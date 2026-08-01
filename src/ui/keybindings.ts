// Configurable keyboard shortcuts. `.eeditor/keybindings.eelisp` in the workspace *is* the
// shortcut table: each `(bind "Key" …)` maps a key to either a built-in app command or a piece of
// EELisp. Lisp bodies are evaluated on the engine and hand back editor commands as data (see
// keybindings/prelude.eelisp), which we apply here to the live document.
//
// Dispatch runs on the document in the *capture* phase, so a bound key wins over CodeMirror's own
// bindings — and unbinding a key in the config hands it straight back to CodeMirror.

import { parseKeybindings, eventKeyId, lispString, type Binding } from "../core/keybindings";
import type { EngineClient } from "../engine/client";
import type { WorkspaceClient } from "../engine/workspace";
import type { JsonValue } from "../engine/types";
import type { Editor } from "./editor";
import { toast } from "./dialogs";
import PRELUDE from "../keybindings/prelude.eelisp?raw";
import DEFAULT_CONFIG from "../keybindings/default.eelisp?raw";

/** Where the user's config lives (dot-prefixed → hidden from the file tree). */
export const KEYBINDINGS_PATH = ".eeditor/keybindings.eelisp";

export type CommandTable = Record<string, () => void | Promise<void>>;

export interface Keybindings {
  /** Re-read the config (falling back to the bundled defaults) and rebuild the key map. */
  reload(): Promise<void>;
  /** Open the config in an editor tab, writing the defaults first if it doesn't exist yet. */
  openConfig(): Promise<void>;
  isConfigPath(path: string): boolean;
  bindings(): Binding[];
}

export interface KeybindingsOptions {
  ws: WorkspaceClient;
  engine: EngineClient;
  editor: Editor;
  commands: CommandTable;
  /** Path of the note in the editor — exposed to bindings as *file*. */
  file: () => string;
  openFile: (path: string) => Promise<void>;
  /** Where errors and `println` output from a binding go (the REPL scrollback). */
  note: (text: string) => void;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Editor commands the engine may hand back (the `ed-*` constructors in prelude.eelisp). */
const COMMANDS = new Set([
  "command",
  "insert",
  "insert-at",
  "goto",
  "goto-line",
  "select",
  "replace",
  "replace-range",
  "set-buffer",
  "open",
  "message",
]);

export function createKeybindings(opts: KeybindingsOptions): Keybindings {
  const { ws, engine, editor, commands } = opts;
  let map = new Map<string, Binding>();
  let preludeLoaded = false;

  // ── config ──

  async function reload(): Promise<void> {
    let src: string;
    try {
      src = await ws.read(KEYBINDINGS_PATH);
    } catch {
      src = DEFAULT_CONFIG; // no config yet (or unreadable) — the bundled defaults still apply
    }
    const { bindings, errors } = parseKeybindings(src);
    map = new Map(bindings.map((b) => [b.id, b]));
    for (const e of errors) opts.note(`; keybindings: ${e}`);
    if (errors.length > 0) toast(`keybindings: ${errors.length} problem(s) — see the REPL`);
  }

  async function openConfig(): Promise<void> {
    try {
      await ws.read(KEYBINDINGS_PATH);
    } catch {
      await ws.write(KEYBINDINGS_PATH, DEFAULT_CONFIG);
    }
    await opts.openFile(KEYBINDINGS_PATH);
  }

  // ── running a binding ──

  async function ensurePrelude(): Promise<boolean> {
    if (preludeLoaded) return true;
    const env = await engine.evalSrc(PRELUDE);
    if (!env.ok) {
      opts.note(`; keybindings: could not load the editor prelude — ${env.error}`);
      return false;
    }
    preludeLoaded = true;
    return true;
  }

  /** `(def *x* …)` bindings the lisp body can read. Kept in sync with default.eelisp's header. */
  function context(binding: Binding): string {
    const state = editor.view.state;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    const d = new Date();
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const defs = [
      `(def *file* ${lispString(opts.file())})`,
      `(def *cursor* ${sel.head})`,
      `(def *line* ${line.number})`,
      `(def *col* ${sel.head - line.from + 1})`,
      `(def *line-text* ${lispString(line.text)})`,
      `(def *lines* ${state.doc.lines})`,
      `(def *sel-from* ${sel.from})`,
      `(def *sel-to* ${sel.to})`,
      `(def *date* ${lispString(date)})`,
      `(def *time* ${lispString(time)})`,
      `(def *now* ${lispString(`${date} ${time}:${pad2(d.getSeconds())}`)})`,
    ];
    // the document can be large — only ship it when the binding actually asks for it
    if (binding.source.includes("*selection*")) {
      defs.push(`(def *selection* ${lispString(state.sliceDoc(sel.from, sel.to))})`);
    }
    if (binding.source.includes("*buffer*")) {
      defs.push(`(def *buffer* ${lispString(state.doc.toString())})`);
    }
    return defs.join("\n");
  }

  function runCommand(name: string): void {
    const fn = commands[name];
    if (!fn) {
      opts.note(`; keybindings: unknown command "${name}"`);
      toast(`Unknown command "${name}"`);
      return;
    }
    void fn();
  }

  const num = (v: JsonValue): number | null => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const text = (v: JsonValue): string => (typeof v === "string" ? v : String(v ?? ""));

  /** Apply one editor command. Returns true if it touched the document/selection. */
  function exec(name: string, args: JsonValue[]): boolean {
    const view = editor.view;
    const len = view.state.doc.length;
    const pos = (v: JsonValue): number => Math.max(0, Math.min(num(v) ?? 0, len));

    switch (name) {
      case "command":
        runCommand(text(args[0]));
        return false;
      case "message":
        toast(text(args[0]));
        return false;
      case "open":
        void opts.openFile(text(args[0]));
        return false;
      case "insert": {
        const at = view.state.selection.main.head;
        const insert = text(args[0]);
        view.dispatch({
          changes: { from: at, insert },
          selection: { anchor: at + insert.length },
          scrollIntoView: true,
        });
        return true;
      }
      case "insert-at": {
        const at = pos(args[0]);
        const insert = text(args[1]);
        view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, scrollIntoView: true });
        return true;
      }
      case "goto":
        view.dispatch({ selection: { anchor: pos(args[0]) }, scrollIntoView: true });
        return true;
      case "goto-line":
        editor.gotoLine(num(args[0]) ?? 1);
        return true;
      case "select": {
        const from = pos(args[0]);
        view.dispatch({ selection: { anchor: from, head: pos(args[1]) }, scrollIntoView: true });
        return true;
      }
      case "replace": {
        const { from, to } = view.state.selection.main;
        const insert = text(args[0]);
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
        return true;
      }
      case "replace-range": {
        const from = pos(args[0]);
        const to = Math.max(from, pos(args[1]));
        const insert = text(args[2]);
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
        return true;
      }
      case "set-buffer":
        editor.setDoc(text(args[0]));
        return true;
      default:
        return false;
    }
  }

  /**
   * A returned value is a command when it's a list headed by a known command name; anything else
   * that's a list is walked, so a binding can return one command, a list of them, or a nested mix.
   */
  function apply(v: JsonValue): boolean {
    if (!Array.isArray(v) || v.length === 0) return false;
    const head = v[0];
    if (typeof head === "string" && COMMANDS.has(head)) return exec(head, v.slice(1));
    let touched = false;
    for (const item of v) touched = apply(item) || touched;
    return touched;
  }

  async function run(binding: Binding): Promise<void> {
    if (binding.command) {
      runCommand(binding.command); // no engine round-trip for a plain (ed-cmd "…")
      return;
    }
    if (!(await ensurePrelude())) return;
    const env = await engine.evalSrc(`${context(binding)}\n${binding.source}`);
    if (!env.ok) {
      opts.note(`; ${binding.spec}: ${env.error}`);
      toast(`${binding.spec}: ${env.error}`);
      return;
    }
    if (env.output) opts.note(env.output.replace(/\n$/, ""));
    if (apply(env.result)) editor.view.focus();
  }

  // ── dispatch ──

  document.addEventListener(
    "keydown",
    (e) => {
      const binding = map.get(eventKeyId(e));
      if (!binding) return;
      // claim the key even when we won't act on it, so it never falls through to CodeMirror
      e.preventDefault();
      e.stopPropagation();
      if (e.isComposing || e.repeat) return;
      void run(binding);
    },
    true,
  );

  return {
    reload,
    openConfig,
    isConfigPath: (p) => p === KEYBINDINGS_PATH,
    bindings: () => [...map.values()],
  };
}
