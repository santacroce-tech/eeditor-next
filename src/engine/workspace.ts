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
