// The two cheatsheets, and the panel that shows them: what you can write in a cell, and what the
// language looks like. Both answer a question that happens *inside* the app — sitting in a cell not
// knowing how to name another one — so they live a button away from where it is asked rather than
// on the website.
//
// Every example here has been run. Clicking one puts it where you would have typed it: into the
// selected cell, or into the REPL's prompt, ready to edit rather than already run.

export interface HelpRow {
  /** What to write. Clicking it hands this back. */
  code: string;
  means: string;
}

export interface HelpSection {
  heading: string;
  /** Shown under the heading, before the rows. */
  note?: string;
  rows?: HelpRow[];
}

export interface HelpSheet {
  title: string;
  subtitle: string;
  sections: HelpSection[];
  /** What clicking an example does, said in the panel's footer. */
  pickHint: string;
}

/** What you can write in a cell. Mirrors the manual's Sheets chapter. */
export const SHEET_HELP: HelpSheet = {
  title: "What you can write in a cell",
  subtitle: "A value, or = and one expression. References are capitals: B1 is a cell, b1 is a name.",
  pickHint: "Click any formula to try it in the selected cell — Enter keeps it, Escape leaves the cell as it was.",
  sections: [
    {
      heading: "Referring to cells",
      rows: [
        { code: "B1", means: "what is in B1" },
        { code: "B1:B9", means: "those nine cells as a list — what sum and its friends take" },
        { code: "$B$1", means: "B1, pinned: copy the formula elsewhere and it still reads B1" },
        { code: "B$1", means: "only the row pinned ($B1 pins only the column)" },
        { code: "Rates!A1", means: "A1 in the sheet called Rates, sitting beside this one" },
      ],
    },
    {
      heading: "Numbers",
      note: "An empty cell reads as nil, and these step over blanks and text rather than complaining.",
      rows: [
        { code: "=(sum B1:B9)", means: "the total" },
        { code: "=(avg B1:B9)", means: "the mean — also min, max, and length for how many" },
        { code: "=(round (/ E1 3) 2)", means: "a third of E1, to two decimals" },
        { code: "=(/ B1 $E$1)", means: "B1's share of the total in E1, pinned so it survives filling" },
      ],
    },
    {
      heading: "Choosing and joining",
      note: "A blank inside a joined range comes through as the word nil, so join a range that is filled.",
      rows: [
        { code: '=(if (> E1 1500) "over" "ok")', means: "one answer or the other" },
        { code: '=(str A1 ": " B1)', means: "text stuck together — rent: 1200" },
        { code: '=(str-join ", " A1:A3)', means: "a range as one line of text" },
      ],
    },
    {
      heading: "Working over a range",
      note:
        "map and filter hand every cell to your function, blanks included — unlike sum and its friends, they want a range with nothing missing.",
      rows: [
        { code: "=(sum (map (fn (x) (* x 1.1)) B1:B3))", means: "ten per cent on each, then the total" },
        { code: "=(sum (filter (fn (x) (> x 400)) B1:B3))", means: "only the ones over 400" },
      ],
    },
    {
      heading: "Dates",
      note: "A date is written 2026-09-16. (today) on its own is an instant — a number — so it needs dressing.",
      rows: [
        { code: "=(date-add C1 1 :months)", means: "a month after the date in C1" },
        { code: "=(date-diff C3 C1)", means: "the days between two dates" },
        { code: '=(date-format C1 "EEEE")', means: 'the day’s name — or "dd/MM/yyyy" for the date written that way' },
        { code: '=(date-format (today) "yyyy-MM-dd")', means: "today" },
      ],
    },
    {
      heading: "Reaching further",
      rows: [
        { code: "=(count-records contacts)", means: 'rows in a table — :where "city = ?" :params \'("Lisbon") narrows it' },
        { code: '=(sheet-get "Rates" "A1")', means: "a cell of another sheet, worked out as it runs" },
      ],
    },
    {
      heading: "Anything else the language knows",
      note:
        'There is no separate list of spreadsheet functions: a cell can call anything in scope, including what you write in your own notes. In the REPL, (functions "date-") lists what is there and (source sum) shows how one was written.',
    },
  ],
};

/** The shape of the language, for the REPL. */
export const LISP_HELP: HelpSheet = {
  title: "EELisp in a minute",
  subtitle: "Everything is a call: the function first, its arguments after, all inside parentheses.",
  pickHint: "Click any line to put it at the prompt — ⌘/Ctrl+↵ runs it.",
  sections: [
    {
      heading: "Calling things",
      rows: [
        { code: "(+ 1 2 3)", means: "6 — the operator goes first" },
        { code: '(str "a" "b")', means: "ab" },
        { code: "(map (fn (n) (* n n)) (range 1 6))", means: "(1 4 9 16 25)" },
      ],
    },
    {
      heading: "Naming things",
      rows: [
        { code: "(def pi 3.14159)", means: "a value that stays" },
        { code: "(defn square (n) (* n n))", means: "a function — the ;; comment above it becomes its documentation" },
        { code: "(let (a 2 b 3) (+ a b))", means: "5 — bindings for one expression" },
      ],
    },
    {
      heading: "Choosing",
      rows: [
        { code: '(if (> 3 2) "bigger" "smaller")', means: "only false and nil are false — 0 and \"\" are true" },
        { code: '(cond (< n 0) "neg" (= n 0) "zero" true "pos")', means: "flat pairs, first match wins" },
      ],
    },
    {
      heading: "Lists and dicts",
      rows: [
        { code: "(filter even? (range 1 10))", means: "(2 4 6 8)" },
        { code: "(reduce + 0 '(1 2 3))", means: "6" },
        { code: '{:name "Ada" :age 36}', means: "a dict — (dict-get d :name) reads one" },
      ],
    },
    {
      heading: "Your data",
      rows: [
        { code: "(deftable contacts (name:string age:number))", means: "a table, kept in the workspace" },
        { code: '(insert contacts {:name "Ada" :age 36})', means: "a row" },
        { code: "(browse contacts)", means: "the rows as a grid you can read" },
        { code: '(add "call Bob tomorrow !!")', means: "an agenda item, in plain language" },
        { code: '(sheet-get "Budget" "B3")', means: "a cell of a sheet — also sheet-rows, sheet-set" },
      ],
    },
    {
      heading: "Finding your way",
      rows: [
        { code: "(functions)", means: "everything in scope; (functions \"str\") filters by name" },
        { code: "(source map)", means: "how something was written, comments and all" },
        { code: "(database-info)", means: "which file your tables and agenda live in" },
      ],
    },
    {
      heading: "Elsewhere in the app",
      note:
        "⌘⇧↵ runs the ```eelisp block your cursor is in, inside a note, and ⌘⇧K opens your keybindings file, which is EELisp too — Ctrl for ⌘ on Windows and Linux. The snippets button loads a bundle of ready-made functions.",
    },
  ],
};

/**
 * Show a cheatsheet. `onPick` gets the example that was clicked; without it the examples are just
 * text. Closes on Escape, on the backdrop, or on a pick.
 */
export function openHelp(sheet: HelpSheet, onPick?: (code: string) => void): void {
  // whatever had focus gets it back on Escape; a pick moves focus itself, so it doesn't
  const returnTo = document.activeElement as HTMLElement | null;
  const overlay = document.createElement("div");
  overlay.className = "qo-overlay help-overlay";
  const panel = document.createElement("div");
  panel.className = "help-panel";
  panel.setAttribute("role", "dialog");
  panel.tabIndex = -1;
  panel.setAttribute("aria-label", sheet.title);

  const head = document.createElement("div");
  head.className = "help-head";
  const title = document.createElement("div");
  title.className = "help-title";
  title.textContent = sheet.title;
  const close = document.createElement("button");
  close.className = "head-btn";
  close.textContent = "✕";
  close.title = "Close";
  head.append(title, close);

  const subtitle = document.createElement("p");
  subtitle.className = "help-subtitle";
  subtitle.textContent = sheet.subtitle;

  const body = document.createElement("div");
  body.className = "help-body";
  for (const section of sheet.sections) {
    const heading = document.createElement("h4");
    heading.className = "help-heading";
    heading.textContent = section.heading;
    body.appendChild(heading);
    if (section.note) {
      const note = document.createElement("p");
      note.className = "help-note";
      note.textContent = section.note;
      body.appendChild(note);
    }
    for (const row of section.rows ?? []) {
      const line = document.createElement(onPick ? "button" : "div");
      line.className = "help-row";
      const code = document.createElement("code");
      code.textContent = row.code;
      const means = document.createElement("span");
      means.className = "help-means";
      means.textContent = row.means;
      line.append(code, means);
      if (onPick) {
        line.addEventListener("click", () => {
          dismiss(false);
          onPick(row.code);
        });
      }
      body.appendChild(line);
    }
  }

  const foot = document.createElement("div");
  foot.className = "help-foot";
  foot.textContent = onPick ? sheet.pickHint : "";

  panel.append(head, subtitle, body, foot);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  function dismiss(restore = true): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    if (restore) returnTo?.focus?.();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    }
  }
  document.addEventListener("keydown", onKey, true);
  close.addEventListener("click", () => dismiss());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss();
  });
  // the panel, not its first line: nothing should look picked before anything is
  panel.focus();
}
