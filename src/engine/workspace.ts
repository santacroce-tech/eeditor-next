// Filesystem access for the editor. Same two-transport pattern as the engine client:
//   • Tauri  — invoke fs_tree/fs_read/fs_write commands (src-tauri)
//   • HTTP   — the dev bridge's /fs/* endpoints (Node fs, confined to a workspace root)
// Paths are relative to the workspace root; the transport resolves them.

export interface FileNode {
  name: string;
  path: string; // relative to workspace root ("" = root)
  isDir: boolean;
  children?: FileNode[];
  /**
   * Root only. Folders the walk was not allowed to read, `"path: reason"` each — a macOS privacy
   * gate, usually. Reported rather than dropped: an unreadable folder is otherwise an empty one.
   */
  unreadable?: string[];
  /** Root only. The walk hit its size cap, so the tree is not the whole folder. */
  truncated?: boolean;
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
   * Native file picker (works on iOS too — browse Files/Downloads/iCloud) → the chosen absolute
   * path, or null if cancelled/unsupported. The caller decides what to do with it; picking a file
   * asks the same copy-in/in-place question as dropping one.
   */
  pickFile(): Promise<string | null>;

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
  /** Where a workspace-relative path actually is on disk. */
  absPath(path: string): Promise<string>;
  /** Whether the platform has a file manager we can show a file in. */
  canReveal(): boolean;
  /** Show a workspace file in the system file manager. */
  reveal(path: string): Promise<void>;
  /** Show a file opened in place — its path is already absolute. */
  revealExternal(path: string): Promise<void>;
  /**
   * Let the app finish quitting. A quit is held back until the editor has flushed what is unsaved
   * (see the `app-exiting` event); this is the frontend saying "done, you may go".
   */
  exitApp(): Promise<void>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // The bridge answers a failure with {ok:false,error} — that message is the useful part.
    const detail = await res.text().catch(() => "");
    let msg = "";
    try {
      msg = String((JSON.parse(detail) as { error?: unknown }).error ?? "");
    } catch {
      msg = detail;
    }
    throw new Error(msg || `${url} → ${res.status}`);
  }
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
  async pickFile(): Promise<string | null> {
    return null; // no native file picker in the browser — the UI falls back to <input type=file>
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
  async absPath(path: string): Promise<string> {
    const r = await post<{ path: string }>(`${this.base}/fs/abspath`, { path });
    return r.path;
  }
  // The bridge runs on the dev machine and could shell out, but a browser tab is not the app —
  // saying where the file is, is the part that makes sense here.
  canReveal(): boolean {
    return false;
  }
  async reveal(): Promise<void> {
    throw new Error("revealing files needs the desktop app");
  }
  async revealExternal(): Promise<void> {
    throw new Error("revealing files needs the desktop app");
  }
  async exitApp(): Promise<void> {
    /* a browser tab closes itself */
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
  async pickFile(): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    // No extension filter: anything that turns out to be text is editable, and the backend says so
    // by reading it. A filter here would hide files EEditor can perfectly well open.
    const picked = await open({ multiple: false, directory: false });
    return typeof picked === "string" ? picked : null; // null = cancelled
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
  async absPath(path: string): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("fs_abs_path", { path });
  }
  canReveal(): boolean {
    // iOS has no file manager to reveal into; the Files app is the user's own way in.
    return !/iPad|iPhone|iPod/.test(navigator.userAgent);
  }
  async reveal(path: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("fs_reveal", { path });
  }
  async revealExternal(path: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("external_reveal", { path });
  }
  async exitApp(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("finish_exit");
  }
}

export function inTauri(): boolean {
  const w = globalThis as Record<string, unknown>;
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in w || "__TAURI__" in w);
}

export function createWorkspaceClient(): WorkspaceClient {
  if (inTauri()) return new TauriWorkspace();
  const url = (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? "http://localhost:8787";
  return new HttpWorkspace(url);
}
