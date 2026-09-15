// Pure interpretation of engine results into a render model. No DOM here, so it's unit-testable.

import type { Envelope, JsonValue, FormViewJson, TableViewJson, ResultSetJson } from "./types";
import {
  isTableView,
  isFormView,
  isRecord,
  isResultSet,
  isItem,
  isTable,
  isKeyword,
  isSymbol,
  isDict,
  isCallable,
} from "./types";

export interface TableModel {
  kind: "table";
  title: string;
  columns: string[];
  rows: { id: number; cells: string[] }[];
  /** Heading of the leading column: a record's "id", or "#" for rows counted from 1. */
  idLabel?: string;
}

export interface FormFieldModel {
  name: string;
  type: string;
  value: string;
  choices: string[];
}

export interface FormModel {
  kind: "form";
  title: string;
  standalone: boolean;
  fields: FormFieldModel[];
  computed: { name: string; expression: string }[];
  recordCount: number;
}

export type RenderModel =
  | { kind: "scalar"; text: string }
  | TableModel
  | FormModel
  | { kind: "error"; message: string };

/** Display form of any value (the REPL/`str`-style rendering). */
export function scalarText(v: JsonValue): string {
  if (v === null) return "nil";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return "(" + v.map(scalarText).join(" ") + ")";
  if (isSymbol(v)) return v.$sym;
  if (isKeyword(v)) return ":" + v.$kw;
  if (isDict(v)) return "{" + v.$dict.map(([k, val]) => `:${k} ${scalarText(val)}`).join(" ") + "}";
  if (isItem(v)) return `#<item ${v.$item.id}: ${v.$item.text}>`;
  if (isTable(v)) return `#<table ${v.$table.name}>`;
  if (isRecord(v)) {
    const parts = [`id: ${v.$record.id}`, ...Object.entries(v.$record.data).map(([k, val]) => `${k}: ${scalarText(val)}`)];
    return "{" + parts.join(", ") + "}";
  }
  if (isResultSet(v)) return `#<result-set ${v.$resultSet.table} (${v.$resultSet.records.length} rows)>`;
  if (isCallable(v)) {
    if ("$fn" in v) return `#<fn ${v.$fn}>`;
    if ("$builtin" in v) return `#<builtin ${v.$builtin}>`;
    return `#<macro ${v.$macro}>`;
  }
  return JSON.stringify(v);
}

function resultSetTable(rs: ResultSetJson, title: string): TableModel {
  const columns = rs.columns;
  return {
    kind: "table",
    title,
    columns,
    rows: rs.records.map((r) => ({
      id: r.id,
      cells: columns.map((c) => scalarText(r.data[c] ?? null)),
    })),
  };
}

function tableModel(tv: TableViewJson): TableModel {
  return resultSetTable(tv.resultSet, tv.tableName);
}

function formModel(fv: FormViewJson): FormModel {
  const first = fv.resultSet.records[0];
  return {
    kind: "form",
    title: fv.tableName,
    standalone: fv.isStandalone,
    recordCount: fv.resultSet.records.length,
    fields: fv.tableDef.fields.map((f) => ({
      name: f.name,
      type: f.type,
      value: first ? scalarText(first.data[f.name] ?? null) : "",
      choices: f.choices,
    })),
    computed: fv.computedFields.map((c) => ({ name: c.name, expression: c.expression })),
  };
}

/**
 * A list whose every item is a list of plain values reads better as a table than as nested
 * parentheses — `(sheet-rows "Budget" "A1:C9")`, `zip`. Anything holding deeper structure stays text.
 */
function rowsTable(items: JsonValue[]): TableModel | null {
  if (items.length === 0 || !items.every(Array.isArray)) return null;
  const rows = items as JsonValue[][];
  const width = Math.max(...rows.map((r) => r.length));
  const plain = (x: JsonValue): boolean => !Array.isArray(x) && (typeof x !== "object" || x === null || isSymbol(x) || isKeyword(x));
  if (width === 0 || !rows.every((r) => r.every(plain))) return null;
  return {
    kind: "table",
    title: `${rows.length} row${rows.length === 1 ? "" : "s"}`,
    idLabel: "#",
    columns: Array.from({ length: width }, (_, c) => String(c + 1)),
    rows: rows.map((r, i) => ({ id: i + 1, cells: Array.from({ length: width }, (_, c) => (c < r.length ? scalarText(r[c]) : "")) })),
  };
}

/** A result value → what to render. */
export function renderValue(v: JsonValue): RenderModel {
  if (isTableView(v)) return tableModel(v.$tableView);
  if (isFormView(v)) return formModel(v.$formView);
  if (isResultSet(v)) return resultSetTable(v.$resultSet, v.$resultSet.table);
  if (Array.isArray(v)) {
    const table = rowsTable(v);
    if (table) return table;
  }
  return { kind: "scalar", text: scalarText(v) };
}

/** The full envelope → a render model (errors become an error model). */
export function renderEnvelope(env: Envelope): RenderModel {
  if (!env.ok) return { kind: "error", message: env.error };
  return renderValue(env.result);
}
