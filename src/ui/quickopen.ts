// Quick-open palette (⌘/Ctrl+P): a fuzzy file finder modal over the tested `fuzzy.ts` ranking.

import type { FileEntry } from "../core/fuzzy";
import { rankFiles } from "../core/fuzzy";

export interface QuickOpen {
  open(): void;
}

export function createQuickOpen(getFiles: () => FileEntry[], onOpen: (path: string) => void): QuickOpen {
  const overlay = document.createElement("div");
  overlay.className = "qo-overlay";
  overlay.style.display = "none";
  const panel = document.createElement("div");
  panel.className = "qo-panel";
  const input = document.createElement("input");
  input.className = "qo-input";
  input.placeholder = "Open file…";
  input.spellcheck = false;
  const list = document.createElement("div");
  list.className = "qo-list";
  panel.append(input, list);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let results: FileEntry[] = [];
  let selected = 0;

  function render(): void {
    results = rankFiles(input.value, getFiles()).slice(0, 50);
    if (selected >= results.length) selected = Math.max(0, results.length - 1);
    list.innerHTML = "";
    results.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = "qo-row" + (i === selected ? " active" : "");
      row.textContent = f.path;
      row.addEventListener("click", () => choose(i));
      list.appendChild(row);
    });
  }

  function choose(i: number): void {
    const f = results[i];
    if (f) {
      close();
      onOpen(f.path);
    }
  }

  function open(): void {
    overlay.style.display = "flex";
    input.value = "";
    selected = 0;
    render();
    input.focus();
  }

  function close(): void {
    overlay.style.display = "none";
  }

  input.addEventListener("input", () => {
    selected = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = Math.min(results.length - 1, selected + 1);
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(0, selected - 1);
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(selected);
    }
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  return { open };
}
