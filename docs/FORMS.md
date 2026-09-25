# Forms — plan

A visual form designer in the spirit of Visual Basic and FoxPro: drop buttons, text boxes and grids
on a canvas, set their properties, attach **EELisp** to their events, press *Run*. The obvious job
is a screen over a table — `(insert contacts …)` on *Save*, `(query contacts …)` into a grid — but
a form is just controls plus code, so a calculator or a launcher for keybinding commands is the same
thing. Branch `feat/forms`, app only; no engine change is needed for v1.

```
 ┌ Contacts ────────────────────────────────────────┐
 │  Name  [ Ada Lovelace          ]                  │
 │  Age   [ 36  ]                                    │
 │                                                   │
 │        ( Save )                                   │
 │  ┌──────────────────────────────────────────────┐ │
 │  │ name            │ age                        │ │
 │  │ Ada Lovelace    │ 36                         │ │
 │  └──────────────────────────────────────────────┘ │
 └───────────────────────────────────────────────────┘
```

## Where it lives

Inside EEditor, as a document type: `Contacts.eeform` in the workspace, opened in a tab like a note
or a sheet. The database a form manages is the engine's database (`<workspace>/.eeditor/eeditor.db`),
the handlers run on the same engine as the REPL and the keybindings, and the tree, tabs, quick-open,
rename and *Reveal in Finder* all work on a form for free. A separate project would have to rebuild
the engine bridge, the workspace and the database access before drawing its first button. The
designer and the runtime are their own modules (`core/form.ts`, `ui/formdesigner.ts`, `ui/formrun.ts`)
with no dependency on the rest of the app beyond the engine client, so they could be lifted out later.

## Decisions

| | Choice | Why |
|---|---|---|
| File format | **EELisp source.** A `.eeform` is a text file: one `(form …)` top-level form holding the layout, followed by the handlers as ordinary `(defn …)`s. | It is what VB's `.frm` was — a machine-written header and your code below — and it fits "keybindings are EELisp". The file is readable, diffable, greppable, editable by hand, and searchable by the app's full-text search. No JSON schema, no second parser: the layout is data the engine already reads. |
| The designer | A **structured editor for one top-level form** of that file. The tab has three modes: *Design* (canvas + toolbox + properties), *Code* (the ordinary CodeMirror editor on the same text), *Run*. | Design edits rewrite only the `(form …)` region of the buffer, as one CodeMirror transaction — so ⌘Z in the designer is CodeMirror's undo, autosave and dirty tracking are the note's, and switching to *Code* shows exactly what will be saved. |
| Events | A property naming a function: `(button btnSave :text "Save" :on-click save-contact)`. Double-clicking a control in the designer creates `(defn save-contact (f) …)` if it is missing and jumps to it. | The layout stays data and never has to parse code. A handler is a plain function, testable from the REPL: `(save-contact {:txtName "Ada"})`. |
| The runtime | In the app. The form's state is handed to the handler as a dict; the handler *queues* changes with `(ui-set "lblStatus" :text "Saved")`, and the app applies the queue when the handler returns. | The engine has no way to reach the UI (see `keybindings/prelude.eelisp`), and a handler that returns commands as data is the pattern the app already has. `ui-set` reads as imperative code — `(ui-set …)` then `(ui-message …)` in a row — because a global queue and `set!` make it so, in pure EELisp. No Rust. |
| Where code runs | *Run* evaluates the whole file (defining the handlers), then `:on-load`. Opening a form in *Design* runs nothing. | A `.eeform` from somewhere else must not run by being opened, the same rule as sheets and ```eelisp blocks. |
| Naming | This is a *form*. The engine's older `(edit contacts 1)` / `(defform …)` stay as the **instant** forms of the REPL. | Same word VB and FoxPro use; the REPL's record editor is a different, smaller thing and keeps its name. |

## The file

```lisp
;; Contacts.eeform
(form "Contacts" :size (480 380) :on-load load-contacts
  (label   lblName :text "Name" :at (16 20) :size (72 24))
  (textbox txtName :at (96 16) :size (240 28))
  (label   lblAge  :text "Age"  :at (16 56) :size (72 24))
  (textbox txtAge  :at (96 52) :size (80 28))
  (button  btnSave :text "Save" :at (96 92) :size (90 30) :on-click save-contact)
  (grid    grdAll  :columns ("name" "age") :at (16 136) :size (448 220) :on-change pick-contact))

(deftable contacts (name:string age:number))

(defn load-contacts (f)
  (ui-set "grdAll" :rows (query contacts :order "name")))

(defn save-contact (f)
  (insert contacts {:name (ui-get f "txtName") :age (->number (ui-get f "txtAge"))})
  (ui-set "txtName" :value "")
  (ui-set "txtAge" :value "")
  (load-contacts f))

(defn pick-contact (f)
  (let (r (ui-get f "grdAll"))
    (ui-set "txtName" :value (dict-get r "name"))
    (ui-set "txtAge" :value (dict-get r "age"))))
```

**Controls**: `label`, `textbox` (`:multiline`, `:placeholder`, `:number` — worth a number or nil
to the handler; `:min`, `:max`, `:pattern`; `:readonly` — selectable and copyable, not typed into;
`:mono` — a monospaced font, for code), `button` (`:submit`, `:default` — Enter in a box
presses it, `:cancel` — Escape does), `checkbox`, `radio` (`:items`, one chosen), `dropdown`
(`:items`), `listbox` (`:items`), `grid` (`:columns`, `:rows`; `:editable` — double-click a cell to
type into it, and `:on-edit` gets the row as edited; `:sortable` — click a header; `:filter` — a
box that narrows the rows to those containing the text; `:page-size` — pages, with ‹ › and a
row count), `date` (`:value` as `yyyy-mm-dd`;
`:min`, `:max`), `image` (`:src`, a path beside the form like a note's `![](assets/x.png)`), `timer`
(`:interval` ms; nothing to see, fires `:on-tick` while enabled), `tabs` (`:pages`, `:value` the
open one), `sheet` (`:file`, a `.eesheet` beside the form — the live grid, with its formula bar
unless `:toolbar false`; handlers read and write its cells with `(sheet-get …)` / `(sheet-set …)`,
and the grid follows), `screen` (`:frame`, an expression evaluated fifty times a second while
enabled — with the keys held on the screen in `ui-keys`, as the ZX Spectrum's 8-byte key matrix
in base64 — whose value, `{"kind" "screen" "pixels" … "border" … "frame" …}`, is painted: a
ZX Spectrum screen. The keys held on it are the Spectrum's — a typed symbol presses the Spectrum's
own combination for it — and `:keyboard true` (or ⌨ in its corner) shows the Spectrum's keyboard
under it, to click. A form with one gets the Spectrum machine, `src/spectrum/zx.eelisp`, loaded
first; `workspace/examples/Spectrum.eeform` runs it. See `docs/spectrum/`).

**The menu bar.** `(form … :menu (("File" ("New" new-item) ("-") ("Quit" quit)) ("Help" ("About"
about))))` puts menus under the title; an item names the handler it runs, `"-"` is a separator, an
item without a handler is greyed. In the designer the form's properties have a *Menu* box that takes
the same thing as text: a title on its own line, its items indented as `label = handler`.

**Pages.** A `tabs` control lists its `:pages`; any control with `:page "Details"` belongs to that
page and shows only while it is open. Controls stay flat in the file with their own `:at`, so the
designer, alignment and code work unchanged — draw them inside the tabs control's box. The
designer shows one page at a time: click a tab header on the canvas to open another. Page names
are matched across the form, so give two tabs controls different page names.

**Validation**, in the order it runs when a `:submit` button is pressed: each control's own rules
— `:required`, `:min`/`:max` on numbers and dates, `:pattern` (a regular expression the whole
text must match) — with the first offender marked, focused and named ("Age must be at most 150");
then the button's `:on-validate` handler, a function of the form that returns a message to refuse
or nil to go ahead; then `:on-click`. Every control has a name, `:at (x y)`, `:size (w h)`,
`:enabled`, `:visible`; the value-bearing ones take `:required`. The order of the controls in the
file is the Tab order when the form runs (the *Order* buttons in the properties move a control).
**Events**: `:on-click` (button), `:on-change` (anything with a value — a
textbox when editing ends, a checkbox, a radio group, a dropdown, a date, a listbox or grid when the
selection moves), `:on-dblclick` (a listbox or grid row), `:on-validate` (a button), `:on-tick` (a
timer), `:on-load` (the form), `:on-public` (the form — another form of its main wrote a public variable),
`:on-close` (the form — asked before it closes, by its stop/✕ button, `(ui-close)`, a frame's Close or ×,
or the main form holding it closing: a message refuses and is shown, nil lets it go; the forms in a
form's frames are asked before the form itself).

**The handler's world** (`src/forms/prelude.eelisp`, loaded once before the first event):

| | |
|---|---|
| `(ui-get f "txtName")` | A control's value: text, a bool, the chosen item, the selected row (a dict) — or nil. |
| `(ui-set "ctl" :prop v)` | Queue a change: `:value`, `:text`, `:items`, `:rows` (a result-set, records or dicts), `:columns`, `:filter`, `:src`, `:file`, `:interval`, `:frame`, `:pages`, `:enabled`, `:visible`. |
| `(ui-message "…")` | A toast. |
| `(ui-focus "ctl")` | Put the caret there. |
| `(ui-close)` | Back to *Design*. |
| `(ui-open "Other.eeform")` | Open and run another form — in a window, or `:in "frmBody"` inside a frame. It joins this form's *main* and shares its public variables. |
| `(ui-pick handler)` | Let the user pick a file; `handler` then runs with its bytes as base64 in `(ui-get f "$file")` and its name in `(ui-get f "$filename")`. `(base64->bytes …)` makes a buffer of it. |
| `(var "pos")` · `(var! "pos" 3)` | Read and write a variable declared with `local` or `public` (below). |

`f` is the whole form as a dict, keyed by control name, so a handler is a function of plain data.

**Two ways to run.** *▶ run* in the tab is for trying the form you are designing; *stop* is the
way back. `(ed-form "Contacts")` — from a keybinding, or typed at the REPL, which carries out
editor commands too — and `(ui-open …)` from another form open the form in a **floating window**
over the app, so it stays usable beside the note you are writing; no tab has to be open (an open
tab's unsaved text counts). ⧉ on a running tab moves it into a window; ✕ closes one. Asking for a
form already in a window raises it. The `form-run`, `form-design` and `form-code` commands switch
the active form tab's mode.

## Frames: forms inside a form

```lisp
(frame frmBody :at (176 8) :size (776 624))          ;; :mode "screens" (the default), "tabs", "windows"
(ui-open "Orders" :in "frmBody")                     ;; run Orders inside it
(ui-open "Orders" :in "frmBody" :new true)           ;; …a second copy, rather than the one already there
```

A `frame` is where the forms a form opens are drawn — VB's MDI client area. A form in a frame
belongs to the same main as the form that has the frame, so it shares its public variables; it can
`ui-open … :in` the same frame too (the name is looked up on the opener, then on its main).

- **screens** — the dBASE way: one form fills the frame at a time. Opening another doesn't close
  the last: every form opened stays alive with what was typed in it. A **Window** menu appears on the
  bar while the frame has forms (✓ on the one showing, Next/Previous — ⌃Tab/⌃⇧Tab — and Close).
  `(ui-close)` in a form, or Window → Close, goes back to the one shown before it.
- **tabs** — the same, with a tab per form across the top of the frame; × closes one.
- **windows** — every form shows, in a small window inside the frame, dragged by its title bar.

The frame's value (`(ui-get f "frmBody")`) is the title of the form showing; `(ui-set "frmBody"
:value "Orders")` brings one forward; `:on-change` runs when the one showing changes. Opening a form
that is already in the frame brings it forward. Stopping the main form stops everything in its
frames. Keys pressed in a form inside the frame are that form's: Enter doesn't press the main
form's `:default` button. Runner: `mount`/`unmount`/`bringForward`/`hasFrame`; the host
(`openInFrame` in main.ts) makes the child. Tests: `dev/ui/frames.pw.mjs`.

### A main form, and an app

`:main true` on a form (*Main form* in the designer's form properties) says it is an app's entry —
the one the others are reached from. Running one is running the app. Two things make several forms
one application:

- **Menus merge**, as in VB: while a form shows in a screens or tabs frame, its menus join the main
  form's bar — the main form's own first, then the showing form's, then Window — and its own bar is
  hidden. A form in windows mode keeps its bar.
- **Names are found beside the form that asks**: `(ui-open "Books" :in "frmMain")` from
  `examples/Office.eeform` opens `examples/Books.eeform` — so an app's folder can move, and (W4) be
  exported whole. A name that isn't beside it is taken from the top of the workspace.

`Office.eeform` in the examples is the worked one: the other examples as screens of one app, the
counts of what they store down the side, and the last screen used reopened next run
(`(public last-screen "" :persist true)`).

## Variables: local and public

```lisp
(local pos 0)                      ;; each open copy of this form has its own
(public cart '())                  ;; shared by a form and every form it opens with ui-open
(public visits 0 :persist true)    ;; …and kept in the database between runs, once per app

(var "pos")   (var! "pos" (+ (var "pos") 1))
```

Declarations sit in the file beside the handlers. A form that nothing opened is a **main** form;
what it opens with `(ui-open …)` belongs to the same main, and so does what *those* open. A public
variable is one per main: two forms under one main see the same `cart`, a second main has its own.
Writing one is an event — every *other* open form of that main with `:on-public` runs it, with the
variable's name in `(ui-get f "$changed")` — so a label counting the cart keeps up without being
asked. A `:persist` public variable is stored (as JSON, in the `_ui_public` table) under the main
form's title, and read back the next time. A plain `(def …)` is still what it was: one binding for
the whole engine, shared by every form and the REPL.

How: the host hands every handler which open form it runs for — `$form`, `$main`, `$key` (its file,
where its `local`s were recorded when it loaded) and `$app` (the main form's title) — in `f`;
`ui-run` keeps that `f` while the handler runs, so `var` needs only the name. All in
`forms/prelude.eelisp`; the runner turns the queued `("public" name)` into `onPublic`, and
main.ts's `running` registry passes it to the other forms of that main. A form closing lets its
locals go (`ui-forget`). An undeclared name gives a message naming it, and nil. Tests:
`dev/ui/vars.pw.mjs`. `Books.eeform` keeps its place in a `local`, so two copies move apart.

## Export as HTML

**⇪ export** in a form tab's head (or right-click a form in the tree → **Export as HTML…**, or the
`export-html` command) opens the export panel: the forms going in (the main one first), the images,
the size, and where it goes — *replace the last export* (the default when `Name.html` beside the form
is an earlier export) or *a new file* (`Name-1.html`). A file that isn't an earlier export — a page
of your own called `Name.html` — is never offered for replacing. `(ed-export "examples/Office")` —
from the REPL or a keybinding; `(ed-export)` is the form in front — exports straight away with the
panel's defaults. The toast offers *Reveal in Finder* where the app can reveal files. **Exported from
a main form, that is the whole app**: every form reached from it goes in the same file — any string
in a form's code that names a form (`(ui-open "Books" …)`, a list of screens, `(office-open
"Orders")`), found beside it first as `ui-open` finds it, and the same again in those forms
(`collectApp` in `core/export.ts`). A name only put together while the app runs (`(str "Bo" "oks")`)
can't be seen; writing it out anywhere in the code is enough. The toast says which forms went in. The file runs
on its own in any browser, offline, opened straight from disk: the EELisp engine is inside it,
compiled to WebAssembly (about 1.5 MB, most of it the engine). What the form writes is kept in that
browser, per exported app; **Save data…** under the form downloads it as a SQLite file and **Open
data…** loads one back — how data moves between browsers or people.

- What goes in: the forms' sources and the images their image controls show (as `data:` URLs), as
  `{ main, forms, assets }` keyed by workspace path — so names resolve in the page as in the app.
- The page runs the main form filling the window; its frames, windows over the page, `ui-open`,
  public variables and merged menus work as in the editor — both run forms through
  `forms/host.ts`. `Office.html` (about 1.5 MB with its five screens) runs from disk, offline.
- **Sheets go in too**: every sheet control's `.eesheet` (read through `(sheet-bytes …)`, carried
  as base64). The page opens each in its engine (`importSheet`), from what the browser kept or else
  from the page; after every evaluation a sheet whose version moved is written into a `_ui_sheets`
  table of the app's own database — so it lasts with the rest, and **Save data… / Open data… carry
  the sheets too** (Open data… reloads the page, so the opened file's sheets take over). Import
  unpacks a carried sheet back into a file with `(sheet-from-bytes …)`, never over an existing one.
  Test: `dev/ui/sheetapp.pw.mjs` (needs eelisp-rs#14).
- **Back again**: right-click an exported page → **Import forms from this page…** unpacks its app
  into a new folder beside it (`Office forms`), each form in its place relative to the main one, and
  opens the main form — for a page that arrived without its `.eeform` files (`readExportedApp`,
  `unpackPlan` in `core/export.ts`). Nothing existing is written over.
- From the command line, without the editor: `npm run export-app -- path/Main.eeform [--root folder]
  [-o out.html]` (`scripts/export-app.ts` — the same `collectApp`/`exportAppHtml`; names are matched
  case-exactly, since macOS and Windows file systems aren't).
- The app needs the runtime template to export: `npm run engine:wasm && npm run runtime:template`
  (CI and the release workflow build it; a local build without it says so when you export).
- Search, tags and backlinks skip exported pages (`isExportedPage`) — a megabyte of engine would
  otherwise match every search.

Pieces: `scripts/build-runtime-template.mjs` + `vite.runtime.config.ts` (the template),
`core/export.ts` (filling it in), `runtime.ts` (the page), `engine/wasm.ts` + `engine/store.ts`
(the engine and its data). Tests: `core/export.test.ts`, `dev/ui/export.pw.mjs` (export from the
tree, open from disk with the network off, reload).

## Examples

`workspace/examples/` — each one is run end to end by `dev/ui/examples.pw.mjs`.

| Form | Shows |
|---|---|
| `Functions.eeform` | Every function in scope — `(function-list)` into a grid, `(source-text name)` for the one picked, and a box of arguments to call it with (the call is built as text and `(eval (parse …))`d, so arguments are written as at the REPL). |
| `Books.eeform` | One record at a time, dBASE-style: \|◀ ◀ ▶ ▶\|, *Record n of m*, find, and New / Edit / Save / Cancel / Delete with the boxes locked while browsing (`:enabled` from the handlers). |
| `Tables.eeform` | Any table: pick it from `(tables)`, a WHERE / order / limit that shows the `(query …)` it ran, cells edited in place, new row, delete, pack. The table is named by an expression — `(query (str name))`. |
| `Orders.eeform` | Master–detail: customers, the picked one's orders (`:where "customer = ?"`), a worked-out amount column and a total. |
| `Office.eeform` | The others as one app: a `:main` form with a screens frame, their menus merged into its bar, and the last screen remembered in a `:persist` public variable. |
| `Agenda.eeform` | The agenda PIM through most of the controls: tabs, menu, datagrid, date, radio, dropdowns, checkbox, timer. Items by due date, an editor for one (`item->dict` reads it), quick add with a `smart-parse` preview, categories, rules, saved views. |

`defcategory`, `defrule` and `defview` take their arguments unevaluated, so the Agenda form writes
those calls as text and evaluates them — `json-stringify` quotes a string safely.

---

## Milestone 1 — the model (`core/form.ts`, pure)

*Done.*

- An s-expression **reader** and **printer** for the layout subset: lists, symbols, keywords,
  strings, numbers, booleans, nil, `;` comments. The printer writes one control per line so the
  file reads like the example above and a diff shows the property that changed.
- `topLevelForms(src)` — the ranges of the top-level forms in a file, string- and comment-aware;
  `layoutRange(src)` finds the `(form …)`. `replaceLayout(src, spec)` splices a printed layout back
  in, or prepends one when the file has none.
- `FormSpec` ⇄ s-expression: `parseFormSpec` is forgiving (unknown properties are kept and written
  back, a missing `:size` gets the control's default), `printFormSpec` is canonical.
- The control catalogue: default size and text for each type, which properties it has and their
  editors (text / number / bool / items list / function name), which events.
- Helpers the designer needs: `snap`, `nextName("txt")`, `handlerName(control, event)`, `defnRange(src,
  name)`, `handlerStub(name)`, and `formState(...)` → the `'{…}` literal handed to the engine.
- vitest: round-trips, the splice, a hand-edited file surviving a design change untouched outside
  the layout.

## Milestone 2 — the designer (`ui/formdesigner.ts`)

*Done.*

- A `.eeform` tab opens in **Design**. The head shows *design · code · run* in place of *preview*.
- **Canvas** the size of the form, controls drawn as inert previews at their `:at`/`:size`.
  Click selects; ⇧-click adds; a drag from empty canvas is a marquee; ⌘A takes all. Drag moves the
  selection; eight handles resize a single control; arrows nudge by a grid step (⇧ by a pixel);
  Delete removes; ⌘D duplicates; ⌘C/⌘X/⌘V copy, cut and paste (into any form's tab); Escape clears
  the selection. Everything snaps to an 8px grid.
- With several selected, the properties panel becomes **align** (left, centre, right, top, middle,
  bottom), **same width/height** and, from three up, **spread evenly** — all relative to the one
  picked last, drawn with a heavier outline, as VB did it.
- **Toolbox**: one button per control type — click, then click on the canvas to place it (or
  drag out its size).
- **Properties**: the selected control's name, position, size, type-specific properties and its
  events, each event a function name with a *…* that creates the stub and opens *Code* at it.
  With nothing selected: the form's title, size and `:on-load`.
- Every change → `replaceLayout` → one CodeMirror transaction on the hidden buffer. Undo/redo are
  ⌘Z/⌘⇧Z on that buffer; the canvas re-reads the layout after each.
- *Code* mode is the normal editor; coming back to *Design* re-parses the buffer. A layout that
  doesn't parse shows the error and stays in *Code*.

## Milestone 3 — running (`ui/formrun.ts`, `engine/form.ts`)

*Done.*

- *Run* evaluates the prelude (once), then the file, then `:on-load`. Errors go to the REPL
  scrollback and a toast, and the tab stays in *Design*.
- Real controls in the tab: inputs, a select, a list, a table for the grid. An event reads the
  whole form into a dict, calls `(ui-run handler '{…})`, and applies the returned queue in order.
- `(ui-set … :rows …)` accepts what `(query …)` returns, a list of records, or a list of dicts;
  `:columns` defaults to the result-set's columns when the control has none.
- *Stop* (or `(ui-close)`) returns to *Design*.

## Milestone 4 — the rest of v1

*Done, except the tree icon — the tree shows every file the same way today.*

- **New form…** in the tree menu and as the `new-form` command; the file starts with a titled
  empty layout. The tree shows a form with its own icon.
- `Contacts.eeform` in the bundled workspace, as the worked example.
- Playwright: create a form, drop a button, run it, click, see the row in the grid.
- `docs/FORMS.md` becomes the manual; the README gets a paragraph.

## Later

Export as a standalone page — which needs the engine in the browser, i.e. eelisp-rs compiled to
WebAssembly, a project of its own; until then a form runs where the engine runs.

*Done since v1:* multi-select with marquee, align/size/spread, copy/paste of controls, radio groups
and dates, number boxes, `:required` + `:submit`, Tab order, `(ed-form …)` from a keybinding and
the REPL, forms in floating windows that come back where they were left, `:min`/`:max`/`:pattern`
and `:on-validate`, image and timer controls, `:default`/`:cancel` buttons, `:on-dblclick`,
editable grid cells, tabs and `:page`, an embedded sheet, the datagrid (sort, filter, pages), the
menu bar.
