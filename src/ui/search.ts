// Full-text search modal (⌘/Ctrl+Shift+F). Reads every workspace file once on open, then filters
// in memory with the tested `searchFiles`. Click a hit to open the file at that line.

import type { FileEntry } from "../core/fuzzy";
import { searchFiles, type SearchFile, type SearchHit } from "../core/search";

export interface SearchModal {
  open(initial?: string): void;
}

export function createSearch(
  getFiles: () => FileEntry[],
  readFile: (path: string) => Promise<string>,
  onOpen: (path: string, line: number) => void,
): SearchModal {
  const overlay = document.createElement("div");
  overlay.className = "qo-overlay";
  overlay.style.display = "none";
  const panel = document.createElement("div");
  panel.className = "qo-panel search-panel";
  const input = document.createElement("input");
  input.className = "qo-input";
  input.placeholder = "Search in files…";
  input.spellcheck = false;
  const list = document.createElement("div");
  list.className = "qo-list search-list";
  panel.append(input, list);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let cache: SearchFile[] = [];
  let hits: SearchHit[] = [];
  let selected = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  function render(): void {
    hits = input.value.trim() ? searchFiles(cache, input.value.trim()).slice(0, 200) : [];
    if (selected >= hits.length) selected = Math.max(0, hits.length - 1);
    list.innerHTML = "";
    hits.forEach((h, i) => {
      const row = document.createElement("div");
      row.className = "search-row" + (i === selected ? " active" : "");
      const loc = document.createElement("div");
      loc.className = "search-loc";
      loc.textContent = `${h.path}:${h.line}`;
      const snippet = document.createElement("div");
      snippet.className = "search-snippet";
      snippet.textContent = h.text.trim();
      row.append(loc, snippet);
      row.addEventListener("click", () => choose(i));
      list.appendChild(row);
    });
  }

  function choose(i: number): void {
    const h = hits[i];
    if (h) {
      close();
      onOpen(h.path, h.line);
    }
  }

  async function open(initial?: string): Promise<void> {
    overlay.style.display = "flex";
    input.value = initial ?? "";
    hits = [];
    selected = 0;
    render();
    input.focus();
    input.select();
    // load contents once, then re-render with the (possibly pre-filled) query
    const files = getFiles();
    cache = await Promise.all(
      files.map((f) => readFile(f.path).then((content) => ({ path: f.path, content })).catch(() => ({ path: f.path, content: "" }))),
    );
    render();
  }

  function close(): void {
    overlay.style.display = "none";
  }

  input.addEventListener("input", () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      selected = 0;
      render();
    }, 120);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = Math.min(hits.length - 1, selected + 1);
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

  return { open: (initial?: string) => void open(initial) };
}
