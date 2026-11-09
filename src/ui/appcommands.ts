// What `(ui-editor …)` does in an exported Mac app, where there is no editor to hand it to: the
// file commands work on real files, (ed-open …) opens a file in the app the system opens it with,
// (ed-form …) opens a form of the app, (ed-message …) is a toast. The commands that type into a
// note have no note to type into, and say so in the console.
//
// In the editor the same commands go through keybindings.ts, which also keeps open tabs in step.

import { isFormPath } from "../core/form";
import type { JsonValue } from "../engine/types";
import type { WorkspaceClient } from "../engine/workspace";

export interface AppCommandsOptions {
  ws: Pick<WorkspaceClient, "rename" | "copy" | "trash" | "create" | "openWithSystem" | "addRoot">;
  /** Open one of the app's forms, in a window over it. */
  openForm: (path: string) => void | Promise<void>;
  say: (message: string) => void;
  note: (text: string) => void;
}

/** Commands an exported app carries out; the rest belong to the editor. */
const KNOWN = new Set(["move", "copy", "delete", "mkdir", "open", "form", "message", "notify", "command", "insert", "insert-at", "goto", "goto-line", "select", "replace", "replace-range", "set-buffer", "new", "export", "write", "append", "prompt"]);

const text = (v: JsonValue | undefined): string => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));

/**
 * The commands in `v` — one, or a list of them, nested any way — carried out in order. Settles once
 * the last has; a failure is said, and the ones after it still run (as in the editor).
 */
export function createAppCommands(opts: AppCommandsOptions): (v: JsonValue) => Promise<void> {
  const fail = (verb: string, what: string) => (e: unknown) =>
    opts.say(`Could not ${verb} ${what}: ${e instanceof Error ? e.message : String(e)}`);

  async function exec(name: string, args: JsonValue[]): Promise<void> {
    const a = text(args[0]);
    const b = text(args[1]);
    switch (name) {
      case "move":
        return opts.ws.rename(a, b).catch(fail("move", a));
      case "copy":
        return opts.ws.copy(a, b).catch(fail("copy", a));
      case "delete":
        return opts.ws.trash(a).catch(fail("delete", a));
      case "mkdir":
        return opts.ws.create(a, true).catch(fail("make the folder", a));
      case "open":
        if (isFormPath(a)) return void (await opts.openForm(a));
        return opts.ws.openWithSystem(a).catch(fail("open", a));
      case "form":
        return void (await opts.openForm(a));
      case "message":
        return opts.say(a);
      case "notify":
        return opts.say(b ? `${a} — ${b}` : a);
      case "command":
        if (a === "add-folder") {
          await opts.ws.addRoot().catch(fail("add", "a folder"));
          return;
        }
        return opts.note(`(ed-cmd "${a}") is the editor's — an exported app has no editor`);
      default:
        return opts.note(`(ed-${name} …) is the editor's — an exported app has no note to do it in`);
    }
  }

  async function apply(v: JsonValue): Promise<void> {
    if (!Array.isArray(v) || v.length === 0) return;
    const head = v[0];
    if (typeof head === "string" && KNOWN.has(head)) return exec(head, v.slice(1));
    for (const item of v) await apply(item);
  }

  return apply;
}
