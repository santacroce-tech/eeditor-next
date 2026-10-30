// ⌘P's actions (type ">", or ⌘⇧P): everything EEditor can do, found by name. Pure + testable; the
// list's DOM is ui/quickopen.ts, and main.ts runs what's picked.
//
// The list is gathered, never written by hand: the app's commands, every key in the keybindings
// (named by the comment above its (bind …)), the header's buttons, (action …) forms, and the
// workspace's forms.

import type { Binding, Button } from "./keybindings";
import { fuzzyMatch } from "./fuzzy";
import { keyLabel } from "./keybindings";

/** What picking an action does — main.ts carries it out. */
export type PaletteRun =
  | { kind: "command"; command: string }
  | { kind: "binding"; binding: Binding }
  | { kind: "button"; button: Button }
  | { kind: "form"; path: string };

export interface PaletteItem {
  /** Stable across reloads, for the recently-used order: "cmd:save", "key:ma:s", "act:Label", … */
  id: string;
  title: string;
  /** A second, dimmer line: the full comment, the path. */
  detail?: string;
  /** The key, as a person reads it: "⌘⌥S". */
  key?: string;
  /** More words that find it — a button's label, the command's name. */
  also?: string;
  run: PaletteRun;
}

/** The app's commands, as the list names them. One missing here is shown by its name, de-hyphenated. */
export const COMMAND_TITLES: Record<string, string> = {
  save: "Save",
  search: "Search in every note",
  "daily-note": "Today's daily note",
  "new-file": "New note",
  "new-folder": "New folder",
  "new-sheet": "New sheet",
  "new-form": "New form",
  "new-mindmap": "New mind map",
  "new-window": "New window",
  "form-design": "Form: design view",
  "form-code": "Form: code view",
  "form-run": "Form: run it",
  "mindmap-map": "Mind map: map view",
  "mindmap-text": "Mind map: text view",
  "export-html": "Export the form as HTML",
  "export-pdf": "Export as PDF",
  "open-keys": "Open the keybindings",
  "reload-keys": "Reload the keybindings",
  "open-functions": "Open the sheet functions",
  "reload-functions": "Reload the sheet functions",
  "add-samples": "Add the sample notes",
  "install-pim": "Install the PIM keys",
  about: "About EEditor",
  "toggle-repl": "Show / hide the EELisp REPL",
  "focus-repl": "Go to the REPL",
  "focus-editor": "Go to the editor",
  "toggle-preview": "Preview / edit",
  "toggle-theme": "Next theme",
  "theme-dark": "Theme: dark",
  "theme-light": "Theme: light",
  "theme-vb6": "Theme: VB6",
  "insert-image": "Insert an image",
  snippets: "Snippets",
  calendar: "Calendar",
  "agenda-setup": "Agenda: set up",
  "agenda-refresh": "Agenda: refresh",
  "open-file": "Open a file from disk",
  "copy-into-workspace": "Copy a file into the workspace",
  "close-tab": "Close the tab",
  "next-tab": "Next tab",
  "prev-tab": "Previous tab",
};

/** Not offered: they'd open this list, or another one in its place. */
const HIDDEN = new Set(["quick-open", "command-palette"]);

const humanize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, " ");

/**
 * A key's comment as a title. "⌘⌥S — every note in step with the agenda: lines whose…" → "Every
 * note in step with the agenda": the keys written in front go, and a long one stops at its first
 * ":", ";", " — " or end of sentence that isn't inside quotes, parens or a <!-- … --> — the rest
 * is the detail line.
 */
export function docTitle(doc: string): string {
  let t = withoutKeys(doc);
  if (t.length > 48) {
    // the first ": ", "; ", " — " or ". Next" that isn't inside quotes, parens or a <!-- … -->
    const cut = /(?:[:;]\s|\s—\s|\.\s(?=[A-Z])|[:.;]$)/g;
    for (let m = cut.exec(t); m; m = cut.exec(t)) {
      const head = t.slice(0, m.index);
      const count = (re: RegExp) => (head.match(re) ?? []).length;
      const open = count(/"/g) % 2 === 1 || count(/\(/g) > count(/\)/g) || count(/<!--/g) > count(/-->/g);
      if (head.length >= 12 && !open) {
        t = head;
        break;
      }
    }
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A comment without the keys written in front of it: "⌘⌥S — every note…" → "every note…". */
const withoutKeys = (doc: string): string => doc.replace(/^[^—]*[⌘⌥⌃⇧][^—]*—\s*/, "").trim();

/** A binding with no comment: its body, shortened — `(pim-clock-out)`. */
function bodyTitle(b: Binding): string {
  const body = b.source.replace(/^\(list\s*/, "").replace(/\)$/, "").replace(/\s+/g, " ").trim();
  return body.length > 56 ? body.slice(0, 55) + "…" : body;
}

const baseName = (p: string): string => (p.split("/").pop() ?? p).replace(/\.eeform$/i, "");

export interface PaletteSources {
  commands: string[];
  bindings: Binding[];
  buttons: Button[];
  actions: Button[];
  /** Workspace paths of the forms (*.eeform). */
  forms: string[];
  mac: boolean;
}

export function paletteItems(src: PaletteSources): PaletteItem[] {
  const items: PaletteItem[] = [];
  const keyOf = new Map<string, string>(); // command → the key bound to exactly it
  for (const b of src.bindings) if (b.command && !keyOf.has(b.command)) keyOf.set(b.command, keyLabel(b.spec, src.mac));
  const labelOf = new Map<string, string>(); // binding id / command → the label of a button for it
  for (const b of src.buttons) {
    if (b.key && b.label) labelOf.set(b.key, b.label);
    else if (b.command && b.label) labelOf.set(b.command, b.label);
  }

  // what you wrote first: (action …), then your keys, then buttons with a body of their own
  for (const a of src.actions) {
    const bound = a.key ? src.bindings.find((b) => b.id === a.key) : undefined;
    items.push({
      id: `act:${a.label}`,
      title: a.label,
      key: a.key && bound ? keyLabel(bound.spec, src.mac) : undefined,
      run: a.command ? { kind: "command", command: a.command } : { kind: "button", button: a },
    });
  }
  for (const b of src.bindings) {
    if (b.command) continue; // the command's own row shows its key
    items.push({
      id: `key:${b.id}`,
      title: b.doc ? docTitle(b.doc) : bodyTitle(b),
      detail: b.doc && docTitle(b.doc).length < withoutKeys(b.doc).length ? withoutKeys(b.doc) : undefined,
      key: keyLabel(b.spec, src.mac),
      also: labelOf.get(b.id),
      run: { kind: "binding", binding: b },
    });
  }
  for (const b of src.buttons) {
    if (b.key || b.command) continue; // the key's or the command's row has it
    items.push({ id: `btn:${b.label}`, title: b.label, run: { kind: "button", button: b } });
  }
  for (const c of src.commands) {
    if (HIDDEN.has(c)) continue;
    items.push({
      id: `cmd:${c}`,
      title: COMMAND_TITLES[c] ?? humanize(c),
      key: keyOf.get(c),
      also: [c, labelOf.get(c)].filter(Boolean).join(" "),
      run: { kind: "command", command: c },
    });
  }
  for (const p of src.forms) {
    items.push({ id: `form:${p}`, title: `Run form: ${baseName(p)}`, detail: p, run: { kind: "form", path: p } });
  }
  return items;
}

/**
 * The list for what's typed (without the ">"): the matches, best first — the title starting with
 * it, then a word of it starting with it, then containing it, then the letters in order anywhere —
 * and among equals the recently used first. Nothing typed: the recent ones, then the rest in order.
 */
export function rankItems(query: string, items: PaletteItem[], recent: string[]): PaletteItem[] {
  const q = query.trim().toLowerCase();
  const rec = (it: PaletteItem): number => {
    const i = recent.indexOf(it.id);
    return i < 0 ? recent.length : i;
  };
  const score = (it: PaletteItem): number => {
    const t = it.title.toLowerCase();
    const all = `${t} ${(it.also ?? "").toLowerCase()} ${(it.detail ?? "").toLowerCase()}`;
    if (t.startsWith(q)) return 0;
    if (t.split(/[\s:/(—-]+/).some((w) => w.startsWith(q))) return 1;
    if (t.includes(q)) return 2;
    if (all.includes(q)) return 3;
    if (fuzzyMatch(q, t)) return 4;
    if (fuzzyMatch(q, all)) return 5;
    return -1;
  };
  const scored = items
    .map((it, order) => ({ it, order, s: q === "" ? 0 : score(it), r: rec(it) }))
    .filter((x) => x.s >= 0);
  scored.sort((a, b) => a.s - b.s || a.r - b.r || a.order - b.order);
  return scored.map((x) => x.it);
}

/** The recently-used list after picking `id`: it first, at most `max`. */
export function pushRecent(recent: string[], id: string, max = 20): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}
