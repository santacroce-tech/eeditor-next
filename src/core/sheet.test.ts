import { describe, it, expect } from "vitest";
import {
  a1,
  blockArea,
  fillTarget,
  fromCSV,
  fromTSV,
  importedValue,
  toCSV,
  toTableHtml,
  toTSV,
  valueRows,
  areaA1,
  cellOf,
  colIndex,
  colName,
  Lengths,
  decimalsShown,
  display,
  errorTag,
  extent,
  formatValue,
  isSheetPath,
  moveSelection,
  parseArea,
  readableOn,
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
        ["heights", [[2, 48]]],
      ],
    });
    expect(sheet.version).toBe(7);
    expect(sheet.cells[0].input).toBe("rent");
    expect(sheet.widths.get(0)).toBe(160);
    expect(sheet.heights.get(2)).toBe(48);
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

describe("dates", () => {
  it("shows the language's own date the way the format asks", () => {
    expect(formatValue("2026-09-16", { date: "iso" })).toBe("2026-09-16");
    expect(formatValue("2026-09-16", { date: "medium" }, "en-GB")).toBe("16 Sept 2026");
    expect(formatValue("2026-09-16", null)).toBe("2026-09-16"); // no format, no interpretation
    expect(formatValue("not a date", { date: "medium" })).toBe("not a date");
    expect(display(cellOf([0, 0, "2026-09-16", "2026-09-16", null, { $dict: [["date", "iso"]] }])).align).toBe("right");
  });
});

describe("decimal places", () => {
  it("counts what a number shows, unless its format says", () => {
    expect(decimalsShown(1234.5, null)).toBe(1);
    expect(decimalsShown(3, null)).toBe(0);
    expect(decimalsShown(0.125, null)).toBe(3);
    expect(decimalsShown(3, { dp: 2 })).toBe(2);
    expect(decimalsShown("text", null)).toBe(0);
    expect(decimalsShown(1200, { num: "currency", cur: "USD" }, "en-US")).toBe(2);
    expect(decimalsShown(1200, { num: "currency", cur: "JPY" }, "en-US")).toBe(0);
    expect(decimalsShown(0.12345, { num: "percent" })).toBe(2);
    expect(decimalsShown(0.5, { num: "percent" })).toBe(0);
  });
});

describe("the clipboard", () => {
  it("writes and reads what a spreadsheet puts on the clipboard", () => {
    const rows = [["rent", "1200"], ["a\tb", "says \"hi\""], ["two\nlines", ""]];
    const tsv = toTSV(rows);
    expect(tsv.split("\n")[0]).toBe("rent\t1200");
    expect(tsv).toContain('"a\tb"');
    expect(tsv).toContain('"says ""hi"""');
    expect(fromTSV(tsv)).toEqual(rows);
  });

  it("reads what other programs send", () => {
    expect(fromTSV("a\tb\nc\td")).toEqual([["a", "b"], ["c", "d"]]);
    expect(fromTSV("a\tb\r\nc\td\r\n")).toEqual([["a", "b"], ["c", "d"]]); // CRLF, trailing newline
    expect(fromTSV("one")).toEqual([["one"]]);
    expect(fromTSV("")).toEqual([]);
  });

  it("knows the area a pasted block covers", () => {
    expect(blockArea({ row: 2, col: 1 }, [["a", "b"], ["c", "d"], ["e", "f"]])).toEqual({ r0: 2, c0: 1, r1: 4, c1: 2 });
  });
});

describe("CSV", () => {
  it("writes and reads the same rules with commas", () => {
    const rows = [["rent", "1200"], ["a,b", 'says "hi"'], ["two\nlines", ""]];
    const csv = toCSV(rows);
    expect(csv.split("\n")[0]).toBe("rent,1200");
    expect(csv).toContain('"a,b"');
    expect(fromCSV(csv)).toEqual(rows);
    expect(fromCSV("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("reads a field as a number only when it is one", () => {
    expect(importedValue(" 1200 ")).toBe(1200);
    expect(importedValue("-3.5")).toBe(-3.5);
    expect(importedValue("1,200")).toBe("1,200");
    expect(importedValue("=(delete-everything)")).toBe("=(delete-everything)");
    expect(importedValue("NaN")).toBe("NaN");
    expect(importedValue("")).toBe("");
  });

  it("exports values, not what the grid shows, and errors as their tag", () => {
    const cells = [
      cellOf([0, 0, "rent", "rent", null, null]),
      cellOf([0, 1, "1200", 1200, null, { $dict: [["num", "currency"], ["dp", 2]] }]),
      cellOf([1, 1, "=(x)", null, "Undefined symbol: x", null]),
    ];
    expect(valueRows(cells, "en-US")).toEqual([["rent", "1200"], ["", "#ERR"]]);
  });
});

describe("readable ink", () => {
  it("picks near-black on a pale fill and near-white on a dark one", () => {
    expect(readableOn("#ffe9a8")).toBe("#16181d");
    expect(readableOn("#fff")).toBe("#16181d");
    expect(readableOn("#1e1e2e")).toBe("#f7f8fa");
    expect(readableOn("#7a1fa2")).toBe("#f7f8fa");
    expect(readableOn("not a colour")).toBe("");
  });
});

describe("printing", () => {
  it("builds a table of what the sheet shows, with each cell's styling", () => {
    const cells = [
      cellOf([0, 0, "rent", "rent", null, { $dict: [["bold", true]] }]),
      cellOf([0, 1, "1200", 1200, null, { $dict: [["num", "currency"], ["cur", "USD"]] }]),
      cellOf([1, 1, "<script>", "<script>", null, null]),
    ];
    const html = toTableHtml(cells, new Map([[0, 160]]), "en-US");
    expect(html).toContain('<col style="width:160px">');
    expect(html).toContain("font-weight:600");
    expect(html).toContain("$1,200.00");
    expect(html).toContain("&lt;script&gt;"); // a cell's text is text, not markup
    expect(html.match(/<tr>/g)).toHaveLength(2);
    expect(toTableHtml([], new Map())).toContain("empty");
  });
});

describe("fill", () => {
  it("grows the selection along whichever way the drag went further", () => {
    const source = { r0: 0, c0: 0, r1: 0, c1: 1 };
    expect(fillTarget(source, { row: 5, col: 1 })).toEqual({ r0: 0, c0: 0, r1: 5, c1: 1 });
    expect(fillTarget(source, { row: 1, col: 6 })).toEqual({ r0: 0, c0: 0, r1: 0, c1: 6 });
    expect(fillTarget(source, { row: 0, col: 1 })).toEqual(source); // a drag back inside changes nothing
    expect(fillTarget({ r0: 3, c0: 3, r1: 3, c1: 3 }, { row: 0, col: 3 })).toEqual({ r0: 0, c0: 3, r1: 3, c1: 3 }); // upwards
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
  it("places rows or columns with a few custom sizes", () => {
    const lengths = new Lengths(new Map([[1, 200], [3, 50]]), 100);
    expect(lengths.start(0)).toBe(0);
    expect(lengths.start(1)).toBe(100);
    expect(lengths.start(2)).toBe(300);
    expect(lengths.start(4)).toBe(450);
    expect(lengths.size(1)).toBe(200);
    expect(lengths.size(2)).toBe(100);
    for (const [x, col] of [[0, 0], [99, 0], [100, 1], [299, 1], [300, 2], [400, 3], [449, 3], [450, 4], [10_000, 99]] as const) {
      expect(lengths.at(x), `x=${x}`).toBe(col);
    }
  });

  it("finds the edge under the pointer, from either side", () => {
    const lengths = new Lengths(new Map(), 100);
    expect(lengths.edgeAt(98, 4)).toBe(0);
    expect(lengths.edgeAt(102, 4)).toBe(0);
    expect(lengths.edgeAt(150, 4)).toBeNull();
    expect(lengths.edgeAt(2, 4)).toBeNull(); // nothing to the left of the first one to resize
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
    await client.format("B", "A1", [[{ bold: true }, null]]);
    expect(sent[4]).toContain(`"A1" '(({:bold true} nil)))`);
    await client.format("B", "A1", { align: null });
    expect(sent[5]).toContain('{:align nil}');
    await client.paste("B", "C5", [["=(sum A1:A2)"]], "A3");
    expect(sent[6]).toContain(`(sheet-paste "B" "C5" '(("=(sum A1:A2)")) "A3")`);
    await client.paste("B", "C5", [["x"]]);
    expect(sent[7]).toContain(`'(("x")) nil)`);
    await client.fill("B", "C1", "C2:C9");
    expect(sent[8]).toContain('(sheet-fill "B" "C1" "C2:C9")');
    await client.put("B", "A1", [["rent", 1200], ["=x", ""]]);
    expect(sent[9]).toContain(`(sheet-put "B" "A1" '(("rent" 1200) ("=x" "")))`);
  });

  it("turns an engine error into a rejection", async () => {
    const { engine } = fake(() => ({ ok: false, error: "Error: no sheet at /w/Nope.eesheet" }));
    await expect(createSheetClient(engine).open("Nope")).rejects.toThrow("no sheet at");
  });
});
