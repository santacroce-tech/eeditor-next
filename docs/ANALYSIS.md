# EEditor + EELisp — Complete Analysis & Rebuild Plan

> A full feature-and-mechanism inventory of both projects, the integration contract between
> them, the known bugs to carry or fix deliberately, and a recommended platform for the next
> version. Written to support reorganizing the two repos and porting to a new stack.
>
> Snapshot: branch `mobile`, 2026-07-22. Cited line numbers refer to that snapshot.

---

## Table of Contents

1. [Executive summary](#1-executive-summary)
2. [What exists today](#2-what-exists-today)
3. [Feature catalog — EEditor (the app)](#3-feature-catalog--eeditor-the-app)
4. [Feature catalog — EELisp (the engine)](#4-feature-catalog--eelisp-the-engine)
5. [The integration contract (the part that must survive a rewrite)](#5-the-integration-contract)
6. [Known bugs & tech debt — the landmines](#6-known-bugs--tech-debt)
7. [Reorganization & platform recommendation](#7-reorganization--platform-recommendation)
8. [Suggested porting order](#8-suggested-porting-order)
9. [Appendix: maps, protocols, schemas](#9-appendix)

---

## 1. Executive summary

**Two projects, one clean dependency:** `eeditor` (a SwiftUI Markdown/code editor, ~12.5 K LOC)
embeds `eelisp` (a Lisp interpreter + SQLite + a Lotus‑Agenda‑style PIM, ~8 K LOC) as a Swift
package. The layering is unusually disciplined and is the single most important asset:

```
UI layer          per-platform, disposable  (SwiftUI today)
   └─ ViewModels   platform-independent, zero UI imports  (EEditorCore)
        └─ EELisp  standalone library: language + SQLite + agenda  (no UI, no app deps)
```

**The crown jewel is EELisp, not the editor.** Every data feature in the app — the REPL, the
agenda sidebar, the calendar's item dots, interactive tables/forms, even `eelisp` code blocks
inside markdown documents — is driven by calling `interpreter.eval("…")` and pattern‑matching
the returned `Value` enum. The GUI duplicates **no** database or agenda logic. Adding a builtin
to EELisp automatically makes it available to both the REPL and the GUI.

**This has already been ported four times.** SwiftUI (Apple), a TermKit Swift TUI, a C/ncurses
version (`eeditor-nc`, on `main`), and a C++/Dear ImGui version (`eeditor-imgui`, on `main`).
Swift frontends reuse EELisp in‑process; the C/C++ frontends talk to `eelisp --pipe` over a
line protocol. So the reuse pattern is proven: **keep EELisp as the portable engine, rewrite
only the thin UI + viewmodels.** `docs/SPEC.md` is effectively already a porting guide.

**Recommendation (detailed in §7):** rebuild EELisp as a **Rust crate that compiles to both
native and WASM**, and build the new frontend in **TypeScript + CodeMirror 6, packaged with
Tauri** for desktop and shipped as a PWA for web. This reuses one engine across desktop and
browser, and the web platform eliminates the two heaviest couplings in the current app (the
AppKit/UIKit text system and WKWebView). An all‑TypeScript build is the pragmatic runner‑up.

---

## 2. What exists today

### 2.1 The two repositories

| | `eelisp` | `eeditor` |
|---|---|---|
| What | Lisp interpreter + SQLite + agenda PIM | Markdown/code editor GUI |
| Language | Swift 6 (language mode 5) | Swift + SwiftUI |
| Deps | SQLite (via `CSQLite` shim), Foundation | `swift-markdown`, `EELisp` (this repo) |
| Products | `EELisp` library + `eelisp` CLI | `EEditorCore` library + app targets |
| Standalone? | Yes — CLI and library both ship | No — needs `EELisp` |
| Embedded here | as a git submodule at `eeditor/eelisp` | — |

`eeditor` is built with **xcodegen** (`project.yml`) into two app targets, `EEditor-macOS` and
`EEditor-iOS`, both layered on the platform‑independent `EEditorCore` Swift package
(`Sources/EEditorCore`). Requirements: macOS 14+, iOS/iPadOS 17+.

### 2.2 The layered architecture (from `docs/SPEC.md §2` + confirmed in code)

- **UI layer** — SwiftUI views. Disposable per platform.
- **EEditorCore** — ViewModels + Services, *no UI imports* (except `WebKit` in `PDFExportService`).
  This is where reusable logic lives: autosave, search, fuzzy quick‑open, calendar grid math,
  tab/bookmark/rename bookkeeping, file CRUD, language detection, theme data.
- **EELisp** — the interpreter. No dependency on EEditorCore or any UI framework.
- **AppState** — per‑window composition root that owns one instance of every ViewModel and one
  shared `Interpreter`.

### 2.3 The four historical frontends (relevant to a platform switch)

| Frontend | Stack | Where | EELisp integration |
|---|---|---|---|
| SwiftUI app | Swift/SwiftUI, macOS + iOS | `mobile` (current) | in‑process library, native `Value` returns |
| TermKit TUI | Swift terminal UI | described in SPEC §11 | in‑process library |
| `eeditor-nc` | **C + ncurses** | `main` branch | out‑of‑process: spawns `eelisp --pipe`, parses `@@TABLE/@@ROW` |
| `eeditor-imgui` | **C++ + Dear ImGui** (+ ImGuiColorTextEdit) | `main` branch | (Linux/cross‑platform experiment) |

The current `mobile` tree contains **only** the SwiftUI app + the `eelisp` submodule; the C and
C++ frontends live on `main`. The README still documents all of them.

### 2.4 Code size

- EELisp: ~8 K LOC Swift. Biggest files: `AgendaBuiltins.swift` (2607), `Builtins.swift` (900),
  `DatabaseBuiltins.swift` (608), `Evaluator.swift` (570), `Types.swift` (505), `Database.swift` (467).
- EEditor app: ~12.5 K LOC Swift. Biggest: `SyntaxHighlighter.swift` (1266),
  `REPLViewModel.swift` (749), `ContentView.swift` (672), `REPLView.swift` (574).

---

## 3. Feature catalog — EEditor (the app)

Each feature below lists **what it does** and **how it works** (the mechanism a rewrite must
reproduce). File cites are from the `mobile` tree.

### 3.1 App shell & window model
- **Entry** `EEditorApp.swift:8` — one `WindowGroup("main")` hosting `ContentView`, plus a macOS‑only
  detached `Window("form-panel")` for popped‑out record forms.
- **One `AppState` per window** (`@State`, `ContentView.swift:10`), an `@Observable` composition
  root (`AppState.swift:56`) that constructs all services + view models in `init()` and owns all
  presentation flags and the `SidebarMode` (files / bookmarks / calendar / agenda / snippets / tags).
- **Menu commands** are built with `.commands { CommandGroup(...) }` and reach the active window's
  state through a custom `@FocusedValue(\.appState)` injected via `.focusedSceneValue` — this is how
  global shortcuts target the correct window.
- **macOS vs iOS:** macOS opens folders in new windows (`openWindow` + bookmark hand‑off); iOS
  bridges hardware‑keyboard `UIKeyCommand`s to app actions through a `NotificationCenter` command bus.
- **Per‑window folder restore** uses `@SceneStorage` holding a security‑scoped bookmark `Data`,
  with a fallback to a legacy single‑slot `UserDefaults` bookmark.

### 3.2 Text editor core
- **Platform split behind one `EditorView`** (`EditorView.swift:24`): macOS → `MarkdownTextView`
  (`NSViewRepresentable` around `NSTextView`/`NSScrollView`); iOS → `MarkdownUITextView`
  (`UIViewRepresentable` around a custom `UITextView`).
- **Config:** plain text (`isRichText=false`), native undo (`allowsUndo`), autocorrect/smart‑quotes
  off, monospaced 14 pt, soft wrap. macOS uses the native find bar; iOS uses `UIFindInteraction`.
- **Edit flow:** delegate `textDidChange`/`textViewDidChange` → push text to the SwiftUI binding →
  `EditorViewModel.updateContent` → schedule autosave → re‑highlight around the cursor. A re‑entrancy
  guard (`isUpdating`) prevents binding feedback loops; `updateNSView` only rewrites the buffer when
  the model actually differs, preserving selection/scroll.
- **Command bus:** editor actions (insert timestamp, find/replace, focus) are decoupled via
  `NotificationCenter` — the ViewModel posts, the coordinators subscribe. Keeps `EditorViewModel`
  free of AppKit/UIKit.
- **Insert timestamp** (`EditorViewModel.timestampTitleInsertion`, a pure function): inserts
  `# YYYY-MM-DD HH:mm` after the first line with a blank line above, caret on the following line.
  macOS inserts through the undo stack; iOS mutates `textStorage` then syncs the binding.

### 3.3 Syntax highlighting
- **Mechanism:** a value‑type `SyntaxHighlighter` struct applying **`NSRegularExpression`‑based rule
  lists per language** (not a tokenizer). Each `HighlightRule = {pattern, options, attributes}`.
- **Application:** reset a range to default attributes, then for each rule add attributes to every
  match inside the range; wrapped in `beginEditing()/endEditing()` on the `NSTextStorage`.
- **Incremental:** on each keystroke only a window of **cursor ± 2000 chars** (extended to line
  bounds) is re‑attributed; full re‑highlight only on load / language change / theme change.
  *Weakness:* multi‑line constructs (fenced code blocks) that straddle the 2000‑char window can
  mis‑highlight.
- **Languages:** 30 `FileLanguage` cases. Many share a generic `cLikeRules(keywords:types:)` builder
  fed by static keyword arrays; dedicated rule sets for markdown, python, ruby, shell, html, css,
  json, yaml/toml, xml, sql, perl, elixir, haskell, and **lisp** (EELisp‑aware: special forms, DB
  commands, `:keywords`).
- **Detection:** `URL.fileLanguage` (`URL+Extensions.swift`) — extensionless special cases
  (Dockerfile/Makefile), a ~100‑entry `textFileExtensions` set (also gates the file tree and search),
  then extension→language switch. `Document.language = languageOverride ?? fileURL.fileLanguage ?? .plainText`;
  user can override via the language badge menu.
- **Themes:** `EditorTheme` structs of platform colors + a `previewCSSOverrides` string. 10 themes
  (GitHub light/dark, Solarized light/dark, Dracula, Monokai, Nord, One Dark, Catppuccin Latte/Mocha).
  `ThemeManager` (`@Observable`) persists theme + appearance mode to UserDefaults.

### 3.4 File management
- **Tree scan** (`FileSystemService`): recursive `contentsOfDirectory(.skipsHiddenFiles)`, re‑adding a
  whitelisted `.eelisp/` dir; sorts **directories first, then case‑insensitive name**; includes only
  dirs + `isTextFile` files.
- **`FileNode`** (`@Observable`): `url`, `isDirectory`, mutable `children`, `isExpanded`; identity by URL.
- **CRUD:** create (defaults `.md`), rename (preserves extension; propagates to open tabs + bookmarks,
  including descendants of a renamed directory), delete (**macOS `trashItem`, iOS `removeItem`**).
  Reads/writes UTF‑8; **iOS writes go through `NSFileCoordinator`** for sandbox correctness.
- **Dirty state:** `Document.isDirty = content != lastSavedContent`; shown as a dot in the sidebar.
- **Security‑scoped bookmarks** (`BookmarkService`): macOS `.withSecurityScope`, iOS `.withoutUI`;
  `start/stopAccessingSecurityScopedResource` wrap folder access. Two APIs: legacy single‑slot
  UserDefaults bookmark and raw‑`Data` variants for per‑window `@SceneStorage`.

### 3.5 Tabs & "bookmarks" (note: not "pinning")
- Tabs = the open `Document` list on `EditorViewModel`. **There is no pinning**; the README's
  "pinned tabs" are actually **bookmarks** — a `Set<URL>` persisted to UserDefaults as paths.
  `sortTabs()` is a deliberate **no‑op** (tabs stay in open order).
- **Preview tabs:** `Document.isPreview` — opening a file reuses a non‑dirty preview tab; first edit,
  double‑click, or bookmarking promotes it to permanent. Preview titles render italic.
- **Close paths:** `closeTab` (no‑op if dirty; UI confirms), `saveAndCloseTab`, `forceCloseTab`,
  `closeAllUnbookmarkedTabs`. Navigation wraps via modulo arithmetic.

### 3.6 Autosave
- `AutoSaveService`: per‑document debounce with Swift structured concurrency. Each keystroke cancels
  that document's pending `Task` and starts a new one that sleeps **1 s**, checks cancellation, writes,
  then on the main actor clears dirty and fires `onSaved(url, content)` (which drives the tags index).
  `saveImmediately` bypasses the debounce (⌘S). Failures are silent.

### 3.7 Preview & PDF export
- **Markdown→HTML:** `MarkdownRenderer` parses with `swift-markdown` (`Markdown.Document` +
  `.parseBlockDirectives`/`.parseSymbolLinks`) and formats via swift‑markdown's built‑in `HTMLFormatter`
  (body fragment only).
- **Template:** `HTMLTemplate` substitutes `{{CSS}}/{{THEME}}/{{THEME_CSS}}/{{BODY}}` into bundled
  `preview.html` + `preview.css` (GitHub‑style, CSS‑variable driven, light/dark). The template exposes
  JS hooks (`updateContent`, `updateThemeCSS`) for incremental updates.
- **WebView:** `WebPreviewView`/`WebPreviewUIView` wrap `WKWebView`; first render is `loadHTMLString`,
  thereafter incremental `evaluateJavaScript` updates guarded by cached last‑body/theme.
  *Caveat:* the live in‑app preview pane (`PreviewView`/`PreviewViewModel`) exists but is **not wired
  into `ContentView`**. The visible "Preview" button actually writes full HTML to a temp `.html` and
  opens it in the system browser.
- **PDF:** `PDFExportService` loads HTML into an offscreen `WKWebView` sized A4 @96dpi and calls
  `createPDF` with `WKPDFConfiguration` at A4 points. Delivery: macOS `NSSavePanel`, iOS share sheet.

### 3.8 Search & quick‑open
- **Full‑text search** (`SearchService`): reads every text file, line‑by‑line **case‑folded substring**
  match (case‑insensitive by default), records 1‑based line number + a **3‑line context snippet**,
  grouped per file. `SearchViewModel` debounces 300 ms and cancels stale queries. Substring, not regex.
- **Quick open** (`QuickOpenViewModel`): **subsequence fuzzy match** (all query chars appear in order),
  ranked prefix‑match → substring‑match → shorter‑name (a 3‑key tiebreak, no gap scoring). Resolves
  `[[wiki-links]]` (exact, then `+.md`, then extension‑stripped).

### 3.9 Calendar, daily notes, weekly planner
- **Calendar grid** (`CalendarViewModel`): ISO‑8601 calendar, Monday‑first; buckets files by
  filesystem **modification date** into `filesByDate`; builds a month grid (leading/trailing days to fill
  weeks). Each cell shows **dual dots** — blue for files modified that day, orange for agenda items
  scheduled that day (the latter queried live from EELisp; see §5).
- **Daily note:** `YYYY-MM-DD.md` at root, created with `# <date>` or opened if present.
- **Weekly planner:** `YYYY-WEEK-WW.md` with `# Week WW — YYYY` and seven `## <Day>` sections, each with
  `### Morning/Afternoon/Evening` sub‑sections.
- **Timestamp file (⌘N):** `yyyy-MM-dd-HHmmss.md`, uniquified.

### 3.10 Tags
- **File‑text based, independent of EELisp.** `TagsViewModel` extracts `#hashtag` tokens from workspace
  text files (skips fenced code + ATX headings, rejects mid‑word `#` and `#hexcolors`). Maintains three
  indexes (per‑file counts, global counts, tag→files). Incremental update on save; full rescan on
  workspace change. `TagsSidebarView` lists tags (count desc) as disclosure groups → files.

### 3.11 Snippets
- **Storage:** `.eelisp/` directory in the workspace root; each snippet is a `.eelisp` file. On first
  load the dir is created and **bundled snippets are copied in** from the app bundle.
- **Running:** the sidebar's play button calls `replViewModel.loadFile(snippet.url)` (evaluates the
  whole file via `evalAll`) and opens the REPL. Snippets that mutate the editor do so through EELisp's
  editor‑callback bridge (§5).
- **Bundled examples:** `weekly-notes-to-agenda.eelisp` (parses a PT‑BR weekly‑notes markdown file into
  agenda items — heavy use of EELisp stdlib + agenda builtins) and `word-count.eelisp` (reads the current
  editor buffer via `buffer-text` and reports word/line/char counts).

### 3.12 Settings, shortcuts, help
- **Settings:** theme + appearance only.
- **Keyboard shortcuts (customizable):** `KeyboardShortcutAction` is a 22‑case enum, each with a display
  name, a `ShortcutCategory`, and a default binding. `KeyboardShortcutManager` (`@Observable`) stores only
  overrides as JSON in UserDefaults; reverse lookup dispatches keypresses; conflict detection + swap in the
  settings UI. Platform key‑recorder views capture new bindings.
- **Help:** `ShortcutsHelpView` (static reference), `ManualView` (actually an About sheet), and the
  guide/manual/tutorial are just bundled markdown files opened into the editor.

---

## 4. Feature catalog — EELisp (the engine)

This is the portable core. Documented to the depth needed to reimplement it faithfully.

### 4.1 Value model
- One universal `indirect enum Value` (`Types.swift:18`) with ~22 cases:
  `symbol` (a plain `String`; `Symbol = String`), `string`, `number` (**everything is `Double`** — no
  integer type), `bool`, `date`, `null`, `list([Value])` (Swift array, not cons cells), `keyword`,
  `function`, `builtin`, `macro`, `dict` (insertion‑ordered `OrderedDict`), plus DB cases
  (`table/record/resultSet/formView/tableView`) and agenda cases (`item/category/view/rule`).
- **`OrderedDict`** preserves insertion order (`keys:[Symbol]` + `values:[Symbol:Value]`) — load‑bearing
  for record display, dict printing, form field order, `dict-keys`/`dict-values`.
- **Truthiness:** only `false` and `nil` are falsy. `0`, `""`, and `()` are all **truthy** (differs from
  Scheme/Clojure/Python).
- **Equality (`=`):** compares only atoms + lists + dicts; functions/records/tables/items/etc. are
  **never equal, even to themselves**; strictly type‑sensitive (`1` ≠ `"1"`); dict equality is
  order‑sensitive.

### 4.2 Reader / syntax
- **Lexer:** parens/braces/brackets, `'` quote, `` ` `` quasiquote, `,` unquote, `,@` splice, `.` dot,
  strings with `\n \t \r \\ \"` escapes, `:keywords`, numbers (int/float/scientific, leading `-`),
  `true/false/nil`, `;` line comments.
  - Two quirks a port must copy for compatibility: **operator‑then‑digit split** (`(+1 3)`→`(+ 1 3)`) and
    a **negative‑number heuristic** (`-` after `( [ {` or start‑of‑input is the minus *operator*, so
    `(-1 3)`→`(- 1 3)`, but `(def x -1)` keeps `-1`).
- **Parser:** `'`→`(quote …)`, `` ` ``→`(quasiquote …)`, `,`→`(unquote …)`, `,@`→`(unquote-splicing …)`;
  `nil`→`.null`; dicts `{:k v …}` (keys must be keywords); **vectors `[a b c]` desugar to `(list a b c)`**
  (no distinct vector type); dotted lists become `list([a, b, symbol("."), c])`.

### 4.3 Evaluation model
- Ordinary recursive `eval`/`apply`. Symbols look up the lexical `Environment` chain (linked scopes,
  reference‑type). Dict literals evaluate each **value**. Empty list self‑evaluates.
- **No TCO / no trampoline.** Every Lisp call nests a native Swift frame; deep recursion (including some
  prelude functions) can overflow the stack. `loop` is the only non‑stack‑growing iteration.
- **Closures** capture the defining environment by reference; `set!` mutations are visible through captures.
- **Params:** positional; missing args bind to `.null` (no arity error at bind time); `. rest` collects
  extra args — but only `defn`/`fn` parse `.` (see the macro bug in §6).

### 4.4 Special forms (`Evaluator.swift`)
`quote`, `if`, `cond` (with `else`), `def` (+ `(def (f a b) …)` shorthand), `defn`, `fn`, `let` (sequential
= effectively `let*`), `do`, `set!` (returns the value), `and`/`or` (short‑circuit, return the deciding
value), `not` (a special form, not a builtin), `loop` (a plain `while`; **inits are bound once, progress
requires `set!`**), `defmacro`, `for-each`, `apply`. DB/agenda commands (`deftable insert query update
delete count-records describe pack drop-table browse edit defform`, `defcategory defrule defview show
deftemplate from-template drop-template use-agenda close-agenda`) are dispatched here with **selective
argument evaluation** (table names + schema/condition/filter forms are passed unevaluated; keyword values
are evaluated).

### 4.5 Macros
- `defmacro` builds a `Macro`; expansion runs on **unevaluated** args and the result is re‑`eval`'d
  (recursive expansion). Unhygienic (no gensym).
- **Quasiquote/unquote are parsed but NOT implemented in the evaluator** — evaluating a `` ` `` form throws
  `undefined symbol quasiquote`. Existing macros build code with `list`/`cons`/`quote` instead.

### 4.6 Builtins (`Builtins.swift`, ~80)
- **Arithmetic:** `+ - * / mod abs min max floor ceil round pow` (`mod` = truncated remainder, sign
  follows dividend).
- **Comparison:** `= != < > <= >=`.
- **Strings:** `str str-len str-upper str-lower str-contains str-matches` (regex → `(true grp…)` or `false`)
  `str-split str-join` (**sep first**) `str-trim str-replace str-starts-with str-ends-with substr`.
- **Lists:** `list cons car/head cdr/tail nth length append reverse map filter reduce` (`(fn init list)`)
  `range flatten sort-by zip empty?`.
- **Dicts:** `dict dict-get dict-set dict-keys dict-values dict-has dict-merge` (immutable — return new dicts).
- **Types:** `type string? number? bool? list? nil? symbol? keyword? fn? date? dict? table? record? item?`.
- **Conversion:** `->string ->number ->bool`.
- **Dates:** `now date-format today` (returns a *string*) `date-add date-diff calendar`.
- **I/O:** `print`/`println` (routed through the interpreter's `onOutput` callback when set).
- **Meta:** `eval parse`.
- Additional builtin sets registered by the `Interpreter`: HTTP/JSON, file, editor, database, agenda.

### 4.7 Prelude (Lisp source embedded in `Interpreter.loadPrelude`)
`id compose partial complement`, `pipe` (threading macro), `when`/`unless`, `inc dec even? odd? zero? pos?
neg?`, `first second third last take drop`, `count` (= `length`), `some? every?`, `repeat-str`.
*Note:* `pipe`/`when`/`unless` rely on macro rest‑params, which are broken (§6).

### 4.8 Smart natural‑language input (`SmartParser.swift`)
Regex NLP producing `{when (ISO), priority, who[], cleanText}`:
- **Dates (first match wins):** ISO `YYYY-MM-DD`, `tomorrow/today/yesterday`, `next <weekday>`,
  `this weekend`, `in N days/weeks`, `end of week/month`, `<Month> <day>` (rolls to next year if past).
- **Priority:** `urgent/asap`→1, `high priority`→2, `low priority`→4, `!!!`→1 `!!`→2 `!`→3.
- **People:** `@name` (removed from text), `with/for/from Name`, `call/email/meet/text Name` (kept in text).

### 4.9 Database engine (dBASE‑style, `Database.swift` + `DatabaseBuiltins.swift`)
- **One `sqlite3` connection per `Database`** (= one agenda file). WAL mode. Prepared statements per call
  (not cached). No transactions (each statement autocommits) — **batch operations are non‑atomic**.
- **Schema:** `deftable` emits `CREATE TABLE … (_id INTEGER PRIMARY KEY AUTOINCREMENT, _deleted INTEGER
  DEFAULT 0, <fields…>)`. Field types `string→TEXT, number→REAL, bool→INTEGER, date→TEXT, memo→TEXT,
  choice→TEXT`. Schemas are cached in memory and serialized into a meta table `_eelisp_tables` using a
  custom `name:type:req:default` format (**defaults and choices are lost on reload**).
- **Commands:** `deftable insert query update delete count-records pack tables describe drop-table
  browse edit defform field-get field-set records record-id`.
  - `query` keywords: `:where` (**raw SQL** interpolated; only `:params` are bound), `:params`, `:order`,
    `:asc`, `:desc`, `:limit`, `:select`. Always `SELECT _id, …, _deleted … WHERE _deleted = 0`.
  - `delete` is **soft** (`_deleted = 1`); `pack` hard‑deletes flagged rows. Numbers bind as INTEGER when
    whole (`|n| < 1e15`), else REAL; reads dispatch by **declared field type**, not storage type.
- **Reads/writes are value‑typed:** `Value` ⇄ SQL mapping is in `bindParams`/`readColumn`.

### 4.10 Agenda PIM (Lotus‑Agenda‑inspired, `AgendaBuiltins.swift`)
Five auto‑created tables (each with hidden `_id`/`_deleted`):
`_items` (text, notes, categories JSON‑array, properties JSON‑object, created, modified), `_categories`
(name, parent, exclusive, conditions), `_rules` (name, condition, actions, enabled), `_views`
(name, filter, group_by, sort_by, sort_asc, columns), `_templates`.

- **Items:** `add-item` (keyword metadata), `add` (natural language via SmartParser), `smart-parse`
  (preview only), `items`/`items-on`/`items-between` (return `.tableView`), `item-get/edit/set/done/count`,
  `add-item-today`. `item-done` **soft‑deletes and, if recurring, inserts the next occurrence** with the
  `:when` advanced.
- **Categories:** hierarchical slash paths; `defcategory` with `:exclusive`/`:children`; `assign`/`unassign`;
  exclusivity removes sibling categories under an exclusive parent; `categories` prints the tree.
- **Rules (the "magic"):** `defrule :when <cond> :assign "cat" :action <expr>`. The condition/action Lisp is
  **stored as source text in SQLite, re‑parsed, and evaluated against each item** in a child environment
  where `text/notes/id/categories/created/modified` and **every property (as a bare symbol)** are bound,
  plus helpers `get`, `has-category`, and `match` (regex capture). `auto-categorize` runs rules on every
  `add-item`. To keep the in‑memory item in sync, rule application **inspects the action AST** (`assign`/
  `item-set`) rather than relying on eval side effects — a naive eval‑only port silently fails to persist.
- **Views:** `defview :filter <expr> :sort-by :group-by`; `show` loads all items, applies the filter
  in‑memory (same bound context, plus `overdue?`), sorts by string compare, and returns a `.tableView`
  (or a preformatted grouped string when `:group-by`).
- **Templates:** `deftemplate`/`from-template`.
- **Recurrence:** `:daily/:weekly/:monthly` or `(every N :days|:weeks|:months)`.
- **Multi‑agenda:** `open-agenda/use-agenda/close-agenda/agendas/export-agenda/import-agenda` — each agenda
  is a separate SQLite file; a process‑level registry tracks them; `export/import` use real
  `JSONSerialization` (`{version:1, tables:{…}}`).
- **Property values round‑trip as strings** — so `(= priority "1")`, not `(= priority 1)`.

### 4.11 HTTP / JSON (`HTTPBuiltins.swift`)
- `http-get`, `http-post` (`:content-type`) — **synchronous** `URLSession` + semaphore, 30 s timeout,
  return `{:status N :body "…"}`.
- `json-parse` (objects→dicts with **sorted keys**, arrays→lists, bools distinct from numbers),
  `json-stringify` (`.sortedKeys`, integers normalized).

### 4.12 CLI + pipe protocol (`EELispCLI/main.swift`)
- **Modes:** no‑args REPL, `<file>`, `-e "<expr>"`, `--pipe`, `-h`. Always `:memory:` SQLite.
- **REPL:** prompt `λ>` / continuation `..`, multi‑line via balanced‑paren `isComplete`, meta‑commands
  `:quit/:q :help/:h :env :load <file>` (no `:db/:clear/:reset` in the CLI — those exist only in the app's
  REPLViewModel). No history in the CLI itself.
- **Pipe protocol** (for out‑of‑process hosts like `eeditor-nc`): read balanced expressions from stdin;
  for `.tableView`/`.formView`, emit a line protocol and an EOT sentinel `\x04`:
  ```
  @@TABLE:<name>            (or @@FORM:<name>)
  @@COLS:<f>\t<type>\t…
  @@COMPUTED:<name>\t<type>\t<expr>   (forms only)
  @@STANDALONE                        (defform only)
  @@ROW:<id>\t<v>\t…                  (one per record)
  @@END
  \x04
  ```
  Values are **sanitized, not escaped** (tabs→space, newlines→literal `\n`) — cells are display‑only.
  Non‑view results print via `Printer.printREPL` then the sentinel.

### 4.13 Tests
- ~67 custom test blocks / ~181 assertions (not XCTest) covering lexer, parser, evaluator, prelude,
  database, and agenda phases 6–7 (recurrence, templates, multi‑agenda). These pin de‑facto behavior a
  port should match (e.g. operator‑number splitting, soft‑delete + pack, recurrence math, JSON export shape).

---

## 5. The integration contract

*This is the part most worth preserving verbatim — it is why the app is small and consistent.*

1. **One shared `Interpreter`** lives in `REPLViewModel` (`interpreter`, `:memory:` by default). Every
   data feature borrows it. There is no per‑view interpreter.
2. **The app calls EELisp in‑process via direct Swift API** — `evalAll` (multi‑expr), `eval` (single),
   `isComplete` (paren check). **It does NOT use the `@@`/pipe protocol** (that's only for C/C++ hosts).
3. **Interactive views cross the boundary as structured `Value` cases**, never as printed text:
   `(browse …)` → `.tableView(TableViewData)`; `(edit …)`/`(defform …)` → `.formView(FormViewData)` carrying
   `tableName, tableDef, resultSet, computedFields, isStandalone`. The ViewModel pattern‑matches these and
   renders native SwiftUI grids/forms. **Any rewrite's interpreter must return structured view descriptors,
   not ASCII tables.**
4. **Form CRUD bypasses the interpreter and calls `Database` directly** (`db.insert/update/delete` with a
   `rowid = ?` where clause). So a port needs a record‑store API, not just an eval endpoint.
5. **Computed fields (`defform`) re‑enter the evaluator on every keystroke** — a child of `globalEnv` with
   field values bound, evaluating stored AST expressions in order (later fields can reference earlier ones).
6. **Two in‑process callback channels** wired from the app into the interpreter:
   - `onOutput: (String)->Void` — captures `print`/`println` into the REPL scrollback.
   - Seven `editor*` closures — let EELisp builtins read/mutate the editor buffer (cursor, insert, replace,
     selection, current file, buffer text). This is how `word-count.eelisp` reads the buffer and how
     snippets edit the document.
7. **Agenda/Calendar couple by string‑building queries** (`(items-on "…")`, `(items-between …)`,
   `(edit items <id>)`) and matching `.tableView`. Softer coupling — could become a string‑eval API.
8. **`eelisp` code blocks in markdown** (`EELispBlockService`): fenced ```` ```eelisp ```` blocks are
   detected, run via `evalAll`, and their text results spliced back as a ```` ```result ```` block; if a
   block returns a `.form`/`.table`, it opens the interactive side panel and leaves a text stub.

---

## 6. Known bugs & tech debt

Discovered during analysis. For a rewrite, each is a conscious **fix‑or‑replicate** decision — several are
observable behaviors that existing scripts (and the prelude) depend on.

**Language / interpreter**
- **No TCO** — deep recursion overflows the native stack; some prelude functions (`last`, `take`, `some?`)
  are recursive. A port on a small‑stack runtime needs TCO or an explicit stack. *(Recommend: add TCO.)*
- **Quasiquote/unquote are dead** — parsed but unhandled; evaluating `` ` `` throws. *(Recommend: implement
  properly; it makes macros writable.)*
- **`defmacro` ignores `. rest`** — `.` becomes a literal parameter, so the prelude's `pipe`/`when`/`unless`
  are latently broken. *(Recommend: fix macro rest‑params.)*
- **`sort-by` on string keys sorts by `hashValue`** — non‑lexicographic and **non‑deterministic across
  runs** (Swift per‑process hash seed). *(Recommend: lexicographic; note behavior will change.)*
- **`=` never equates functions/records/etc.**, and is strictly type‑sensitive; dict `=` is order‑sensitive.
- **Reader/printer asymmetry** — the printer emits `#date"…"`, `#<fn …>` etc. that the reader cannot read back.
- `read-line` is documented but never registered.

**Database / agenda**
- **No transactions** — apply‑rules over all items, import, etc. are non‑atomic; a mid‑batch failure leaves
  partial writes.
- **Schema round‑trip loss** — reloaded table defs lose `defaultValue` and `choices` (custom non‑JSON meta
  format); `deftable` on an existing table is a no‑op (no migrations).
- **Raw‑SQL `:where`** interpolation (only `:params` bound) — injection‑capable by design; agenda queries
  rely on fragile `LIKE '%"key":"val"%'` substring matching against hand‑rolled JSON, so the exact
  `serializeProps` output format is load‑bearing.
- **Property values are all strings after round‑trip** — numeric comparisons in rules/views must use string
  operands (`"1"`).
- **Process‑global mutable state** (`autoCategorizationEnabled`, `agendaRegistry`, `currentAgendaName`) is
  file‑level `private var`, shared across interpreters in‑process. *(Recommend: instance state.)*
- **Inconsistent date formats** — `created/modified` full timestamps, `:when` date‑only, all `when`
  comparisons are plain string `<` on `YYYY-MM-DD`. Replicate exactly or normalize deliberately.

**App**
- The **live preview pane is not wired in**; the Preview button opens the system browser instead.
- Incremental syntax highlighting's **±2000‑char window** can mis‑highlight long fenced blocks.
- `TabBarWithREPL.swift` is an empty stub; "close others" in the tab context menu is a no‑op.
- README documents targets (TermKit terminal, `eeditor-nc`, `eeditor-imgui`) not present on `mobile`,
  and the test counts in SPEC are stale.

---

## 7. Reorganization & platform recommendation

### 7.1 The decision, stated plainly

> **Rebuild EELisp as a Rust crate that compiles to both native and WebAssembly, and build the
> new EEditor frontend in TypeScript + CodeMirror 6, packaged with Tauri for desktop and shipped
> as a PWA for the web.**

Two repos, mirroring today's healthy split:

```
eelisp/     Rust crate — language + SQLite + agenda. Targets: native lib, `eelisp` CLI, WASM (wasm-bindgen).
              No UI. This is the reusable asset. rusqlite (native) / sql.js or wa-sqlite (web).
eeditor/    TypeScript app — CodeMirror 6 editor + views. Loads eelisp as a native addon (Tauri) or WASM (web).
              One UI codebase runs on macOS/Linux/Windows (Tauri) and in the browser (PWA).
```

### 7.2 Why this, specifically

**It reuses the one thing worth reusing — the engine — across the widest reach.** A Rust EELisp
compiles once and runs both as a native library (Tauri desktop) and as WASM (browser). That's a
strictly larger reach than the current Swift engine, which is Apple‑only in practice.

**The web platform deletes your two heaviest couplings.** The analysis found the biggest
reimplementation costs are (a) the AppKit/UIKit text system + regex highlighting and (b) WKWebView
for preview/PDF. **CodeMirror 6 solves (a) for free** — it's a batteries‑included editor with
incremental syntax highlighting (Lezer grammars), find/replace, undo, multiple cursors, and huge
language support — and an **HTML DOM + `window.print()` solves (b)**. You stop maintaining a bespoke
`NSTextStorage` highlighter and a WKWebView PDF pipeline entirely.

**The integration contract ports cleanly.** The whole app↔engine boundary is "call eval, get back a
typed `Value`, pattern‑match `.tableView`/`.formView`." In Rust that's an `enum Value` with `serde`;
across the WASM/Tauri boundary it's JSON. The `.tableView`/`.formView` descriptors become typed JSON
the TS UI renders. The `onOutput` stream and the seven `editor*` callbacks become a small bidirectional
RPC (print events out; editor‑buffer requests in) — which is exactly what the existing `--pipe` protocol
already proves is workable.

**Rust is the right engine language for you.** Your other projects (bitcoin, darkfi, cpuminer, …) show
deep Rust/systems comfort, so it's no ramp‑up. Rust gives you: a real algebraic `enum` for `Value`
(a near 1:1 map from the Swift enum), `rusqlite` for native + `wa-sqlite`/`sql.js` for web, easy TCO or
an explicit eval stack, and a natural place to **fix the §6 bugs** (macro hygiene, transactions, instance
state, deterministic sort) instead of porting them forward.

**One frontend, three-plus platforms.** Tauri wraps the same TS/CodeMirror UI into small native binaries
for macOS, Linux, and Windows; the same code is a PWA on the web and installable on mobile browsers. That
subsumes the SwiftUI + TermKit + ncurses + ImGui sprawl into a single UI codebase — the reorganization
you're after.

### 7.3 The honest runner‑up: all‑TypeScript

If your priority is **velocity and a solo‑maintainable stack over native performance**, write EELisp in
**TypeScript too** and skip Rust. One language end‑to‑end, the largest ecosystem, trivial web deploy, and
the interpreter's performance is irrelevant for a personal‑data Lisp. The cost: no free native desktop
(still fine via Tauri‑with‑JS or Electron), SQLite‑in‑browser is a little fiddly (`wa-sqlite` + OPFS for
persistence), and you lose Rust's type‑system leverage on the `Value` enum. **Choose all‑TS if you want
the fastest path to a working web app; choose Rust‑core if you want the engine to be a durable, fast,
reusable asset across native + web (recommended).**

### 7.4 Alternatives considered and why not (now)

- **Stay Swift, just reorganize.** Lowest effort, but you've already saturated the Apple ecosystem and the
  editor/WebKit couplings remain. Doesn't advance the "new version / new reach" goal. Reasonable only if
  Apple‑exclusive is actually the target.
- **Go + Wails.** Good SQLite and easy native builds, but a weaker WASM story than Rust and no first‑class
  embeddable editor to reuse — you'd still lean on a JS editor anyway, so you end up with the TS UI regardless.
- **C++ / Dear ImGui (continue `eeditor-imgui`).** Maximum control and truly native, but immediate‑mode GUIs
  make a rich text editor + markdown preview painful, and you'd hand‑roll everything CodeMirror gives free.
- **Flutter / other.** Viable, but Dart is a third language with no engine‑reuse benefit and a heavier text‑
  editing story than CodeMirror.

### 7.5 What to keep, port, and drop

| Component | Action |
|---|---|
| EELisp language + DB + agenda | **Port to Rust** (fix §6 bugs on the way). Keep the language surface + test suite as the compatibility spec. |
| The `.tableView`/`.formView` structured‑value contract | **Keep the shape**; serialize as JSON across the boundary. |
| ViewModels' pure logic (autosave, search, fuzzy rank, calendar math, tags, tab/bookmark rules, language detection tables, theme data, syntax keyword sets) | **Reimplement in TS** — these are portable algorithms + data, cheap to move. |
| Editor text system, WKWebView preview/PDF, security‑scoped bookmarks | **Drop** — replaced by CodeMirror, DOM/print, and plain FS (native) or File System Access/OPFS (web). |
| `--pipe` `@@` protocol | **Drop** for the primary app (in‑process/WASM instead); optionally keep a CLI JSON mode for scripting. |
| CLI (`eelisp`) | **Keep** as a Rust binary — useful for scripting and as a test harness. |

---

## 8. Suggested porting order

Bottom‑up, keeping a runnable artifact at every step (mirrors `SPEC.md §12.4`):

1. **Rust EELisp core** — Types/`Value` enum → Lexer → Parser → Environment → Evaluator (with TCO) →
   Builtins → Prelude → Printer. Port the existing test suite first as the acceptance spec.
2. **Database + database builtins** — `rusqlite`, the dBASE command set, soft‑delete/pack, **add
   transactions**, and a JSON (not custom‑string) schema store so defaults/choices survive.
3. **Agenda layer** — items/categories/rules/views/templates/recurrence/multi‑agenda + SmartParser.
   Move the process‑global state to instance state.
4. **Structured view values + a serialization boundary** — `.tableView`/`.formView` as serde types;
   define the JSON the UI receives, and the RPC for `onOutput` + editor callbacks.
5. **WASM + native bindings** — `wasm-bindgen` for the browser; a native addon / Tauri command for desktop.
   Validate the CLI still runs.
6. **TS app shell + CodeMirror editor** — tabs, file tree, autosave, search, quick‑open, calendar, tags,
   snippets, shortcuts. Wire the editor callbacks.
7. **REPL + native record/table/form renderers** — consume the structured values; computed‑field
   recompute calling back into the engine.
8. **Markdown preview + PDF** — a JS markdown lib into a themed HTML pane; `window.print()` / headless for PDF.
9. **Package** — Tauri desktop builds + PWA; optional mobile via the same web app.

---

## 9. Appendix

### 9.1 Source map (current `mobile` tree)

```
eelisp/Sources/EELisp/
  Types.swift           Value enum, OrderedDict, Record/ResultSet/FormViewData/TableViewData, LispError
  Lexer.swift  Parser.swift  SmartParser.swift
  Evaluator.swift  Environment.swift  Printer.swift  Interpreter.swift
  Builtins.swift        ~80 core builtins + embedded Prelude (in Interpreter.loadPrelude)
  DatabaseBuiltins.swift  Database.swift        dBASE-style DB
  AgendaBuiltins.swift  (2607 LOC)              items/categories/rules/views/templates/recurrence/multi-agenda
  HTTPBuiltins.swift  FileBuiltins.swift  EditorBuiltins.swift
eelisp/Sources/EELispCLI/main.swift             REPL, -e, file, --pipe (@@ protocol), -h

EEditor/                        SwiftUI app (macOS/iOS)
  App/{EEditorApp,AppState}.swift
  Views/{Editor,Preview,Tabs,Sidebar,Search,QuickOpen,REPL}/…
  Helpers/{SyntaxHighlighter,EditorTheme,ThemeManager,HTMLTemplate}.swift
  Resources/{preview.html,preview.css,Snippets/*.eelisp,manual/tutorial/guide .md}
Sources/EEditorCore/            platform-independent core
  Models/{Document,FileNode,SearchResult,KeyboardShortcutAction}.swift
  ViewModels/{Editor,Sidebar,Search,QuickOpen,Calendar,Preview,REPL,Agenda,Tags,Snippets}ViewModel.swift
  Services/{FileSystem,AutoSave,Bookmark,MarkdownRenderer,PDFExport,Search,EELispBlock,KeyboardShortcutManager}.swift
  Extensions/URL+Extensions.swift   (language detection + text-file gate)
```

### 9.2 The pipe wire protocol (reference, `EELispCLI/main.swift`)

```
@@TABLE:<name>      | @@FORM:<name>
@@COLS:<f>\t<type>\t…
@@COMPUTED:<name>\t<type>\t<expr>     (FORM only, 0+)
@@STANDALONE                          (FORM only, if isStandalone)
@@ROW:<id>\t<v>\t…                    (one per record, schema order; missing → empty)
@@END
\x04                                  (EOT sentinel; also emitted after scalar/error results)
```
Field types: `string|number|bool|date|memo|choice`. Values sanitized (no real tabs/newlines survive);
no reversible escaping — treat cells as display text.

### 9.3 Agenda SQLite schema (reference)

- `_items(text, notes, categories /*JSON [str]*/, properties /*JSON {str:str}*/, created, modified)`
- `_categories(name, parent, exclusive, conditions)`
- `_rules(name, condition /*Lisp src*/, actions /*@@-joined Lisp*/, enabled)`
- `_views(name, filter /*Lisp src*/, group_by, sort_by, sort_asc, columns)`
- `_templates(name, text_template, notes, categories, properties, created, modified)`
- Every table also has hidden `_id INTEGER PK AUTOINCREMENT` and `_deleted INTEGER DEFAULT 0`.

### 9.4 Compatibility quirks to replicate (or consciously break)

Operator‑number split (`(+1 3)`→`(+ 1 3)`) · negative‑number heuristic after `([{` · truthiness (`0`/`""`/`()`
truthy) · `mod` = truncated remainder · `str-join`/`reduce`/`str-replace` argument orders · property values
round‑trip as strings · `:when` string comparison ordering · soft‑delete everywhere, `pack` to purge ·
`export-agenda` JSON shape `{version:1, tables:{…}}`.

---

*Generated from a full read of both codebases (language core, DB/agenda domain, CLI/pipe/HTTP, the
editor/file/preview app layer, and the app↔engine integration) plus `docs/SPEC.md`. Line references are
against branch `mobile` and may drift.*
