// Agenda panel: smart quick-add + an editable item list. Each item expands to an inline editor
// (text / when / priority) with Save (item-set) and Done (item-done). Backed by the engine.

import type { EngineClient } from "../engine/client";
import type { Envelope, JsonValue } from "../engine/types";
import { isResultSet } from "../engine/types";

export interface AgendaPanel {
  refresh(): Promise<void>;
}

interface AgItem {
  id: number;
  text: string;
  when: string;
  priority: string;
  categories: string;
}

function s(v: JsonValue): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function parseItems(env: Envelope): AgItem[] {
  if (env.ok && isResultSet(env.result)) {
    return env.result.$resultSet.records.map((r) => ({
      id: r.id,
      text: s(r.data.text),
      when: s(r.data.when),
      priority: s(r.data.priority),
      categories: s(r.data.categories),
    }));
  }
  return [];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createAgendaPanel(parent: HTMLElement, engine: EngineClient): AgendaPanel {
  const root = el("div", "agenda");

  const addRow = el("div", "agenda-add");
  const input = el("input", "agenda-input");
  input.placeholder = 'add — e.g. "call Bob tomorrow !!"';
  input.spellcheck = false;
  addRow.appendChild(input);

  const list = el("div", "agenda-list");
  root.append(addRow, list);
  parent.appendChild(root);

  function renderItem(it: AgItem): HTMLElement {
    const row = el("div", "ag-item");
    const main = el("div", "ag-item-main");
    if (it.priority) main.appendChild(el("span", "ag-pri", it.priority));
    main.appendChild(el("span", "ag-text", it.text));
    if (it.when) main.appendChild(el("span", "ag-when", it.when));

    const cats = it.categories.split(",").map((x) => x.trim()).filter(Boolean);
    const catsRow = el("div", "ag-cats");
    for (const c of cats) catsRow.appendChild(el("span", "ag-cat", c));

    const editor = el("div", "ag-editor");
    editor.style.display = "none";
    const text = el("input", "ag-field");
    text.value = it.text;
    text.placeholder = "text";
    const when = el("input", "ag-field");
    when.value = it.when;
    when.placeholder = "when (YYYY-MM-DD)";
    const pri = el("input", "ag-field ag-pri-field");
    pri.value = it.priority;
    pri.placeholder = "priority";
    const actions = el("div", "ag-actions");
    const save = el("button", "ag-btn", "Save");
    const done = el("button", "ag-btn ag-done", "Done");
    actions.append(save, done);
    editor.append(text, when, pri, actions);

    main.addEventListener("click", () => {
      editor.style.display = editor.style.display === "none" ? "flex" : "none";
      if (editor.style.display !== "none") text.focus();
    });
    save.addEventListener("click", () => {
      const src = `(item-set ${it.id} :text ${JSON.stringify(text.value)} :when ${JSON.stringify(when.value)} :priority ${JSON.stringify(pri.value)})`;
      void engine.evalSrc(src).then(() => refresh());
    });
    done.addEventListener("click", () => {
      void engine.evalSrc(`(item-done ${it.id})`).then(() => refresh());
    });

    row.append(main);
    if (cats.length) row.append(catsRow);
    row.append(editor);
    return row;
  }

  async function refresh(): Promise<void> {
    const items = parseItems(await engine.evalSrc("(items)"));
    list.innerHTML = "";
    if (items.length === 0) {
      list.appendChild(el("div", "ag-empty", "(no items)"));
      return;
    }
    for (const it of items) list.appendChild(renderItem(it));
  }

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    void engine.evalSrc(`(add ${JSON.stringify(text)})`).then(() => refresh());
  });

  return { refresh };
}
