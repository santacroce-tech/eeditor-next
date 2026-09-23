// Running a form over the engine: load its file (the handlers get defined), then one eval per event
// — `(ui-run handler '{…})` — whose value is the list of UI changes the handler queued.

import type { EngineClient } from "./client";
import { isDict, isKeyword, isRecord, isResultSet, type JsonValue } from "./types";
import { formState, type StateValue } from "../core/form";
import PRELUDE from "../forms/prelude.eelisp?raw";

/** One row of a grid: the record's fields, and its id when it came from a table. */
export type Row = Record<string, StateValue>;

export type UiChange =
  | { kind: "set"; control: string; prop: string; value: JsonValue }
  | { kind: "message"; text: string }
  | { kind: "focus"; control: string }
  | { kind: "close" }
  | { kind: "open"; path: string };

export interface FormClient {
  /** Evaluate the file — defines its handlers. Rejects with the engine's error. */
  load(src: string): Promise<void>;
  /** Run `handler` with the form's state; the changes it queued, in order. */
  call(handler: string, state: Record<string, StateValue>): Promise<{ changes: UiChange[]; output: string }>;
  /** Ask `handler` whether the form may go ahead: the message it returned, or null for yes. */
  check(handler: string, state: Record<string, StateValue>): Promise<string | null>;
}

const text = (v: JsonValue | undefined): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const asStr = (s: StateValue): string => (typeof s === "string" ? s : s == null ? "" : typeof s === "object" ? JSON.stringify(s) : String(s));
const keyOf = (v: JsonValue | undefined): string => (isKeyword(v ?? null) ? (v as { $kw: string }).$kw : text(v));

/** A change as the prelude's constructors shape it: `("set" ctl :prop value)`. */
export function parseChange(v: JsonValue): UiChange | undefined {
  if (!Array.isArray(v) || typeof v[0] !== "string") return undefined;
  switch (v[0]) {
    case "set":
      return { kind: "set", control: text(v[1]), prop: keyOf(v[2]), value: v[3] ?? null };
    case "message":
      return { kind: "message", text: text(v[1]) };
    case "focus":
      return { kind: "focus", control: text(v[1]) };
    case "close":
      return { kind: "close" };
    case "open":
      return { kind: "open", path: text(v[1]) };
    default:
      return undefined;
  }
}

/** A JSON value from the engine as something a control can hold. */
export function stateValue(v: JsonValue): StateValue {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x) => asStr(stateValue(x)));
  if (isKeyword(v)) return v.$kw;
  if (isDict(v)) return Object.fromEntries(v.$dict.map(([k, x]) => [k, stateValue(x)]));
  if (isRecord(v)) return { id: v.$record.id, ...Object.fromEntries(Object.entries(v.$record.data).map(([k, x]) => [k, stateValue(x)])) };
  return JSON.stringify(v);
}

/**
 * Rows for a grid from what `(ui-set g :rows …)` was given: a result-set, a list of records, or a
 * list of dicts. With the columns the value names, when it does.
 */
export function rowsOf(v: JsonValue): { rows: Row[]; columns?: string[] } {
  if (isResultSet(v)) {
    return { rows: v.$resultSet.records.map((r) => stateValue({ $record: r }) as Row), columns: v.$resultSet.columns };
  }
  if (Array.isArray(v)) {
    const rows: Row[] = [];
    for (const item of v) {
      const s = stateValue(item);
      if (s && typeof s === "object" && !Array.isArray(s)) rows.push(s);
    }
    return { rows };
  }
  return { rows: [] };
}

export function createFormClient(engine: EngineClient): FormClient {
  let preludeLoaded = false;

  async function ev(src: string): Promise<{ result: JsonValue; output: string }> {
    const env = await engine.evalSrc(src);
    if (!env.ok) throw new Error(env.error);
    return { result: env.result, output: env.output };
  }

  async function ensurePrelude(): Promise<void> {
    if (preludeLoaded) return;
    await ev(PRELUDE);
    preludeLoaded = true;
  }

  return {
    async load(src) {
      await ensurePrelude();
      await ev(src);
    },
    async call(handler, state) {
      await ensurePrelude();
      const { result, output } = await ev(`(ui-run ${handler} ${formState(state)})`);
      const changes = Array.isArray(result) ? result.map(parseChange).filter((c): c is UiChange => c !== undefined) : [];
      return { changes, output };
    },
    async check(handler, state) {
      await ensurePrelude();
      const { result } = await ev(`(${handler} ${formState(state)})`);
      return typeof result === "string" && result !== "" ? result : null;
    },
  };
}
