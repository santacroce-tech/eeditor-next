# Sheets — what's missing

The running list of what a sheet still can't do, kept out of `SPREADSHEET.md` so it can grow without
burying the plan. Everything here was found while building milestones 1–5; none of it is needed for a
sheet to be useful, and all of it is missing. Grouped by what it costs to live without.

Struck through when it lands, with the branch that did it.

**The three that get noticed first**

- ~~**Copy, paste and fill.**~~ Landed on `feat/sheet-clipboard`: ⌘C/⌘X put the values on the
  clipboard as TSV, a paste back into a sheet types the formulas with their references moved, a paste
  from anywhere else types the values, and the fill handle (or *Fill down* / *Fill right*) repeats a
  block. `sheet-copy`, `sheet-paste` and `sheet-fill` in the engine. Still missing around it:
  paste-special (values only, formats only) and ⌘D/⌘R, which the keybindings own.
- ~~**CSV import and export.**~~ Landed on `feat/sheet-clipboard`: *Export as CSV* and *Import as
  sheet* in the file tree's menu. Still missing around it: `.xlsx`, and a CSV opened straight into a
  grid rather than imported as a copy.
- ~~**`Other!A1` in formulas.**~~ Landed on `feat/sheet-clipboard`: a formula reads `Rates!A1` or
  `Rates!A1:A9` from a sheet beside it, and writing that sheet redoes the open sheets that read it,
  once each. Still missing around it: a sheet that was closed when its source changed only catches up
  on ↻ (nothing runs on open, by design), and a circle across sheets isn't detected the way one
  inside a sheet is.

**In the grid**

- Formats stop at bold, italic, alignment, number/currency/percent and decimals: no colours, borders,
  wrapped text, row heights, or auto-fit (double-clicking a column edge resets it rather than fitting
  it to what's there). Dates have no format of their own.
- No frozen headers, no sort or filter, no named ranges, no cell comments, no data validation, no
  conditional formatting.
- Writing a formula is bare: no completion of function names, no clicking a cell to insert its
  reference, no highlighting of the cells a formula reads, no syntax colouring in the formula bar
  (`lisphl` from the snippets panel is the thing to reuse).
- ~~Entry conventions are literal.~~ Landed on `feat/sheet-entry` (engine): `50%`, `$1,200`,
  `1.200,50` and `1 200,50` are read as numbers and ask for the format they were wearing. Dates are
  still text — there is no date value or format yet.
- Undo covers typing and formatting only — not column widths, not inserting or deleting rows and
  columns (which clears the history, because every position it remembers has moved) — and never
  survives a restart.

**Sheets as first-class citizens of the app**

- ~~Search skips `.eesheet`.~~ Landed on `feat/sheet-search`: search reads a sheet as its values, a
  row per line, and a hit names the cell — clicking it opens the sheet with that cell selected. Tags
  and backlinks still skip sheets, and search sees values rather than formulas.
- A sheet can't be printed or exported to PDF — the button is hidden on a sheet tab.
- A `[[Budget]]` link opens a sheet, but a sheet shows no backlinks bar of its own.

**Deeper in the engine**

- Several sheets per file — tabs inside one workbook.
- A per‑sheet script: helper `defn`s stored in the file's `meta`, so a sheet carries the functions its
  formulas call instead of depending on what a session happens to have loaded.
- Result sets spilling into a range, and a live two‑way binding between a range and a `deftable`;
  `sheet-put` is a one‑off snapshot today.
- Charts.
- Column‑level formats. Formatting a whole column writes a row per cell, which is why it is capped at
  a million.
- Paging a big sheet by viewport (see the risks above), and refreshing volatile formulas — the ones
  reading the database, another sheet or the clock — without pressing ↻.
- Two windows on one sheet resolve cell by cell, last write wins. The version counter catches the
  reader up afterwards; nothing detects a conflict.

**Accessibility**

- The grid is positioned `div`s with no ARIA grid roles, so a screen reader can't navigate it. The
  keyboard works; the semantics don't exist.

**Process**

- ~~No automated UI test for the grid.~~ Landed on `feat/sheet-search`: `npm run test:ui` drives a
  real browser against the dev bridge and a real engine (`dev/ui/grid.pw.mjs`, six tests — typing and
  recalculation, a copied formula's references, a paste from another program, the fill handle, reload
  and search, CSV out and back), and CI runs it in the job that already builds the engine. It doesn't
  cover formats, row/column edits, or touch.
- Untested on real hardware: the desktop app's open‑in‑place and copy‑in paths, Finder's "Open With",
  and all of iOS — including the long‑press menu.
- The marketing pages (`site/index.html`, `tutorial.html`, `download.html`) still describe a notes
  editor. The manual and the EELisp reference cover sheets; these don't.
