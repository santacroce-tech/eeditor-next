// File-tree sidebar. Loads the workspace tree; clicking a file opens it in the editor.

import type { WorkspaceClient, FileNode } from "../engine/workspace";
import type { FileEntry } from "../core/fuzzy";

export interface Sidebar {
  refresh(): Promise<void>;
  setActive(path: string): void;
  files(): FileEntry[];
}

export function createSidebar(
  parent: HTMLElement,
  ws: WorkspaceClient,
  onOpen: (path: string) => void,
  onContextMenu?: (node: FileNode, x: number, y: number) => void,
): Sidebar {
  const root = document.createElement("div");
  root.className = "filetree";
  parent.appendChild(root);

  let activePath = "";
  const fileEls = new Map<string, HTMLElement>();
  let flatFiles: FileEntry[] = [];

  // Touch has no right-click, so a long-press opens the same context menu.
  // suppressClick stops the finger-lift from also opening/toggling the row.
  let suppressClick = false;
  function longPress(el: HTMLElement, node: FileNode): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sx = 0;
    let sy = 0;
    el.addEventListener(
      "touchstart",
      (e) => {
        const t = e.touches[0];
        sx = t.clientX;
        sy = t.clientY;
        timer = setTimeout(() => {
          timer = undefined;
          suppressClick = true;
          onContextMenu?.(node, t.clientX, t.clientY);
        }, 500);
      },
      { passive: true },
    );
    const cancel = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    el.addEventListener(
      "touchmove",
      (e) => {
        const t = e.touches[0];
        if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) cancel();
      },
      { passive: true },
    );
    el.addEventListener("touchend", cancel);
    el.addEventListener("touchcancel", cancel);
  }

  function renderNode(node: FileNode, depth: number): HTMLElement {
    if (node.isDir) {
      const wrap = document.createElement("div");
      const head = document.createElement("div");
      head.className = "tree-row tree-dir";
      head.style.paddingLeft = `${depth * 12 + 8}px`;
      const caret = document.createElement("span");
      caret.className = "tree-caret";
      caret.textContent = "▾";
      head.append(caret, document.createTextNode(node.path === "" ? node.name : node.name));
      const kids = document.createElement("div");
      for (const c of node.children ?? []) kids.appendChild(renderNode(c, depth + 1));
      head.addEventListener("click", () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        const hidden = kids.style.display === "none";
        kids.style.display = hidden ? "" : "none";
        caret.textContent = hidden ? "▾" : "▸";
      });
      head.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        onContextMenu?.(node, e.clientX, e.clientY);
      });
      longPress(head, node);
      wrap.append(head, kids);
      return wrap;
    }
    const row = document.createElement("div");
    row.className = "tree-row tree-file";
    row.style.paddingLeft = `${depth * 12 + 20}px`;
    row.textContent = node.name;
    row.addEventListener("click", () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      onOpen(node.path);
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      onContextMenu?.(node, e.clientX, e.clientY);
    });
    longPress(row, node);
    fileEls.set(node.path, row);
    flatFiles.push({ name: node.name, path: node.path });
    if (node.path === activePath) row.classList.add("active");
    return row;
  }

  /** A one-line note under the tree: something was left out, and here is why. */
  function notice(text: string, detail?: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "tree-note";
    el.textContent = text;
    if (detail) el.title = detail;
    return el;
  }

  // Two refreshes can be in flight at once (a rename refreshes the tree while a tag pass is still
  // reading). Only the newest one gets to paint, so a slow earlier walk can't replace a newer tree.
  let generation = 0;

  async function refresh(): Promise<void> {
    const mine = ++generation;
    root.innerHTML = "";
    // Reading a workspace takes a moment when the disk is slow, the folder is large, or the OS is
    // still deciding whether we may read it at all. Say so — a blank panel is indistinguishable
    // from an app that has stopped working, which is exactly how the freeze used to look.
    root.appendChild(notice("reading the workspace…"));

    let tree: FileNode;
    try {
      tree = await ws.tree();
    } catch (e) {
      if (mine !== generation) return;
      // Nothing was read, so nothing is open: quick-open and search must not go on offering the
      // files of a workspace we can no longer see.
      fileEls.clear();
      flatFiles = [];
      root.innerHTML = "";
      const err = document.createElement("div");
      err.className = "tree-error";
      // The backend's message already says what happened and what to do about it.
      err.textContent = String(e).replace(/^Error:\s*/, "");
      root.appendChild(err);
      return;
    }
    if (mine !== generation) return;

    fileEls.clear();
    flatFiles = [];
    root.innerHTML = "";
    root.appendChild(renderNode(tree, 0));
    // Folders that were there but couldn't be read, and a walk that stopped early, are both things
    // the user has to be told: either one looks like files went missing.
    const denied = tree.unreadable ?? [];
    if (denied.length > 0) {
      root.appendChild(
        notice(
          `${denied.length} folder${denied.length > 1 ? "s" : ""} could not be read`,
          denied.join("\n"),
        ),
      );
    }
    if (tree.truncated) {
      root.appendChild(notice("this folder is very large — the tree stops here", "Not every file is listed."));
    }
  }

  function setActive(path: string): void {
    fileEls.get(activePath)?.classList.remove("active");
    activePath = path;
    fileEls.get(path)?.classList.add("active");
  }

  return { refresh, setActive, files: () => flatFiles };
}
