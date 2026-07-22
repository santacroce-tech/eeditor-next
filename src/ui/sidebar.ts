// File-tree sidebar. Loads the workspace tree; clicking a file opens it in the editor.

import type { WorkspaceClient, FileNode } from "../engine/workspace";
import type { FileEntry } from "../core/fuzzy";

export interface Sidebar {
  refresh(): Promise<void>;
  setActive(path: string): void;
  files(): FileEntry[];
}

export function createSidebar(parent: HTMLElement, ws: WorkspaceClient, onOpen: (path: string) => void): Sidebar {
  const root = document.createElement("div");
  root.className = "filetree";
  parent.appendChild(root);

  let activePath = "";
  const fileEls = new Map<string, HTMLElement>();
  let flatFiles: FileEntry[] = [];

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
        const hidden = kids.style.display === "none";
        kids.style.display = hidden ? "" : "none";
        caret.textContent = hidden ? "▾" : "▸";
      });
      wrap.append(head, kids);
      return wrap;
    }
    const row = document.createElement("div");
    row.className = "tree-row tree-file";
    row.style.paddingLeft = `${depth * 12 + 20}px`;
    row.textContent = node.name;
    row.addEventListener("click", () => onOpen(node.path));
    fileEls.set(node.path, row);
    flatFiles.push({ name: node.name, path: node.path });
    if (node.path === activePath) row.classList.add("active");
    return row;
  }

  async function refresh(): Promise<void> {
    fileEls.clear();
    flatFiles = [];
    root.innerHTML = "";
    try {
      const tree = await ws.tree();
      root.appendChild(renderNode(tree, 0));
    } catch (e) {
      const err = document.createElement("div");
      err.className = "tree-error";
      err.textContent = `workspace unavailable: ${String(e)}`;
      root.appendChild(err);
    }
  }

  function setActive(path: string): void {
    fileEls.get(activePath)?.classList.remove("active");
    activePath = path;
    fileEls.get(path)?.classList.add("active");
  }

  return { refresh, setActive, files: () => flatFiles };
}
