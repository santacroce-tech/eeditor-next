// Agenda panel: smart quick-add + an editable item list. Each item expands to an inline editor
// (text / when / priority) with Save (item-set) and Done (item-done). Backed by the engine.
// Under the items, a folding group lists the "- [ ] …" lines in notes that aren't agenda items yet
// (no "{#12}"): click one to open the note at it, ＋ to make it an item and link the line.
// A `(panel "agenda" …)` form in the keybindings takes the quick-add's and the list's place; the
// notes' group stays, under it.

import type { EngineClient } from "../engine/client";
import type { Envelope, JsonValue } from "../engine/types";
import { isResultSet, isItem } from "../engine/types";
import { type NoteTask, unlinkedTasks, replaceTaskLine, linkLine } from "../core/notetasks";

export interface AgendaPanel {
  refresh(): Promise<void>;
  /** Draw this (a running form's element) in place of the quick-add and the list; null brings them back. */
  setPanel(el: HTMLElement | null): void;
}

/** Where the panel finds the notes' own tasks, and how it opens and rewrites a note. */
export interface NoteTasksSource {
  files(): string[];
  read(path: string): Promise<string>;
  open(path: string, line: number): void;
  /** Compare-and-swap, like `ed-write`: false when the note no longer says `expected`. */
  write(path: string, content: string, expected: string): Promise<boolean>;
}

const NOTES_OPEN_KEY = "eeditor.agenda.notesOpen";

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

export function createAgendaPanel(parent: HTMLElement, engine: EngineClient, notes?: NoteTasksSource): AgendaPanel {
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

  let notesOpen = false;
  try {
    notesOpen = localStorage.getItem(NOTES_OPEN_KEY) === "1";
  } catch {
    // no storage: the group starts folded
  }

  async function scanNotes(): Promise<NoteTask[]> {
    if (!notes) return [];
    const paths = notes.files().filter((p) => /\.(md|markdown|txt)$/i.test(p));
    const texts = await Promise.all(paths.map((p) => notes.read(p).catch(() => "")));
    return paths.flatMap((p, i) => unlinkedTasks(p, texts[i]));
  }

  /**
   * Into the agenda, and the line linked to it. With the PIM loaded its own `pim-link-new` does it —
   * the same parse as ⌘⌥T: #tags become categories, " | …" the notes, the rules run. Without it, a
   * plain `add` and the same " {#id}".
   */
  async function linkTask(t: NoteTask): Promise<void> {
    if (!notes) return;
    const before = await notes.read(t.path).catch(() => null);
    if (before === null || replaceTaskLine(before, t, t.raw) === null) {
      void refresh(); // the line changed since it was listed
      return;
    }
    let linked: string | null = null;
    const pim = await engine.evalSrc(`(pim-link-new ${JSON.stringify(t.raw)})`);
    if (pim.ok && typeof pim.result === "string" && /\{#\d+\}/.test(pim.result)) linked = pim.result;
    else {
      const added = await engine.evalSrc(`(add ${JSON.stringify(t.text)})`);
      if (added.ok && isItem(added.result)) linked = linkLine(t.raw, added.result.$item.id);
    }
    const after = linked === null ? null : replaceTaskLine(before, t, linked);
    if (after !== null) await notes.write(t.path, after, before);
    await refresh();
  }

  function renderNotes(tasks: NoteTask[]): HTMLElement | null {
    if (tasks.length === 0) return null;
    const group = el("div", "ag-notes-group");
    const head = el("button", "ag-notes-head");
    head.title = "Tasks typed in notes that aren't in the agenda yet";
    const body = el("div", "ag-notes-body");
    const draw = (): void => {
      head.textContent = `${notesOpen ? "▾" : "▸"} in notes, not in the agenda · ${tasks.length}`;
      body.style.display = notesOpen ? "" : "none";
    };
    head.addEventListener("click", () => {
      notesOpen = !notesOpen;
      try {
        localStorage.setItem(NOTES_OPEN_KEY, notesOpen ? "1" : "0");
      } catch {
        // remembered for this session only
      }
      draw();
    });
    let lastPath = "";
    for (const t of tasks) {
      if (t.path !== lastPath) {
        lastPath = t.path;
        body.appendChild(el("div", "ag-note-name", t.path.replace(/\.(md|markdown|txt)$/i, "")));
      }
      const row = el("div", "ag-note-task");
      const text = el("span", "ag-text", t.text);
      text.title = `${t.path}:${t.line}`;
      text.addEventListener("click", () => notes?.open(t.path, t.line));
      const add = el("button", "ag-note-add", "＋");
      add.title = "Add to the agenda (links the line)";
      add.addEventListener("click", () => {
        add.disabled = true;
        void linkTask(t);
      });
      row.append(text, add);
      body.appendChild(row);
    }
    group.append(head, body);
    draw();
    return group;
  }

  let panel: HTMLElement | null = null;

  async function refresh(): Promise<void> {
    const own = panel === null; // a panel draws the items itself
    const [env, tasks] = await Promise.all([own ? engine.evalSrc("(items)") : null, scanNotes()]);
    list.innerHTML = "";
    if (env) {
      const items = parseItems(env);
      if (items.length === 0) list.appendChild(el("div", "ag-empty", "(no items)"));
      for (const it of items) list.appendChild(renderItem(it));
    }
    const group = renderNotes(tasks);
    if (group) list.appendChild(group);
  }

  function setPanel(next: HTMLElement | null): void {
    if (next === panel) return;
    panel?.remove();
    panel = next;
    if (panel) root.insertBefore(panel, list);
    root.classList.toggle("with-panel", panel !== null);
    void refresh();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    void engine.evalSrc(`(add ${JSON.stringify(text)})`).then(() => refresh());
  });

  return { refresh, setPanel };
}
