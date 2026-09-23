// Forms — the model. Pure and testable; the canvas lives in ui/formdesigner.ts, the running form
// in ui/formrun.ts, and the engine round-trips in engine/form.ts.
//
// A `.eeform` file is EELisp source. One top-level `(form …)` holds the layout — what the designer
// reads and writes — and everything else in the file is the author's: `(deftable …)`, the event
// handlers as ordinary `(defn …)`s, comments. The designer only ever rewrites the layout's range.
//
//   (form "Contacts" :size (480 380) :on-load load-contacts
//     (label   lblName :text "Name" :at (16 20) :size (72 24))
//     (textbox txtName :at (96 16) :size (240 28))
//     (button  btnSave :text "Save" :at (96 92) :size (90 30) :on-click save-contact))
//
// Everything here works on text: an s-expression reader and printer for that subset, the layout as
// a `FormSpec`, and the splice back into the file.

import { lispString } from "./keybindings";

export const FORM_EXT = ".eeform";
export const isFormPath = (p: string): boolean => /\.eeform$/i.test(p);

/** Positions and sizes snap to this. */
export const GRID = 8;
export const snap = (n: number, g = GRID): number => Math.round(n / g) * g;

// ── s-expressions ─────────────────────────────────────────────────────────

export type Sx =
  | { t: "sym"; v: string }
  | { t: "kw"; v: string }
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "nil" }
  | { t: "list"; v: Sx[] }
  /** `{…}` — kept so a dict in a property survives a round trip; the designer never edits one. */
  | { t: "dict"; v: Sx[] };

export const sym = (v: string): Sx => ({ t: "sym", v });
export const kw = (v: string): Sx => ({ t: "kw", v });
export const str = (v: string): Sx => ({ t: "str", v });
export const num = (v: number): Sx => ({ t: "num", v });
export const list = (...v: Sx[]): Sx => ({ t: "list", v });

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const isDelim = (c: string): boolean => /[\s()[\]{}"';`,]/.test(c);

export class ReadError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
  ) {
    super(message);
  }
}

/** Read every form in `src`, or the one starting at `from`. */
export function readAll(src: string): Sx[] {
  const r = new Reader(src);
  const out: Sx[] = [];
  for (;;) {
    r.skip();
    if (r.i >= src.length) return out;
    out.push(r.read());
  }
}

class Reader {
  i = 0;
  constructor(private readonly s: string) {}

  skip(): void {
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === ";") {
        while (this.i < s.length && s[this.i] !== "\n") this.i++;
      } else if (/\s/.test(c)) this.i++;
      else return;
    }
  }

  read(): Sx {
    this.skip();
    const s = this.s;
    if (this.i >= s.length) throw new ReadError("unexpected end of input", this.i);
    const c = s[this.i];
    if (c === "(" || c === "[" || c === "{") {
      const close = c === "(" ? ")" : c === "[" ? "]" : "}";
      const start = this.i++;
      const items: Sx[] = [];
      for (;;) {
        this.skip();
        if (this.i >= s.length) throw new ReadError(`missing ${close}`, start);
        if (s[this.i] === close) {
          this.i++;
          return c === "{" ? { t: "dict", v: items } : { t: "list", v: items };
        }
        if (/[)\]}]/.test(s[this.i])) throw new ReadError(`unexpected ${s[this.i]}`, this.i);
        items.push(this.read());
      }
    }
    if (c === ")" || c === "]" || c === "}") throw new ReadError(`unexpected ${c}`, this.i);
    if (c === "'" || c === "`") {
      this.i++;
      return list(sym(c === "'" ? "quote" : "quasiquote"), this.read());
    }
    if (c === ",") {
      this.i++;
      return list(sym("unquote"), this.read());
    }
    if (c === '"') return this.string();
    const start = this.i;
    while (this.i < s.length && !isDelim(s[this.i])) this.i++;
    const tok = s.slice(start, this.i);
    if (tok === "") throw new ReadError(`unexpected ${c}`, start);
    if (tok === "true") return { t: "bool", v: true };
    if (tok === "false") return { t: "bool", v: false };
    if (tok === "nil") return { t: "nil" };
    if (NUMBER_RE.test(tok)) return num(Number(tok));
    if (tok.startsWith(":") && tok.length > 1) return kw(tok.slice(1));
    return sym(tok);
  }

  private string(): Sx {
    const s = this.s;
    const start = this.i++;
    let out = "";
    while (this.i < s.length) {
      const c = s[this.i++];
      if (c === '"') return str(out);
      if (c === "\\" && this.i < s.length) {
        const e = s[this.i++];
        out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
      } else out += c;
    }
    throw new ReadError("unterminated string", start);
  }
}

/** One form on one line. */
export function printSx(x: Sx): string {
  switch (x.t) {
    case "sym":
      return x.v;
    case "kw":
      return ":" + x.v;
    case "str":
      return lispString(x.v);
    case "num":
      return Number.isFinite(x.v) ? String(x.v) : "0";
    case "bool":
      return x.v ? "true" : "false";
    case "nil":
      return "nil";
    case "list":
      return "(" + x.v.map(printSx).join(" ") + ")";
    case "dict":
      return "{" + x.v.map(printSx).join(" ") + "}";
  }
}

// ── the top-level forms of a file ─────────────────────────────────────────

export interface Range {
  start: number;
  end: number;
}

/**
 * Where each top-level form of a file starts and ends — by scanning, not reading, so a file with a
 * broken form elsewhere still yields the ranges before it. Strings and comments are honoured;
 * an unclosed form runs to the end of the file.
 */
export function topLevelForms(src: string): Range[] {
  const out: Range[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === ";") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === '"') {
      if (depth === 0) start = i;
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      if (depth === 0) {
        out.push({ start, end: Math.min(i + 1, src.length) });
        start = -1;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      if (depth > 0) depth--;
      if (depth === 0 && start >= 0) {
        out.push({ start, end: i + 1 });
        start = -1;
      }
    } else if (depth === 0 && !/\s/.test(c)) {
      // an atom on its own at top level
      if (start < 0) start = i;
      while (i + 1 < src.length && !isDelim(src[i + 1])) i++;
      out.push({ start, end: i + 1 });
      start = -1;
    }
  }
  if (start >= 0) out.push({ start, end: src.length });
  return out;
}

/** The first top-level form whose head is `head` — `(form …)`, `(defn save …)`. */
function formHeaded(src: string, range: Range, head: string, name?: string): boolean {
  const text = src.slice(range.start, range.end);
  const m = /^\(\s*([^\s()]+)(?:\s+([^\s()]+))?/.exec(text);
  if (!m || m[1] !== head) return false;
  return name === undefined || m[2] === name;
}

/** The range of the layout — the top-level `(form …)` — if the file has one. */
export function layoutRange(src: string): Range | undefined {
  return topLevelForms(src).find((r) => formHeaded(src, r, "form"));
}

/** The range of `(defn name …)` (or `defun`/`def`), if the file defines it at top level. */
export function defnRange(src: string, name: string): Range | undefined {
  return topLevelForms(src).find(
    (r) => formHeaded(src, r, "defn", name) || formHeaded(src, r, "defun", name) || formHeaded(src, r, "def", name),
  );
}

// ── the layout ────────────────────────────────────────────────────────────

export type ControlType = "label" | "textbox" | "button" | "checkbox" | "radio" | "dropdown" | "listbox" | "grid" | "date" | "image" | "timer" | "tabs" | "sheet";

/** `scalar`: a number or a string, kept as whichever it was — `:min 0` stays a number, `:min "2026-01-01"` a string. */
export type PropKind = "text" | "number" | "bool" | "items" | "scalar";
export type PropValue = string | number | boolean | string[];

export interface PropDef {
  key: string;
  kind: PropKind;
  label: string;
  /** Left out of the file when the value is this. */
  default?: PropValue;
}

export interface ControlDef {
  label: string;
  /** Name prefix in the VB tradition: btnSave, txtName. */
  prefix: string;
  /** The size a new one gets — multiples of GRID, so placing one never re-snaps it. */
  w: number;
  h: number;
  /** Type-specific properties, in the order they are shown and written. */
  props: PropDef[];
  /** Events the control fires, without the `on-`: "click", "change". */
  events: string[];
  /** Properties a new control starts with. */
  initial: Record<string, PropValue>;
}

const ENABLED: PropDef = { key: "enabled", kind: "bool", label: "Enabled", default: true };
/** A `:submit` button refuses to run its handler while a required control holds nothing. */
const REQUIRED: PropDef = { key: "required", kind: "bool", label: "Required", default: false };
const VISIBLE: PropDef = { key: "visible", kind: "bool", label: "Visible", default: true };
/** `:page "Notes"` — the control belongs to that page of a `tabs` control, and shows only while it is the one open. */
const PAGE: PropDef = { key: "page", kind: "text", label: "Page", default: "" };
/** Every control has these, after its own. */
export const COMMON_PROPS: PropDef[] = [ENABLED, VISIBLE, PAGE];

export const CONTROLS: Record<ControlType, ControlDef> = {
  label: {
    label: "Label",
    prefix: "lbl",
    w: 96,
    h: 24,
    props: [{ key: "text", kind: "text", label: "Text" }],
    events: [],
    initial: { text: "Label" },
  },
  textbox: {
    label: "Text box",
    prefix: "txt",
    w: 160,
    h: 32,
    props: [
      { key: "value", kind: "text", label: "Value", default: "" },
      { key: "placeholder", kind: "text", label: "Placeholder", default: "" },
      { key: "multiline", kind: "bool", label: "Multiline", default: false },
      { key: "number", kind: "bool", label: "Number", default: false },
      REQUIRED,
      { key: "min", kind: "scalar", label: "Min", default: "" },
      { key: "max", kind: "scalar", label: "Max", default: "" },
      { key: "pattern", kind: "text", label: "Pattern", default: "" },
    ],
    events: ["change"],
    initial: {},
  },
  button: {
    label: "Button",
    prefix: "btn",
    w: 88,
    h: 32,
    props: [
      { key: "text", kind: "text", label: "Text" },
      { key: "submit", kind: "bool", label: "Checks required", default: false },
      { key: "default", kind: "bool", label: "Enter presses it", default: false },
      { key: "cancel", kind: "bool", label: "Escape presses it", default: false },
    ],
    events: ["click", "validate"],
    initial: { text: "Button" },
  },
  checkbox: {
    label: "Check box",
    prefix: "chk",
    w: 144,
    h: 24,
    props: [
      { key: "text", kind: "text", label: "Text" },
      { key: "value", kind: "bool", label: "Checked", default: false },
    ],
    events: ["change"],
    initial: { text: "Check" },
  },
  radio: {
    label: "Radio group",
    prefix: "opt",
    w: 144,
    h: 72,
    props: [
      { key: "items", kind: "items", label: "Items", default: [] },
      { key: "value", kind: "text", label: "Value", default: "" },
      REQUIRED,
    ],
    events: ["change"],
    initial: { items: ["One", "Two", "Three"] },
  },
  dropdown: {
    label: "Dropdown",
    prefix: "cmb",
    w: 160,
    h: 32,
    props: [
      { key: "items", kind: "items", label: "Items", default: [] },
      { key: "value", kind: "text", label: "Value", default: "" },
      REQUIRED,
    ],
    events: ["change"],
    initial: { items: ["One", "Two"] },
  },
  listbox: {
    label: "List box",
    prefix: "lst",
    w: 160,
    h: 96,
    props: [
      { key: "items", kind: "items", label: "Items", default: [] },
      { key: "value", kind: "text", label: "Value", default: "" },
      REQUIRED,
    ],
    events: ["change", "dblclick"],
    initial: { items: ["One", "Two", "Three"] },
  },
  date: {
    label: "Date",
    prefix: "dtp",
    w: 160,
    h: 32,
    props: [
      { key: "value", kind: "text", label: "Value", default: "" },
      REQUIRED,
      { key: "min", kind: "scalar", label: "Min", default: "" },
      { key: "max", kind: "scalar", label: "Max", default: "" },
    ],
    events: ["change"],
    initial: {},
  },
  image: {
    label: "Image",
    prefix: "img",
    w: 160,
    h: 120,
    props: [{ key: "src", kind: "text", label: "Source", default: "" }],
    events: [],
    initial: {},
  },
  tabs: {
    label: "Tabs",
    prefix: "tab",
    w: 320,
    h: 200,
    props: [
      { key: "pages", kind: "items", label: "Pages", default: [] },
      { key: "value", kind: "text", label: "Open page", default: "" },
    ],
    events: ["change"],
    initial: { pages: ["General", "Details"] },
  },
  sheet: {
    label: "Sheet",
    prefix: "sht",
    w: 400,
    h: 240,
    props: [
      { key: "file", kind: "text", label: "Sheet file", default: "" },
      { key: "toolbar", kind: "bool", label: "Toolbar and formula bar", default: true },
    ],
    events: [],
    initial: {},
  },
  timer: {
    label: "Timer",
    prefix: "tmr",
    w: 32,
    h: 32,
    props: [{ key: "interval", kind: "number", label: "Every (ms)", default: 1000 }],
    events: ["tick"],
    initial: { interval: 1000 },
  },
  grid: {
    label: "Grid",
    prefix: "grd",
    w: 320,
    h: 160,
    props: [
      { key: "columns", kind: "items", label: "Columns", default: [] },
      { key: "editable", kind: "bool", label: "Editable cells", default: false },
      { key: "sortable", kind: "bool", label: "Sort by header", default: false },
      { key: "filter", kind: "bool", label: "Filter box", default: false },
      { key: "page-size", kind: "number", label: "Rows per page", default: 0 },
    ],
    events: ["change", "dblclick", "edit"],
    initial: { columns: [] },
  },
};

/** The toolbox order: the everyday controls first, containers and the odd ones last. */
export const CONTROL_TYPES: ControlType[] = ["label", "textbox", "button", "checkbox", "radio", "dropdown", "listbox", "grid", "date", "image", "tabs", "sheet", "timer"];
export const isControlType = (s: string): s is ControlType => s in CONTROLS;

export interface Control {
  type: ControlType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Typed properties from the catalogue (its own and the common ones). */
  props: Record<string, PropValue>;
  /** Event → handler function name: `{ click: "save-contact" }`. */
  events: Record<string, string>;
  /** Properties the catalogue doesn't know, kept as written so a hand edit survives the designer. */
  extra: [string, Sx][];
}

/** One entry of a menu: a label and the handler it runs, or a separator (label "-"). */
export interface MenuItem {
  label: string;
  handler?: string;
}
export interface Menu {
  title: string;
  items: MenuItem[];
}

export interface FormSpec {
  title: string;
  w: number;
  h: number;
  onLoad?: string;
  /** `:menu (("File" ("New" new-item) ("-") ("Quit" quit)) …)` — a menu bar under the title. */
  menu: Menu[];
  controls: Control[];
  extra: [string, Sx][];
}

/** `:menu` as data ⇄ Menu[]. Anything malformed is skipped rather than refused. */
export function parseMenu(x: Sx): Menu[] {
  if (x.t !== "list") return [];
  const out: Menu[] = [];
  for (const m of x.v) {
    if (m.t !== "list" || m.v.length === 0 || m.v[0].t !== "str") continue;
    const items: MenuItem[] = [];
    for (const it of m.v.slice(1)) {
      if (it.t !== "list" || it.v.length === 0 || it.v[0].t !== "str") continue;
      const handler = it.v[1] ? fnName(it.v[1]) : undefined;
      items.push(it.v[0].v === "-" ? { label: "-" } : { label: it.v[0].v, handler });
    }
    out.push({ title: m.v[0].v, items });
  }
  return out;
}

export function menuSx(menu: Menu[]): Sx {
  return list(...menu.map((m) => list(str(m.title), ...m.items.map((it) => (it.label === "-" ? list(str("-")) : list(str(it.label), ...(it.handler ? [sym(it.handler)] : [])))))));
}

/**
 * The menu as a person types it in the properties panel — a title on its own line, its items
 * indented as `label = handler`, `-` for a separator:
 *
 *   File
 *     New = new-item
 *     -
 *     Quit = quit
 */
export function menuText(menu: Menu[]): string {
  return menu.map((m) => [m.title, ...m.items.map((it) => (it.label === "-" ? "  -" : `  ${it.label}${it.handler ? " = " + it.handler : ""}`))].join("\n")).join("\n");
}

export function parseMenuText(text: string): Menu[] {
  const out: Menu[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const indented = /^\s/.test(raw);
    const line = raw.trim();
    if (!indented || out.length === 0) {
      out.push({ title: line, items: [] });
      continue;
    }
    const menu = out[out.length - 1];
    if (line === "-") {
      menu.items.push({ label: "-" });
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) menu.items.push({ label: line });
    else menu.items.push({ label: line.slice(0, eq).trim(), handler: line.slice(eq + 1).trim() || undefined });
  }
  return out;
}

export const DEFAULT_FORM_SIZE = { w: 480, h: 360 };
export const MIN_CONTROL = 16;
export const MIN_FORM = 120;
export const MAX_FORM = 4000;

export function emptyForm(title: string): FormSpec {
  return { title, ...DEFAULT_FORM_SIZE, menu: [], controls: [], extra: [] };
}

/** What a new file holds: a comment saying whose the two halves are, then an empty layout. */
export function newFormSource(title: string): string {
  return (
    `;; ${title} — an EEditor form. The (form …) below is the layout the designer writes;\n` +
    `;; everything after it is yours: tables, and the handlers its events name.\n\n` +
    printFormSpec(emptyForm(title)) +
    "\n"
  );
}

const pair = (x: Sx): [number, number] | undefined =>
  x.t === "list" && x.v.length === 2 && x.v[0].t === "num" && x.v[1].t === "num" ? [x.v[0].v, x.v[1].v] : undefined;

const fnName = (x: Sx): string | undefined => (x.t === "sym" ? x.v : x.t === "str" ? x.v : undefined);

/** A property value as the catalogue types it, or undefined when it isn't of that kind. */
function propValue(kind: PropKind, x: Sx): PropValue | undefined {
  switch (kind) {
    case "text":
      return x.t === "str" ? x.v : x.t === "num" ? String(x.v) : x.t === "sym" ? x.v : undefined;
    case "number":
      return x.t === "num" ? x.v : undefined;
    case "bool":
      return x.t === "bool" ? x.v : x.t === "nil" ? false : undefined;
    case "items":
      return x.t === "list" ? x.v.map((i) => (i.t === "str" || i.t === "sym" ? i.v : printSx(i))) : undefined;
    case "scalar":
      return x.t === "num" ? x.v : x.t === "str" ? x.v : x.t === "sym" ? x.v : undefined;
  }
}

function propSx(kind: PropKind, v: PropValue): Sx {
  switch (kind) {
    case "text":
      return str(String(v));
    case "number":
      return num(Number(v));
    case "bool":
      return { t: "bool", v: Boolean(v) };
    case "items":
      return list(...(Array.isArray(v) ? v : [String(v)]).map(str));
    case "scalar":
      return typeof v === "number" ? num(v) : str(String(v));
  }
}

/** `:key value :key value …` from `items[from..]`, stopping at the first non-keyword. */
function pairs(items: Sx[], from: number): { pairs: [string, Sx][]; rest: Sx[] } {
  const out: [string, Sx][] = [];
  const rest: Sx[] = [];
  for (let i = from; i < items.length; i++) {
    const k = items[i];
    if (k.t === "kw" && i + 1 < items.length) {
      out.push([k.v, items[++i]]);
    } else rest.push(k);
  }
  return { pairs: out, rest };
}

const same = (a: PropValue | undefined, b: PropValue | undefined): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

function parseControl(x: Sx): Control | string {
  if (x.t !== "list" || x.v.length < 2) return "a control is (type name …)";
  const [head, nameSx] = x.v;
  if (head.t !== "sym") return "a control is (type name …)";
  if (!isControlType(head.v)) return `unknown control type "${head.v}"`;
  if (nameSx.t !== "sym") return `${head.v}: a control needs a name`;
  const def = CONTROLS[head.v];
  const c: Control = { type: head.v, name: nameSx.v, x: 0, y: 0, w: def.w, h: def.h, props: {}, events: {}, extra: [] };
  for (const [k, v] of pairs(x.v, 2).pairs) {
    const at = k === "at" ? pair(v) : undefined;
    const size = k === "size" ? pair(v) : undefined;
    const p = [...def.props, ...COMMON_PROPS].find((d) => d.key === k);
    const pv = p ? propValue(p.kind, v) : undefined;
    if (at) [c.x, c.y] = at;
    else if (size) [c.w, c.h] = size;
    else if (k.startsWith("on-") && fnName(v) !== undefined) c.events[k.slice(3)] = fnName(v) as string;
    else if (p && pv !== undefined) c.props[k] = pv;
    else c.extra.push([k, v]);
  }
  return c;
}

/** Read a `(form …)` s-expression. Forgiving: unknown properties are kept, defaults filled in. */
export function parseFormSpec(x: Sx): FormSpec | { error: string } {
  if (x.t !== "list" || x.v.length === 0 || x.v[0].t !== "sym" || x.v[0].v !== "form") return { error: "not a (form …)" };
  const spec: FormSpec = { title: "", ...DEFAULT_FORM_SIZE, menu: [], controls: [], extra: [] };
  let from = 1;
  if (x.v[1]?.t === "str") {
    spec.title = x.v[1].v;
    from = 2;
  }
  const { pairs: ps, rest } = pairs(x.v, from);
  for (const [k, v] of ps) {
    const size = k === "size" ? pair(v) : undefined;
    if (size) [spec.w, spec.h] = size;
    else if (k === "title" && v.t === "str") spec.title = v.v;
    else if (k === "on-load" && fnName(v) !== undefined) spec.onLoad = fnName(v);
    else if (k === "menu") spec.menu = parseMenu(v);
    else spec.extra.push([k, v]);
  }
  for (const item of rest) {
    const c = parseControl(item);
    if (typeof c === "string") return { error: c };
    spec.controls.push(c);
  }
  return spec;
}

/** The layout in the file: its spec and where it sits, or why it couldn't be read. */
export function readFormSpec(src: string): { spec: FormSpec; range: Range } | { error: string } {
  const range = layoutRange(src);
  if (!range) return { error: "no (form …) in this file" };
  let sx: Sx;
  try {
    sx = readAll(src.slice(range.start, range.end))[0];
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (!sx) return { error: "no (form …) in this file" };
  const spec = parseFormSpec(sx);
  return "error" in spec ? spec : { spec, range };
}

function controlSx(c: Control): Sx {
  const def = CONTROLS[c.type];
  const items: Sx[] = [sym(c.type), sym(c.name)];
  for (const p of def.props) {
    const v = c.props[p.key];
    if (v === undefined || same(v, p.default)) continue;
    items.push(kw(p.key), propSx(p.kind, v));
  }
  items.push(kw("at"), list(num(c.x), num(c.y)), kw("size"), list(num(c.w), num(c.h)));
  for (const p of COMMON_PROPS) {
    const v = c.props[p.key];
    if (v === undefined || same(v, p.default)) continue;
    items.push(kw(p.key), propSx(p.kind, v));
  }
  for (const [k, v] of c.extra) items.push(kw(k), v);
  for (const ev of def.events) {
    const fn = c.events[ev];
    if (fn) items.push(kw("on-" + ev), sym(fn));
  }
  for (const [ev, fn] of Object.entries(c.events)) {
    if (!def.events.includes(ev) && fn) items.push(kw("on-" + ev), sym(fn));
  }
  return list(...items);
}

/** The canonical text of a layout: the header on one line, then one control per line. */
export function printFormSpec(spec: FormSpec): string {
  const head: Sx[] = [sym("form"), str(spec.title), kw("size"), list(num(spec.w), num(spec.h))];
  if (spec.onLoad) head.push(kw("on-load"), sym(spec.onLoad));
  if (spec.menu.length) head.push(kw("menu"), menuSx(spec.menu));
  for (const [k, v] of spec.extra) head.push(kw(k), v);
  const lines = [printSx(list(...head)).slice(0, -1), ...spec.controls.map((c) => "  " + printSx(controlSx(c)))];
  return lines.join("\n") + ")";
}

/** The file with its layout replaced — or, when it has none, the layout put in front of it. */
export function replaceLayout(src: string, spec: FormSpec): { src: string; range: Range } {
  const text = printFormSpec(spec);
  const range = layoutRange(src);
  if (range) {
    return { src: src.slice(0, range.start) + text + src.slice(range.end), range: { start: range.start, end: range.start + text.length } };
  }
  const sep = src.length === 0 ? "\n" : "\n\n";
  return { src: text + sep + src, range: { start: 0, end: text.length } };
}

/** The pages open across the form's `tabs` controls: each one's `:value`, or its first page. `open` overrides by control name. */
export function openPages(spec: FormSpec, open: Map<string, string> = new Map()): Set<string> {
  const out = new Set<string>();
  for (const c of spec.controls) {
    if (c.type !== "tabs") continue;
    const pages = Array.isArray(c.props.pages) ? c.props.pages : [];
    const chosen = open.get(c.name) ?? String(c.props.value ?? "");
    out.add(pages.includes(chosen) ? chosen : (pages[0] ?? ""));
  }
  return out;
}

/** Whether a control is on a page that is open — or on no page, or on a page no tabs control has (so never hidden by mistake). */
export function onOpenPage(c: Control, spec: FormSpec, open: Set<string>): boolean {
  const page = String(c.props.page ?? "");
  if (!page) return true;
  const known = spec.controls.some((t) => t.type === "tabs" && Array.isArray(t.props.pages) && t.props.pages.includes(page));
  return !known || open.has(page);
}

// ── helpers for the designer ──────────────────────────────────────────────

/** btnSave, txtName, … — the first free number for the prefix. */
export function nextName(type: ControlType, taken: Iterable<string>): string {
  const used = new Set(taken);
  const prefix = CONTROLS[type].prefix;
  for (let i = 1; ; i++) {
    const name = `${prefix}${i}`;
    if (!used.has(name)) return name;
  }
}

/** The handler a double-click creates: `btnSave` + `click` → `btnSave-click`. */
export const handlerName = (control: string, event: string): string => `${control}-${event}`;

/** A handler that does something visible until it is written — or, for `validate`, one that lets everything through. */
export function handlerStub(name: string, event = "click"): string {
  if (event === "validate") return `(defn ${name} (f)\n  ;; return a message to refuse, nil to go ahead\n  nil)`;
  return `(defn ${name} (f)\n  (ui-message "${name}"))`;
}

/** What to call a control in a message: `txtFirstName` → "First name", `grdAll` → "All". */
export function humanName(name: string): string {
  const stem = name.replace(/^(lbl|txt|btn|chk|opt|cmb|lst|grd|dtp|img|tmr|tab|sht)(?=[A-Z0-9_-])/, "");
  const words = stem.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : name;
}

/** A control name has to be a symbol and a keyword at once: letters, digits, `-` and `_`. */
export const validName = (s: string): boolean => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s);

/** A new control placed at (x, y), its catalogue defaults filled in. */
export function newControl(type: ControlType, name: string, x: number, y: number, w?: number, h?: number): Control {
  const def = CONTROLS[type];
  return {
    type,
    name,
    x: snap(x),
    y: snap(y),
    w: Math.max(MIN_CONTROL, snap(w ?? def.w)),
    h: Math.max(MIN_CONTROL, snap(h ?? def.h)),
    props: { ...def.initial },
    events: {},
    extra: [],
  };
}

// ── the running form's state, as EELisp ───────────────────────────────────

/** What a control is worth to a handler. A grid's value is its selected row, a dict. */
export type StateValue = string | number | boolean | null | string[] | { [k: string]: StateValue };

/** An EELisp literal for a value (inside a quote, so lists and dicts print as themselves). */
export function lispLiteral(v: StateValue): string {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return lispString(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "nil";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return "(" + v.map(lispLiteral).join(" ") + ")";
  const entries = Object.entries(v).filter(([k]) => validName(k));
  return "{" + entries.map(([k, x]) => `:${k} ${lispLiteral(x)}`).join(" ") + "}";
}

/** The whole form as a quoted dict keyed by control name — the `f` every handler receives. */
export function formState(values: Record<string, StateValue>): string {
  return "'" + lispLiteral(values);
}
