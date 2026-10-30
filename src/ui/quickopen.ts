// Quick-open palette (⌘/Ctrl+P): a fuzzy file finder modal over the tested `fuzzy.ts` ranking —
// and, typed after a ">" (or opened with ⌘⇧P), the actions: every command, key, button and form,
// ranked by core/palette.ts.

import type { FileEntry } from "../core/fuzzy";
import { rankFiles } from "../core/fuzzy";
import type { PaletteItem } from "../core/palette";
import { pushRecent, rankItems } from "../core/palette";

export interface QuickOpen {
  /** Open on the files — or, given ">", on the actions. */
  open(prefix?: string): void;
}

export interface QuickOpenActions {
  /** Every action, gathered fresh each time the list opens. */
  items: () => PaletteItem[];
  run: (item: PaletteItem) => void;
}

const RECENT_KEY = "eeditor.palette.recent";

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(r: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(r));
  } catch {
    /* private window, blocked storage: the order just isn't remembered */
  }
}

export function createQuickOpen(
  getFiles: () => FileEntry[],
  onOpen: (path: string) => void,
  actions?: QuickOpenActions,
): QuickOpen {
  const overlay = document.createElement("div");
  overlay.className = "qo-overlay quick-open";
  overlay.style.display = "none";
  const panel = document.createElement("div");
  panel.className = "qo-panel";
  const input = document.createElement("input");
  input.className = "qo-input";
  input.spellcheck = false;
  const list = document.createElement("div");
  list.className = "qo-list";
  panel.append(input, list);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  type Row = { file: FileEntry } | { item: PaletteItem };
  let results: Row[] = [];
  let selected = 0;
  let all: PaletteItem[] = [];

  const actionMode = (): boolean => !!actions && input.value.startsWith(">");

  function render(): void {
    if (actionMode()) {
      results = rankItems(input.value.slice(1), all, loadRecent()).slice(0, 80).map((item) => ({ item }));
    } else {
      results = rankFiles(input.value, getFiles()).slice(0, 50).map((file) => ({ file }));
    }
    panel.classList.toggle("actions", actionMode());
    if (selected >= results.length) selected = Math.max(0, results.length - 1);
    list.innerHTML = "";
    results.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "qo-row" + (i === selected ? " active" : "");
      if ("file" in r) row.textContent = r.file.path;
      else {
        const text = document.createElement("div");
        text.className = "qo-text";
        const title = document.createElement("div");
        title.className = "qo-title";
        title.textContent = r.item.title;
        text.appendChild(title);
        if (r.item.detail) {
          const detail = document.createElement("div");
          detail.className = "qo-detail";
          detail.textContent = r.item.detail;
          text.appendChild(detail);
        }
        row.appendChild(text);
        if (r.item.key) {
          const key = document.createElement("span");
          key.className = "qo-key";
          key.textContent = r.item.key;
          row.appendChild(key);
        }
        if (r.item.detail) row.title = r.item.detail;
      }
      row.addEventListener("click", () => choose(i));
      list.appendChild(row);
    });
    if (results.length === 0 && actionMode()) {
      const none = document.createElement("div");
      none.className = "qo-none";
      none.textContent = "No action by that name";
      list.appendChild(none);
    }
    list.querySelector(".qo-row.active")?.scrollIntoView({ block: "nearest" });
  }

  function choose(i: number): void {
    const r = results[i];
    if (!r) return;
    close();
    if ("file" in r) onOpen(r.file.path);
    else if (actions) {
      saveRecent(pushRecent(loadRecent(), r.item.id));
      actions.run(r.item);
    }
  }

  function open(prefix = ""): void {
    overlay.style.display = "flex";
    all = actions?.items() ?? [];
    input.value = actions ? prefix : "";
    input.placeholder = actions ? "Open file…   or type > for actions" : "Open file…";
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
