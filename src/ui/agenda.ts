// Agenda panel: smart quick-add + an editable item list. Each item expands to an inline editor
// (text / when / priority) with Save (item-set) and Done (item-done). Backed by the engine.

import type { EngineClient } from "../engine/client";
import type { Envelope, JsonValue } from "../engine/types";
import { isResultSet, isItem } from "../engine/types";

export interface AgendaPanel {
  refresh(): Promise<void>;
}

interface AgItem {
  id: number;
  text: string;
  when: string;
  priority: string;
  categories: string;
  recurrence: string;
}

const RECUR_OPTIONS: [string, string][] = [
  ["", "no repeat"],
  ["daily", "daily"],
  ["weekly", "weekly"],
  ["monthly", "monthly"],
];

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
      recurrence: s(r.data.recurrence),
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

  // Available category names for the assign datalist — parsed from the engine's (categories) tree.
  async function fetchCategoryNames(): Promise<string[]> {
    const env = await engine.evalSrc("(categories)");
    const str = env.ok && typeof env.result === "string" ? env.result : "";
    if (!str || str.startsWith("(no categories")) return [];
    return str.split("\n").map((l) => l.trim().replace(/\s*\[exclusive\]$/, "")).filter(Boolean);
  }

  function renderItem(it: AgItem): HTMLElement {
    const row = el("div", "ag-item");
    const main = el("div", "ag-item-main");
    if (it.priority) main.appendChild(el("span", "ag-pri", it.priority));
    main.appendChild(el("span", "ag-text", it.text));
    if (it.recurrence) main.appendChild(el("span", "ag-recur", "⟳"));
    if (it.when) main.appendChild(el("span", "ag-when", it.when));

    let cats = it.categories.split(",").map((x) => x.trim()).filter(Boolean);
    const mainCats = el("div", "ag-cats"); // read-only chips shown under the row
    const editCats = el("div", "ag-cat-chips"); // editable chips (with ×) in the editor

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
    const recur = el("select", "ag-field ag-recur-field");
    for (const [val, label] of RECUR_OPTIONS) {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = `repeat: ${label}`;
      recur.appendChild(o);
    }
    recur.value = it.recurrence;
    const notes = el("textarea", "ag-notes");
    notes.placeholder = "notes";
    notes.rows = 2;

    // per-item category assignment: chips (× to unassign) + an add box with a datalist of known cats
    const catEdit = el("div", "ag-cat-edit");
    const catAddRow = el("div", "ag-cat-add");
    const catInput = el("input", "ag-cat-input");
    catInput.placeholder = "add category…";
    const listId = `ag-cats-${it.id}`;
    const datalist = document.createElement("datalist");
    datalist.id = listId;
    catInput.setAttribute("list", listId);
    const catAddBtn = el("button", "ag-cat-add-btn", "＋");
    catAddRow.append(catInput, datalist, catAddBtn);
    catEdit.append(editCats, catAddRow);

    const actions = el("div", "ag-actions");
    const save = el("button", "ag-btn", "Save");
    const done = el("button", "ag-btn ag-done", "Done");
    actions.append(save, done);
    editor.append(text, when, pri, recur, notes, catEdit, actions);

    function renderCatChips(): void {
      mainCats.innerHTML = "";
      editCats.innerHTML = "";
      for (const c of cats) {
        mainCats.appendChild(el("span", "ag-cat", c));
        const chip = el("span", "ag-cat ag-cat-chip");
        chip.appendChild(document.createTextNode(c));
        const x = el("button", "ag-cat-x", "×");
        x.addEventListener("click", () => {
          void engine.evalSrc(`(unassign ${it.id} ${JSON.stringify(c)})`).then(() => {
            cats = cats.filter((k) => k !== c);
            renderCatChips();
          });
        });
        chip.appendChild(x);
        editCats.appendChild(chip);
      }
      mainCats.style.display = cats.length ? "" : "none";
    }
    renderCatChips();

    async function reloadCats(): Promise<void> {
      const env = await engine.evalSrc(`(item-get ${it.id})`);
      if (env.ok && isItem(env.result)) cats = env.result.$item.categories.slice();
      renderCatChips();
    }
    function assignCat(name: string): void {
      const c = name.trim();
      catInput.value = "";
      if (!c || cats.includes(c)) return;
      // assign may drop exclusive siblings, so re-read the item's categories after
      void engine.evalSrc(`(assign ${it.id} ${JSON.stringify(c)})`).then(() => reloadCats());
    }
    catAddBtn.addEventListener("click", () => assignCat(catInput.value));
    catInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        assignCat(catInput.value);
      }
    });

    // lazily load notes + the known-category list the first time the editor opens
    let loaded = false;
    async function loadDetail(): Promise<void> {
      const [detail, avail] = await Promise.all([engine.evalSrc(`(item-get ${it.id})`), fetchCategoryNames()]);
      if (detail.ok && isItem(detail.result)) {
        notes.value = detail.result.$item.notes;
        cats = detail.result.$item.categories.slice();
        const rec = detail.result.$item.properties.recurrence;
        recur.value = typeof rec === "string" ? rec : "";
        renderCatChips();
      }
      datalist.innerHTML = "";
      for (const name of avail) {
        const o = document.createElement("option");
        o.value = name;
        datalist.appendChild(o);
      }
      loaded = true;
    }

    main.addEventListener("click", () => {
      const show = editor.style.display === "none";
      editor.style.display = show ? "flex" : "none";
      if (show) {
        if (!loaded) void loadDetail();
        text.focus();
      }
    });
    save.addEventListener("click", () => {
      const src = `(item-set ${it.id} :text ${JSON.stringify(text.value)} :when ${JSON.stringify(when.value)} :priority ${JSON.stringify(pri.value)} :notes ${JSON.stringify(notes.value)} :recurrence ${JSON.stringify(recur.value)})`;
      void engine.evalSrc(src).then(() => refresh());
    });
    done.addEventListener("click", () => {
      void engine.evalSrc(`(item-done ${it.id})`).then(() => refresh());
    });

    row.append(main, mainCats, editor);
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
