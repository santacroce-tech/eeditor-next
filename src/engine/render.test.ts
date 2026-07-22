import { describe, it, expect } from "vitest";
import { scalarText, renderEnvelope, renderValue } from "./render";
import type { Envelope, JsonValue } from "./types";

describe("scalarText", () => {
  it("formats scalars, lists, keywords, dicts", () => {
    expect(scalarText(3)).toBe("3");
    expect(scalarText(null)).toBe("nil");
    expect(scalarText(true)).toBe("true");
    expect(scalarText("hi")).toBe("hi");
    expect(scalarText([1, 2, 3])).toBe("(1 2 3)");
    expect(scalarText({ $kw: "name" })).toBe(":name");
    expect(scalarText({ $sym: "x" })).toBe("x");
    expect(scalarText({ $dict: [["a", 1], ["b", 2]] })).toBe("{:a 1 :b 2}");
  });

  it("summarizes rich values", () => {
    expect(scalarText({ $item: { id: 5, text: "t", notes: "", categories: [], properties: {}, created: "", modified: "" } })).toBe(
      "#<item 5: t>",
    );
  });
});

describe("renderEnvelope", () => {
  it("turns an error envelope into an error model", () => {
    const env: Envelope = { ok: false, error: "Undefined symbol: foo" };
    expect(renderEnvelope(env)).toEqual({ kind: "error", message: "Undefined symbol: foo" });
  });

  it("turns a tableView into a table model", () => {
    const tv: JsonValue = {
      $tableView: {
        tableName: "contacts",
        tableDef: { name: "contacts", fields: [{ name: "name", type: "string", required: false, choices: [] }] },
        resultSet: {
          table: "contacts",
          columns: ["name"],
          records: [{ table: "contacts", id: 1, data: { name: "Alice" } }],
        },
      },
    };
    const m = renderValue(tv);
    expect(m.kind).toBe("table");
    if (m.kind === "table") {
      expect(m.columns).toEqual(["name"]);
      expect(m.rows).toEqual([{ id: 1, cells: ["Alice"] }]);
    }
  });

  it("turns a resultSet into a table model (the agenda `(items)` path)", () => {
    const rs: JsonValue = {
      $resultSet: {
        table: "_items",
        columns: ["text", "when"],
        records: [{ table: "_items", id: 3, data: { text: "Ship it", when: "2026-09-01" } }],
      },
    };
    const m = renderValue(rs);
    expect(m.kind).toBe("table");
    if (m.kind === "table") {
      expect(m.columns).toEqual(["text", "when"]);
      expect(m.rows[0]).toEqual({ id: 3, cells: ["Ship it", "2026-09-01"] });
    }
  });

  it("turns a standalone formView into a form model with computed fields", () => {
    const fv: JsonValue = {
      $formView: {
        tableName: "loan",
        tableDef: { name: "loan", fields: [{ name: "p", type: "number", required: false, choices: [] }] },
        resultSet: { table: "loan", columns: ["p"], records: [{ table: "loan", id: 0, data: { p: 0 } }] },
        computedFields: [{ name: "d", type: "number", expression: "(* p 2)" }],
        isStandalone: true,
      },
    };
    const m = renderValue(fv);
    expect(m.kind).toBe("form");
    if (m.kind === "form") {
      expect(m.standalone).toBe(true);
      expect(m.fields[0].name).toBe("p");
      expect(m.computed[0]).toEqual({ name: "d", expression: "(* p 2)" });
    }
  });
});
