// Sheets over the engine: every call is EELisp source, the same `evalSrc` everything else uses.
// A sheet is named by its workspace-relative path ("notes/Budget.eesheet") — the engine resolves it
// against (current-dir) — or by an absolute path.

import type { EngineClient } from "./client";
import type { JsonValue } from "./types";
import { lispString } from "../core/keybindings";
import { cellOf, sheetOf, type Cell, type Fmt, type FmtChange, type SheetData } from "../core/sheet";

/** What a write returns: the cells it changed, and the sheet's version afterwards. */
export interface Changes {
  cells: Cell[];
  version: number;
}

export interface SheetClient {
  create(path: string): Promise<void>;
  open(path: string): Promise<SheetData>;
  close(path: string): Promise<void>;
  version(path: string): Promise<number>;
  /** Type into one cell, or a block of rows from that corner. */
  set(path: string, at: string, input: string | string[][]): Promise<Changes>;
  /** Merge a change into every cell of an area (null clears) — or, given rows, set each cell's exactly. */
  format(path: string, area: string, fmt: FmtChange | null | (Fmt | null)[][]): Promise<Changes>;
  /** A column's width, or null for the default. Returns the sheet's version afterwards. */
  colWidth(path: string, col: string, width: number | null): Promise<number>;
  recalc(path: string): Promise<Changes>;
  /** Insert or delete rows (`at` numbered from 1) or columns (`at` a letter). The whole sheet comes back. */
  structure(path: string, op: "insert-rows" | "delete-rows" | "insert-cols" | "delete-cols", at: number | string, n: number): Promise<SheetData>;
}

/** An EELisp literal for a block of typed inputs: '(("a" "b") ("c")). */
const rowsLiteral = (rows: string[][]): string =>
  `'(${rows.map((r) => `(${r.map(lispString).join(" ")})`).join(" ")})`;

/** `{:num "currency" :dp 2}` — or nil to clear; rows of those for a block. Undefined values are left out. */
function fmtLiteral(fmt: FmtChange | null | (Fmt | null)[][]): string {
  if (Array.isArray(fmt)) return `'(${fmt.map((row) => `(${row.map(fmtLiteral).join(" ")})`).join(" ")})`;
  if (!fmt) return "nil";
  const parts = Object.entries(fmt)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `:${k} ${v === null ? "nil" : typeof v === "string" ? lispString(v) : String(v)}`);
  return `{${parts.join(" ")}}`;
}

export function createSheetClient(engine: EngineClient): SheetClient {
  async function ev(src: string): Promise<JsonValue> {
    const env = await engine.evalSrc(src);
    if (!env.ok) throw new Error(env.error);
    return env.result;
  }

  /** A write and the version it left behind, in one round trip. */
  async function changes(path: string, call: string): Promise<Changes> {
    const result = await ev(`(list ${call} (sheet-version ${lispString(path)}))`);
    const [rows, version] = Array.isArray(result) ? result : [[], 0];
    return { cells: Array.isArray(rows) ? rows.map(cellOf) : [], version: Number(version) };
  }

  return {
    create: async (path) => void (await ev(`(sheet-new ${lispString(path)})`)),
    open: async (path) => sheetOf(await ev(`(sheet-open ${lispString(path)})`)),
    close: async (path) => void (await ev(`(sheet-close ${lispString(path)})`)),
    version: async (path) => Number(await ev(`(sheet-version ${lispString(path)})`)),
    set: (path, at, input) =>
      changes(
        path,
        `(sheet-set ${lispString(path)} ${lispString(at)} ${typeof input === "string" ? lispString(input) : rowsLiteral(input)})`,
      ),
    format: (path, area, fmt) => changes(path, `(sheet-format ${lispString(path)} ${lispString(area)} ${fmtLiteral(fmt)})`),
    colWidth: async (path, col, width) => {
      const w = width === null ? "nil" : String(Math.round(width));
      const result = await ev(`(list (sheet-col-width ${lispString(path)} ${lispString(col)} ${w}) (sheet-version ${lispString(path)}))`);
      return Number(Array.isArray(result) ? result[1] : 0);
    },
    recalc: (path) => changes(path, `(sheet-recalc ${lispString(path)})`),
    structure: async (path, op, at, n) =>
      sheetOf(await ev(`(sheet-${op} ${lispString(path)} ${typeof at === "number" ? at : lispString(at)} ${n})`)),
  };
}
