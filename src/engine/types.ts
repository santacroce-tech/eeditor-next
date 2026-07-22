// TypeScript mirror of the eelisp host JSON encoding (eelisp-rs/src/host.rs).
// Scalars/lists are natural JSON; rich types are tagged objects so we can discriminate + render.

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | Tagged;

export type Tagged =
  | { $sym: string }
  | { $kw: string }
  | { $dict: [string, JsonValue][] }
  | { $table: TableDef }
  | { $record: RecordJson }
  | { $resultSet: ResultSetJson }
  | { $tableView: TableViewJson }
  | { $formView: FormViewJson }
  | { $item: ItemJson }
  | { $fn: string }
  | { $builtin: string }
  | { $macro: string };

export interface FieldDefJson {
  name: string;
  type: string; // string | number | bool | date | memo | choice
  required: boolean;
  choices: string[];
}

export interface TableDef {
  name: string;
  fields: FieldDefJson[];
}

export interface RecordJson {
  table: string;
  id: number;
  data: Record<string, JsonValue>;
}

export interface ResultSetJson {
  table: string;
  columns: string[];
  records: RecordJson[];
}

export interface TableViewJson {
  tableName: string;
  tableDef: TableDef;
  resultSet: ResultSetJson;
}

export interface ComputedFieldJson {
  name: string;
  type: string;
  expression: string; // Lisp source; the UI recomputes by eval-ing it with field bindings
}

export interface FormViewJson {
  tableName: string;
  tableDef: TableDef;
  resultSet: ResultSetJson;
  computedFields: ComputedFieldJson[];
  isStandalone: boolean;
}

export interface ItemJson {
  id: number;
  text: string;
  notes: string;
  categories: string[];
  properties: Record<string, JsonValue>;
  created: string;
  modified: string;
}

// The envelope returned by `eval_host` / the Tauri command / the dev bridge.
export type Envelope =
  | { ok: true; result: JsonValue; output: string }
  | { ok: false; error: string; output?: string };

// ── narrowing helpers ──

function has<K extends string>(v: unknown, key: K): v is Record<K, unknown> {
  return typeof v === "object" && v !== null && key in v;
}

export const isTableView = (v: JsonValue): v is { $tableView: TableViewJson } => has(v, "$tableView");
export const isFormView = (v: JsonValue): v is { $formView: FormViewJson } => has(v, "$formView");
export const isRecord = (v: JsonValue): v is { $record: RecordJson } => has(v, "$record");
export const isResultSet = (v: JsonValue): v is { $resultSet: ResultSetJson } => has(v, "$resultSet");
export const isItem = (v: JsonValue): v is { $item: ItemJson } => has(v, "$item");
export const isTable = (v: JsonValue): v is { $table: TableDef } => has(v, "$table");
export const isKeyword = (v: JsonValue): v is { $kw: string } => has(v, "$kw");
export const isSymbol = (v: JsonValue): v is { $sym: string } => has(v, "$sym");
export const isDict = (v: JsonValue): v is { $dict: [string, JsonValue][] } => has(v, "$dict");
export const isCallable = (v: JsonValue): v is { $fn: string } | { $builtin: string } | { $macro: string } =>
  has(v, "$fn") || has(v, "$builtin") || has(v, "$macro");
