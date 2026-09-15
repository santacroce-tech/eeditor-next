// The pure half of the sheet grid: addressing, decoding what the engine sends, how a value is
// displayed, selection, and where rows and columns sit on screen. No DOM — ui/sheet.ts draws.
//
// Rows and columns are 0-based here, as the engine sends them; "A1" is (0, 0).

import type { JsonValue } from "../engine/types";
import { dictGet, isDict } from "../engine/types";
import { scalarText } from "../engine/render";

export const SHEET_EXT = ".eesheet";
export const isSheetPath = (path: string): boolean => path.toLowerCase().endsWith(SHEET_EXT);

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 18_278; // A … ZZZ

// ── addressing ──────────────────────────────────────────────────────

export interface Pos {
  row: number;
  col: number;
}

/** A rectangle, inclusive, top-left to bottom-right. */
export interface Area {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function colName(col: number): string {
  let n = col + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** "A" → 0, "aa" → 26; null when it isn't one to three letters. */
export function colIndex(letters: string): number | null {
  const s = letters.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(s)) return null;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n <= MAX_COLS ? n - 1 : null;
}

export const a1 = (p: Pos): string => `${colName(p.col)}${p.row + 1}`;

export function areaA1(a: Area): string {
  const tl = a1({ row: a.r0, col: a.c0 });
  return a.r0 === a.r1 && a.c0 === a.c1 ? tl : `${tl}:${a1({ row: a.r1, col: a.c1 })}`;
}

/** "C3" or "A1:C9" (any case, `$` allowed) → the area, or null. */
export function parseArea(text: string): Area | null {
  const cell = (s: string): Pos | null => {
    const m = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]*)$/.exec(s.trim());
    if (!m) return null;
    const col = colIndex(m[1]);
    const row = Number(m[2]) - 1;
    return col === null || row >= MAX_ROWS ? null : { row, col };
  };
  const [left, right, extra] = text.split(":");
  if (extra !== undefined) return null;
  const a = cell(left);
  const b = right === undefined ? a : cell(right);
  return a && b ? spanOf(a, b) : null;
}

export const spanOf = (a: Pos, b: Pos): Area => ({
  r0: Math.min(a.row, b.row),
  c0: Math.min(a.col, b.col),
  r1: Math.max(a.row, b.row),
  c1: Math.max(a.col, b.col),
});

export const inArea = (a: Area, p: Pos): boolean => p.row >= a.r0 && p.row <= a.r1 && p.col >= a.c0 && p.col <= a.c1;

// ── what the engine sends ───────────────────────────────────────────

export interface Fmt {
  num?: "general" | "number" | "currency" | "percent";
  /** Decimal places. */
  dp?: number;
  /** ISO currency code for `num: "currency"`; the locale's region picks one otherwise. */
  cur?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
}

/** A change to merge into formats: a key set to null is removed. */
export type FmtChange = { [K in keyof Fmt]?: Fmt[K] | null };

/**
 * How many decimal places a number is showing, so "one more" starts from what's on screen: its
 * format's `dp`, else the format's own default — a currency's minor unit, at most 2 for a percent,
 * at most 3 for a grouped number — else as many as the value has, up to 10.
 */
export function decimalsShown(value: JsonValue, fmt: Fmt | null, locale?: string): number {
  if (fmt?.dp !== undefined) return fmt.dp;
  if (typeof value !== "number") return 0;
  const own = (n: number): number => (Number.isInteger(n) ? 0 : (String(n).split(".")[1] ?? "").replace(/e.*$/, "").length);
  switch (fmt?.num) {
    case "currency":
      return new Intl.NumberFormat(locale, { style: "currency", currency: fmt.cur ?? currencyFor(locale) }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    case "percent":
      return Math.min(2, own(Number((value * 100).toPrecision(12))));
    case "number":
      return Math.min(3, own(value));
    default:
      return Math.min(10, own(value));
  }
}

export interface Cell {
  row: number;
  col: number;
  /** Exactly what was typed. */
  input: string;
  value: JsonValue;
  error: string | null;
  fmt: Fmt | null;
}

export interface SheetData {
  path: string;
  version: number;
  cells: Cell[];
  widths: Map<number, number>;
}

function fmtOf(v: JsonValue | undefined): Fmt | null {
  if (!v || !isDict(v)) return null;
  const f: Fmt = {};
  for (const [k, val] of v.$dict) (f as Record<string, unknown>)[k] = val;
  return f;
}

/** `(row col input value error fmt)` → a cell. */
export function cellOf(row: JsonValue): Cell {
  const r = Array.isArray(row) ? row : [];
  return {
    row: Number(r[0] ?? 0),
    col: Number(r[1] ?? 0),
    input: typeof r[2] === "string" ? r[2] : "",
    value: r[3] ?? null,
    error: typeof r[4] === "string" ? r[4] : null,
    fmt: fmtOf(r[5]),
  };
}

/** `(sheet-open …)`'s dict → the sheet. */
export function sheetOf(result: JsonValue): SheetData {
  const cells = dictGet(result, "cells");
  const widths = dictGet(result, "widths");
  return {
    path: String(dictGet(result, "path") ?? ""),
    version: Number(dictGet(result, "version") ?? 0),
    cells: Array.isArray(cells) ? cells.map(cellOf) : [],
    widths: new Map(
      (Array.isArray(widths) ? widths : []).map((w) => (Array.isArray(w) ? [Number(w[0]), Number(w[1])] : [0, 0])),
    ),
  };
}

// ── display ─────────────────────────────────────────────────────────

/** The short tag a failed cell shows; the full message goes in its tooltip. */
export function errorTag(message: string): string {
  if (/circular reference/.test(message)) return "#CYCLE";
  if (/#REF!/.test(message)) return "#REF!";
  return "#ERR";
}

export function formatValue(value: JsonValue, fmt: Fmt | null, locale?: string): string {
  if (value === null) return "";
  if (typeof value === "number") {
    const dp = fmt?.dp;
    const digits = dp === undefined ? {} : { minimumFractionDigits: dp, maximumFractionDigits: dp };
    switch (fmt?.num) {
      case "number":
        return new Intl.NumberFormat(locale, { useGrouping: true, ...digits }).format(value);
      case "currency":
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: fmt.cur ?? currencyFor(locale),
          ...(dp === undefined ? {} : digits),
        }).format(value);
      case "percent":
        return new Intl.NumberFormat(locale, { style: "percent", ...(dp === undefined ? { maximumFractionDigits: 2 } : digits) }).format(value);
      default:
        return dp === undefined ? String(value) : value.toFixed(Math.max(0, Math.min(20, dp)));
    }
  }
  return scalarText(value);
}

/** The locale's currency, for the regions listed; US dollars otherwise. */
function currencyFor(locale?: string): string {
  const region = (locale ?? (typeof navigator !== "undefined" ? navigator.language : "en-US")).split("-")[1]?.toUpperCase();
  const byRegion: Record<string, string> = {
    US: "USD", GB: "GBP", BR: "BRL", PT: "EUR", ES: "EUR", FR: "EUR", DE: "EUR", IT: "EUR", NL: "EUR",
    IE: "EUR", JP: "JPY", CN: "CNY", IN: "INR", CA: "CAD", AU: "AUD", CH: "CHF", MX: "MXN", AR: "ARS",
  };
  return (region && byRegion[region]) || "USD";
}

export interface Shown {
  text: string;
  align: "left" | "center" | "right";
  /** The full error, for a tooltip. */
  title?: string;
  error: boolean;
}

export function display(cell: Cell | undefined, locale?: string): Shown {
  if (!cell) return { text: "", align: "left", error: false };
  if (cell.error) return { text: errorTag(cell.error), align: "left", title: cell.error, error: true };
  const text = formatValue(cell.value, cell.fmt, locale);
  const natural = typeof cell.value === "number" ? "right" : "left";
  return { text, align: cell.fmt?.align ?? natural, error: false };
}

// ── selection ───────────────────────────────────────────────────────

/** Where a selection was started, and where it has been extended to (the active cell). */
export interface Selection {
  anchor: Pos;
  focus: Pos;
}

export const selectionArea = (s: Selection): Area => spanOf(s.anchor, s.focus);

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Move the active cell by (dr, dc). With `extend` the anchor stays, growing the selection. */
export function moveSelection(s: Selection, dr: number, dc: number, extend: boolean): Selection {
  const focus = { row: clamp(s.focus.row + dr, 0, MAX_ROWS - 1), col: clamp(s.focus.col + dc, 0, MAX_COLS - 1) };
  return { anchor: extend ? s.anchor : focus, focus };
}

export const selectCell = (p: Pos): Selection => ({ anchor: p, focus: p });

// ── layout ──────────────────────────────────────────────────────────

export const ROW_HEIGHT = 24;
export const DEFAULT_COL_WIDTH = 96;
export const MIN_COL_WIDTH = 24;
export const MAX_COL_WIDTH = 1000;
export const HEADER_HEIGHT = 24;

/**
 * Where columns sit horizontally. Widths are mostly the default, so positions are computed from
 * the few columns that differ rather than from a table of every column.
 */
export class ColumnLayout {
  private readonly custom: [number, number][];

  constructor(widths: Map<number, number>, readonly defaultWidth = DEFAULT_COL_WIDTH) {
    this.custom = [...widths.entries()].sort((a, b) => a[0] - b[0]);
  }

  width(col: number): number {
    const hit = this.custom.find(([c]) => c === col);
    return hit ? hit[1] : this.defaultWidth;
  }

  /** The x of a column's left edge. */
  left(col: number): number {
    let x = col * this.defaultWidth;
    for (const [c, w] of this.custom) {
      if (c >= col) break;
      x += w - this.defaultWidth;
    }
    return x;
  }

  /** The column whose right edge is within `slop` of x — where a drag resizes it — or null. */
  edgeAt(x: number, slop: number): number | null {
    const col = this.at(x);
    const left = this.left(col);
    if (x - left <= slop && col > 0) return col - 1;
    if (left + this.width(col) - x <= slop) return col;
    return null;
  }

  /** The column under x (clamped to 0 on the left). */
  at(x: number): number {
    if (x <= 0) return 0;
    let col = 0;
    let edge = 0;
    for (const [c, w] of this.custom) {
      const plainRun = (c - col) * this.defaultWidth;
      if (x < edge + plainRun) return col + Math.floor((x - edge) / this.defaultWidth);
      edge += plainRun;
      if (x < edge + w) return c;
      edge += w;
      col = c + 1;
    }
    return col + Math.floor((x - edge) / this.defaultWidth);
  }
}

/** How wide the row-number gutter must be for the rows on show. */
export const gutterWidth = (rows: number): number => Math.max(40, String(rows).length * 8 + 16);

/** How many rows and columns to lay out: what's used, plus room to keep going. */
export function extent(cells: Iterable<Pos>, active: Pos): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const c of cells) {
    rows = Math.max(rows, c.row + 1);
    cols = Math.max(cols, c.col + 1);
  }
  rows = Math.max(rows, active.row + 1);
  cols = Math.max(cols, active.col + 1);
  return { rows: Math.min(MAX_ROWS, Math.max(100, rows + 50)), cols: Math.min(MAX_COLS, Math.max(26, cols + 10)) };
}
