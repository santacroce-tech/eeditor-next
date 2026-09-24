# Form apps — plan

Two things that belong together: **a main form** that other forms open inside of and that shares
variables with them, and **a runtime** that runs a set of forms as a program on its own, without
the editor around it. The first is what makes several `.eeform`s one application; the second is how
that application reaches someone who doesn't use EEditor.

Status: decisions taken (see *Decided* at the end). W0–W3 are done: the engine runs in a browser, and a form exports as one HTML file that runs anywhere, offline, keeping its data.

```
 ┌ Shop ─────────────────────────────────────────────────────────┐
 │ File  Customers  Orders  Reports  Help                        │  ← the main form's menu
 ├──────────────┬────────────────────────────────────────────────┤
 │ Books        │ ┌ Orders ───────────────────────────────────┐  │
 │ Orders   ◀   │ │ customers …          orders …             │  │  ← a child form, drawn
 │ Tables       │ │                                           │  │    inside the frame
 │ Agenda       │ └───────────────────────────────────────────┘  │
 │              │                                                │
 │ cart: 3      │                                                │  ← reads a public variable
 └──────────────┴────────────────────────────────────────────────┘
```

---

## Part 1 — the main form

### What it is

A form with `:main true`. It is an ordinary form — controls, a menu, handlers — plus two things:

1. **A `frame` control**: a region the other forms render *inside*, as VB's MDI client area was.
   `(ui-open "Orders" :in "frmBody")` draws Orders there instead of in a floating window.
2. **Public variables**: variables it declares, which every form it opens can read and change.

```lisp
(form "Shop" :main true :size (960 640) :on-load shop-start
      :menu (("Go" ("Books" go-books) ("Orders" go-orders) ("-") ("Quit" quit)))
  (listbox lstNav :items ("Books" "Orders" "Tables" "Agenda") :at (8 8) :size (160 400) :on-change go)
  (label lblCart :at (8 420) :size (160 24))
  (frame frmBody :at (176 8) :size (776 624)))       ;; :mode "screens", the default

(public cart '())                          ;; shared with every form Shop opens
(public user "ana" :persist true)          ;; …and kept across runs

(defn go (f) (ui-open (ui-get f "lstNav") :in "frmBody"))
```

### The frame control

| Property | |
|---|---|
| `:mode` | `"screens"` (the default) — the dBASE way: one screen fills the frame at a time, picked from the menu, but opening another doesn't close the last. Every screen opened stays alive with what was typed in it; a **Window** menu, added to the bar automatically, lists them, ⌃Tab cycles, and `(ui-close)` in a screen goes back to the one before it. Opening a form that is already open brings its screen forward rather than a second copy (`:new true` on `ui-open` asks for one). `"tabs"` — the same, with the screens as tabs across the top of the frame. `"windows"` — children as small windows that stay inside the frame (true MDI: cascade, tile). |
| `:value` | the name of the child showing (read with `ui-get`; set with `ui-set` to bring one forward) |
| `:on-change` | fires when the child showing changes |

A child still has its own title, menu and `:on-load`. In a frame its title becomes the tab or
window caption. **Menus merge**: while a child is showing, its menus are added to the main form's
bar after the main form's own, as VB did; the child keeps working if the main form has no menu.

`(ui-close)` in a child closes just that child. In the main form it closes the application
(children first; each child's `:on-close`, if it has one, can refuse by returning a message —
"unsaved changes" — the same rule as `:on-validate`).

### Scopes: local, public, global

Today every form's `(def …)` lands in the engine's one global environment. That works for one form
and breaks quietly for several: Books' `bk-pos` would be shared by two open copies of Books, and a
child can overwrite a variable of the main form by using the same name. Three scopes, named for
what they mean:

| Scope | Declared with | Lives | Seen by |
|---|---|---|---|
| **local** | `(local pos 0)` | one open form — a second copy of Books has its own | that form's handlers |
| **public** | `(public cart '())` in the main form | while the main form runs; `:persist true` keeps it between runs, once per app — in the app's own database, so everyone using the same copy (or the same served app) sees one value | the main form and every form it opened |
| **global** | `(def x …)`, as now | the engine | everything, the REPL included |

Read and write them with the same two functions whatever the scope — the nearest one wins, local
before public before global:

```lisp
(var "cart")                 ;; read
(var! "cart" (cons item (var "cart")))   ;; write — and every open form hears about it
```

A write to a public variable is an event: any open form with `:on-public` gets called with the
variable's name in `f` (`(ui-get f "$changed")` → `"cart"`), so the main form's `lblCart` can keep
count without anyone calling it.

**Why functions and not new special forms.** It can be done in the forms prelude, in EELisp, with no
engine change — the same way `ui-set` is: the runner already hands every handler the form's state,
so it hands over the form's instance id and the main form's id with it (`$form`, `$main` in `f`),
and `var`/`var!` look up a dict per instance and per main form. `:persist` writes to a `_public`
table. When the engine grows real environments per evaluation (a `(with-env …)`), `local` can
become a true binding and `bk-pos` can be written as a plain name again; the functions stay.

### What it needs

- `core/form.ts`: `:main` on the form; the `frame` control in the catalogue (a box in the designer,
  labelled with its mode); `:on-public` and `:on-close` events.
- `ui/formrun.ts`: a frame hosts child runners (the runner already takes all its outside world as
  `FormRunnerOptions`, so a child is a runner whose `onClose`/`onOpen` go to the frame); menu merge;
  instance ids; `var!` → an `on-public` fan-out to every runner under the same main form.
- `src/forms/prelude.eelisp`: `local`, `public`, `var`, `var!`, the `(ui-open name :in frame)` form.
- A worked example: **Shop.eeform**, a main form that opens Books, Orders, Tables and Agenda in
  its frame and keeps a cart that Orders adds to.
- Playwright: open a child in a frame, change a public variable in it, see the main form update;
  two copies of Books keep their own position.

---

## Part 2 — running without the editor

### The shape of an app

An app is a folder — or the same folder zipped, `Shop.eeapp` — with a manifest:

```
Shop.eeapp/
  app.eelisp            (app "Shop" :main "Shop.eeform" :version "1.0" :db "shop.db")
  Shop.eeform
  Books.eeform  Orders.eeform  …
  lib/*.eelisp          code the forms share, loaded before the main form
  sheets/*.eesheet      sheets the forms show
  assets/…              images
  shop.db               optional: starting data (a copy is made on first run; the user's
                        data lives in the OS app-data folder, never inside the bundle)
```

**Export app…** in EEditor (tree menu on a main form) writes it: the main form, every form it can
reach through `ui-open` (found by reading the files, plus any the author lists in the manifest),
the `lib/` files, the sheets and images they refer to, and optionally the tables they use with
their current rows.

### Three ways to run one — in the order to build them

**1. EEditor Runtime (desktop) — build first.** A second Tauri app from this repo: the same engine
(eelisp-rs, native, SQLite and all), the same form renderer, and nothing else — no tree, no editor,
no designer, no REPL. It opens an `.eeapp` (double-click, or drop it on the window) and runs the
main form filling the window. This is the VB-runtime / Access-runtime model.

- Why first: almost everything exists. The renderer is already separate from the rest of the app
  (`ui/formrun.ts` knows the world only through `FormRunnerOptions`), the engine already runs
  inside Tauri, sheets already embed. The work is a small `runtime.html` + `runtime.ts` that
  implements those options against the bundle instead of the workspace, and a second `tauri.conf`
  (`bundle.identifier com.eeditor.runtime`, its own file association for `.eeapp`).
- **A single double-clickable app** comes from the same thing: *Export → macOS app* copies the
  runtime and puts the bundle in its `Resources/`, renames it `Shop.app`, and re-signs it ad-hoc.
  No compiler on the author's machine. Windows and Linux: the runtime plus the bundle beside it.
- What a runtime refuses: editor commands (`ed-*` do nothing — there is no editor), reading or
  writing files outside the bundle and its data folder, `ui-open` of a form outside the bundle.

**2. Served to a browser — built alongside 1.** `eelisp serve-app Shop.eeapp --port 8080`: the
engine serves the runtime page and answers its calls over HTTP, which is what the dev bridge does
today for the whole editor. One engine per connection, or one shared engine with a lock; a small
office's shared order book is the case it fits. Needs a login before it faces a network.

**3. One HTML file, the engine in WebAssembly — the chosen path.** eelisp-rs compiled to
`wasm32-unknown-unknown`, the renderer bundled with it by Vite, the app's files inlined: a single
`Shop.html` that runs anywhere, offline, with nothing installed.

**The spike (W0) is done and it holds** — eelisp-rs branch `spike/wasm`, `web/README.md`:

| | |
|---|---|
| builds | the whole engine, SQLite included: `rusqlite` 0.40 switches to `sqlite-wasm-rs` on this target by itself |
| size | 2.7 MB `.wasm`, **1.06 MB gzipped** |
| start | ~21 ms to load and create an engine |
| SQLite | 10,000 inserts ~51 ms; a filtered, sorted query over them ~2 ms |
| forms | the forms prelude and `Books.eeform` load, and its handlers return the same UI queue as in the app |
| changes to the engine | `ureq` behind an `http` feature (on by default; off in the browser, where `http-get` says it isn't available); every clock read through `dates::now_epoch`, which uses `Date.now()` in a browser; the thread-backed `server` module native-only |
| one snag | macOS `ar` silently drops WebAssembly objects from an archive, so SQLite's symbols went missing at link time; `web/build.sh` uses the `llvm-ar` that ships with Rust |

What's left is packaging, and one real decision — **where the data lives between visits**:

- **In the browser (OPFS)** — `sqlite-wasm-rs` has an OPFS storage backend: the database persists
  per browser and per page address, invisibly. Right for "open the file, use it like an app".
- **In a file the user keeps** — the database in memory, with *Save data…* / *Open data…* writing
  and reading an `.db` (or the app itself re-exported with its data inside). Right for handing
  a copy to someone else.

Both can exist; OPFS as the default with an explicit export is the likely answer.

**How a single file carries a 2.7 MB engine.** The `.wasm` goes in gzipped and base64-encoded
(~1.4 MB of text) and is unpacked on load with the browser's own `DecompressionStream`; the
renderer's JS and CSS, the forms, `lib/` code and images are inlined next to it. An export is a
little over 1.5 MB before the app's own content.

### Security

Running an app runs its code. The runtime shows who made it and asks once per app the first time
(the same rule as EEditor: opening a file runs nothing, *running* does). An app's data folder is its
own; one app can't read another's database.

---

## Milestones

The single HTML file comes first. Its first steps (W1–W3) don't wait for the main form — any form
can be exported on its own — and the main form (A) is what turns several of them into one app.

| | What | Depends on |
|---|---|---|
| ~~**W0**~~ | ~~WebAssembly spike (engine + SQLite in the browser)~~ — done, it holds | — |
| ~~**W1**~~ | ~~A `wasm` transport for the app's `EngineClient`~~ — done: `src/engine/wasm.ts`; `?engine=wasm` (or `VITE_ENGINE=wasm`) runs the whole app on it. `npm run engine:wasm` builds eelisp-rs `web/` into `public/engine/`, loaded at run time (fetched, imported from a blob — Vite's dev server won't serve a `public/` file to `import()`), so a build without it still builds. `dev/ui/wasm.pw.mjs`: the REPL and Books.eeform on it. Not yet on it: sheets (their `.eesheet` files are on disk, out of the page's reach) and keeping the data (in memory — a reload starts empty) — both W2 | W0 |
| ~~**W2**~~ | ~~The runtime page~~ — done: `runtime.html` + `src/runtime.ts`. A form runs on its own over the wasm engine (`?form=<url>`, or a `<script type="text/x-eeform">` in the page); its data is kept in IndexedDB (`src/engine/store.ts`) under the app's name, written straight after every change (the engine's `exportDb`/`importDb`/`changes` — rusqlite's serialize, eelisp-rs `feat/wasm-data`); *Save data…* downloads it as a SQLite file, *Open data…* loads one back. The page already reads an engine carried inline (gzipped base64), which W3 writes. `dev/ui/runtime.pw.mjs`. Not in it yet: sheets, `ui-open` of another form (W4), images other than by URL | W1 |
| ~~**W3**~~ | ~~*Export as HTML…*~~ — done: the tree menu on a form and the `export-html` command write one self-contained file beside it (`core/export.ts` into the template from `npm run runtime:template`); the form and its images inside, runs offline from disk — checked in Chromium (with the network off) and WebKit. The release workflow builds the template once and puts it in every installer | W2 |
| ~~**A1**~~ | ~~Scopes~~ — done: `local`, `public` (`:persist`), `var`, `var!`, `:on-public`; `$form`/`$main`/`$key`/`$app` in `f`. Until the frame exists, a form's *main* is the one that opened it with `ui-open` (windows), or itself — see docs/FORMS.md, *Variables* | — |
| ~~**A2**~~ | ~~The `frame` control~~ — done: `(ui-open … :in …)` (`:new true`), screens (default) / tabs / windows, the Window menu, ⌃Tab, back to the previous on close, `:value`/`:on-change`. `:on-close` (refusing to close) is left for later | A1 |
| **A3** | `:main`, menu merge, **Shop.eeform** example | A2 |
| **W4** | Export of a whole app — the main form and every form it reaches — as one HTML file; *Save data / Open data* | W3, A3 |
| B1–B4 | The `.eeapp` folder, the desktop runtime, the served app — later, if the HTML file leaves a need |  |

## Decided

- **Persisted public variables are per app** — stored in the app's database under the app's name,
  not per user. A served app (B4) therefore shares them between everyone using it.
- **The frame works the dBASE way, with several screens**: `:mode "screens"` is the default — one
  screen at a time from the menu, but the others stay open and a Window menu switches between them.
- **The standalone is the single HTML file** (W). The desktop runtime and the served app (B) stay
  in the plan as possible later work, not now.
