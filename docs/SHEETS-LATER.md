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
- **`Other!A1` in formulas**, with dependency tracking across files. Recognised and refused now;
  `(sheet-get …)` does the reading, untracked, refreshed by ↻.

**In the grid**

- Formats stop at bold, italic, alignment, number/currency/percent and decimals: no colours, borders,
  wrapped text, row heights, or auto-fit (double-clicking a column edge resets it rather than fitting
  it to what's there). Dates have no format of their own.
- No frozen headers, no sort or filter, no named ranges, no cell comments, no data validation, no
  conditional formatting.
- Writing a formula is bare: no completion of function names, no clicking a cell to insert its
  reference, no highlighting of the cells a formula reads, no syntax colouring in the formula bar
  (`lisphl` from the snippets panel is the thing to reuse).
- Entry conventions are literal: `50%`, `$1,200` and `16/09/2026` are stored as text, not as the
  number or date they look like.
- Undo covers typing and formatting only — not column widths, not inserting or deleting rows and
  columns (which clears the history, because every position it remembers has moved) — and never
  survives a restart.

**Sheets as first-class citizens of the app**

- Search, tags and backlinks skip `.eesheet` entirely, so **nothing finds text inside a sheet**;
  quick‑open matches the filename alone.
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

- No automated UI test for the grid. The engine, the pure model and the engine contract are covered by
  CI; everything about the grid was verified by hand in a browser.
- Untested on real hardware: the desktop app's open‑in‑place and copy‑in paths, Finder's "Open With",
  and all of iOS — including the long‑press menu.
- The marketing pages (`site/index.html`, `tutorial.html`, `download.html`) still describe a notes
  editor. The manual and the EELisp reference cover sheets; these don't.
