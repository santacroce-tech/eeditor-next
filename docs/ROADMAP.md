# Roadmap

What EEditor and EELisp can't do yet, found by using them for something real — mostly while
writing *Zero to Hero*, the book that builds a PIM with an agenda, tables, sheets and live market
prices (santacroce-tech/eeditor-docs, `book/`). Each item says where it came up, how it would be
built, roughly what it costs, and whether it's worth doing.

Cost: **S** a day or less · **M** a few days · **L** a week or more. *Engine* means eelisp-rs,
*app* means this repository.

| | Item | Where | Cost | Decision |
|---|---|---|---|---|
| 1 | [The `http-get` manual says it returns text](#1-http-get-is-documented-wrong) | engine | S | **Fixed** with this roadmap |
| 2 | [Catching an error: `try`](#2-catching-an-error-try) — and `iferror` with it | engine + app | M | **Do next** |
| 3 | [`http-get` options: timeout and headers](#3-http-get-options-timeout-and-headers) | engine | S | **Do next** |
| 4 | [`csv-parse` in the language](#4-csv-parse-in-the-language) | engine | S | **Do next** |
| 5 | [Installing the PIM keys in a folder that has its own](#5-installing-the-pim-keys-in-any-folder) | app | S | **Do next** |
| 6 | [Formulas that read the database recalculate by themselves](#6-formulas-that-read-the-database-recalculate-by-themselves) | engine | M–L | Later |
| 7 | [Charts](#7-charts) | app + engine | M, then L | Later — sparklines first |
| 8 | [`.xlsx` import](#8-xlsx-import) | engine + app | M | Later |
| 9 | [Query results that fill a range, and stay live](#9-query-results-that-fill-a-range) | engine + app | L | Later, after 6 |
| 10 | [A place for API keys](#10-a-place-for-api-keys) | app | S | Later — with the book's chapter 16 |
| 11 | [Requests that don't hold the engine](#11-requests-that-dont-hold-the-engine) | engine + app | L | Only if 3 isn't enough |
| 12 | [Refreshing with the app closed](#12-refreshing-with-the-app-closed) | app | L | **No** |
| 13 | [A built-in stock price source](#13-a-built-in-stock-price-source) | — | — | **No** |
| 14 | [Whole rows, and a formula knowing its own cell](#14-whole-rows-and-a-formula-knowing-its-own-cell) | engine | M | Not until asked |
| 15 | [An easter egg: a raycaster in EELisp](#15-an-easter-egg-a-raycaster-in-eelisp) | app | M | Someday |
| 16 | [Small engine fixes found by the book](#16-small-engine-fixes-found-by-the-book) | engine | S each | **Do next** |

What sheets in particular still lack — formatting, the grid, sheets as first-class files — has its
own running list: [SHEETS-LATER.md](SHEETS-LATER.md).

---

## Do next

### 1. `http-get` is documented wrong

**Where:** the book's chapter 10. The engine's manual says `(http-get url) → string`, with the
example `(json-parse (http-get url))`. It returns `{:status 200 :body "…"}`, so the example fails.

**How:** correct the entry in `src/docs.rs` (and `http-post`), rebuild the reference. **Fixed** in
eelisp-rs alongside this roadmap.

### 2. Catching an error: `try`

**Where:** the book's chapter 10 — with no connection, `http-get` stops with *HTTP request failed*,
and nothing in EELisp can catch that and carry on; a sheet formula can't say "this, or 0 if it
fails" either (no `iferror`, noted in SHEETS-LATER).

**How:** a special form in the evaluator,

```lisp
(try (fetch-json url)
  (catch e (do (println (dict-get e :message)) nil)))
```

that evaluates the body and, on a `LispError`, binds `e` to `{:message "…" :kind "…"}` and
evaluates the handler instead. The body runs in non-tail position (a `try` can't be a loop's tail
call), which keeps the trampoline untouched. Then `iferror` is one line in
`src/sheets/functions.eelisp`: `(defmacro iferror (expr fallback) …)` — a macro, because the
expression must not be evaluated before `try` is around it. Tests: errors from builtins, from user
code, nested `try`, and that `recur` inside a `try` body is refused with a clear message.

**Decision: do next.** It's the one gap every real script hits — network, parsing, user input —
and it unblocks `iferror`, the spreadsheet function people ask for first.

### 3. `http-get` options: timeout and headers

**Where:** the book's chapter 10. The timeout is fixed at 30 seconds (a key or a tick waits that
long when a service hangs), and there's no way to send a header — many APIs want their key in one
(CoinGecko's free key goes in `x-cg-demo-api-key`).

**How:** keyword arguments on both `http-get` and `http-post`, `ureq` already supports both:

```lisp
(http-get url :timeout 5 :headers {"x-cg-demo-api-key" key})
```

**Decision: do next.** Small, and it bounds the blocking problem (11) well enough for scripts that
make a few calls.

### 4. `csv-parse` in the language

**Where:** price sources that answer in CSV, and notes or downloads holding CSV. The app has a
CSV reader (`fromCSV` in `src/core/sheet.ts`, for *Import as sheet*), but the language can't use it.

**How:** `(csv-parse text) → list of rows` and `(csv-stringify rows) → text` in the engine, with the
same rules as the app's reader (quotes, doubled quotes, a final line without a newline). The app's
import could then call the engine, so there's one reader, not two.

**Decision: do next.** Small, and it makes "fetch a CSV into a table" a three-line recipe.

### 5. Installing the PIM keys in any folder

**Where:** a user, asking why ⌘⌥U did nothing. The PIM's keys (⌘⌥T, ⌘⌥U, ⌘⌥N…) aren't part of
the default keybindings: they arrive only with *Add sample notes*, and only in a folder with no
agenda and no keybindings of its own — the samples won't write over a real setup. A folder you
already use never gets them, and nothing says how to.

**How:** a command, `install-pim`, also in the workspace menu: it appends the PIM section
(`docs/pim/pim.eelisp`, between marker comments) to the folder's `.eeditor/keybindings.eelisp` if
it isn't there, reloads, and says which keys arrived. Running it again updates the section between
the markers and leaves the rest of the file alone. The manual's agenda chapter and the welcome note
mention it; the About box could show whether the PIM is loaded.

**Decision: do next.** The PIM is the most capable thing in the app and the hardest to find.

---

## Later

### 6. Formulas that read the database recalculate by themselves

**Where:** the book's chapter 12, a portfolio sheet over the `prices` table. A formula that calls
`query` or `count-records` isn't recalculated when the table changes — only ↻ or `sheet-recalc`
brings it up to date (documented in SPREADSHEET.md).

**How:** while a formula runs, the engine notes which tables it read (`query`, `records`,
`count-records`, `field-get` on a record), and keeps that per cell next to its references. An
`insert`, `update` or `delete` on a table then recalculates the cells of open sheets that read it —
the same path as a write to another sheet (`propagate`), once per sheet per write batch. Closed
sheets catch up on ↻, as they do for other sheets today.

**Decision: later**, once chapter 12 shows exactly how it's used; until then a fetch can end with
`(sheet-recalc "Portfolio")`.

### 7. Charts

**Where:** the book's Part IV — price history is a table with no picture.

**How, in two steps:**
1. **Sparklines** — `=(sparkline B2:B30)` returns a small value the grid draws as a line inside the
   cell (SVG), printed in the PDF too. No new file format.
2. **Charts** — a chart object stored in the sheet's `meta` (range, kind, title), drawn over the
   grid and movable, and printed. Line, bar and pie cover most needs.

**Decision: later — sparklines first.** Step 1 is cheap and answers "how is it moving"; step 2 is
worth it once sheets are used for reports.

### 8. `.xlsx` import

**Where:** a user, wanting to query an Excel file. Today: save as CSV in Excel, then *Import as
sheet*.

**How:** the `calamine` crate in the engine reads `.xlsx` (and `.xls`, `.ods`): `(sheet-from-xlsx
path)` writes each worksheet as its own `.eesheet`, values only — Excel's formulas don't translate
to EELisp, so they arrive as their last values. The tree's *Import as sheet* accepts `.xlsx`
(still a binary file for the editor, so it stays out of the tree as a note).

**Decision: later.** Asked for, contained, and it makes EEditor useful on the files people
already have.

### 9. Query results that fill a range

**Where:** the book's chapters 12–14 — a watchlist that is simply "the latest price of each
symbol". `sheet-put` writes a result set once; it doesn't stay in step.

**How:** a formula whose result is a result set *spills*: it fills the block below and to the right
(header row, then records), and those cells show as owned by the formula. With 6, it refreshes when
its table changes. A spill that would overwrite a typed cell shows *#SPILL* instead.

**Decision: later, after 6** — it needs 6 to be worth having.

### 10. A place for API keys

**Where:** the book's chapter 10 (stocks need a key) and 16 (sharing). A key written in a note or in
`keybindings.eelisp` travels with every copy and export of the folder.

**How:** `.eeditor/secrets.eelisp`, a list of `name → value`, read with `(secret "alphavantage")`;
never included by *Export as HTML*, the samples, or CSV export.

**Decision: later**, with the book's chapter on sharing.

### 11. Requests that don't hold the engine

**Where:** the book's chapter 10. `http-get` is synchronous: while it waits, keys and the REPL wait.

**How:** `(http-get-async url callback)` runs the request on another thread and, when it's done,
the app runs `(callback result)` like a key press — the same route `ed-prompt` uses for its answer.
The engine stays single-threaded; only the waiting moves.

**Decision: only if 3 isn't enough.** With a timeout of a few seconds, a handful of calls every
few minutes isn't noticeable. This is for scripts that fetch dozens of things.

---

## No

### 12. Refreshing with the app closed

Fetching prices (or anything) with EEditor closed means a background service per operating system
— a launch agent, a Windows service, a systemd timer — with its own engine and its own access to
the folder. It goes against what EEditor is: a folder of files you open, where nothing runs that
you didn't start. The first tick after opening catches up, and that is enough for a personal
desk. **No.**

### 13. A built-in stock price source

There's no stock price service that is free, needs no key and is reliable; the free CSV endpoint
the book first used now answers 404, and scraping a website's pages breaks its terms and breaks
often. The book shows the bring-your-own-key pattern instead (with 3 for headers and 10 for keeping
the key private). **No** — unless a stable free source appears.

### 14. Whole rows, and a formula knowing its own cell

Whole-row references (`2:2`) and cell context — `row()`, `column()`, `offset`, `indirect` — would
need the evaluator to know which cell is running. Nothing written so far has needed them. **Not
until someone asks.**

### 15. An easter egg: a raycaster in EELisp

A Wolfenstein-style maze drawn by EELisp on the screen control the ZX Spectrum form already uses
(`docs/spectrum`), behind a hidden command. At the Spectrum's resolution a raycaster is a few
hundred multiplications a column, which the engine can do at a playable rate; DOOM proper (BSP
maps, WAD files) is out of reach for an interpreter. **Someday** — it's fun, it shows off the
engine, and nothing depends on it.

---

## Small things

### 16. Small engine fixes found by the book

Writing all sixteen chapters of *Zero to Hero* against the engine turned up a handful of small
gaps. Each is a few lines and a test; together they remove the workarounds the book has to
explain.

| | What happens | How to fix |
|---|---|---|
| a | **People parsing takes a word, not a name.** `(add "call the bank")` files a person called "the". | Skip articles and possessives after *call, email, meet, text, with, for, from* (`the`, `a`, `an`, `my`, `our`, `your`). |
| b | **`:choices` isn't enforced.** `(deftable t ((kind :type choice :choices ("a" "b"))))` accepts `"z"` on `insert`; only forms honour it. | Refuse a value outside the choices in `insert` and `update`, with the field named in the message. |
| c | **`:select` is ignored.** `(query t :select "a, b")` returns every field. | Apply it, or drop it from the manual. |
| d | **No folder can be made.** `export-agenda` to a path in a folder that doesn't exist fails, and nothing in EELisp creates one. The book exports into `.eeditor/` and copies with `ed-write`. | Create the missing folders inside the workspace (the same rule `ed-write` follows). |
| e | **A row is not a dict.** `json-stringify` of a query's records gives quoted strings; there's `item->dict` for agenda items but no `record->dict`. And a table's name isn't a value: `(query t)` takes the name itself, so a function can't be handed a table — the book builds the query as text. | `(record->dict r)`; and `(query "holdings" …)` accepting a name as text. |
| f | **`sheet-put` doesn't clear.** Writing fewer rows over more leaves the old ones; the book deletes rows first. | `(sheet-clear name area)`, and a `:clear true` option on `sheet-put` that empties the area below what it writes. |
| g | **Manual drift.** `export-agenda` was documented as `(export-agenda "f.json") → number`; it takes the agenda's name and returns a message, and the example's agenda `memory` is called `eeditor` in the app. | Fixed in eelisp-rs alongside this item. |

**Decision: do next**, one PR each — they are small, and each makes the book shorter.

