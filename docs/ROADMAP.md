# Roadmap

**The one list of what EEditor and EELisp don't do yet**: everything planned, everything decided
against, and what has been done. Other documents explain how things are built (`FORMS.md`,
`FORM-APPS.md`, `SPREADSHEET.md`, `DISPLAY.md`, `msx/MSX.md`, `PIM.md`); none of them keeps a to-do list.
When one finds something missing, it goes here, and that document links to it.

Each item has an id that stays the same: **A** apps and forms, **M** the machines, **S** sheets and
data, **P** the PIM, **W** the site and docs. When an item is done, it moves to *Done*, with the PR
that did it.

Cost: **S** a day or less · **M** a few days · **L** a week or more. *Engine* means eelisp-rs,
*app* means this repository.

---

## Open

### A — apps and forms

| | Item | Where | Cost | Decision |
|---|---|---|---|---|
| A1 | **Try the Windows and Linux export on real machines.** It's built and its Rust is tested, but nobody has run an exported `Files.exe` or `Files.AppImage` yet. On Windows, check whether two WebView2 processes from one build get on (EEditor and an app made from it, open together) | app | S | Next, when a Windows or Linux machine is at hand |
| A2 | **Key events in a form.** `ui-held` says what is down at the frame, not what was pressed and let go in between; a typing program may want the events too (`DISPLAY.md`) | engine + app | M | When a form needs it |

### M — the machines

How they're built: `docs/DISPLAY.md`, `docs/msx/MSX.md`.

| | Item | Cost | Notes |
|---|---|---|---|
| M1 | **The C64**: the 6502, the VIC-II (with its raster tricks), the SID, the CIAs | L | The next machine. As with the Spectrum, the user loads Commodore's ROMs; nothing of theirs is bundled. A 6502 in EELisp, tested against Klaus Dormann's functional tests the way the Z80 is against FUSE's — downloaded when the test runs, not kept here, since they're GPL — then the VIC-II drawn host-side as the TMS9918A is |
| M2 | **MSX tutorial, step 6**: the snake's head as a sprite moving a pixel at a time, and a pause key | S | Practises sprites before the C64 |
| M3 | **Frames that send only what changed** | M | An MSX frame sends all 16 KB of video memory, about 1.3 MB a second of base64; an indexed 320×200 frame at 35 a second, about 3 MB. Sending the changed bytes would help most on the site's WebAssembly engine |
| M4 | **The Spectrum's beeper** as `"audio"` | S | `zx.eelisp` gathers port 0xFE's bit 4; the MSX's PSG path already does the rest |
| M5 | **MSX: the key click (port 0xAA, bit 7), and samples played through the volume** | M | A frame's sound is made from the registers at its end; samples need the writes timed within the frame |
| M6 | **MSX2**: the V9938, 512 KB of video memory, more screens | L | After the C64, if wanted. C-BIOS has an MSX2 BIOS too |

### S — sheets and data

The first seven were found writing *Zero to Hero*, the book that builds a PIM with an agenda, tables,
sheets and live prices (santacroce-tech/eeditor-docs, `book/`). Each one is written up under *How the
open S items would be built*, below.

| | Item | Where | Cost | Decision |
|---|---|---|---|---|
| S1 | Formulas that read the database recalculate by themselves | engine | M–L | Later |
| S2 | Charts (sparklines are done) | app + engine | L | Later |
| S3 | `.xlsx` import | engine + app | M | Later — asked for |
| S4 | Query results that fill a range, and stay live | engine + app | L | Later, after S1 |
| S5 | A place for API keys | app | S | Later — with the book's chapter 16 |
| S6 | Requests that don't hold the engine | engine + app | L | Only if `http-get`'s timeout isn't enough |
| S7 | Whole rows (`2:2`), named ranges, and a formula knowing its own cell (`row()`, `column()`, `offset`, `indirect`) | engine | M | Not until asked |

The rest of the list are things a sheet still lacks, found building it. None of them is needed for a
sheet to be useful.

| | Item |
|---|---|
| S8 | Paste-special (values only, formats only), and ⌘D / ⌘R, which the keybindings own |
| S9 | A CSV opened straight into a grid, not imported as a copy |
| S10 | A sheet that was closed when its source changed catches up only on ↻; a circle across sheets isn't caught the way one inside a sheet is |
| S11 | Auto-fit: double-clicking a column edge resets the width instead of fitting it to the contents, and a row doesn't grow by itself to fit wrapped text |
| S12 | Frozen headers, sort and filter, cell comments, data validation, conditional formatting |
| S13 | Help writing a formula: completing function names, clicking a cell to insert its reference, highlighting the cells it reads, colours in the formula bar (reuse `lisphl`) |
| S14 | Undo for column widths and inserted or deleted rows and columns (today these clear the history), and an undo that survives a restart |
| S15 | Tags and backlinks skip sheets; search sees a sheet's values but not its formulas; a sheet shows no backlinks bar |
| S16 | Page setup in a sheet's PDF: a repeated header row, landscape, fitting to the page width |
| S17 | Several sheets in one file, as tabs of a workbook |
| S18 | A script inside the sheet: its helper `defn`s kept in the file, so a sheet copied to another workspace keeps working without that workspace's `functions.eelisp` |
| S19 | Formats for a whole column (today one row per cell, capped at a million) |
| S20 | Paging a big sheet by what's on screen, and recalculating volatile formulas (the database, another sheet, the clock) without ↻ |
| S21 | Two windows on one sheet: last write wins, cell by cell, and nothing detects a conflict |
| S22 | The grid has no ARIA grid roles, so a screen reader can't move through it (the keyboard can) |
| S23 | UI tests for formats, row and column edits, and touch |

### P — the PIM

How it's built: `docs/PIM.md`.

| | Item | Cost |
|---|---|---|
| P1 | **Agenda changes show at once.** The sweep runs once a minute on the tick. An `(on-agenda …)` hook the config listens to would make it immediate | M |
| P2 | **Refile moves a heading with what's under it**, as org does, not a single line | M |
| P3 | **A date set with ⌘⌥E stays put.** ⌘⌥A reads the line's words again, so a line that still says `tomorrow` brings that date back. The line could carry an ISO date that ⌘⌥E rewrites | S |
| P4 | **The agenda's parser learns weekdays** (`friday`) **and times** (`at 3pm`; a reminder today reads only `15:00`) | M |

### W — the site, the docs and testing

| | Item | Cost |
|---|---|---|
| W1 | Dark-mode screenshots for the *Play* cards (Raycaster, MSX, Display) | S |
| W2 | Export Office and Functions again with the current runtime, so every live app has the same frame loop | S |
| W3 | Try on real hardware: open in place and copy in, Finder's *Open With*, and all of iOS, the long-press menu included | S |

---

## No

| Item | Why |
|---|---|
| **Refreshing with the app closed** (was 12) | Fetching anything with EEditor closed means a background service per operating system — a launch agent, a Windows service, a systemd timer — with its own engine and its own access to the folder. EEditor is a folder of files you open, where nothing runs that you didn't start. The first tick after opening catches up, and reminders work the same way: a reminder up to `pim-remind-grace` minutes late still fires when EEditor opens |
| **A built-in stock price source** (was 13) | No stock price service is free, keyless and reliable; scraping breaks terms and breaks often. The book shows bring-your-own-key instead (`http-get` headers, and S5 to keep the key private). Unless a stable free source appears |
| **An exported HTML page that opens a real folder** (2026-11-09) | Only Chrome and Edge can do it, and the engine reads files synchronously while the browser hands them over asynchronously, so every read would have to load first and then run again. A Mac, Windows or Linux app made with Export as … app has real files already |
| **The `.eeapp` folder and a served app** (FORM-APPS B1–B4) | The HTML export and the desktop export cover both needs |
| **MSX BASIC, disks and cassettes** | They need Microsoft's ROMs, which aren't free, or a disk system |

---

## Done

Newest first. The PRs say how; `git log` has the rest.

- **2026-11-09 — Apps of their own** (#85): a form, the forms it opens, its images and sheets, as a
  Mac app (`Name.app`, a renamed copy of EEditor, signed for this Mac) or a Windows or Linux one (a
  folder with the program renamed and the app beside it). It starts at the form's size, the form
  fills the window, the file commands work on real files, `(ed-open …)` uses the system's app. A
  sheet it carries goes into its own folder the first time and is its own from then on. `:on-close`,
  which FORM-APPS left for later, was already in (`formrun.ts`).
- **2026-11-04 → 11-08 — the plan of 4 November** (#70–#84): ⌘I and ⌘⇧I swapped, ⌘W closes the tab, a
  sidebar you can resize and hide (⌘B), the welcome note brought up to date; then *Files*, the
  two-panel file browser, as a form — `dir-list` / `file-info` (eelisp-rs #29), `ed-move` /
  `ed-copy` / `ed-delete` / `ed-mkdir` (#75), keys in a form (#76), folders outside the workspace
  (eelisp-rs #31), the form itself (#77–#81); Run or Design when a form opens, F5 runs it; the VB6
  theme removed; eelisp-rs as a submodule (#83).
- **2026-11-03 — 2.5.0** published, with every installer and its notes.
- **The raycaster** (was 15): `workspace/examples/Raycaster.eeform`, on the screen control made
  general (`docs/DISPLAY.md`) — 320×200 indexed, textured walls, sliding doors and sprites at 35
  frames a second.
- **Sparklines** (S2's first step): `=(sparkline B2:B30)` draws a line in the cell's own ink; copy,
  CSV and PDF get the same numbers as bars, `▂▅▁█`.
- **Sheets, built out** (`feat/sheet-clipboard`, `feat/sheet-formats`, `feat/sheet-entry`,
  `feat/sheet-search`, `feat/sheet-ranges`, `feat/sheet-functions`): copy, paste and fill; CSV in and
  out; `Other!A1`; colours, borders, wrapping, row heights and dates; `50%`, `$1,200` and
  `2026-09-16` read as what they are; search inside sheets; PDF; whole columns (`E:E`); a library of
  spreadsheet functions and the workspace's own; `iferror`; UI tests for the grid.
- **2026-10-26 — what the book needed first**: `try` (eelisp-rs #23) and `iferror` (#48), `http-get`
  with a timeout and headers (eelisp-rs #24), `csv-parse` (eelisp-rs #25), `install-pim` for any
  folder (#47), and the small engine fixes the book found — names after *call* and *email*,
  `:choices` enforced, `:select` as text, folders made for an export, `record->dict`,
  `sheet-clear` (eelisp-rs #22, #26).

---

## How the open S items would be built

### S1. Formulas that read the database recalculate by themselves

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

### S2. Charts

**Where:** the book's Part IV — price history is a table with no picture.

**How, in two steps:**
1. **Sparklines** — `=(sparkline B2:B30)` returns a small value the grid draws as a line inside the
   cell (SVG), printed in the PDF too. No new file format.
2. **Charts** — a chart object stored in the sheet's `meta` (range, kind, title), drawn over the
   grid and movable, and printed. Line, bar and pie cover most needs.

**Decision: later — sparklines first.** Step 1 is cheap and answers "how is it moving"; step 2 is
worth it once sheets are used for reports.

**Step 1 done:** `=(sparkline B2:B30)` in the spreadsheet functions returns `{:sparkline (…)}`; the
grid draws it as a line in the cell's own ink, and everything that reads a cell as text — copy, CSV,
PDF — gets the same numbers as bars, `▂▅▁█`, with nothing new to teach them.

### S3. `.xlsx` import

**Where:** a user, wanting to query an Excel file. Today: save as CSV in Excel, then *Import as
sheet*.

**How:** the `calamine` crate in the engine reads `.xlsx` (and `.xls`, `.ods`): `(sheet-from-xlsx
path)` writes each worksheet as its own `.eesheet`, values only — Excel's formulas don't translate
to EELisp, so they arrive as their last values. The tree's *Import as sheet* accepts `.xlsx`
(still a binary file for the editor, so it stays out of the tree as a note).

**Decision: later.** Asked for, contained, and it makes EEditor useful on the files people
already have.

### S4. Query results that fill a range

**Where:** the book's chapters 12–14 — a watchlist that is simply "the latest price of each
symbol". `sheet-put` writes a result set once; it doesn't stay in step.

**How:** a formula whose result is a result set *spills*: it fills the block below and to the right
(header row, then records), and those cells show as owned by the formula. With S1, it refreshes when
its table changes. A spill that would overwrite a typed cell shows *#SPILL* instead.

**Decision: later, after S1** — it needs S1 to be worth having.

### S5. A place for API keys

**Where:** the book's chapter 10 (stocks need a key) and 16 (sharing). A key written in a note or in
`keybindings.eelisp` travels with every copy and export of the folder.

**How:** `.eeditor/secrets.eelisp`, a list of `name → value`, read with `(secret "alphavantage")`;
never included by *Export as HTML*, the samples, or CSV export.

**Decision: later**, with the book's chapter on sharing.

### S6. Requests that don't hold the engine

**Where:** the book's chapter 10. `http-get` is synchronous: while it waits, keys and the REPL wait.

**How:** `(http-get-async url callback)` runs the request on another thread and, when it's done,
the app runs `(callback result)` like a key press — the same route `ed-prompt` uses for its answer.
The engine stays single-threaded; only the waiting moves.

**Decision: only if `http-get`'s timeout isn't enough.** With a timeout of a few seconds, a handful of calls every
few minutes isn't noticeable. This is for scripts that fetch dozens of things.

---

## Could stand on their own

Several pieces built here don't need EEditor, and may one day be projects of their own, with
their own repository, releases and users. Each is kept self-contained with that in mind: its own
file or folder, its own tests and its own documentation, and no reach into the editor's
internals.

| Piece | Where | What it would be on its own |
|---|---|---|
| The Z80 assembler | `dev/z80asm.mjs` | A Z80 assembler in one file with nothing to install: `npx z80asm game.asm` |
| The Z80 | `src/spectrum/zx.eelisp` | A complete Z80 in EELisp (FUSE's tests pass), for any machine built on it |
| The ZX Spectrum and the MSX | `src/spectrum/`, `src/msx/` | Emulators that run in a form, in the browser or anywhere EELisp runs |
| The video chips and the screen | `src/display/` | Drawing the TMS9918A and the Spectrum's screen from their memory; the frame protocol (`docs/DISPLAY.md`) |
| The raycaster | `workspace/examples/Raycaster.eeform` | A small engine for first-person mazes in EELisp |
| The MSX tutorial | `docs/msx/TUTORIAL.md`, `docs/msx/snake/` | A course in writing MSX games |
| The catalog | santacroce-tech/eeditor-docs | A documentation site built from source repositories |

EELisp already is one: santacroce-tech/eelisp-rs.
