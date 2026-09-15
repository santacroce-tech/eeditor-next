# Spreadsheets — plan

A grid of cells with live formulas, where **a formula is EELisp** and **a sheet is a SQLite file in
the workspace**. Branch `feat/spreadsheet` in both repos (engine first — CI's `native` job checks out
`eelisp-rs` at `main`, so the engine PR has to land before the app PR can go green).

```
   |  A        |  B     |  C
---+-----------+--------+-------------------------------
 1 | rent      |  1200  |
 2 | food      |   450  |
 3 | total     |        | =(sum B1:B2)
 4 | per week  |        | =(/ C3 4.33)
 5 | status    |        | =(if (> C3 1500) "over" "ok")
```

## Decisions

| | Choice | Why |
|---|---|---|
| Formula language | EELisp after `=` | No second language to parse. `A1`, `$A$1`, `A1:B3` (and `Sheet2!A1`) already read as plain symbols, so references cost nothing in the lexer. Any `defn` in scope works in a cell. |
| Storage | One SQLite file per sheet, `Name.eesheet` | Fits a file‑centric app: the tree, tabs, quick‑open, rename, *Reveal in Finder*, the Files app and `[[Name]]` links all work on it as on any file. |
| Where formulas run | In the engine (Rust) | The dependency graph, recalculation and storage sit next to the evaluator, so the grid and `(sheet-get …)` from a note give the same answer. The grid becomes a thin view. |
| Engine database | Persistent, `<workspace>/.eeditor/eeditor.db` | Today both the app and `eelisp --serve` run on `:memory:`, so **agenda items are lost on quit**. Fixed on this branch (milestone 0). |
| When code runs | Opening a sheet shows the **stored values** and runs nothing | A `.eesheet` from somewhere else must not run `(http-get …)` just by being opened, the same way a note's ```eelisp block only runs on ⌘⇧Enter. Editing a cell recomputes its dependents; **Recalculate** (↻) reruns everything. |

v1 scope: grid + values + formulas + recalculation, **formats and column widths**, insert/delete
rows and columns, and **EELisp access from notes, the REPL and keybindings**. Also included, because
a grid without it is hostile and it is cheap: **undo/redo of cell edits**. Not in v1: see *Later*.

---

## Milestone 0 — the engine database persists

*Done — eelisp-rs#3, eeditor-next#7.*

**eelisp-rs**
- `Interpreter::try_with_database(path) -> Result<Self, LispError>`. `with_database` currently
  `expect`s, so an unopenable file panics the engine thread and every later eval answers
  `engine stopped`. `EngineHandle::spawn_with` uses the fallible version and **falls back to
  `:memory:`**, remembering why.
- `EngineHandle::open_database(path) -> Result<(), String>` — a new `Job` that swaps the `Database`
  behind the shared `Rc<RefCell<…>>` (db + agenda builtins see it at once) and resets `Agendas`.
  A job rather than an eval'd string, so no path ever has to be escaped into EELisp source.
- `(database-info)` → `{:path …}` — the file in use, or `":memory:"` — plus `:error` when the file
  the host asked for couldn't be opened. How the app notices the fallback, and how a user answers
  "where is my agenda".
- Open with `busy_timeout` (the dev bridge and the desktop app can share a workspace) and the default
  rollback journal — no `-wal`/`-shm` sidecars in synced folders.
- `eelisp --serve --db <path>`: parse args *before* building the interpreter (today `main` builds it
  first). Without `--db`, still `:memory:` — the smoke test relies on that.

**eeditor-next**
- `setup()`: spawn with `<ws>/.eeditor/eeditor.db`; the engine creates `.eeditor/` when it's
  missing. The open runs on the engine thread, never the main thread — the TCC gate note in
  `memory.md` applies.
- `pick_workspace` / `restore_workspace`: after moving the root, `engine.open_database(new path)`.
- Frontend at launch and after a workspace change: an `:error` in `(database-info)` → a dialog,
  *"The agenda isn't being saved"*, with the reason copyable.
- `dev/bridge.mjs` passes `--db <ws>/.eeditor/eeditor.db`; `.gitignore` gets
  `workspace/.eeditor/eeditor.db*`.
- `.eeditor/` is a dot‑folder, so the tree already hides the database.

**Tests**: `tests/database.rs` — a file database survives drop + respawn; the folder is created; an unopenable path falls back to
memory and says so; `open_database` swaps agenda contents, and a failed one lands in memory rather
than in the old file. Smoke: `--serve --db tmp` persists across
two processes.

---

## Milestone 1 — the sheet engine (eelisp-rs)

*Done on `feat/sheets`: `src/sheet_ref.rs` (addressing, the text rewrite), `src/sheet.rs` (store,
graph, plan), `src/sheet_builtins.rs` (surface and the recalculation loop), 27 tests in
`tests/sheet.rs`.*

New `src/sheet.rs` (file format, addressing, dependency graph, recalculation) and
`src/sheet_builtins.rs` (the EELisp surface), registered in `Interpreter::with_database` beside the
db/agenda builtins. A sheet's connection is **its own** — `open-agenda`/`use-agenda` swap the shared
database, and must not take the open sheets with them.

### File format

```sql
PRAGMA application_id = 0x45455348;   -- 'EESH': recognise a sheet by its bytes, not its name
PRAGMA user_version  = 1;             -- schema version, for migrations

CREATE TABLE cells (
  row   INTEGER NOT NULL,             -- 0-based
  col   INTEGER NOT NULL,             -- 0-based
  input TEXT    NOT NULL DEFAULT '',  -- exactly what was typed: 1200 · rent · =(sum B1:B2)
  value TEXT,                         -- last result, tagged JSON (host::to_json)
  error TEXT,                         -- why the formula failed, if it did
  fmt   TEXT,                         -- {"num":"currency","dp":2,"bold":true,"align":"right"}
  PRIMARY KEY (row, col)
) WITHOUT ROWID;
CREATE TABLE widths (col INTEGER PRIMARY KEY, width REAL NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- version, created
```

`meta.version` increments on every write: it is how an open grid learns a note changed the sheet.

### What a cell holds

- empty → `nil` · a number (`-12.5`, `1e3`) → number · a leading `'` → text without it ·
  `=…` → formula · anything else → text.
- A formula is **one** EELisp form after `=`. Inside it, an uppercase symbol shaped like a cell
  (`^\$?[A-Z]{1,3}\$?[1-9][0-9]*$`) is a reference, and `REF:REF` a range. Lowercase `a1` stays an
  ordinary name. (Documented consequence: `A1` can't be a `let` name inside a formula.)
- A reference binds to the cell's value; a range to a **flat, row‑major list** (`nil` for blanks).
- Evaluation: `env::child(global)`, define each referenced symbol, `eval::eval`. Any result type is
  stored; the grid shows lists/dicts with `scalarText`.
- `Name!A1` is recognised and answers *"cross-sheet references aren't supported yet — use
  (sheet-get …)"* rather than *Undefined symbol*.

### Recalculation

- On open, parse every formula once; keep `precedents` per cell, a `dependents` index for single
  references and a list of `(range, cell)` pairs for ranges (a scan is fine at v1 sizes).
- On a write: update that cell's edges → collect the transitive dependents → Tarjan's strongly
  connected components over that subgraph, iteratively (a 5000-deep chain of running totals must not
  touch the stack). A component of more than one cell, or a cell that reads itself, is a cycle:
  *circular reference between A1, B1* on each (`#CYCLE` in the grid). Recompute in order, write the
  cells whose `value`/`error` changed in **one transaction**, bump `version`, return them.
- The registry of open sheets is never borrowed while a formula runs, so a formula may call
  `(sheet-get …)`. It may not change a sheet: the write builtins refuse during a recalculation.
- A formula whose input has an error does not run: it gets `C3 has an error — <that error>`, naming
  the cell where it started rather than every cell in between.
- `sum`, `avg` new (flatten lists, skip `nil` and text); `min`/`max` taught to flatten lists —
  backward compatible, numbers still work. Neither name exists in the builtins, prelude or snippets.
- Formulas that read the database or other sheets aren't tracked; ↻ refreshes them. (Documented.)

### Insert / delete rows and columns

Rewrite references **in the formula's text**, not by re‑printing its AST — that would throw away
the user's spacing and comments. A small scanner skips string literals and `;` comments, finds
reference tokens and substitutes their spans. References past the edit shift; references to a
deleted cell become `#REF!`; a range losing some rows shrinks. All in one transaction.

### Builtins

All take a sheet as `"Budget"`, `"Budget.eesheet"`, `"money/Budget"` or an absolute path; relative
paths resolve against `(current-dir)`, and `.eesheet` is added when missing.

| Builtin | Returns |
|---|---|
| `(sheet-new path)` | the path; error if it exists |
| `(sheet-open path)` | `{:path :version :cells ((row col input value error fmt) …) :widths ((col width) …)}` — lists, not dicts, to keep a large sheet's JSON small. Runs no formulas. |
| `(sheet-close path)` | nil — required before a rename or delete (Windows can't rename an open file; on macOS a deleted sheet keeps writing to an unlinked inode, and a renamed one puts its journal under the old name) |
| `(sheet-set path "B2" input)` | changed cells, same row shape. **Typed input**: `"=(sum …)"` is a formula, `"1200"` a number. Given a list of rows it types a block from that corner in one recalculation — what a paste is. |
| `(sheet-get path "C3")` | the value |
| `(sheet-rows path "A1:C5")` | list of rows (2‑D, which is what a note wants) |
| `(sheet-put path "A1" data)` | changed cells. **Values**: text that would read as a number or formula stays text. A list of lists writes a block; a result set writes a header row + records |
| `(sheet-recalc path)` | changed cells |
| `(sheet-format path "A1:B3" {:num "currency" :dp 2})` | changed cells |
| `(sheet-col-width path "B" 120)` | nil |
| `(sheet-insert-rows path at n)` · `sheet-delete-rows` · `sheet-insert-cols` · `sheet-delete-cols` | the full `sheet-open` payload (too much moves to patch) |
| `(sheet-version path)` | number |

Every one gets a manual entry in `src/docs.rs` — `tests/docs.rs` fails otherwise.

**Tests** (`tests/sheet.rs`): new/open/close; value typing; formula + range evaluation; diamond
dependencies recompute once, in order; a cycle errors and breaking it recovers; error propagation;
inputs/values/formats/widths survive reopen; opening runs no formula (a formula with a side effect
is not re‑run); insert/delete rewrite text and keep comments; `#REF!`; `open-agenda` leaves open
sheets alone.

---

## Milestone 2 — the grid (eeditor-next)

*Done on `feat/sheets`.*

- **`src/core/sheet.ts`** (pure, unit‑tested): `A1` ⇄ `(row, col)`, column letters, range parsing,
  input classification, `formatValue(value, fmt)` via `Intl.NumberFormat`, the selection/navigation
  reducer, viewport math (visible rows/cols from scroll offsets and prefix sums of widths).
- **`src/engine/sheet.ts`**: typed wrapper over `evalSrc`, escaping with the `lispString` the
  keybindings already use (it covers exactly the escapes the lexer reads). A write asks for the
  version in the same round trip — `(list (sheet-set …) (sheet-version …))` — so the grid knows its
  own writes from someone else's.
- **`src/ui/sheet.ts`**: two layers in one box. A stage draws only what is in view — occupied cells,
  grid lines, headers, the selection — from the scroll offsets; a transparent scroller on top owns
  native scrolling and every click, turned into a cell by arithmetic. A formula bar (name box + raw
  input), an in‑cell editor, and a status line with the full error of the active cell.
  - Keys: arrows · Tab/⇧Tab · Enter or F2 edits (and, editing, commits and moves down) · typing
    starts an edit whose arrows commit and move · Escape cancels · Delete clears · ⇧+arrows / drag
    extend · Home · Page Up/Down · ⌘A · ⌘Z / ⇧⌘Z undo/redo.
  - Undo is a per‑view stack of blocks `(origin, before, after)` replayed through `sheet-set`;
    session‑only. Writes go through a queue, one at a time — async Tauri commands could otherwise
    reach the engine out of order.
  - Errors show `#ERR` / `#CYCLE` / `#REF!`.
  - ↻ in the header runs `sheet-recalc`.
- **`main.ts`**
  - `Tab` gains `sheet: true`; `openFile` routes `.eesheet` before `ws.read` (which
    refuses NUL bytes). The editor pane swaps CodeMirror for the grid; preview, PDF and run‑block
    are hidden for sheets.
  - Nothing to autosave — writes are immediate. `saveTab`/`saveAllDirty` on a sheet commit the
    cell being edited (the only unsaved state it can have), so quit/tab‑switch/blur lose nothing.
    **A sheet tab never reaches `ws.write`**, and a keybinding that types into the hidden text editor
    while a sheet is showing changes nothing — otherwise a stray autosave could write text over a
    SQLite file.
  - Rename/delete: `sheet-close` first, retarget the tab after a rename.
  - **New sheet…** in the folder context menu, a name ending `.eesheet` in **＋**, and a
    `new-sheet` command for keybindings.
  - Search, tags and backlinks skip `.eesheet`; quick‑open and `[[` completion list sheets, and a
    `[[Budget]]` link opens the sheet through the same `openFile`.
  - A sheet refreshes when its tab or the window comes back to the front, if its version moved.
- **Tree**: hide SQLite sidecars (`*-journal`, `*-wal`, `*-shm`) in `children_of` and in
  `dev/bridge.mjs` — a journal appears next to the sheet for the length of every write.

**Tests**: vitest for `core/sheet.ts` and the client; three new smoke checks (new → set → a new
process opens the stored value) against a temp dir. **UI verified with Playwright** against the dev bridge (per
`memory.md`, never `screencapture`): type values and a formula, watch dependents update, reload and
see stored values, rename a sheet.

---

## Milestone 3 — formats, widths, rows and columns

*Done on `feat/sheets`.*

- Toolbar: bold, italic, alignment, number format (general / number / currency / percent), decimals
  ±, clear format. It shows the active cell's format and applies to the selection via
  `sheet-format`. "More decimals" starts from what's on screen — a currency's minor unit, a
  percent's two places — not from the stored `dp`, which is usually absent.
- Drag a column header's edge → `sheet-col-width` on release; double-click the edge for the default.
- Right-click (long press on touch, or the context-menu key) on a column header, a row header or a
  cell: insert rows/columns before or after, delete them, clear contents or format. The menu acts on
  the selection; a header outside a whole-row/column selection selects its row or column first.
  Dragging across headers selects several. Selecting a whole row never scrolls off to its end.
- Undo covers formats: an entry keeps each cell's exact format, and `sheet-format` gained a block
  form — rows of formats, set rather than merged — to put back formats that differed cell by cell.
  Inserting or deleting rows and columns is not undoable and clears the undo history (every position
  in it has moved); deleting asks first and says so.

---

## Milestone 4 — EELisp and notes

- From the REPL, a ```eelisp block or a keybinding: `(sheet-get "Budget" "C3")`,
  `(sheet-rows "Budget" "A1:C5")`, `(sheet-set …)`, and `(sheet-put "Report" "A1" (query contacts
  :order "name"))` to snapshot a table into a sheet. Reading the database *from* a formula is plain
  EELisp: `=(count-records contacts :where "city = 'Lisbon'")`.
- `render.ts`: a list whose items are all lists renders as a table in the REPL, so `sheet-rows`
  shows as a grid rather than nested parentheses.
- An open grid stays true: `EngineClient` gets an after‑eval hook; a sheet view that didn't make
  the call checks `(sheet-version path)` and reloads if it moved (and on tab focus).
- Docs: `memory.md` feature entry + gotchas, the manual page on the site, `README`.

## Milestone 5 — the OS knows what a `.eesheet` is

`exportedType` `com.eeditor.app.eesheet` (conforms to `public.data`), `rank: Owner`, the same
declaration in `Info.ios.plist`, pinned by `dev/associations.test.mjs`. Dragged in from outside, a
sheet takes the existing *copy in / open in place* path; in place works because the engine opens
absolute paths.

---

## Risks to keep in view

- **Synced folders** (iCloud Drive, Dropbox): a SQLite file synced mid‑write, or open on two
  devices, can corrupt. Rollback journal + short transactions reduce the window; document "one
  device at a time".
- **Big sheets**: `sheet-open` sends every cell. Fine to tens of thousands; past that, page by
  viewport (a `sheet-cells path "A1:Z200"` builtin) — the view is already virtualised, so only the
  loader changes.
- **The agenda starts persisting** — visible behaviour change; release notes should say where the
  data lives.

## Later

Copy/paste as TSV and fill with relative references (the reference scanner from milestone 1 is
what shifts `A1` → `A2`) · CSV import/export · `Other!A1` in formulas with cross‑file dependency
tracking · several sheets per file · a per‑sheet script of helper `defn`s stored in `meta` ·
formula‑bar syntax colouring with `lisphl` · dates · sort/filter · result sets spilling into a range ·
a live two‑way binding between a range and a `deftable` · charts.
