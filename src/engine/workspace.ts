// Filesystem access for the editor. Same two-transport pattern as the engine client:
//   • Tauri  — invoke fs_tree/fs_read/fs_write commands (src-tauri)
//   • HTTP   — the dev bridge's /fs/* endpoints (Node fs, confined to a workspace root)
// Paths are relative to the workspace root; the transport resolves them.

export interface FileNode {
  name: string;
  path: string; // relative to workspace root ("" = root)
  isDir: boolean;
  children?: FileNode[];
}

/** A file handed to us from outside the workspace — dropped on the window, or via "Open With". */
export interface ExternalFile {
  /** Absolute path on disk; also the tab identity for an in-place file. */
  path: string;
  name: string;
  /**
   * Set when the path turned out to be *inside* the workspace after all (its workspace-relative
   * path). Then it is an ordinary file and there is nothing to ask the user about.
   */
  rel: string | null;
  content: string;
  /** False for a read-only file — editing is allowed but saving in place will fail. */
  writable: boolean;
}

export interface WorkspaceClient {
  tree(): Promise<FileNode>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  /** Create an empty file (or a directory) at path. Rejects if it already exists. */
  create(path: string, isDir: boolean): Promise<void>;
  /** Move/rename from → to (both relative to the workspace root). */
  rename(from: string, to: string): Promise<void>;
  /** Delete a file or directory (recursive for directories). */
  remove(path: string): Promise<void>;
  /** Native folder dialog → the chosen root, or null (unavailable in a plain browser). */
  pickWorkspace(): Promise<string | null>;
  /** iOS: re-open the folder picked last session (updates the workspace), or null. */
  restoreWorkspace(): Promise<string | null>;
  /**
   * Native file picker (works on iOS too — browse Files/Downloads/iCloud) → import the chosen file
   * into the workspace and return its new path, or null if cancelled/unsupported.
   */
  pickAndImport(): Promise<string | null>;

  /** Whether this transport can open a file in place by absolute path (Tauri only). */
  canOpenExternal(): boolean;
  /** Read an outside-the-workspace file and grant in-place access for this session. */
  openExternal(path: string): Promise<ExternalFile>;
  /** Re-read a file previously granted by openExternal. */
  readExternal(path: string): Promise<string>;
  /** Save back to a file previously granted by openExternal. */
  writeExternal(path: string, content: string): Promise<void>;
  /** Copy an outside file into the workspace; returns its new workspace-relative path. */
  importExternal(path: string): Promise<string>;
  /** Drain paths the OS queued for us before the UI was listening (cold-start "Open With"). */
  takePendingOpens(): Promise<string[]>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

class HttpWorkspace implements WorkspaceClient {
  constructor(private readonly base: string) {}
  tree(): Promise<FileNode> {
    return post<FileNode>(this.base + "/fs/tree", {});
  }
  async read(path: string): Promise<string> {
    const r = await post<{ content: string }>(this.base + "/fs/read", { path });
    return r.content;
  }
  async write(path: string, content: string): Promise<void> {
    await post<{ ok: boolean }>(this.base + "/fs/write", { path, content });
  }
  async create(path: string, isDir: boolean): Promise<void> {
    await post<{ ok: boolean }>(this.base + "/fs/create", { path, isDir });
  }
  async rename(from: string, to: string): Promise<void> {
    await post<{ ok: boolean }>(this.base + "/fs/rename", { from, to });
  }
  async remove(path: string): Promise<void> {
    await post<{ ok: boolean }>(this.base + "/fs/delete", { path });
  }
  async pickWorkspace(): Promise<string | null> {
    return null; // no native folder dialog in the browser
  }
  async restoreWorkspace(): Promise<string | null> {
    return null;
  }
  async pickAndImport(): Promise<string | null> {
    return null; // native file picker unavailable in the browser
  }
  // A browser drop hands over file *contents*, never a path, so nothing can be opened in place.
  canOpenExternal(): boolean {
    return false;
  }
  async openExternal(): Promise<ExternalFile> {
    throw new Error("opening files in place needs the desktop app");
  }
  async readExternal(): Promise<string> {
    throw new Error("opening files in place needs the desktop app");
  }
  async writeExternal(): Promise<void> {
    throw new Error("opening files in place needs the desktop app");
  }
  async importExternal(): Promise<string> {
    throw new Error("importing by path needs the desktop app");
  }
  async takePendingOpens(): Promise<string[]> {
    return [];
  }
}

class TauriWorkspace implements WorkspaceClient {
  async tree(): Promise<FileNode> {
    const { invoke } = await import("@tauri-apps/api/core");
    return JSON.parse(await invoke<string>("fs_tree")) as FileNode;
  }
  async read(path: string): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("fs_read", { path });
  }
  async write(path: string, content: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("fs_write", { path, content });
  }
  async create(path: string, isDir: boolean): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("fs_create", { path, isDir });
  }
  async rename(from: string, to: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("fs_rename", { from, to });
  }
  async remove(path: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("fs_delete", { path });
  }
  async pickWorkspace(): Promise<string | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<string | null>("pick_workspace")) ?? null;
  }
  async restoreWorkspace(): Promise<string | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<string | null>("restore_workspace")) ?? null;
  }
  async pickAndImport(): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Notes", extensions: ["md", "markdown", "txt", "eelisp", "lisp", "json"] }],
    });
    if (typeof picked !== "string") return null; // cancelled
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("import_file", { src: picked });
  }
  canOpenExternal(): boolean {
    return true;
  }
  async openExternal(path: string): Promise<ExternalFile> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ExternalFile>("external_open", { path });
  }
  async readExternal(path: string): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("external_read", { path });
  }
  async writeExternal(path: string, content: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("external_write", { path, content });
  }
  async importExternal(path: string): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("import_file", { src: path });
  }
  async takePendingOpens(): Promise<string[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string[]>("take_pending_opens");
  }
}

function inTauri(): boolean {
  const w = globalThis as Record<string, unknown>;
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in w || "__TAURI__" in w);
}

export function createWorkspaceClient(): WorkspaceClient {
  if (inTauri()) return new TauriWorkspace();
  const url = (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? "http://localhost:8787";
  return new HttpWorkspace(url);
}
