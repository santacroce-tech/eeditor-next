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
  ColumnLayout,
  display,
  extent,
  gutterWidth,
  HEADER_HEIGHT,
  moveSelection,
  parseArea,
  ROW_HEIGHT,
  selectCell,
  selectionArea,
  spanOf,
  colName,
  type Area,
  type Cell,
  type Pos,
  type Selection,
  type SheetData,
} from "../core/sheet";

export interface SheetView {
  readonly el: HTMLElement;
  path: string;
  load(): Promise<void>;
  /** Write the cell being typed into, if any — the one piece of unsaved state a sheet has. */
  commit(): Promise<void>;
  /** Reload when the sheet changed elsewhere: a note, the REPL, another window. */
  refreshIfChanged(): Promise<void>;
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

/** One undoable write: the block at `origin` before and after. */
interface Edit {
  origin: Pos;
  before: string[][];
  after: string[][];
}

/** Clearing more than this at once is refused — it would be a very long undo entry. */
const MAX_CLEAR = 100_000;

const key = (row: number, col: number): string => `${row},${col}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

export function createSheetView(opts: SheetViewOptions): SheetView {
  const { client } = opts;

  // ── DOM ──
  const root = el("div", "sheet");
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
  const activeBox = el("div", "sheet-active", stage);
  const colHead = el("div", "sheet-colhead", stage);
  const rowHead = el("div", "sheet-rowhead", stage);
  const corner = el("div", "sheet-corner", stage);
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
  let layout = new ColumnLayout(new Map());
  let size = { rows: 100, cols: 26 };
  let gutter = gutterWidth(size.rows);
  let sel: Selection = selectCell({ row: 0, col: 0 });
  /** A cell being typed into. "enter" started by typing (arrows commit and move); "edit" by F2,
   *  a double-click or the formula bar (arrows move the caret). */
  let editing: { at: Pos; mode: "enter" | "edit" } | null = null;
  const undo: Edit[] = [];
  const redo: Edit[] = [];
  /** Writes run one at a time, in the order they were made. */
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;

  const cellAt = (p: Pos): Cell | undefined => cells.get(key(p.row, p.col));
  const inputAt = (p: Pos): string => cellAt(p)?.input ?? "";

  // ── loading and applying what the engine sends ──

  function take(data: SheetData): void {
    cells.clear();
    for (const c of data.cells) cells.set(key(c.row, c.col), c);
    version = data.version;
    layout = new ColumnLayout(data.widths);
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
    sizer.style.width = `${gutter + layout.left(size.cols)}px`;
    sizer.style.height = `${HEADER_HEIGHT + size.rows * ROW_HEIGHT}px`;
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

  const message = (e: unknown): string => String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, "");

  /** Queue a write of `after` at `origin`; `before` is what undo puts back. */
  function write(origin: Pos, after: string[][], before: string[][], record: boolean): Promise<void> {
    pending++;
    queue = queue.then(async () => {
      try {
        const single = after.length === 1 && after[0].length === 1;
        apply(await client.set(path, a1(origin), single ? after[0][0] : after));
        if (record) {
          undo.push({ origin, before, after });
          redo.length = 0;
        }
      } catch (e) {
        opts.onError(message(e));
      } finally {
        pending--;
        syncBar();
      }
    });
    return queue;
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

  const xOf = (col: number): number => gutter + layout.left(col) - scroller.scrollLeft;
  const yOf = (row: number): number => HEADER_HEIGHT + row * ROW_HEIGHT - scroller.scrollTop;

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
    const c0 = layout.at(sx);
    const c1 = Math.min(size.cols - 1, layout.at(sx + w - gutter));
    const r0 = Math.floor(sy / ROW_HEIGHT);
    const r1 = Math.min(size.rows - 1, Math.ceil((sy + h - HEADER_HEIGHT) / ROW_HEIGHT));
    const area = selectionArea(sel);

    lines.replaceChildren();
    cellsLayer.replaceChildren();
    colHead.replaceChildren();
    rowHead.replaceChildren();

    for (let c = c0; c <= c1; c++) {
      const x = xOf(c);
      const cw = layout.width(c);
      const v = el("div", "sheet-vline", lines);
      place(v, x + cw - 1, 0, 1, h);
      const head = el("div", "sheet-colname" + (c >= area.c0 && c <= area.c1 ? " on" : ""), colHead);
      place(head, x, 0, cw, HEADER_HEIGHT);
      head.textContent = colName(c);
    }
    for (let r = r0; r <= r1; r++) {
      const y = yOf(r);
      const line = el("div", "sheet-hline", lines);
      place(line, 0, y + ROW_HEIGHT - 1, w, 1);
      const head = el("div", "sheet-rowname" + (r >= area.r0 && r <= area.r1 ? " on" : ""), rowHead);
      place(head, 0, y, gutter, ROW_HEIGHT);
      head.textContent = String(r + 1);
    }
    for (const cell of cells.values()) {
      if (cell.row < r0 || cell.row > r1 || cell.col < c0 || cell.col > c1) continue;
      const shown = display(cell);
      if (!shown.text) continue;
      const box = el("div", "sheet-cell" + (shown.error ? " error" : ""), cellsLayer);
      place(box, xOf(cell.col), yOf(cell.row), layout.width(cell.col), ROW_HEIGHT);
      box.style.textAlign = shown.align;
      if (cell.fmt?.bold) box.style.fontWeight = "600";
      if (cell.fmt?.italic) box.style.fontStyle = "italic";
      box.textContent = shown.text;
    }
    place(colHead, 0, 0, w, HEADER_HEIGHT);
    place(rowHead, 0, 0, gutter, h);
    place(corner, 0, 0, gutter, HEADER_HEIGHT);

    const areaBox = (a: Area, box: HTMLElement): void => {
      const x = xOf(a.c0);
      const y = yOf(a.r0);
      place(box, x, y, layout.left(a.c1 + 1) - layout.left(a.c0), (a.r1 - a.r0 + 1) * ROW_HEIGHT);
    };
    areaBox(area, selBox);
    selBox.hidden = area.r0 === area.r1 && area.c0 === area.c1;
    areaBox(spanOf(sel.focus, sel.focus), activeBox);
    if (editing) {
      const x = xOf(editing.at.col);
      const y = yOf(editing.at.row);
      editor.style.transform = `translate(${x}px, ${y}px)`;
      editor.style.minWidth = `${layout.width(editing.at.col)}px`;
      editor.style.height = `${ROW_HEIGHT}px`;
    }
  }

  // ── the formula bar ──

  function syncBar(): void {
    const area = selectionArea(sel);
    if (document.activeElement !== nameBox) nameBox.value = areaA1(area);
    if (!editing) formula.value = inputAt(sel.focus);
    const error = cellAt(sel.focus)?.error;
    status.hidden = !error;
    status.textContent = error ? `${a1(sel.focus)}: ${error}` : "";
    root.classList.toggle("busy", pending > 0);
  }

  // ── selection and scrolling ──

  function select(next: Selection): void {
    sel = next;
    if (next.focus.row >= size.rows - 10 || next.focus.col >= size.cols - 3) resize();
    scrollIntoView(next.focus);
    syncBar();
    schedule();
  }

  function scrollIntoView(p: Pos): void {
    const left = layout.left(p.col);
    const right = left + layout.width(p.col);
    const top = p.row * ROW_HEIGHT;
    const viewW = scroller.clientWidth - gutter;
    const viewH = scroller.clientHeight - HEADER_HEIGHT;
    if (left < scroller.scrollLeft) scroller.scrollLeft = left;
    else if (right > scroller.scrollLeft + viewW) scroller.scrollLeft = right - viewW;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_HEIGHT > scroller.scrollTop + viewH) scroller.scrollTop = top + ROW_HEIGHT - viewH;
  }

  /** The cell (or header) under a point in the scroller's box; null over a scrollbar. */
  function hit(clientX: number, clientY: number): { kind: "cell" | "col" | "row" | "corner"; pos: Pos } | null {
    const r = scroller.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    if (x < 0 || y < 0 || x > scroller.clientWidth || y > scroller.clientHeight) return null;
    const pos = {
      row: Math.max(0, Math.floor((y - HEADER_HEIGHT + scroller.scrollTop) / ROW_HEIGHT)),
      col: layout.at(x - gutter + scroller.scrollLeft),
    };
    if (y < HEADER_HEIGHT && x < gutter) return { kind: "corner", pos };
    if (y < HEADER_HEIGHT) return { kind: "col", pos };
    if (x < gutter) return { kind: "row", pos };
    return { kind: "cell", pos };
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

  function clearSelection(): void {
    const area = selectionArea(sel);
    const count = (area.r1 - area.r0 + 1) * (area.c1 - area.c0 + 1);
    if (count > MAX_CLEAR) {
      opts.onError(`${areaA1(area)} is ${count} cells — too many to clear at once`);
      return;
    }
    const before: string[][] = [];
    const after: string[][] = [];
    let anything = false;
    for (let r = area.r0; r <= area.r1; r++) {
      const was: string[] = [];
      for (let c = area.c0; c <= area.c1; c++) {
        const input = inputAt({ row: r, col: c });
        anything ||= input !== "";
        was.push(input);
      }
      before.push(was);
      after.push(was.map(() => ""));
    }
    if (anything) void write({ row: area.r0, col: area.c0 }, after, before, true);
  }

  function undoRedo(from: Edit[], to: Edit[], useBefore: boolean): void {
    const edit = from.pop();
    if (!edit) return;
    to.push(edit);
    void write(edit.origin, useBefore ? edit.before : edit.after, useBefore ? edit.after : edit.before, false);
    const rows = edit.after.length;
    const cols = Math.max(1, ...edit.after.map((r) => r.length));
    select({ anchor: edit.origin, focus: { row: edit.origin.row + rows - 1, col: edit.origin.col + cols - 1 } });
  }

  // ── events ──

  scroller.addEventListener("scroll", schedule, { passive: true });
  const observer = new ResizeObserver(schedule);
  observer.observe(grid);

  let dragging = false;
  let touchStart: { x: number; y: number } | null = null;

  scroller.addEventListener("pointerdown", (e) => {
    const h = hit(e.clientX, e.clientY);
    if (!h) return;
    if (editing) void commit();
    if (e.pointerType !== "mouse") {
      touchStart = { x: e.clientX, y: e.clientY }; // decide on lift: a scroll is not a tap
      return;
    }
    e.preventDefault();
    scroller.focus({ preventScroll: true });
    pick(h, e.shiftKey);
    if (h.kind === "cell") {
      dragging = true;
      scroller.setPointerCapture(e.pointerId);
    }
  });
  scroller.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const h = hit(Math.min(e.clientX, scroller.getBoundingClientRect().right - 1), e.clientY);
    if (h?.kind === "cell") select({ anchor: sel.anchor, focus: h.pos });
  });
  scroller.addEventListener("pointerup", (e) => {
    dragging = false;
    if (touchStart && Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y) < 8) {
      const h = hit(e.clientX, e.clientY);
      if (h) pick(h, false);
    }
    touchStart = null;
  });
  scroller.addEventListener("dblclick", (e) => {
    const h = hit(e.clientX, e.clientY);
    if (h?.kind !== "cell") return;
    select(selectCell(h.pos));
    startEdit(inputAt(h.pos), "edit");
  });

  /** A click: a cell, a whole column or row (within the laid-out grid), or everything. */
  function pick(h: { kind: string; pos: Pos }, extend: boolean): void {
    const last = { row: size.rows - 1, col: size.cols - 1 };
    switch (h.kind) {
      case "col":
        select({ anchor: { row: 0, col: h.pos.col }, focus: { row: last.row, col: h.pos.col } });
        break;
      case "row":
        select({ anchor: { row: h.pos.row, col: 0 }, focus: { row: h.pos.row, col: last.col } });
        break;
      case "corner":
        select({ anchor: { row: 0, col: 0 }, focus: last });
        break;
      default:
        select(extend ? { anchor: sel.anchor, focus: h.pos } : selectCell(h.pos));
    }
  }

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
      clearSelection();
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) undoRedo(redo, undo, false);
      else undoRedo(undo, redo, true);
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      undoRedo(redo, undo, false);
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      pick({ kind: "corner", pos: sel.focus }, false);
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
    pending++;
    syncBar();
    queue = queue.then(async () => {
      try {
        apply(await client.recalc(path));
      } catch (e) {
        opts.onError(message(e));
      } finally {
        pending--;
        syncBar();
      }
    });
  });

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
    focus: () => scroller.focus({ preventScroll: true }),
    destroy() {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      root.remove();
    },
  };
}

