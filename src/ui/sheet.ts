// A sheet in an editor tab: a grid over the engine's sheet builtins.
//
// Two layers share the grid's box. Underneath, a stage draws only what is in view — the cells that
// hold something, grid lines, headers, the selection — positioned from the scroll offsets. On top, a
// transparent scroller owns scrolling (native, so trackpads and touch feel right) and every click,
// which is turned into a cell by arithmetic rather than by asking the DOM what was under it.
//
// Nothing here is saved on a timer: each committed edit is written by the engine at once. The only
// unsaved state a sheet has is a cell being typed into, which `commit()` writes.

import type { SheetClient, Changes } from "../engine/sheet";
import {
  a1,
  areaA1,
  blockArea,
  colName,
  DEFAULT_COL_WIDTH,
  decimalsShown,
  display,
  extent,
  fillTarget,
  fromTSV,
  gutterWidth,
  HEADER_HEIGHT,
  Lengths,
  MAX_SIZE,
  MIN_SIZE,
  moveSelection,
  parseArea,
  readableOn,
  ROW_HEIGHT,
  selectCell,
  selectionArea,
  spanOf,
  toTSV,
  MAX_COLS,
  MAX_ROWS,
  type Area,
  type Cell,
  type Fmt,
  type FmtChange,
  type Pos,
  type Selection,
  type SheetData,
} from "../core/sheet";
import { confirmModal, showContextMenu, type MenuItem } from "./dialogs";
import { openHelp, SHEET_HELP } from "./help";

export interface SheetView {
  readonly el: HTMLElement;
  path: string;
  load(): Promise<void>;
  /** Write the cell being typed into, if any — the one piece of unsaved state a sheet has. */
  commit(): Promise<void>;
  /** Reload when the sheet changed elsewhere: a note, the REPL, another window. */
  refreshIfChanged(): Promise<void>;
  /** Select a cell or an area — "B3", "A1:C9" — and scroll to it. */
  goto(ref: string): void;
  focus(): void;
  destroy(): void;
}

export interface SheetViewOptions {
  client: SheetClient;
  path: string;
  onError: (message: string) => void;
  /** Typing into a cell started (true) or ended — the tab shows • meanwhile. */
  onEditing: (editing: boolean) => void;
}

/** One undoable change. Inserting or deleting rows and columns is not one of them. */
type Edit =
  /** A block of inputs at `origin`, before and after. */
  | { kind: "input"; origin: Pos; before: string[][]; after: string[][] }
  /** A format merged into `area`; `before` is each cell's exact format, to put back. */
  | { kind: "format"; area: Area; before: (Fmt | null)[][]; change: FmtChange | null | (Fmt | null)[][] };

/** Clearing or formatting more than this at once is refused — it would be a very long undo entry. */
const MAX_BLOCK = 100_000;
/** How close to a column's edge the pointer must be to drag its width. */
const EDGE_SLOP = 4;
const LONG_PRESS_MS = 500;

const key = (row: number, col: number): string => `${row},${col}`;
const cellCount = (a: Area): number => (a.r1 - a.r0 + 1) * (a.c1 - a.c0 + 1);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

/** Three short lines, aligned one way — the alignment buttons' faces. */
function alignIcon(align: "left" | "center" | "right"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 14 12");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "12");
  for (const [y, w] of [[2, 12], [6, 8], [10, 10]] as const) {
    const x = align === "left" ? 1 : align === "right" ? 13 - w : (14 - w) / 2;
    const line = document.createElementNS(ns, "rect");
    line.setAttribute("x", String(x));
    line.setAttribute("y", String(y - 0.75));
    line.setAttribute("width", String(w));
    line.setAttribute("height", "1.5");
    line.setAttribute("fill", "currentColor");
    svg.appendChild(line);
  }
  return svg;
}

export function createSheetView(opts: SheetViewOptions): SheetView {
  const { client } = opts;

  // ── DOM ──
  const root = el("div", "sheet");

  const tools = el("div", "sheet-tools", root);
  const tool = (label: string | SVGElement, title: string, cls = ""): HTMLButtonElement => {
    const b = el("button", `sheet-tool ${cls}`.trim(), tools);
    if (typeof label === "string") b.textContent = label;
    else b.appendChild(label);
    b.title = title;
    // a toolbar click must not take focus from the grid — the next key belongs to the selection
    b.addEventListener("mousedown", (e) => e.preventDefault());
    return b;
  };
  const gap = (): void => void el("span", "sheet-tool-gap", tools);
  const boldBtn = tool("B", "Bold", "bold");
  const italicBtn = tool("I", "Italic", "italic");
  gap();
  const alignBtns = (["left", "center", "right"] as const).map((a) => [a, tool(alignIcon(a), `Align ${a}`)] as const);
  gap();
  const numSelect = el("select", "sheet-num", tools);
  numSelect.title = "Number format";
  for (const [value, label] of [["general", "General"], ["number", "Number"], ["currency", "Currency"], ["percent", "Percent"]]) {
    const o = el("option", "", numSelect);
    o.value = value;
    o.textContent = label;
  }
  for (const [value, label] of [["date", "Date"]]) {
    const o = el("option", "", numSelect);
    o.value = value;
    o.textContent = label;
  }
  const lessDp = tool(".0←", "Fewer decimal places");
  const moreDp = tool(".00→", "More decimal places");
  gap();
  const wrapBtn = tool("wrap", "Wrap the text inside the cell");
  const borderSelect = el("select", "sheet-num sheet-borders", tools);
  borderSelect.title = "Lines around the cells";
  for (const [value, label] of [["", "No border"], ["all", "All borders"], ["outer", "Outside only"]]) {
    const o = el("option", "", borderSelect);
    o.value = value;
    o.textContent = label;
  }
  const colour = (title: string, fallback: string): HTMLInputElement => {
    const input = el("input", "sheet-colour", tools);
    input.type = "color";
    input.title = title;
    input.value = fallback;
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    return input;
  };
  const fgInput = colour("Text colour", "#000000");
  const bgInput = colour("Fill colour", "#ffffff");
  const clearColours = tool("×", "No colours");
  gap();
  const clearFmtBtn = tool("clear format", "Remove the formatting from the selection");
  gap();
  const helpBtn = tool("?", "What you can write in a cell", "sheet-help");

  const bar = el("div", "sheet-bar", root);
  const nameBox = el("input", "sheet-namebox", bar);
  nameBox.spellcheck = false;
  nameBox.title = "The selected cell — type a cell or range, like C3 or A1:B9, and press Enter to go there";
  const fx = el("span", "sheet-fx", bar);
  fx.textContent = "=";
  const formula = el("input", "sheet-formula", bar);
  formula.spellcheck = false;
  formula.placeholder = "a value, or =(an expression)";
  const recalcBtn = el("button", "head-btn sheet-recalc", bar);
  recalcBtn.textContent = "↻";
  recalcBtn.title = "Recalculate every formula — for ones that read the database, other sheets or the clock";
  const status = el("div", "sheet-status", root);
  status.hidden = true;

  const grid = el("div", "sheet-grid", root);
  const stage = el("div", "sheet-stage", grid);
  const lines = el("div", "sheet-lines", stage);
  const cellsLayer = el("div", "sheet-cells", stage);
  const selBox = el("div", "sheet-sel", stage);
  const fillBox = el("div", "sheet-fillpreview", stage);
  fillBox.hidden = true;
  const activeBox = el("div", "sheet-active", stage);
  const colHead = el("div", "sheet-colhead", stage);
  const rowHead = el("div", "sheet-rowhead", stage);
  const corner = el("div", "sheet-corner", stage);
  // the small square at the selection's bottom-right corner: drag it to fill
  const handle = el("div", "sheet-handle", stage);
  const scroller = el("div", "sheet-scroller", grid);
  scroller.tabIndex = 0;
  const sizer = el("div", "sheet-sizer", scroller);
  const editor = el("input", "sheet-editor", grid);
  editor.spellcheck = false;
  editor.hidden = true;

  // ── state ──
  let path = opts.path;
  const cells = new Map<string, Cell>();
  let version = -1;
  let widths = new Map<number, number>();
  let heights = new Map<number, number>();
  let cols = new Lengths(widths, DEFAULT_COL_WIDTH);
  let rows = new Lengths(heights, ROW_HEIGHT);
  let size = { rows: 100, cols: 26 };
  let gutter = gutterWidth(size.rows);
  let sel: Selection = selectCell({ row: 0, col: 0 });
  /** Whether the selection is whole rows or columns — picked by their headers — rather than cells. */
  let whole: "rows" | "cols" | null = null;
  /** A cell being typed into. "enter" started by typing (arrows commit and move); "edit" by F2,
   *  a double-click or the formula bar (arrows move the caret). */
  let editing: { at: Pos; mode: "enter" | "edit" } | null = null;
  const undo: Edit[] = [];
  const redo: Edit[] = [];
  /** What ⌘C put on the clipboard, so a paste back into a sheet can move formulas rather than
   *  retype the values it is showing. Recognised by the text itself matching. */
  let clip: { tsv: string; rows: string[][]; origin: Pos } | null = null;
  /** A fill being dragged from the handle: where it started, and where it would reach. */
  let filling: { source: Area; target: Area } | null = null;
  /** Writes run one at a time, in the order they were made. */
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;

  const cellAt = (p: Pos): Cell | undefined => cells.get(key(p.row, p.col));
  const inputAt = (p: Pos): string => cellAt(p)?.input ?? "";
  const message = (e: unknown): string => String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, "");

  // ── loading and applying what the engine sends ──

  function take(data: SheetData): void {
    cells.clear();
    for (const c of data.cells) cells.set(key(c.row, c.col), c);
    version = data.version;
    setSizes(data.widths, data.heights);
  }

  function setSizes(nextWidths: Map<number, number>, nextHeights: Map<number, number>): void {
    widths = nextWidths;
    heights = nextHeights;
    cols = new Lengths(widths, DEFAULT_COL_WIDTH);
    rows = new Lengths(heights, ROW_HEIGHT);
    resize();
  }

  function apply(changes: Changes): void {
    for (const c of changes.cells) {
      if (c.input === "" && !c.fmt) cells.delete(key(c.row, c.col));
      else cells.set(key(c.row, c.col), c);
    }
    version = changes.version;
    resize();
  }

  /** Recompute how much grid to lay out, and redraw. */
  function resize(): void {
    size = extent(
      [...cells.values()].map((c) => ({ row: c.row, col: c.col })),
      sel.focus,
    );
    gutter = gutterWidth(size.rows);
    sizer.style.width = `${gutter + cols.start(size.cols)}px`;
    sizer.style.height = `${HEADER_HEIGHT + rows.start(size.rows)}px`;
    schedule();
  }

  async function load(): Promise<void> {
    try {
      take(await client.open(path));
    } catch (e) {
      opts.onError(`Could not open ${path}: ${message(e)}`);
    }
    syncBar();
  }

  /** Run a write after the ones already queued. A failure is reported, and the queue carries on. */
  function enqueue(task: () => Promise<void>): Promise<void> {
    pending++;
    syncBar();
    queue = queue.then(async () => {
      try {
        await task();
      } catch (e) {
        opts.onError(message(e));
      } finally {
        pending--;
        syncBar();
      }
    });
    return queue;
  }

  /** Type `after` at `origin`; `before` is what undo puts back. */
  function write(origin: Pos, after: string[][], before: string[][], record: boolean): Promise<void> {
    return enqueue(async () => {
      const single = after.length === 1 && after[0].length === 1;
      apply(await client.set(path, a1(origin), single ? after[0][0] : after));
      if (record) remember({ kind: "input", origin, before, after });
    });
  }

  function remember(edit: Edit): void {
    undo.push(edit);
    redo.length = 0;
  }

  // ── drawing ──

  let frame = 0;
  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  const xOf = (col: number): number => gutter + cols.start(col) - scroller.scrollLeft;
  const yOf = (row: number): number => HEADER_HEIGHT + rows.start(row) - scroller.scrollTop;

  function place(e: HTMLElement, x: number, y: number, w: number, h: number): void {
    e.style.transform = `translate(${x}px, ${y}px)`;
    e.style.width = `${w}px`;
    e.style.height = `${h}px`;
  }

  function draw(): void {
    const w = grid.clientWidth;
    const h = grid.clientHeight;
    const sx = scroller.scrollLeft;
    const sy = scroller.scrollTop;
    const c0 = cols.at(sx);
    const c1 = Math.min(size.cols - 1, cols.at(sx + w - gutter));
    const r0 = rows.at(sy);
    const r1 = Math.min(size.rows - 1, rows.at(sy + h - HEADER_HEIGHT));
    const area = selectionArea(sel);

    lines.replaceChildren();
    cellsLayer.replaceChildren();
    colHead.replaceChildren();
    rowHead.replaceChildren();

    for (let c = c0; c <= c1; c++) {
      const x = xOf(c);
      const cw = cols.size(c);
      const v = el("div", "sheet-vline", lines);
      place(v, x + cw - 1, 0, 1, h);
      const head = el("div", "sheet-colname" + (c >= area.c0 && c <= area.c1 ? " on" : ""), colHead);
      place(head, x, 0, cw, HEADER_HEIGHT);
      head.textContent = colName(c);
    }
    for (let r = r0; r <= r1; r++) {
      const y = yOf(r);
      const rh = rows.size(r);
      const line = el("div", "sheet-hline", lines);
      place(line, 0, y + rh - 1, w, 1);
      const head = el("div", "sheet-rowname" + (r >= area.r0 && r <= area.r1 ? " on" : ""), rowHead);
      place(head, 0, y, gutter, rh);
      head.textContent = String(r + 1);
    }
    for (const cell of cells.values()) {
      if (cell.row < r0 || cell.row > r1 || cell.col < c0 || cell.col > c1) continue;
      const shown = display(cell);
      if (!shown.text) continue;
      const box = el("div", "sheet-cell" + (shown.error ? " error" : "") + (cell.fmt?.wrap ? " wrap" : ""), cellsLayer);
      place(box, xOf(cell.col), yOf(cell.row), cols.size(cell.col), rows.size(cell.row));
      box.style.textAlign = shown.align;
      if (cell.fmt?.bold) box.style.fontWeight = "600";
      if (cell.fmt?.italic) box.style.fontStyle = "italic";
      if (cell.fmt?.bg) box.style.background = cell.fmt.bg;
      // a fill with no colour of its own gets ink that can be read on it
      if (cell.fmt?.fg) box.style.color = cell.fmt.fg;
      else if (cell.fmt?.bg) box.style.color = readableOn(cell.fmt.bg);
      if (cell.fmt?.border) {
        const edges = cell.fmt.border === "all" ? "tblr" : cell.fmt.border;
        const line = "1px solid var(--fg)";
        if (edges.includes("t")) box.style.borderTop = line;
        if (edges.includes("b")) box.style.borderBottom = line;
        if (edges.includes("l")) box.style.borderLeft = line;
        if (edges.includes("r")) box.style.borderRight = line;
      }
      box.textContent = shown.text;
    }
    place(colHead, 0, 0, w, HEADER_HEIGHT);
    place(rowHead, 0, 0, gutter, h);
    place(corner, 0, 0, gutter, HEADER_HEIGHT);

    const areaBox = (a: Area, box: HTMLElement): void => {
      place(box, xOf(a.c0), yOf(a.r0), cols.start(a.c1 + 1) - cols.start(a.c0), rows.start(a.r1 + 1) - rows.start(a.r0));
    };
    areaBox(area, selBox);
    selBox.hidden = area.r0 === area.r1 && area.c0 === area.c1;
    areaBox(spanOf(sel.focus, sel.focus), activeBox);
    const end = { x: xOf(area.c1) + cols.size(area.c1), y: yOf(area.r1) + rows.size(area.r1) };
    place(handle, end.x - 4, end.y - 4, 8, 8);
    handle.hidden = !!editing;
    if (filling) areaBox(filling.target, fillBox);
    fillBox.hidden = !filling;
    if (editing) {
      editor.style.transform = `translate(${xOf(editing.at.col)}px, ${yOf(editing.at.row)}px)`;
      editor.style.minWidth = `${cols.size(editing.at.col)}px`;
      editor.style.height = `${rows.size(editing.at.row)}px`;
    }
  }

  // ── the formula bar and the toolbar ──

  function syncBar(): void {
    const area = selectionArea(sel);
    if (document.activeElement !== nameBox) nameBox.value = areaA1(area);
    if (!editing) formula.value = inputAt(sel.focus);
    const active = cellAt(sel.focus);
    status.hidden = !active?.error;
    status.textContent = active?.error ? `${a1(sel.focus)}: ${active.error}` : "";
    root.classList.toggle("busy", pending > 0);
    // the toolbar shows the active cell's format
    const fmt = active?.fmt ?? null;
    boldBtn.classList.toggle("on", !!fmt?.bold);
    italicBtn.classList.toggle("on", !!fmt?.italic);
    for (const [a, b] of alignBtns) b.classList.toggle("on", fmt?.align === a);
    numSelect.value = fmt?.date ? "date" : (fmt?.num ?? "general");
    wrapBtn.classList.toggle("on", !!fmt?.wrap);
    borderSelect.value = fmt?.border === "all" ? "all" : fmt?.border ? "outer" : "";
    if (fmt?.fg) fgInput.value = fmt.fg;
    if (fmt?.bg) bgInput.value = fmt.bg;
  }

  // ── selection and scrolling ──

  function select(next: Selection, lines: "rows" | "cols" | "all" | null = null): void {
    sel = next;
    whole = lines === "all" ? null : lines;
    if (!lines && (next.focus.row >= size.rows - 10 || next.focus.col >= size.cols - 3)) resize();
    // A whole row is as wide as the laid-out grid: follow it only up and down, never off to its end.
    if (lines !== "all") scrollIntoView(next.focus, lines !== "cols", lines !== "rows");
    syncBar();
    schedule();
  }

  function scrollIntoView(p: Pos, vertical = true, horizontal = true): void {
    const left = cols.start(p.col);
    const right = left + cols.size(p.col);
    const top = rows.start(p.row);
    const bottom = top + rows.size(p.row);
    const viewW = scroller.clientWidth - gutter;
    const viewH = scroller.clientHeight - HEADER_HEIGHT;
    if (horizontal && left < scroller.scrollLeft) scroller.scrollLeft = left;
    else if (horizontal && right > scroller.scrollLeft + viewW) scroller.scrollLeft = right - viewW;
    if (vertical && top < scroller.scrollTop) scroller.scrollTop = top;
    else if (vertical && bottom > scroller.scrollTop + viewH) scroller.scrollTop = bottom - viewH;
  }

  /** A column's right edge or a row's bottom edge, under the pointer in its own header. */
  type Edge = { axis: "col" | "row"; index: number };
  type Hit = { kind: "cell" | "col" | "row" | "corner"; pos: Pos; edge: Edge | null };

  /** The cell or header under a point in the scroller's box; null over a scrollbar. */
  function hit(clientX: number, clientY: number): Hit | null {
    const r = scroller.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    if (x < 0 || y < 0 || x > scroller.clientWidth || y > scroller.clientHeight) return null;
    const contentX = x - gutter + scroller.scrollLeft;
    const contentY = y - HEADER_HEIGHT + scroller.scrollTop;
    const pos = { row: Math.max(0, rows.at(contentY)), col: cols.at(contentX) };
    if (y < HEADER_HEIGHT && x < gutter) return { kind: "corner", pos, edge: null };
    if (y < HEADER_HEIGHT) {
      const index = cols.edgeAt(contentX, EDGE_SLOP);
      return { kind: "col", pos, edge: index === null ? null : { axis: "col", index } };
    }
    if (x < gutter) {
      const index = rows.edgeAt(contentY, EDGE_SLOP);
      return { kind: "row", pos, edge: index === null ? null : { axis: "row", index } };
    }
    return { kind: "cell", pos, edge: null };
  }

  // ── editing ──

  function startEdit(text: string, mode: "enter" | "edit", into: HTMLInputElement = editor): void {
    editing = { at: sel.focus, mode };
    editor.hidden = false;
    editor.value = text;
    formula.value = text;
    opts.onEditing(true);
    draw();
    into.focus();
    into.setSelectionRange(text.length, text.length);
  }

  async function commit(move?: [number, number]): Promise<void> {
    if (!editing) return;
    const { at } = editing;
    const text = editor.value;
    stopEdit();
    const before = inputAt(at);
    const done = text !== before ? write(at, [[text]], [[before]], true) : Promise.resolve();
    if (move) select(moveSelection(selectCell(at), move[0], move[1], false));
    scroller.focus({ preventScroll: true });
    await done;
  }

  function cancelEdit(): void {
    if (!editing) return;
    stopEdit();
    syncBar();
    scroller.focus({ preventScroll: true });
  }

  function stopEdit(): void {
    editing = null;
    editor.hidden = true;
    opts.onEditing(false);
    schedule();
  }

  /** Each cell of the selection through `f`, as rows — or null, reported, when there are too many. */
  function snapshot<T>(area: Area, f: (p: Pos) => T, what: string): T[][] | null {
    if (cellCount(area) > MAX_BLOCK) {
      opts.onError(`${areaA1(area)} is ${cellCount(area)} cells — too many to ${what} at once`);
      return null;
    }
    const rows: T[][] = [];
    for (let r = area.r0; r <= area.r1; r++) {
      const row: T[] = [];
      for (let c = area.c0; c <= area.c1; c++) row.push(f({ row: r, col: c }));
      rows.push(row);
    }
    return rows;
  }

  function clearContents(): void {
    const area = selectionArea(sel);
    const before = snapshot(area, inputAt, "clear");
    if (!before || before.every((row) => row.every((input) => input === ""))) return;
    void write({ row: area.r0, col: area.c0 }, before.map((row) => row.map(() => "")), before, true);
  }

  /** Merge a format change into the selection (null clears it), remembering each cell's format for undo. */
  function formatSelection(change: FmtChange | null): void {
    const area = selectionArea(sel);
    const before = snapshot(area, (p) => cellAt(p)?.fmt ?? null, "format");
    if (before) applyFormat(area, before, change);
  }

  /** Set every cell's format in the area exactly — for a format that differs from cell to cell. */
  function applyFormatBlock(area: Area, block: (Fmt | null)[][]): void {
    const before = snapshot(area, (p) => cellAt(p)?.fmt ?? null, "format");
    if (before) applyFormat(area, before, block);
  }

  function applyFormat(area: Area, before: (Fmt | null)[][], change: FmtChange | null | (Fmt | null)[][]): void {
    void enqueue(async () => {
      const corner = a1({ row: area.r0, col: area.c0 });
      apply(await client.format(path, Array.isArray(change) ? corner : areaA1(area), change));
      remember({ kind: "format", area, before, change });
    });
  }

  function undoRedo(isUndo: boolean): void {
    const from = isUndo ? undo : redo;
    const to = isUndo ? redo : undo;
    const edit = from.pop();
    if (!edit) return;
    to.push(edit);
    if (edit.kind === "input") {
      void write(edit.origin, isUndo ? edit.before : edit.after, isUndo ? edit.after : edit.before, false);
      const rows = edit.after.length;
      const cols = Math.max(1, ...edit.after.map((r) => r.length));
      select({ anchor: edit.origin, focus: { row: edit.origin.row + rows - 1, col: edit.origin.col + cols - 1 } });
    } else {
      const { area } = edit;
      void enqueue(async () => {
        const origin = a1({ row: area.r0, col: area.c0 });
        const target = Array.isArray(edit.change) ? origin : areaA1(area);
        apply(await (isUndo ? client.format(path, origin, edit.before) : client.format(path, target, edit.change)));
      });
      select({ anchor: { row: area.r0, col: area.c0 }, focus: { row: area.r1, col: area.c1 } });
    }
  }

  // ── rows and columns ──

  type Structure = "insert-rows" | "delete-rows" | "insert-cols" | "delete-cols";

  /**
   * Insert or delete rows or columns. The whole sheet comes back, and undo history is dropped: every
   * position it remembers has moved.
   */
  function restructure(op: Structure, at: number, n: number): void {
    const cols = op.endsWith("cols");
    void enqueue(async () => {
      take(await client.structure(path, op, cols ? colName(at) : at + 1, n));
      undo.length = 0;
      redo.length = 0;
    });
  }

  async function deleteLines(op: "delete-rows" | "delete-cols", area: Area): Promise<void> {
    const cols = op === "delete-cols";
    const [from, to] = cols ? [area.c0, area.c1] : [area.r0, area.r1];
    const name = (i: number): string => (cols ? colName(i) : String(i + 1));
    const which = from === to ? `${cols ? "column" : "row"} ${name(from)}` : `${cols ? "columns" : "rows"} ${name(from)}–${name(to)}`;
    const ok = await confirmModal(
      `Delete ${which}? Formulas that read those cells will show #REF!, and this can't be undone.`,
      "Delete",
    );
    if (ok) restructure(op, from, to - from + 1);
  }

  /** The menu for a right-click (or long press) on a header or a cell. */
  function menuFor(h: Hit): MenuItem[] {
    // The menu acts on the selection, so a click outside it selects what was clicked first — and a
    // header selects its whole row or column unless those are what is already selected.
    const area0 = selectionArea(sel);
    const inRows = h.pos.row >= area0.r0 && h.pos.row <= area0.r1;
    const inCols = h.pos.col >= area0.c0 && h.pos.col <= area0.c1;
    if (h.kind === "col" && !(whole === "cols" && inCols)) pick(h, false);
    else if (h.kind === "row" && !(whole === "rows" && inRows)) pick(h, false);
    else if (h.kind === "cell" && !(inRows && inCols)) pick(h, false);
    const area = selectionArea(sel);
    const nCols = area.c1 - area.c0 + 1;
    const nRows = area.r1 - area.r0 + 1;
    const plural = (n: number, one: string): string => (n === 1 ? `1 ${one}` : `${n} ${one}s`);
    const colItems: MenuItem[] = [
      { label: `Insert ${plural(nCols, "column")} left`, action: () => restructure("insert-cols", area.c0, nCols) },
      { label: `Insert ${plural(nCols, "column")} right`, action: () => restructure("insert-cols", area.c1 + 1, nCols) },
      { label: `Delete ${plural(nCols, "column")}`, action: () => void deleteLines("delete-cols", area), danger: true },
    ];
    const rowItems: MenuItem[] = [
      { label: `Insert ${plural(nRows, "row")} above`, action: () => restructure("insert-rows", area.r0, nRows) },
      { label: `Insert ${plural(nRows, "row")} below`, action: () => restructure("insert-rows", area.r1 + 1, nRows) },
      { label: `Delete ${plural(nRows, "row")}`, action: () => void deleteLines("delete-rows", area), danger: true },
    ];
    const cellItems: MenuItem[] = [
      { label: "Clear contents", action: clearContents },
      { label: "Clear format", action: () => formatSelection(null) },
    ];
    if (nRows > 1) {
      cellItems.unshift({ label: "Fill down", action: () => fill({ ...area, r1: area.r0 }, area) });
    }
    if (nCols > 1) {
      cellItems.unshift({ label: "Fill right", action: () => fill({ ...area, c1: area.c0 }, area) });
    }
    if (h.kind === "col") return colItems;
    if (h.kind === "row") return rowItems;
    if (h.kind === "corner") return cellItems;
    return [...cellItems, ...rowItems.slice(0, 2), ...colItems.slice(0, 2), rowItems[2], colItems[2]];
  }

  // ── events ──

  scroller.addEventListener("scroll", schedule, { passive: true });
  const observer = new ResizeObserver(schedule);
  observer.observe(grid);

  /** What a held mouse button is sweeping across: cells, or whole rows or columns from their headers. */
  let dragging: "cell" | "row" | "col" | false = false;
  /** A column's or row's edge being dragged. */
  let resizing: { edge: Edge; from: number; size: number } | null = null;
  let touch: { x: number; y: number; timer: ReturnType<typeof setTimeout>; pressed: boolean } | null = null;

  scroller.addEventListener("pointerdown", (e) => {
    const h = hit(e.clientX, e.clientY);
    if (!h) return;
    if (editing) void commit();
    if (e.pointerType !== "mouse") {
      // Decide on lift — a scroll is not a tap — unless the finger stays put long enough for a menu.
      const start = { x: e.clientX, y: e.clientY };
      touch = {
        ...start,
        pressed: false,
        timer: setTimeout(() => {
          if (!touch) return;
          touch.pressed = true;
          showContextMenu(start.x, start.y, menuFor(h));
        }, LONG_PRESS_MS),
      };
      return;
    }
    if (e.button !== 0) return; // the context menu has its own event
    e.preventDefault();
    scroller.focus({ preventScroll: true });
    if (onHandle(e.clientX, e.clientY)) {
      const source = selectionArea(sel);
      filling = { source, target: source };
      scroller.setPointerCapture(e.pointerId);
      return;
    }
    if (h.edge) {
      resizing = { edge: h.edge, from: along(h.edge.axis, e), size: sizeOf(h.edge) };
      scroller.setPointerCapture(e.pointerId);
      return;
    }
    pick(h, e.shiftKey);
    if (h.kind !== "corner") {
      dragging = h.kind;
      scroller.setPointerCapture(e.pointerId);
    }
  });

  scroller.addEventListener("pointermove", (e) => {
    if (touch && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) >= 8) clearTimeout(touch.timer);
    if (filling) {
      const h = hit(e.clientX, e.clientY);
      if (h) {
        filling.target = fillTarget(filling.source, h.pos);
        schedule();
      }
      return;
    }
    if (resizing) {
      const moved = along(resizing.edge.axis, e) - resizing.from;
      applySize(resizing.edge, Math.round(Math.max(MIN_SIZE, Math.min(MAX_SIZE, resizing.size + moved))));
      return;
    }
    if (dragging) {
      const r = scroller.getBoundingClientRect();
      // past the headers the sweep keeps going: a row drag reads only the row, a column drag the column
      const h = hit(Math.min(Math.max(e.clientX, r.left + gutter + 1), r.right - 1), Math.min(Math.max(e.clientY, r.top + HEADER_HEIGHT + 1), r.bottom - 1));
      if (!h) return;
      if (dragging === "cell") select({ anchor: sel.anchor, focus: h.pos });
      else pick({ kind: dragging, pos: h.pos }, true);
      return;
    }
    if (e.pointerType === "mouse") {
      const edge = hit(e.clientX, e.clientY)?.edge;
      scroller.style.cursor = onHandle(e.clientX, e.clientY)
        ? "crosshair"
        : edge
          ? edge.axis === "col"
            ? "col-resize"
            : "row-resize"
          : "";
    }
  });

  scroller.addEventListener("pointerup", (e) => {
    dragging = false;
    if (filling) {
      const { source, target } = filling;
      filling = null;
      schedule();
      if (target.r0 !== source.r0 || target.r1 !== source.r1 || target.c0 !== source.c0 || target.c1 !== source.c1) {
        fill(source, target);
      }
    }
    if (resizing) {
      const { edge } = resizing;
      resizing = null;
      saveSize(edge, sizeOf(edge));
    }
    if (touch) {
      clearTimeout(touch.timer);
      if (!touch.pressed && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) < 8) {
        const h = hit(e.clientX, e.clientY);
        if (h) pick(h, false);
      }
      touch = null;
    }
  });

  /** Is the pointer on the fill handle? */
  function onHandle(clientX: number, clientY: number): boolean {
    const r = scroller.getBoundingClientRect();
    const area = selectionArea(sel);
    const x = r.left + xOf(area.c1) + cols.size(area.c1);
    const y = r.top + yOf(area.r1) + rows.size(area.r1);
    return Math.abs(clientX - x) <= 5 && Math.abs(clientY - y) <= 5;
  }

  /** Which way a drag on this axis counts. */
  const along = (axis: Edge["axis"], e: PointerEvent): number => (axis === "col" ? e.clientX : e.clientY);
  const sizeOf = (edge: Edge): number => (edge.axis === "col" ? cols : rows).size(edge.index);

  /** Resize on screen, before the engine hears about it. */
  function applySize(edge: Edge, size: number | null): void {
    const next = new Map(edge.axis === "col" ? widths : heights);
    if (size === null) next.delete(edge.index);
    else next.set(edge.index, size);
    if (edge.axis === "col") setSizes(next, heights);
    else setSizes(widths, next);
  }

  function saveSize(edge: Edge, size: number | null): void {
    void enqueue(async () => {
      version =
        edge.axis === "col"
          ? await client.colWidth(path, colName(edge.index), size)
          : await client.rowHeight(path, edge.index + 1, size);
    });
  }

  scroller.addEventListener("dblclick", (e) => {
    const h = hit(e.clientX, e.clientY);
    if (h?.edge) {
      applySize(h.edge, null); // back to the default size
      saveSize(h.edge, null);
      return;
    }
    if (h?.kind !== "cell") return;
    select(selectCell(h.pos));
    startEdit(inputAt(h.pos), "edit");
  });

  scroller.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const h = hit(e.clientX, e.clientY);
    if (!h || touch?.pressed) return; // a long press already opened one
    showContextMenu(e.clientX, e.clientY, menuFor(h));
  });

  /**
   * A click: a cell, a whole column or row (as far as the grid is laid out), or everything. For a
   * row the active cell is its first; the anchor sits at the far end, which keeps the row an area.
   */
  function pick(h: { kind: string; pos: Pos }, extend: boolean): void {
    const last = { row: size.rows - 1, col: size.cols - 1 };
    switch (h.kind) {
      case "col": {
        const from = extend && whole === "cols" ? sel.anchor.col : h.pos.col;
        select({ anchor: { row: last.row, col: from }, focus: { row: 0, col: h.pos.col } }, "cols");
        break;
      }
      case "row": {
        const from = extend && whole === "rows" ? sel.anchor.row : h.pos.row;
        select({ anchor: { row: from, col: last.col }, focus: { row: h.pos.row, col: 0 } }, "rows");
        break;
      }
      case "corner":
        select({ anchor: last, focus: { row: 0, col: 0 } }, "all");
        break;
      default:
        select(extend ? { anchor: sel.anchor, focus: h.pos } : selectCell(h.pos));
    }
  }

  /** ⌘C / ⌘X: the values as TSV for anyone else, the inputs kept here for a paste back into a sheet. */
  function putOnClipboard(e: ClipboardEvent, cut: boolean): void {
    const area = selectionArea(sel);
    const inputs = snapshot(area, inputAt, "copy");
    const shown = snapshot(area, (p) => display(cellAt(p)).text, "copy");
    if (!inputs || !shown) return;
    const tsv = toTSV(shown);
    e.clipboardData?.setData("text/plain", tsv);
    e.preventDefault();
    clip = { tsv, rows: inputs, origin: { row: area.r0, col: area.c0 } };
    if (cut) clearContents();
  }

  /** Type a block at `at`. `from` — where it was copied here — moves the formulas with it. */
  function pasteBlock(at: Pos, rows: string[][], from?: string): void {
    if (rows.length === 0) return;
    const area = blockArea(at, rows);
    if (area.r1 >= MAX_ROWS || area.c1 >= MAX_COLS) {
      opts.onError(`that block doesn't fit at ${a1(at)}`);
      return;
    }
    const before = snapshot(area, inputAt, "paste");
    if (!before) return;
    void enqueue(async () => {
      apply(await client.paste(path, a1(at), rows, from));
      remember({ kind: "input", origin: at, before, after: snapshot(area, inputAt, "paste") ?? [] });
      select({ anchor: at, focus: { row: area.r1, col: area.c1 } });
    });
  }

  /** Repeat the source block over the target area, formulas moving with each copy. */
  function fill(source: Area, target: Area): void {
    const before = snapshot(target, inputAt, "fill");
    if (!before) return;
    const origin = { row: target.r0, col: target.c0 };
    void enqueue(async () => {
      apply(await client.fill(path, areaA1(source), areaA1(target)));
      remember({ kind: "input", origin, before, after: snapshot(target, inputAt, "fill") ?? [] });
      select({ anchor: origin, focus: { row: target.r1, col: target.c1 } });
    });
  }

  // On the document, not the grid: with focus on something that isn't editable, a browser sends the
  // paste to the body, so a listener on the grid would never hear it. Each view answers only while
  // it holds focus, and drops its listeners when it goes.
  const clipboardOwner = (): boolean => document.activeElement === scroller && !editing;
  const onCopy = (e: ClipboardEvent): void => {
    if (clipboardOwner()) putOnClipboard(e, false);
  };
  const onCut = (e: ClipboardEvent): void => {
    if (clipboardOwner()) putOnClipboard(e, true);
  };
  const onPaste = (e: ClipboardEvent): void => {
    if (!clipboardOwner()) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    e.preventDefault();
    const area = selectionArea(sel);
    const at = { row: area.r0, col: area.c0 };
    // The same text we put there means these cells came from a sheet: paste what was typed, moved.
    const mine = clip && clip.tsv === text ? clip : null;
    pasteBlock(at, mine ? mine.rows : fromTSV(text), mine ? a1(mine.origin) : undefined);
  };
  document.addEventListener("copy", onCopy);
  document.addEventListener("cut", onCut);
  document.addEventListener("paste", onPaste);

  scroller.addEventListener("keydown", (e) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const page = Math.max(1, Math.floor((scroller.clientHeight - HEADER_HEIGHT) / ROW_HEIGHT) - 1);
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      PageUp: [-page, 0],
      PageDown: [page, 0],
    };
    if (e.key in moves && !mod) {
      e.preventDefault();
      select(moveSelection(sel, moves[e.key][0], moves[e.key][1], e.shiftKey));
    } else if (e.key === "Tab") {
      e.preventDefault();
      select(moveSelection(selectCell(sel.focus), 0, e.shiftKey ? -1 : 1, false));
    } else if (e.key === "Home" && !mod) {
      e.preventDefault();
      select(moveSelection(sel, 0, -sel.focus.col, e.shiftKey));
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit(inputAt(sel.focus), "edit");
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      clearContents();
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undoRedo(!e.shiftKey);
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      undoRedo(false);
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      pick({ kind: "corner", pos: sel.focus }, false);
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = scroller.getBoundingClientRect();
      const x = r.left + xOf(sel.focus.col) + 8;
      const y = r.top + yOf(sel.focus.row) + ROW_HEIGHT;
      showContextMenu(x, y, menuFor({ kind: "cell", pos: sel.focus, edge: null }));
    } else if (e.key.length === 1 && !mod && !e.altKey && !e.isComposing) {
      e.preventDefault();
      startEdit(e.key, "enter");
    }
  });

  function editKeys(e: KeyboardEvent, input: HTMLInputElement): void {
    if (e.isComposing) return;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (e.key === "Enter") {
      e.preventDefault();
      void commit([e.shiftKey ? -1 : 1, 0]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      void commit([0, e.shiftKey ? -1 : 1]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (e.key in arrows && editing?.mode === "enter" && input === editor) {
      e.preventDefault();
      void commit(arrows[e.key]);
    }
  }

  editor.addEventListener("keydown", (e) => editKeys(e, editor));
  // The two inputs show the same text; commit reads the in-cell one.
  editor.addEventListener("input", () => {
    formula.value = editor.value;
  });
  formula.addEventListener("focus", () => {
    if (!editing) startEdit(inputAt(sel.focus), "edit", formula);
  });
  formula.addEventListener("input", () => {
    editor.value = formula.value;
  });
  formula.addEventListener("keydown", (e) => editKeys(e, formula));
  // Leaving the cell by clicking elsewhere keeps what was typed, the way every spreadsheet does.
  for (const input of [editor, formula]) {
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (editing && document.activeElement !== editor && document.activeElement !== formula) void commit();
      }, 0);
    });
  }

  nameBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const area = parseArea(nameBox.value);
      if (!area) {
        nameBox.value = areaA1(selectionArea(sel));
        return;
      }
      select({ anchor: { row: area.r0, col: area.c0 }, focus: { row: area.r1, col: area.c1 } });
      scroller.focus({ preventScroll: true });
    } else if (e.key === "Escape") {
      nameBox.value = areaA1(selectionArea(sel));
      scroller.focus({ preventScroll: true });
    }
  });

  recalcBtn.addEventListener("click", () => {
    void enqueue(async () => apply(await client.recalc(path)));
  });

  // the cheatsheet, a button away from the cell the question was asked in: picking a formula types it
  // into the selected cell rather than writing it, so Escape still leaves the cell alone
  helpBtn.addEventListener("click", () => {
    openHelp(SHEET_HELP, (code) => startEdit(code, "edit"));
  });

  // ── toolbar ──

  const activeFmt = (): Fmt | null => cellAt(sel.focus)?.fmt ?? null;
  boldBtn.addEventListener("click", () => formatSelection({ bold: activeFmt()?.bold ? null : true }));
  italicBtn.addEventListener("click", () => formatSelection({ italic: activeFmt()?.italic ? null : true }));
  for (const [align, btn] of alignBtns) {
    btn.addEventListener("click", () => formatSelection({ align: activeFmt()?.align === align ? null : align }));
  }
  numSelect.addEventListener("change", () => {
    const chosen = numSelect.value;
    // a date and a number format are the same slot to a person, so choosing one clears the other
    if (chosen === "date") formatSelection({ date: "medium", num: null });
    else formatSelection({ num: chosen === "general" ? null : (chosen as NonNullable<Fmt["num"]>), date: null });
    scroller.focus({ preventScroll: true });
  });
  wrapBtn.addEventListener("click", () => formatSelection({ wrap: activeFmt()?.wrap ? null : true }));
  fgInput.addEventListener("input", () => formatSelection({ fg: fgInput.value }));
  bgInput.addEventListener("input", () => formatSelection({ bg: bgInput.value }));
  clearColours.addEventListener("click", () => formatSelection({ fg: null, bg: null }));
  borderSelect.addEventListener("change", () => {
    const area = selectionArea(sel);
    if (borderSelect.value === "") formatSelection({ border: null });
    else if (borderSelect.value === "all") formatSelection({ border: "all" });
    else {
      // "outside only" is a different format per cell, so it goes as a block — built from what each
      // cell already has, since a block replaces rather than merges.
      const block = snapshot(area, (p) => {
        const edges =
          (p.row === area.r0 ? "t" : "") +
          (p.row === area.r1 ? "b" : "") +
          (p.col === area.c0 ? "l" : "") +
          (p.col === area.c1 ? "r" : "");
        const fmt: Fmt = { ...(cellAt(p)?.fmt ?? {}) };
        if (edges) fmt.border = edges;
        else delete fmt.border;
        return Object.keys(fmt).length ? fmt : null;
      }, "format");
      if (block) applyFormatBlock(area, block);
    }
    scroller.focus({ preventScroll: true });
  });
  const stepDecimals = (by: number): void => {
    const active = cellAt(sel.focus);
    const dp = Math.max(0, Math.min(10, decimalsShown(active?.value ?? null, active?.fmt ?? null) + by));
    formatSelection({ dp });
  };
  lessDp.addEventListener("click", () => stepDecimals(-1));
  moreDp.addEventListener("click", () => stepDecimals(1));
  clearFmtBtn.addEventListener("click", () => formatSelection(null));

  return {
    el: root,
    get path() {
      return path;
    },
    set path(p: string) {
      path = p;
    },
    load,
    commit: () => commit(),
    async refreshIfChanged() {
      if (editing || pending > 0) return;
      try {
        if ((await client.version(path)) !== version) await load();
      } catch {
        /* the next write will say what's wrong */
      }
    },
    goto(ref: string) {
      const area = parseArea(ref);
      if (!area) return;
      select({ anchor: { row: area.r0, col: area.c0 }, focus: { row: area.r1, col: area.c1 } });
      scroller.focus({ preventScroll: true });
    },
    focus: () => scroller.focus({ preventScroll: true }),
    destroy() {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      root.remove();
    },
  };
}
