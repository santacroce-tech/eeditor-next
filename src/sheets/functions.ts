// The spreadsheet functions a sheet formula can call — countif, sumif, vlookup… They are EELisp
// (functions.eelisp, bundled), plus whatever the workspace adds in `.eeditor/functions.eelisp`.
//
// They have to be in the engine before any sheet recalculates: a formula that calls one is fine on
// open (opening runs no code), but the next edit or ↻ would fail with "Undefined symbol". So they
// load when a workspace arrives, ahead of the shortcuts and the first file.

import type { EngineClient } from "../engine/client";
import type { WorkspaceClient } from "../engine/workspace";
import BUNDLED from "./functions.eelisp?raw";

/** The workspace's own functions (dot-prefixed → hidden from the file tree, like the keybindings). */
export const FUNCTIONS_PATH = ".eeditor/functions.eelisp";

/** What a new `.eeditor/functions.eelisp` starts with. */
export const FUNCTIONS_TEMPLATE = `;; functions.eelisp — your own spreadsheet functions.
;;
;; Loaded at launch after EEditor's own (countif, sumif, vlookup… — (functions) lists them,
;; (source countif) shows one), and again whenever this file is saved. Anything defined here can
;; be called from a sheet formula, and a name you reuse replaces EEditor's.
;;
;; (defn commission (amount) (* amount 0.05))   ; then in a cell: =(commission B2)
`;

export interface SheetFunctions {
  /** Load the bundled functions, then the workspace's. Returns the problems, if any (already reported). */
  load(): Promise<string[]>;
  isUserPath(path: string): boolean;
}

export function createSheetFunctions(opts: {
  engine: EngineClient;
  ws: WorkspaceClient;
  /** Where load errors go (the REPL scrollback). */
  note: (text: string) => void;
}): SheetFunctions {
  const { engine, ws, note } = opts;

  async function load(): Promise<string[]> {
    const problems: string[] = [];
    // The bundled ones every time: a workspace switch must not keep the last one's redefinitions.
    const bundled = await engine.evalSrc(BUNDLED);
    if (!bundled.ok) problems.push(`sheet functions: ${bundled.error}`);
    let own: string | null = null;
    try {
      own = await ws.read(FUNCTIONS_PATH);
    } catch {
      // optional — most workspaces have none
    }
    if (own !== null && own.trim()) {
      const env = await engine.evalSrc(own);
      if (env.output) note(env.output.replace(/\n$/, ""));
      if (!env.ok) problems.push(`${FUNCTIONS_PATH}: ${env.error}`);
    }
    for (const p of problems) note(`; ${p}`);
    return problems;
  }

  return { load, isUserPath: (p) => p === FUNCTIONS_PATH };
}
