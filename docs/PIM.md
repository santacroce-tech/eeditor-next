# EEditor as a PIM — org-mode habits, in EELisp

*A guide and a working config for running tasks, agenda, time, habits and a life log out of
EEditor. Verified against the engine and the app on 2026-09-30.*

The config is [`docs/pim/pim.eelisp`](pim/pim.eelisp) (keybindings + a library) plus
[`docs/pim/Capture.eeform`](pim/Capture.eeform) (a capture window). Every behaviour described here
is checked by `npx vite-node dev/pim-check.ts` (84 checks, real engine, real keybinding parser).

---

## The idea

Org-mode is three things wearing one syntax: **an outliner** (text you write), **an agenda** (dated
commitments collected from that text) and **a spreadsheet/database** (clocks, properties, tables).
EEditor already has all three as separate, better-typed parts. They just need wiring together:

| Part | What lives there | Why there |
|---|---|---|
| **Notes** (`.md`) | Everything you write: daily notes, projects, reviews | The human artifact — greppable, linkable (`[[…]]`), taggable (`#…`), exportable to PDF |
| **Agenda** (`add`, `items`, …) | Dated, prioritised, categorised commitments | The agenda panel, the calendar, recurrence, rules and views all read it |
| **Tables** (`deftable`) | Numbers over time: clock, done log, life tracker | Queryable, summable, `browse`-able in the REPL |

All three sit in the workspace database, `.eeditor/eeditor.db`, which has persisted across launches
since `feat/spreadsheet`. The keybindings are the glue: each one reads the caret's line, writes to
one of the stores, and rewrites the line so the note shows what happened.

**Tasks live in the built-in agenda.** A task line in a note is a *view* of an agenda item. It
carries the item's id as `{#12}`:

```
- [ ] call the plumber tomorrow !! #home | ask about the boiler {#12}
```

Making the task (⌃⌥T) is `add`: the agenda's own parser takes the date, priority and people from
your words. Each `#tag` is `defcategory` + `assign`, the text after ` | ` becomes the item's notes,
and your rules (the ⚙ panel) run over it. So the item appears in the agenda panel, the calendar,
`(items)` and every view. Nothing is kept twice:

| You do | In the agenda |
|---|---|
| ⌃⌥T on a line (make a task) | `add` + categories + notes + `apply-rules` |
| ⌃⌥T on a `- [ ] … {#12}` (tick it) | `item-done 12`; a repeating item rolls forward and the line follows it |
| ⌃⌥P (priority) on a linked line | `item-set 12 :priority …` |
| Edit the line, ⌃⌥A | `item-set 12` with the re-parsed text, date, priority, notes, tags |
| Done / reschedule in the agenda panel or the calendar | ⌃⌥U ticks the note's line (and logs it) |
| Clock a linked task (⌃⌥I / ⌃⌥O) | `item-set 12 :clocked "1:35"` |
| Capture (⌃⌥N) | `add`, with the category `inbox` if you picked *inbox* |

The agenda panel re-reads the items after every keybinding, form event and REPL eval (a small
app change in `src/main.ts`, beside the sheet refresh that was already there). You never press
refresh. The one exception: it doesn't redraw while you're typing in it.

---

## Install

1. ⌘⇧K opens `.eeditor/keybindings.eelisp`. **Append** the whole of `docs/pim/pim.eelisp` to it
   (keep your own `bind`s; later bindings win, so the PIM's ⌘D replaces the plain daily note).
   If your file already has an `(on-start …)`, delete it — the PIM's is the library.
2. Copy `docs/pim/Capture.eeform` into the workspace as `pim/Capture.eeform`.
3. Quit and relaunch. `(on-start …)` only runs at launch; ⌘S reloads the `bind`s but not it.

**Editing the library later:** select the whole `(on-start …)` form and press ⌘⇧Enter. The first
line of the library turns `on-start` into an ordinary macro, so after the first launch the form runs
like any other code — no restart.

> **If you used the earlier tracker snippet:** remove its `(open-agenda ".../life.db")`. The database
> persists on its own now, and `open-agenda` doesn't "open a file for tables" — it swaps the *entire*
> active database. With it in `on-start`, the agenda panel, your forms' tables and the REPL would
> all be looking at `life.db`, and everything in `eeditor.db` would appear to be gone.

---

## Org-mode → EEditor

| Org | EEditor | Key |
|---|---|---|
| Outline, headings, folding | Markdown `#` headings; the gutter folds them | — |
| `TODO` → `DONE` (`C-c C-t`) + `CLOSED:` stamp | `text` → `- [ ] … {#12}` (an agenda item) → `- [x] … ✓ 2026-09-30` (`item-done`) → `-`, logged to the `done` table | ⌃⌥T |
| `[#A]` priorities | `!!!` / `!!` / `!` at the start of the task (what the agenda's parser reads), synced to the item | ⌃⌥P |
| `SCHEDULED` / `DEADLINE` | Words on the line: `dentist tomorrow !! #health` → dated, priority 2, category *health*. Edit the line, ⌃⌥A updates the item; a hand-typed `- [ ]`, ⌃⌥A links it | ⌃⌥T / ⌃⌥A |
| Repeaters `+1w` | `(item-set 12 :recurrence (every 1 :weeks))` — ⌃⌥T on the line then rolls it forward and keeps it open | REPL |
| `org-agenda` (week view) | `(pim-agenda 7)`: the `pim-overdue` view, then `items-between` day by day, by priority; plus the agenda panel and the calendar, live | ⌃⌥W |
| Agenda filters | Saved views `pim-overdue`, `pim-inbox` (`defview`); `(pim-category "work")` takes in `work/…` | REPL / blocks |
| Dynamic blocks `#+BEGIN: … #+END` | `<!-- eel: (any expression) -->` … `<!-- /eel -->`; the markers are invisible in preview/PDF | ⌃⌥U refreshes all |
| `org-capture` | A floating window: task / inbox / log, Enter, next | ⌃⌥N |
| Clocking (`C-c C-x C-i/o`) + clock report | Clock in on the task or heading at the caret (stops the previous one), out, status; `(pim-clock-report from to)` | ⌃⌥I ⌃⌥O ⌃⌥K |
| Archive (`C-c C-x C-a`) | Every `- [x]` line moves under `## Archive` at the end of the note | ⌃⌥X |
| Habits / `org-habit` | The life tracker + `(pim-streak "exercise")` | ⌃⌥L ⌃⌥C ⌃⌥R |
| `org-journal` / datetree | Daily note from a template (agenda block, Log, Notes) | ⌘D |
| Weekly review | `reviews/<monday> week.md`: done, time, tracker, next 7 days, undated, prompts | ⌃⌥V |
| Tags `:work:` | `#work` in text (tags panel); in ⌃⌥A each `#tag` also becomes an agenda category | — |
| Links `[[…]]`, backlinks | Same syntax, ⌘-click, backlinks bar | — |
| `org-babel` | ```` ```eelisp ```` blocks, ⌘⇧Enter runs the one at the caret | ⌘⇧Enter |
| Tables + formulas | Sheets (`.eesheet`) with EELisp formulas; `browse` for a table widget | — |
| Sparse trees / search | ⌘⇧F full-text search, ⌘P quick-open, tags panel | — |
| Properties drawers | ` \| notes` on the line; any property via `(item-set 12 :where "clinic")` | ⌃⌥A / REPL |
| Export | PDF export; forms export to standalone HTML | — |
| Custom agenda commands | `(defview name :filter … :sort-by …)` + `(show name)`; `defrule` auto-categorises | REPL |

---

## A day with it

**Morning.** EEditor opens on today's note, created from the template:

```markdown
# 2026-09-30 · Wednesday

## Agenda

<!-- eel: (pim-agenda 1) -->
**Wed 30 Sep — today**

- [ ] !!! pay rent {#3}
<!-- /eel -->

## Log

## Notes
```

**Planning.** Type tasks as plain lines anywhere and press ⌃⌥T. `call @Ana about the flat in 3 days !!`
becomes an agenda item for Saturday, priority 2, with Ana as a person. It's in the agenda panel at
once, and the line becomes `- [ ] call @Ana about the flat in 3 days !! {#14}`. Changed your mind?
Edit the line to `in 5 days` and press ⌃⌥A. The panel is just as good a place to plan: an item
you reschedule or finish there is reflected in the note at the next ⌃⌥U.

**Working.** Caret on `## Write the report`, ⌃⌥I: the clock runs. Caret on another task, ⌃⌥I: the
first clock stops, the new one starts. ⌃⌥K tells you what's running, ⌃⌥O stops it.

**Living.** In the Log section, `coffee 2` ⌃⌥L → `- 09:12  coffee 2 un`. `red wine 2 glass | with Ana`
→ drink, 2 glass, with a note. `🍕 pizza 800 kcal` → food. `walk 30` → exercise, 30 min. Or ⌃⌥C for
the coffee you have twenty times a day, or ⌃⌥N and pick *log* from wherever you are.

**Done.** ⌃⌥T on a task: `- [x] … ✓ 2026-09-30`, done in the agenda (it leaves the panel) and a
row in the `done` table. A repeating one stays `- [ ]` and its `{#id}` moves to the next occurrence.

**Evening.** ⌃⌥R drops today's log and totals at the caret. ⌃⌥X clears finished tasks to the bottom.

**Sunday.** ⌃⌥V opens the week's review, already filled in: what you finished, where the time went,
the tracker totals, the next seven days and the undated pile. Write the reflection underneath.

---

## Dynamic blocks — the part to build on

Any EELisp expression that returns a string can be a block. Put it in a note and ⌃⌥U fills it:

```markdown
<!-- eel: (pim-clock-report "2026-09-01" "2026-09-30") -->
<!-- /eel -->

<!-- eel: (str "Exercise streak: " (pim-streak "exercise") " days") -->
<!-- /eel -->

<!-- eel: (pim-track-report "2026-09-01" "2026-09-30") -->
<!-- /eel -->
```

⌃⌥U re-runs every block in the note and keeps the text around them. A block with no closing marker
gets one. A dashboard note (`dashboard.md`) made of blocks is the org-agenda "custom command" in
spirit: open it, ⌃⌥U, read.

The library's building blocks, all callable in blocks, the REPL and your own bindings:

| Function | Returns |
|---|---|
| `(pim-agenda n)` | overdue + the next *n* days of agenda items, as task lines |
| `(pim-someday)` | agenda items with no date |
| `(pim-inbox)` | what capture put in the inbox (the `pim-inbox` view) |
| `(pim-category c)` | the items in a category and its children |
| `(pim-done-report from to)` | what you finished, from the `done` table |
| `(pim-clock-report from to)` | a markdown table of time per task, with a total |
| `(pim-track-report from to)` | tracker totals per kind: `drink 5 un · exercise 90 min · …` |
| `(pim-day-log day)` | the day's tracker entries and totals |
| `(pim-streak kind)` | consecutive days with that kind logged |
| `(track thing qty unit note)` | log one entry directly |
| `(pim-capture kind text)` | what the capture window calls: `"task"`, `"inbox"`, `"log"` |

---

## REPL recipes (⌘J)

```lisp
(browse log :where "kind = ?" :params (list "weed") :order "at")   ; a table widget
(browse done :order "at")
(count-records log :where "kind = ? AND day >= ?" :params (list "drink" "2026-09-01"))

(item-set 12 :recurrence (every 2 :weeks))       ; make an agenda item repeat (or: the panel's editor)
(show pim-inbox)                                 ; the capture inbox, to sort
(show pim-overdue)

;; rules file tasks from notes and capture too — or define them in the ⚙ panel
(defrule bills :when (str-contains (str-lower text) "invoice") :assign "money")

(defview urgent :filter (overdue?) :sort-by when)
(show urgent)

;; teach the tracker new things — or edit pim-kinds / pim-units in the library
(set! pim-kinds (dict-set pim-kinds :kombucha "drink"))
```

---

## Things that bit while building this

- **Offsets are UTF-16, `str-len` counts characters.** One emoji on a line used to make a line
  rewrite one unit short and eat the next line's first character. `pim-u16` measures lines the way
  CodeMirror does. Use `pim-set-line` in your own bindings rather than doing the arithmetic.
- **`<` compares numbers only.** `(< "2026-09-20" "2026-09-30")` is a type error; use
  `(date-diff a b)` (days, `a − b`).
- **An agenda row's id is `(record-id r)`, not `(field-get r :id)`** — the latter is nil, so a
  `{#…}` link built from it reads `{#nil}`.
- **`items` / `items-on` return result sets**; wrap them in `records` to `map`/`filter`.
- **`item-done` forgets the item** (soft delete). That is why the `done` table exists: without it
  the weekly review would have nothing to show.
- **`defcategory` doesn't evaluate its argument** — `(defcategory c)` defines a category called
  "c". The library builds the form as text: `(eval (parse (str "(defcategory " c ")")))`.
- **`assign` doesn't define the category**, so it's missing from `(categories)` and the panel's
  list. Define it first (`pim-file-under` does both).
- **`(items :category "work")` doesn't include `work/admin`**; `pim-category` does.
- **With `(auto-categorize true)`, the item `add` returns is from before the rules ran** — read it
  again with `item-get`.
- **Templates are broken in the engine today:** `from-template` drops the item's text, and running
  `deftemplate` again adds a second template of the same name (the docs' `(deftemplate x (…))`
  shape errors too; it takes flat keywords). The capture window uses categories instead.
- **Enter on a list line has already typed `- [ ] `** — so the block-inserting keys take a
  bullet-only line over rather than nesting the block inside a list item.
- **`(str "a" nil)` is `"anil"`** — guard values that may be nil before concatenating.
- **Only `nil` and `false` are falsy.** `""`, `0` and `()` are true.

---

## Where org is still ahead — and what would close the gap

In order of value for this use:

1. **Sync is by keystroke, not live.** A task finished in the panel is ticked in its note at the
   next ⌃⌥U *in that note*, and a `- [ ]` typed by hand is only linked when you ⌃⌥T/⌃⌥A it, because
   EELisp can't read workspace files. A read-only `(read-note path)` / `(notes)` pair in the editor
   host would let one command sweep every note.
2. **Capture into a note.** `ed-open` is asynchronous, so a binding can't open `inbox.md` and then
   append to it. An `(ed-append path text)` command would give org-capture's "file under heading"
   and refile, and a daily-note log line from the capture window.
3. **`*line-from*` / `*line-to*` in the binding context.** They are one line each in
   `ui/keybindings.ts` and would make `pim-u16` unnecessary.
4. **Reloading `on-start` on ⌘S.** Today it's the ⌘⇧Enter trick; a separate `(on-load …)` hook that
   re-runs on reload (with `on-start` kept for "what to open") would make the library feel native.
5. **A prompt.** A `(ed-prompt "Effort?" callback)` minibuffer would allow org's interactive bits
   (set a date, pick a category) without a form.
6. **Reminders.** Nothing notifies you at 15:00. The form `timer` control could, while a form is open;
   a real one needs a host notification command.

None of these is needed for the config above to work; each makes it a bit more like org.
