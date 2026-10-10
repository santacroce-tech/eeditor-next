# EEditor as a PIM — org-mode habits, in EELisp

*A guide and a working config for running tasks, agenda, time, habits and a life log out of
EEditor. Verified against the engine and the app on 2026-10-03.*

The config is [`docs/pim/pim.eelisp`](pim/pim.eelisp) (keybindings + a library) plus
[`docs/pim/Capture.eeform`](pim/Capture.eeform) (a capture window). Every behaviour described here
is checked by `npx vite-node dev/pim-check.ts` (117 checks, real engine, real keybinding parser);
the app's side of it — writing to open notes, the prompt, the minute tick — by
`npx playwright test dev/ui/keyhooks.pw.mjs`.

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

Making the task (⌘⌥T) is `add`: the agenda's own parser takes the date, priority and people from
your words. Each `#tag` is `defcategory` + `assign`, the text after ` | ` becomes the item's notes,
and your rules (the ⚙ panel) run over it. So the item appears in the agenda panel, the calendar,
`(items)` and every view. Nothing is kept twice:

| You do | In the agenda |
|---|---|
| ⌘⌥T on a line (make a task) | `add` + categories + notes + `apply-rules` |
| ⌘⌥T on a `- [ ] … {#12}` (tick it) | `item-done 12`; a repeating item rolls forward and the line follows it |
| ⌘⌥P (priority) on a linked line | `item-set 12 :priority …` |
| Edit the line, ⌘⌥A | `item-set 12` with the re-parsed text, date, priority, notes, tags |
| Done / reschedule in the agenda panel or the calendar | within a minute the line is ticked, in whichever note it is (and logged); ⌘⌥S or ⌘⌥U does it now |
| Clock a linked task (⌘⌥I / ⌘⌥O) | `item-set 12 :clocked "1:35"` |
| Capture (⌘⌥N) | `add`, with the category `inbox` if you picked *inbox* — and the linked line filed in a note |
| ⌘⌥E / ⌘⌥G on a linked line | `item-set 12 :when …` / `assign 12 …`, asked for in a prompt |

The agenda panel re-reads the items after every keybinding, form event and REPL eval (a small
app change in `src/main.ts`, beside the sheet refresh that was already there). You never press
refresh. The one exception: it doesn't redraw while you're typing in it.

---

## Try it first

`npm run pim:sample` (or `npm run pim:sample -- ~/pim-demo`) builds a workspace with something in
every part: an agenda with overdue, today, upcoming, repeating, undated and inbox items, a reminder
three minutes away, notes whose tasks are linked to those items, a tracker and a clock with a few
days of history, a dashboard of blocks, and `TRY ME.md` — a checklist of every key and what it
should do. Open the folder as the workspace. Dates are relative to the day it's made, so make it
again on the day you try it (it starts from scratch each time). It needs the engine binary, like
`dev/pim-check.ts`.

## Install

1. ⌘⇧K opens `.eeditor/keybindings.eelisp`. **Append** the whole of `docs/pim/pim.eelisp` to it
   (keep your own `bind`s; later bindings win, so the PIM's ⌘D replaces the plain daily note).
   If your file already has an `(on-start …)`, delete it — the PIM's opens today's note.
2. Copy `docs/pim/Capture.eeform` into the workspace as `pim/Capture.eeform`.
3. ⌘S. That's all: the library is an `(on-load …)`, which runs when the file is saved as well as at
   launch.

**Editing the library later:** edit it and ⌘S. `(on-load …)` runs again on every save; the tables,
the agenda and everything in them stay, and the settings (`pim-kinds`, `pim-capture-to`, …) go back
to what the file says.

> **If you installed the earlier version** (the library inside `(on-start …)`, starting with
> `(defmacro on-start …)`): replace the whole block with the new file. Your data is in the
> database, not in the config, so nothing is lost.

> **If you used the earlier tracker snippet:** remove its `(open-agenda ".../life.db")`. The database
> persists on its own now, and `open-agenda` doesn't "open a file for tables" — it swaps the *entire*
> active database. With it in `on-start`, the agenda panel, your forms' tables and the REPL would
> all be looking at `life.db`, and everything in `eeditor.db` would appear to be gone.

---

## Org-mode → EEditor

| Org | EEditor | Key |
|---|---|---|
| Outline, headings, folding | Markdown `#` headings; the gutter folds them | — |
| `TODO` → `DONE` (`C-c C-t`) + `CLOSED:` stamp | `text` → `- [ ] … {#12}` (an agenda item) → `- [x] … ✓ 2026-09-30` (`item-done`) → `-`, logged to the `done` table | ⌘⌥T |
| `[#A]` priorities | `!!!` / `!!` / `!` at the start of the task (what the agenda's parser reads), synced to the item | ⌘⌥P |
| `SCHEDULED` / `DEADLINE` | Words on the line: `dentist tomorrow !! #health` → dated, priority 2, category *health*. Edit the line, ⌘⌥A updates the item; a hand-typed `- [ ]`, ⌘⌥A links it. Or ⌘⌥E and say when — `in 3 days`, `2026-10-12`, `none` | ⌘⌥T / ⌘⌥A / ⌘⌥E |
| Repeaters `+1w` | `(item-set 12 :recurrence (every 1 :weeks))` — ⌘⌥T on the line then rolls it forward and keeps it open | REPL |
| `org-agenda` (week view) | `(pim-agenda 7)`: the `pim-overdue` view, then `items-between` day by day, by priority; plus the agenda panel and the calendar, live | ⌘⌥W |
| Agenda filters | Saved views `pim-overdue`, `pim-inbox` (`defview`); `(pim-category "work")` takes in `work/…` | REPL / blocks |
| Dynamic blocks `#+BEGIN: … #+END` | `<!-- eel: (any expression) -->` … `<!-- /eel -->`; the markers are invisible in preview/PDF | ⌘⌥U refreshes all |
| `org-capture` | A floating window: task / inbox / log, Enter, next. Each lands in the agenda (or the tracker) *and* as a line under a heading — `## Tasks` / `## Log` in today's note, `## Inbox` in `inbox.md` (`pim-capture-to`) | ⌘⌥N |
| Refile (`C-c C-w`) | The caret's line moves under any heading of any note, picked from a list you narrow by typing | ⌘⌥F |
| `org-agenda-files` | `pim-agenda-files`: notes or folders whose hand-typed `- [ ]` lines ⌘⌥S makes agenda items | ⌘⌥S |
| Appointment reminders (`org-notify`, `appt`) | An item for today with a time — `call Ana at 15:00`, or `(item-set 12 :remind "14:45")` — notifies you then | — |
| Clocking (`C-c C-x C-i/o`) + clock report | Clock in on the task or heading at the caret (stops the previous one), out, status; `(pim-clock-report from to)` | ⌘⌥I ⌘⌥O ⌘⌥K |
| Archive (`C-c C-x C-a`) | Every `- [x]` line moves under `## Archive` at the end of the note | ⌘⌥X |
| Habits / `org-habit` | The life tracker + `(pim-streak "exercise")` | ⌘⌥L ⌘⌥C ⌘⌥R |
| `org-journal` / datetree | Daily note from a template (agenda block, Log, Notes) | ⌘D |
| Weekly review | `reviews/<monday> week.md`: done, time, tracker, next 7 days, undated, prompts | ⌘⌥V |
| Tags `:work:` | `#work` in text (tags panel); in ⌘⌥A each `#tag` also becomes an agenda category; ⌘⌥G picks one from a list | ⌘⌥G |
| Links `[[…]]`, backlinks | Same syntax, ⌘-click, backlinks bar | — |
| `org-babel` | ```` ```eelisp ```` blocks, ⌘⇧Enter runs the one at the caret | ⌘⇧Enter |
| Tables + formulas | Sheets (`.eesheet`) with EELisp formulas; `browse` for a table widget | — |
| Sparse trees / search | ⌘⇧F full-text search, ⌘P quick-open, tags panel | — |
| Properties drawers | ` \| notes` on the line; any property via `(item-set 12 :where "clinic")` | ⌘⌥A / REPL |
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

**Planning.** Type tasks as plain lines anywhere and press ⌘⌥T. `call @Ana about the flat in 3 days !!`
becomes an agenda item for Saturday, priority 2, with Ana as a person. It's in the agenda panel at
once, and the line becomes `- [ ] call @Ana about the flat in 3 days !! {#14}`. Changed your mind?
Edit the line to `in 5 days` and press ⌘⌥A — or ⌘⌥E and type `in 5 days`. The panel is just as good
a place to plan: an item you finish there is ticked in its note within a minute, whichever note it
is. `call the dentist at 15:00` taps you on the shoulder at three.

**Working.** Caret on `## Write the report`, ⌘⌥I: the clock runs. Caret on another task, ⌘⌥I: the
first clock stops, the new one starts. ⌘⌥K tells you what's running, ⌘⌥O stops it.

**Living.** In the Log section, `coffee 2` ⌘⌥L → `- 09:12  coffee 2 un`. `red wine 2 glass | with Ana`
→ drink, 2 glass, with a note. `🍕 pizza 800 kcal` → food. `walk 30` → exercise, 30 min. Or ⌘⌥C for
the coffee you have twenty times a day, or ⌘⌥N and pick *log* from wherever you are — the line goes
under today's `## Log` whichever note is in front.

**Sorting.** `inbox.md` fills up from capture. Go through it with ⌘⌥F: each line moves under the
heading you pick, in whatever note.

**Done.** ⌘⌥T on a task: `- [x] … ✓ 2026-09-30`, done in the agenda (it leaves the panel) and a
row in the `done` table. A repeating one stays `- [ ]` and its `{#id}` moves to the next occurrence.

**Evening.** ⌘⌥R drops today's log and totals at the caret. ⌘⌥X clears finished tasks to the bottom.

**Sunday.** ⌘⌥V opens the week's review, already filled in: what you finished, where the time went,
the tracker totals, the next seven days and the undated pile. Write the reflection underneath.

---

## Dynamic blocks — the part to build on

Any EELisp expression that returns a string can be a block. Put it in a note and ⌘⌥U fills it:

```markdown
<!-- eel: (pim-clock-report "2026-09-01" "2026-09-30") -->
<!-- /eel -->

<!-- eel: (str "Exercise streak: " (pim-streak "exercise") " days") -->
<!-- /eel -->

<!-- eel: (pim-track-report "2026-09-01" "2026-09-30") -->
<!-- /eel -->
```

⌘⌥U re-runs every block in the note and keeps the text around them. A block with no closing marker
gets one. A dashboard note (`dashboard.md`) made of blocks is the org-agenda "custom command" in
spirit: open it, ⌘⌥U, read.

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
| `(pim-capture kind text)` | captures, and says what it did: `"task"`, `"inbox"`, `"log"` |
| `(pim-capture* kind text)` | the same, as `(message commands)` — the commands file the line in its note (the capture window hands them to `ui-editor`) |
| `(pim-sweep link?)` | editor commands that bring every note in step with the agenda (what the tick and ⌘⌥S run) |
| `(pim-refile-targets)` | every note, and every heading in each, as `"path › ## Heading"` |
| `(pim-reminders)` | `ed-notify` commands for the reminders due now (each fires once) |

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
  rewrite one unit short and eat the next line's first character. Don't measure lines with
  `str-len`: `*line-from*` / `*line-to*` are the caret line's ends as the editor counts them, and
  `pim-set-line` uses them.
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
- **`(on-load …)` runs again on every save** — so a `(def …)` in it resets what you changed at the
  REPL (`(set! pim-kinds …)`). Make the change in the file. `deftable`, `defview` and
  `defcategory` are safe to repeat: they keep what's there.
- **Unsaved tabs are saved before any lisp runs** — a key, a tick, a prompt's answer. That's what
  makes `(read-note …)` agree with the screen, and what `ed-write`'s "only if it still says this"
  relies on.
- **A form handler used to see the clock of the last key pressed** — `*date*` could be yesterday's.
  Handlers get `*date*`, `*time*` and `*now*` fresh now, like keys.

---

## What closed the gap with org — and what's still missing

The list that used to be here, in order of value, and what each became:

| Was | Now |
|---|---|
| **Sync by keystroke, not live.** A task finished in the panel was ticked at the next ⌘⌥U *in that note*; EELisp couldn't read other files. | The engine has `(notes)` and `(read-note path)` (read-only, inside the workspace). Once a minute `(on-tick (pim-tick))` sweeps every note and ticks the lines whose items are done; ⌘⌥S does it now, and also links hand-typed `- [ ]` lines in `pim-agenda-files`. |
| **No capture into a note.** `ed-open` is asynchronous, so a binding couldn't open a note and append to it. | `(ed-append path text "## Heading")` files a line under a heading of any note, open or not, created if missing — so capture files into notes, and ⌘⌥F refiles. `(ed-write path text old)` rewrites a note, but only if it still says `old`: one you're typing into is left for the next sweep. Forms reach these through `(ui-editor …)`. |
| **No `*line-from*` / `*line-to*`.** | In the context of every key, tick and prompt. `pim-u16` is gone. |
| **`on-start` didn't reload on ⌘S** (the ⌘⇧Enter trick). | `(on-load …)` runs at launch and on every save; the library lives there. `(on-start …)` is back to "what opens". |
| **No prompt.** | `(ed-prompt "When?" callback default choices)` asks, then runs `(callback answer)` like a key. ⌘⌥E (a date), ⌘⌥G (a category) and ⌘⌥F (refile, with every heading as a choice) use it. |
| **No reminders.** | `(on-tick …)` once a minute plus `(ed-notify title body)` — a toast, and a system notification when EEditor isn't in front. Items for today with a time (`at 15:00`, or `:remind`) fire once each. |

Still missing, in order of value:

1. **Reminders only while EEditor runs.** Nothing is scheduled with the OS, so a closed app is a
   silent one; a reminder up to `pim-remind-grace` minutes late still fires when it opens.
2. **"Live" is a minute.** The sweep runs on the tick, not when the agenda changes. The agenda panel
   could raise an event the config listens to — an `(on-agenda …)` hook — to make it immediate.
3. **Refile moves a line, not a subtree.** Org carries a heading's children along; a heading's
   section (to the next heading of its level) would be the natural unit.
4. **A date set with ⌘⌥E lives in the item, not the line.** ⌘⌥A re-reads the line's words, so a
   line that still says `tomorrow` puts that date back. The line could carry an ISO date the
   parser reads (`2026-10-12`), rewritten by ⌘⌥E.
5. **The agenda's parser knows `tomorrow`, `in 3 days`, ISO dates — not weekdays** (`friday`) nor
   times (`at 3pm` stays in the text; the reminder reads `15:00` from it).

None of these is needed for the config above to work.
