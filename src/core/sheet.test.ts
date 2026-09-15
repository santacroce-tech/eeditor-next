import { describe, it, expect } from "vitest";
import {
  a1,
  areaA1,
  cellOf,
  colIndex,
  colName,
  ColumnLayout,
  display,
  errorTag,
  extent,
  formatValue,
  isSheetPath,
  moveSelection,
  parseArea,
  selectCell,
  selectionArea,
  sheetOf,
} from "./sheet";
import { createSheetClient } from "../engine/sheet";
import type { Envelope } from "../engine/types";

describe("addressing", () => {
  it("names columns both ways", () => {
    for (const [i, name] of [[0, "A"], [25, "Z"], [26, "AA"], [701, "ZZ"], [702, "AAA"]] as const) {
      expect(colName(i)).toBe(name);
      expect(colIndex(name)).toBe(i);
    }
    expect(colIndex("aa")).toBe(26);
    expect(colIndex("AAAA")).toBeNull();
    expect(a1({ row: 2, col: 2 })).toBe("C3");
  });

  it("reads a cell or a range in any case, and refuses anything else", () => {
    expect(parseArea("c3")).toEqual({ r0: 2, c0: 2, r1: 2, c1: 2 });
    expect(parseArea("$B$9:A1")).toEqual({ r0: 0, c0: 0, r1: 8, c1: 1 });
    for (const bad of ["", "A0", "3C", "A1:B2:C3", "total"]) expect(parseArea(bad)).toBeNull();
    expect(areaA1({ r0: 0, c0: 0, r1: 8, c1: 1 })).toBe("A1:B9");
  });

  it("knows a sheet by its extension", () => {
    expect(isSheetPath("money/Budget.eesheet")).toBe(true);
    expect(isSheetPath("Budget.EESHEET")).toBe(true);
    expect(isSheetPath("budget.md")).toBe(false);
  });
});

describe("what the engine sends", () => {
  it("decodes a cell row", () => {
    const cell = cellOf([2, 1, "=(sum B1:B2)", 1650, null, { $dict: [["num", "currency"], ["dp", 2]] }]);
    expect(cell).toEqual({ row: 2, col: 1, input: "=(sum B1:B2)", value: 1650, error: null, fmt: { num: "currency", dp: 2 } });
  });

  it("decodes a whole sheet", () => {
    const sheet = sheetOf({
      $dict: [
        ["path", "/w/Budget.eesheet"],
        ["version", 7],
        ["cells", [[0, 0, "rent", "rent", null, null]]],
        ["widths", [[0, 160]]],
      ],
    });
    expect(sheet.version).toBe(7);
    expect(sheet.cells[0].input).toBe("rent");
    expect(sheet.widths.get(0)).toBe(160);
  });
});

describe("display", () => {
  it("formats numbers by the cell's format", () => {
    expect(formatValue(1234.5, null)).toBe("1234.5");
    expect(formatValue(1234.5, { dp: 2 })).toBe("1234.50");
    expect(formatValue(1234.5, { num: "number", dp: 0 }, "en-US")).toBe("1,235");
    expect(formatValue(0.256, { num: "percent", dp: 1 }, "en-US")).toBe("25.6%");
    expect(formatValue(12, { num: "currency", cur: "EUR", dp: 2 }, "en-US")).toBe("€12.00");
    expect(formatValue(["a", 1], null)).toBe("(a 1)");
    expect(formatValue(null, { dp: 2 })).toBe("");
  });

  it("shows errors as a tag and aligns numbers right", () => {
    expect(errorTag("circular reference between A1, B1")).toBe("#CYCLE");
    expect(errorTag("#REF! — this formula read a cell that was deleted")).toBe("#REF!");
    expect(errorTag("Undefined symbol: x")).toBe("#ERR");
    const failed = cellOf([0, 0, "=(x)", null, "Undefined symbol: x", null]);
    expect(display(failed)).toMatchObject({ text: "#ERR", error: true, title: "Undefined symbol: x" });
    expect(display(cellOf([0, 0, "3", 3, null, null])).align).toBe("right");
    expect(display(cellOf([0, 0, "3", 3, null, { $dict: [["align", "center"]] }])).align).toBe("center");
  });
});

describe("selection", () => {
  it("moves, extends, and stops at the edge", () => {
    const s = selectCell({ row: 0, col: 0 });
    expect(moveSelection(s, -1, -1, false).focus).toEqual({ row: 0, col: 0 });
    const grown = moveSelection(moveSelection(s, 2, 0, true), 0, 1, true);
    expect(selectionArea(grown)).toEqual({ r0: 0, c0: 0, r1: 2, c1: 1 });
    expect(moveSelection(grown, 1, 0, false).anchor).toEqual({ row: 3, col: 1 });
  });
});

describe("layout", () => {
  it("places columns with a few custom widths", () => {
    const layout = new ColumnLayout(new Map([[1, 200], [3, 50]]), 100);
    expect(layout.left(0)).toBe(0);
    expect(layout.left(1)).toBe(100);
    expect(layout.left(2)).toBe(300);
    expect(layout.left(4)).toBe(450);
    for (const [x, col] of [[0, 0], [99, 0], [100, 1], [299, 1], [300, 2], [400, 3], [449, 3], [450, 4], [10_000, 99]] as const) {
      expect(layout.at(x), `x=${x}`).toBe(col);
    }
  });

  it("lays out what's used plus room to keep going", () => {
    expect(extent([], { row: 0, col: 0 })).toEqual({ rows: 100, cols: 26 });
    expect(extent([{ row: 499, col: 30 }], { row: 0, col: 0 })).toEqual({ rows: 550, cols: 41 });
  });
});

describe("sheet client", () => {
  /** An engine that records what it was sent and answers from a script. */
  function fake(answer: (src: string) => Envelope) {
    const sent: string[] = [];
    return { sent, engine: { evalSrc: async (src: string) => (sent.push(src), answer(src)) } };
  }

  it("escapes what is typed, and reads back the changes with the version", async () => {
    const { sent, engine } = fake(() => ({ ok: true, result: [[[0, 0, "a", "a", null, null]], 3], output: "" }));
    const client = createSheetClient(engine);
    const changes = await client.set("my sheets/Budget.eesheet", "A1", 'say "hi"\n');
    expect(sent[0]).toBe('(list (sheet-set "my sheets/Budget.eesheet" "A1" "say \\"hi\\"\\n") (sheet-version "my sheets/Budget.eesheet"))');
    expect(changes).toEqual({ cells: [cellOf([0, 0, "a", "a", null, null])], version: 3 });

    await client.set("B", "A1", [["1", "=(+ A1 1)"], ["x"]]);
    expect(sent[1]).toContain(`'(("1" "=(+ A1 1)") ("x"))`);
    await client.format("B", "A1:B2", { num: "currency", dp: 2, bold: true });
    expect(sent[2]).toContain('{:num "currency" :dp 2 :bold true}');
    await client.format("B", "A1", null);
    expect(sent[3]).toContain('"A1" nil)');
  });

  it("turns an engine error into a rejection", async () => {
    const { engine } = fake(() => ({ ok: false, error: "Error: no sheet at /w/Nope.eesheet" }));
    await expect(createSheetClient(engine).open("Nope")).rejects.toThrow("no sheet at");
  });
});
