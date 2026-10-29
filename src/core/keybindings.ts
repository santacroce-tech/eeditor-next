// The keybindings config (.eeditor/keybindings.eelisp) — parsing and key matching. Pure + testable;
// the engine round-trip and the DOM wiring live in ui/keybindings.ts.
//
// A config is a list of top-level forms:
//
//   (bind "Mod-i" (ed-goto-line 2) (ed-insert (str "## " *date* "\n\n")))
//   (on-start (ed-open "todo.md"))
//   (on-load (defn my-helper (x) …))       ; at launch and on every reload — a library
//   (on-tick (my-reminders))               ; once a minute
//   (button "↻ update" "Mod-Alt-u")         ; a button in the editor's header that presses ⌘⌥U
//
// We only parse far enough to pull out the key and the *source text* of the body — the body itself
// is EELisp and is evaluated by the engine when the key fires. Wrapping it in `(list …)` means a
// binding can list several commands and still hand back one value.

/** A body of forms, compiled to the value we hand the engine. */
interface Body {
  /** Lisp source: the body forms wrapped in `(list …)`, or `(list)` for an empty body. */
  source: string;
  /** Set when the body is exactly `(ed-cmd "name")` — dispatched without the engine. */
  command?: string;
}

export interface Binding extends Body {
  /** Canonical id matched against a KeyboardEvent (see keyId / eventKeyId). */
  id: string;
  /** The key as written in the config, e.g. "Mod-Shift-I" — for messages. */
  spec: string;
  /** 1-based line of the `(bind …)` form, for error messages. */
  line: number;
}

/**
 * `(button "label" body…)`: a button in the editor's header. Its body is a binding's — or just a key,
 * `(button "↻" "Mod-Alt-u")`, and the button does what that key does at the time it's clicked.
 * A body that is one app command, `(button "PDF" (ed-cmd "export-pdf"))`, may leave the label out —
 * `(button (ed-cmd "export-pdf"))` — and the app labels it (the theme button names the next theme).
 */
export interface Button extends Body {
  /** "" when left out: the app's own label for `command`. */
  label: string;
  /** Set when the body is exactly `(ed-cmd "name")`: the app command it runs. */
  command?: string;
  /** Set when the body is a key: the canonical id of the binding to run. */
  key?: string;
  /** The key as written, or the label — for messages and the tooltip. */
  spec: string;
  line: number;
}

/** What `(on-start …)` runs when the workspace has finished loading. */
export interface StartHook extends Body {
  line: number;
}

export interface ParsedConfig {
  bindings: Binding[];
  /** The `(on-start …)` form. Absent → EEditor picks the note to open itself. */
  start?: StartHook;
  /**
   * Every `(on-load …)`, in order: run when the config is loaded — at launch, before `on-start`, and
   * again each time it's saved. Several are fine (your helpers and a library's); all of them run.
   */
  load: StartHook[];
  /** Every `(on-tick …)`, in order: run once a minute, on the minute, for as long as the app is open. */
  tick: StartHook[];
  /** Every `(button …)`, in the order they're written — the order they appear in. */
  buttons: Button[];
  errors: string[];
}

/** Hooks that collect rather than replace: each of their forms runs. */
type Hook = "on-load" | "on-tick";

/** Source for a body that does nothing — `(on-start)`, i.e. "start with no file open". */
export const EMPTY_BODY = "(list)";

// ── key specs ──────────────────────────────────────────────────────────────

type ModName = "mod" | "meta" | "ctrl" | "alt" | "shift";

const MODIFIERS: Record<string, ModName> = {
  mod: "mod",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  super: "meta",
  win: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  opt: "alt",
  option: "alt",
  shift: "shift",
};

/** Keys allowed with no modifier at all (everything else would swallow ordinary typing). */
const BARE_OK = /^(f[1-9]|f1[0-2]|escape)$/;

export function isMacPlatform(): boolean {
  const n = typeof navigator !== "undefined" ? navigator : undefined;
  const p = (n?.platform ?? "") + " " + (n?.userAgent ?? "");
  return /Mac|iPhone|iPad|iPod/i.test(p);
}

function id(meta: boolean, ctrl: boolean, alt: boolean, shift: boolean, key: string): string {
  return `${meta ? "m" : ""}${ctrl ? "c" : ""}${alt ? "a" : ""}${shift ? "s" : ""}:${key}`;
}

/** "Mod-Shift-I" → a canonical id, or an error explaining why it isn't a usable shortcut. */
export function parseKeySpec(spec: string, mac: boolean): { id: string } | { error: string } {
  const parts = spec.split(/[-+]/);
  let key = parts.pop() ?? "";
  if (key === "") key = spec.slice(-1); // "Mod--" / "Mod-+" — the punctuation itself is the key
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  if (key === "") return { error: `empty key in "${spec}"` };

  let meta = false;
  let ctrl = false;
  let alt = false;
  let shift = false;
  for (const p of parts) {
    const m = MODIFIERS[p.toLowerCase()];
    if (!m) return { error: `unknown modifier "${p}" in "${spec}"` };
    if (m === "mod") (mac ? (meta = true) : (ctrl = true));
    else if (m === "meta") meta = true;
    else if (m === "ctrl") ctrl = true;
    else if (m === "alt") alt = true;
    else shift = true;
  }

  const k = key.toLowerCase();
  if (!meta && !ctrl && !alt && !BARE_OK.test(k)) {
    return { error: `"${spec}" needs a modifier (Mod-, Ctrl-, Alt-)` };
  }
  return { id: id(meta, ctrl, alt, shift, k) };
}

const MAC_GLYPH: Record<ModName, string> = { mod: "⌘", meta: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };
const KEY_GLYPH: Record<string, string> = { backspace: "⌫", delete: "⌦", enter: "↩", escape: "⎋", tab: "⇥", space: "Space" };

/** "Mod-Alt-u" as a person reads it: "⌘⌥U" on a Mac, "Ctrl+Alt+U" elsewhere. Unparseable → as written. */
export function keyLabel(spec: string, mac: boolean): string {
  const parts = spec.split(/[-+]/);
  const key = parts.pop() || spec.slice(-1);
  const mods = parts.filter((p) => p !== "").map((p) => MODIFIERS[p.toLowerCase()]);
  if (mods.some((m) => !m)) return spec;
  const k = KEY_GLYPH[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (mac) return mods.map((m) => MAC_GLYPH[m]).join("") + k;
  const name: Record<ModName, string> = { mod: "Ctrl", meta: "Win", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
  return [...mods.map((m) => name[m]), k].join("+");
}

/**
 * The id of a key event. Letters/digits come from `event.code` so Option-composed characters
 * (⌥i → "ˆ" on macOS) and shifted letters still resolve to the plain key.
 */
export function eventKeyId(e: KeyboardEvent): string {
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else key = e.key.toLowerCase();
  return id(e.metaKey, e.ctrlKey, e.altKey, e.shiftKey, key);
}

// ── config parsing ─────────────────────────────────────────────────────────

export interface Form {
  text: string; // including the outer parens
  line: number; // 1-based
  start: number; // offset of the "(" in the source
}

/** Read a lisp string literal starting at `src[i] === '"'`. Returns null if unterminated. */
function readString(src: string, i: number): { value: string; end: number } | null {
  let out = "";
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      const e = src[j + 1];
      out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : (e ?? "");
      j += 2;
      continue;
    }
    if (c === '"') return { value: out, end: j + 1 };
    out += c;
    j++;
  }
  return null;
}

/** Split a config into its top-level parenthesised forms, skipping `;` comments and strings. */
export function topLevelForms(src: string): { forms: Form[]; errors: string[] } {
  const forms: Form[] = [];
  const errors: string[] = [];
  let depth = 0;
  let start = 0;
  let startLine = 1;
  let line = 1;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (c === ";") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === '"') {
      const s = readString(src, i);
      if (!s) {
        errors.push(`line ${line}: unterminated string`);
        break;
      }
      for (let k = i; k < s.end; k++) if (src[k] === "\n") line++;
      i = s.end;
    } else if (c === "(") {
      if (depth === 0) {
        start = i;
        startLine = line;
      }
      depth++;
      i++;
    } else if (c === ")") {
      i++;
      if (depth === 0) {
        errors.push(`line ${line}: stray ")"`);
        continue;
      }
      depth--;
      if (depth === 0) forms.push({ text: src.slice(start, i), line: startLine, start });
    } else {
      i++;
    }
  }
  if (depth > 0) errors.push(`line ${startLine}: unbalanced "(" — the form is never closed`);
  return { forms, errors };
}

const CMD_ONLY = /^\(\s*ed-cmd\s+"([A-Za-z0-9_-]+)"\s*\)$/;

function compileBody(text: string): Body {
  const cmd = CMD_ONLY.exec(text);
  return { source: text === "" ? EMPTY_BODY : `(list ${text})`, command: cmd ? cmd[1] : undefined };
}

function parseForm(
  form: Form,
  mac: boolean,
):
  | { binding: Binding }
  | { start: StartHook }
  | { hook: Hook; body: StartHook }
  | { button: Button }
  | { error: string } {
  const inner = form.text.slice(1, -1);
  const head = /^\s*(bind|button|on-start|on-load|on-tick)(?=[\s)]|$)/.exec(inner);
  if (!head) {
    const what = form.text.slice(0, 40).replace(/\s+/g, " ");
    return {
      error: `line ${form.line}: expected (bind "Key" …), (button "Label" …), (on-start …), (on-load …) or (on-tick …), got ${what}…`,
    };
  }
  if (head[1] === "button") return parseButton(inner, head[0].length, form.line, mac);
  if (head[1] !== "bind") {
    const body = { ...compileBody(inner.slice(head[0].length).trim()), line: form.line };
    return head[1] === "on-start" ? { start: body } : { hook: head[1] as Hook, body };
  }

  let i = head[0].length;
  while (i < inner.length && /\s/.test(inner[i])) i++;
  if (inner[i] !== '"') return { error: `line ${form.line}: bind needs a quoted key, e.g. (bind "Mod-i" …)` };
  const str = readString(inner, i);
  if (!str) return { error: `line ${form.line}: unterminated key string` };

  const key = parseKeySpec(str.value, mac);
  if ("error" in key) return { error: `line ${form.line}: ${key.error}` };

  const body = inner.slice(str.end).trim();
  if (body === "") return { error: `line ${form.line}: (bind "${str.value}" …) has no body` };

  return { binding: { ...compileBody(body), id: key.id, spec: str.value, line: form.line } };
}

/** `(ed-cmd "name")` and nothing else → "name". */
function commandOf(body: string): string | undefined {
  return /^\(\s*ed-cmd\s+"([a-z0-9-]+)"\s*\)$/.exec(body.trim())?.[1];
}

function parseButton(inner: string, from: number, line: number, mac: boolean): { button: Button } | { error: string } {
  let i = from;
  while (i < inner.length && /\s/.test(inner[i])) i++;
  const bare = commandOf(inner.slice(i));
  if (bare) return { button: { ...compileBody(inner.slice(i).trim()), label: "", command: bare, spec: bare, line } };
  if (inner[i] !== '"') return { error: `line ${line}: button needs a quoted label, e.g. (button "↻" "Mod-Alt-u")` };
  const label = readString(inner, i);
  if (!label) return { error: `line ${line}: unterminated label string` };
  if (label.value.trim() === "") return { error: `line ${line}: the button's label is empty` };

  const body = inner.slice(label.end).trim();
  if (body === "") return { error: `line ${line}: (button "${label.value}" …) has nothing to do` };
  // A body that is one string is a key to press, not lisp to run.
  const str = body.startsWith('"') ? readString(body, 0) : null;
  if (str && str.end === body.length) {
    const key = parseKeySpec(str.value, mac);
    if ("error" in key) return { error: `line ${line}: ${key.error}` };
    return { button: { source: EMPTY_BODY, label: label.value, key: key.id, spec: str.value, line } };
  }
  return { button: { ...compileBody(body), label: label.value, command: commandOf(body), spec: label.value, line } };
}

/** The app commands the header has always had a button for. */
export const HEADER_COMMANDS = ["toggle-theme", "insert-image", "toggle-preview", "export-pdf", "open-keys", "toggle-repl"];

/**
 * The header's buttons: the config's. A config with no button for any of the header's own commands
 * — written before they were buttons in the file — gets the defaults' after its own, so the theme,
 * preview, PDF… buttons don't vanish. Writing one of them is taking the header over.
 */
export function headerButtons(config: Button[], defaults: Button[]): Button[] {
  const own = (b: Button) => b.command !== undefined && HEADER_COMMANDS.includes(b.command);
  return config.some(own) ? config : [...config, ...defaults.filter(own)];
}

/**
 * Parse a keybindings config. Later forms win over earlier ones (per key, and for `on-start`);
 * `on-load` and `on-tick` forms add up instead.
 */
export function parseKeybindings(src: string, mac: boolean = isMacPlatform()): ParsedConfig {
  const { forms, errors } = topLevelForms(src);
  const byId = new Map<string, Binding>();
  let start: StartHook | undefined;
  const load: StartHook[] = [];
  const tick: StartHook[] = [];
  const buttons: Button[] = [];
  for (const form of forms) {
    const r = parseForm(form, mac);
    if ("error" in r) errors.push(r.error);
    else if ("button" in r) buttons.push(r.button);
    else if ("start" in r) start = r.start;
    else if ("hook" in r) (r.hook === "on-load" ? load : tick).push(r.body);
    else byId.set(r.binding.id, r.binding);
  }
  return { bindings: [...byId.values()], start, load, tick, buttons, errors };
}

// ── emitting lisp ──────────────────────────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * `*date*` "YYYY-MM-DD", `*time*` "HH:MM" and `*now*` "YYYY-MM-DD HH:MM:SS", local time, as `def`s.
 * Every run defines them fresh — a key, a tick, a form's handler — so none sees a stale clock.
 */
export function clockDefs(d: Date = new Date()): string {
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return [
    `(def *date* ${lispString(date)})`,
    `(def *time* ${lispString(time)})`,
    `(def *now* ${lispString(`${date} ${time}:${pad2(d.getSeconds())}`)})`,
  ].join("\n");
}

/** Quote a JS string as an EELisp string literal (used to inject *file*, *selection*, …). */
export function lispString(s: string): string {
  return (
    '"' +
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t") +
    '"'
  );
}
