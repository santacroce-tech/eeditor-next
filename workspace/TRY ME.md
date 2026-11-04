# PIM tutorial

A hands-on tour of the PIM in this workspace: every key, what it should do, and what to check when it
doesn't. Made 2026-11-03 at 15:10 by EEditor's *Add sample notes*; the dates in the notes are relative to
that day, so make the workspace again on the day you try it. The full guide is docs/PIM.md in the repo.
The rest of the app is here too: **examples/** has the example forms and **EEditor.mindmap.md** — every
shortcut and the EELisp dialect, drawn as a mind map.

**How to read this.** ⌘⌥T means hold **Command** and **Option** together, then press **T** (Ctrl+Alt on Windows and Linux). The *caret*
is the text cursor: most keys act on the line it's on. A *toast* is the short message that appears at
the bottom of the window. Tick the boxes here as you go — this note is only a checklist; nothing reads it.

---

## 0 · Check your setup first (2 minutes)

The keys only work in a build of EEditor that has the PIM, with this folder open as the workspace.

- [ ] The window's file tree shows **dashboard.md**, **inbox.md**, **bills.md**, **projects/** and today's note. If not, use **⋯ → Open another folder…** above the tree and pick this folder.
- [ ] ⌘J opens the REPL. Type `(notes)` and press Enter: you get a list of the notes here. *Undefined symbol: notes* means the app was built before the PIM — rebuild it (below).
- [ ] ⌘⌥K anywhere in a note: the toast says **No clock running**. That proves the PIM's keys are live.
- [ ] Open **.eeditor/keybindings.eelisp** with ⌘⇧K. This file *is* the shortcut table: the app's own keys at the top, the PIM library below, this sample's two settings at the end.

**If ⌘⌥K does nothing:**

1. **The app is too old.** The PIM landed on 2026-10-05; an app built before that has none of it. From the repo: `git pull`, then `(cd ../eelisp-rs && git pull)` — the app compiles the engine from that checkout — then `npm run tauri build`, and copy `src-tauri/target/release/bundle/macos/eeditor-next.app` over the one in /Applications.
2. **Another app took the key.** Window managers and launchers sometimes claim ⌘⌥ + a letter for the whole system; quit the app or change its shortcut.
3. **The config didn't load.** A toast says *keybindings: N problem(s)*; open the REPL (⌘J) to see which line. Save the file again (⌘S) after fixing it — it reloads on every save.
4. **The caret isn't in a note.** Click into the text first. Keys pressed while the agenda or a form has focus go there.

---

## Every key

| Key | What it does | Where the caret should be |
|---|---|---|
| ⌘D | Today's note, from the template (created if missing) | anywhere |
| ⌘⌥T | Cycle a line: text → agenda task `- [ ] … {#id}` → done `- [x] … ✓ date` → plain `- …` | on the line |
| ⌘⌥P | Priority `!!!` → `!!` → `!` → none | on a task |
| ⌘⌥A | Re-read the line into its agenda item (date, priority, tags, notes); links a hand-typed `- [ ]` | on a task |
| ⌘⌥E | Ask *When?* and set the date (`tomorrow`, `in 3 days`, `2026-12-01`, `none`) | on a linked task |
| ⌘⌥G | Ask *Category* and file the item under it | on a linked task |
| ⌘⌥B | Ask for a tag and insert links to the notes that have it, as a block | where you want it |
| ⌘⌥S | Bring every note in step with the agenda now (the minute tick does it too) | anywhere |
| ⌘⌥N | Capture window: a task, an inbox item or a log line | anywhere |
| ⌘⌥F | Refile the line under a heading of another note | on the line |
| ⌘⌥W | Insert the next 7 days as a block | where you want it |
| ⌘⌥U | Recompute every block in this note | anywhere in the note |
| ⌘⌥I / ⌘⌥O / ⌘⌥K | Clock in on the task or heading / clock out / what's running | on a task or heading (⌘⌥I) |
| ⌘⌥L | Log the line (`coffee 1`, `run 30 min`) in the tracker | on the line |
| ⌘⌥C | Log a coffee | anywhere |
| ⌘⌥R | Insert today's log as a block | where you want it |
| ⌘⌥X | Move the `- [x]` lines to `## Archive` at the end | anywhere in the note |
| ⌘⌥V | Open this week's review, filled in | anywhere |

The app's own keys still work: ⌘P quick-open, ⌘⇧F search, ⌘E preview, ⌘J REPL, ⌘S save.

---

## 1 · A look around

- [ ] The **agenda** section in the sidebar lists the items: *renew the passport* is overdue, *pay the rent today* is today and urgent, *dentist tomorrow* is tomorrow. The 📅 button above it opens the calendar; ⚙ opens rules & categories.
- [ ] Above the items, every category and how many open items it holds. Click *work*: only its items. Click *all* to see everything again. The section is a form, **pim/Side.eeform** — the `(panel "agenda" …)` line in the keybindings puts it there; open it in the designer to change it.
- [ ] ⤢ above the agenda opens **pim/Agenda** filling the window: this tutorial as an interface — the agenda big, the notes' tasks, capture, the clock, the tracker and the review, one tab each. ⤢ in its title bar gives the room back.
- [ ] ⌘D opens today's note (**2026-11-03.md**). Its tasks end in `{#12}`-style ids: each one *is* an agenda item, shown in the note.
- [ ] ⌘P, type `dash`, Enter: **dashboard.md** — blocks of live results (next 7 days, inbox, work, this week's done/clock/tracker, a streak). ⌘E shows it as a page; ⌘E again to edit.

## 2 · Tasks in a note

In today's note (⌘D):

- [ ] Caret on `- [ ] fix the bike` (not linked yet: no `{#id}`). ⌘⌥T: it becomes `- [x] fix the bike ✓ 2026-11-03`. ⌘⌥T again: plain `- fix the bike`.
- [ ] ⌘⌥T once more: `- [ ] fix the bike {#…}` and a toast *Agenda #… (no date)*. It's in the agenda section now.
- [ ] Type a new line `call the plumber tomorrow !! #home | ask about the boiler`, ⌘⌥T: the agenda read the words — dated tomorrow, priority 2, category *home*, and the text after ` | ` became its notes. Click it in the agenda to see.

## 3 · Dates, categories, priority

On the *fix the bike* task from lesson 2:

- [ ] ⌘⌥E, type `in 3 days`, Enter: the toast gives the date; the agenda moves it. ⌘⌥E `none` takes the date away; ⌘⌥E `whenever` is refused (*isn't a date I know*).
- [ ] ⌘⌥G: the categories are offered as you type. Pick `home`, or type a new name to make one.
- [ ] ⌘⌥P four times: `!!!` → `!!` → `!` → none. The item's priority follows each time.
- [ ] Edit *pay the rent today* to *pay the rent tomorrow*, then ⌘⌥A: *Updated Agenda #2 on …* — the item moved to tomorrow.

## 4 · Repeating tasks

- [ ] On `- [ ] water the plants {#6}` (repeats weekly), ⌘⌥T: it stays open and the toast says *Done — next one …* a week from today, and the line now links the next one (a new `{#id}`).

## 5 · The agenda and the notes stay in step

- [ ] Wait for the next minute, then open **bills.md**: `pay the gas bill` is ticked. It was finished in the agenda already; the once-a-minute tick brought the note in line.
- [ ] In the agenda section, mark *design the landing page* done. Within a minute it's ticked in **projects/site.md** (or ⌘⌥S to do it now).

## 6 · Agenda files: plain checkboxes become tasks

This sample makes `projects/` an agenda file (the last lines of the config).

- [ ] ⌘⌥S: *write the spec* and *pick the fonts* in **projects/site.md** get `{#id}`s and appear in the agenda. The toast says how many notes changed.
- [ ] In **inbox.md**, type `- [ ] something`, ⌘⌥S: it stays as it is — inbox.md isn't an agenda file.

## 7 · Reminders

- [ ] At **15:13**, *call Ana* notifies you: a toast, or a system notification if EEditor isn't in front. (Leave the app open.)
- [ ] Your own: ⌘J, then `(item-set 2 :remind "HH:MM")` with a time a minute or two ahead. Wait for it.

## 8 · Capture

- [ ] ⌘⌥N opens the capture window. Pick *inbox*, type `ask about the boiler`, Enter: a linked line appears under `## Inbox` in **inbox.md**, and the item is in the agenda under *inbox*.
- [ ] ⌘⌥N, *log*, `water 2 glass`, Enter: under `## Log` in today's note, and in the tracker. *task* goes under `## Tasks`.

## 9 · Refile

- [ ] In **inbox.md**, caret on *look into solar panels*, ⌘⌥F, type `home`, pick `projects/home.md › ## Someday`, Enter: the line moves there, still linked.

## 10 · Blocks and the dashboard

- [ ] In **dashboard.md**, ⌘⌥U: every block between `<!-- eel: … -->` and `<!-- /eel -->` is recomputed. What you did above shows up: fewer items in *Inbox*, today's done tasks in *This week*.
- [ ] In any note, on an empty line, ⌘⌥W: the next 7 days as a block. ⌘⌥U refreshes it later.
- [ ] The **tags** section is a form too (**pim/Tags.eeform**): click *#work* — the notes that have it are listed; click one to open it. In a note, on an empty line, ⌘⌥B and type `work`: a block of `[[links]]` to those notes. ⌘⌥U refreshes it after you tag another note.
- [ ] Write your own: a line `<!-- eel: (str "Items: " (item-count)) -->` and a line `<!-- /eel -->` under it, then ⌘⌥U.

## 11 · Clocking time

- [ ] In today's note, caret on a task (or a heading), ⌘⌥I: *⏱ …*.
- [ ] ⌘⌥K: what's running and for how long. ⌘⌥O: *Stopped … — N min*. A linked task also records the time on its agenda item.

## 12 · The life tracker

- [ ] In today's `## Log`, caret on `coffee 1`, ⌘⌥L: it becomes `- HH:MM  coffee 1 un` and is in the tracker. ⌘⌥L again: *Already logged*.
- [ ] ⌘⌥C anywhere: *Logged coffee 1 un*.
- [ ] On an empty line, ⌘⌥R: today's log as a block.

## 13 · Archive and the weekly review

- [ ] In today's note, ⌘⌥X: the `- [x]` lines move under `## Archive` at the end. With none: *No finished tasks here*.
- [ ] ⌘⌥V: **reviews/… week.md** opens, filled in — done this week, time, tracker, the next 7 days, undated items, and questions to answer.

## 14 · Change the config

- [ ] ⌘⇧K, find `(def pim-remind-grace 60)` and make it `30`, ⌘S: the toast says *Keybindings reloaded — N shortcuts*. No restart.
- [ ] Add a key of your own at the end: `(bind "Mod-Alt-y" (ed-message "hello"))`, ⌘S, ⌘⌥Y.

## 15 · The REPL (⌘J)

- [ ] `(notes)` — every note. `(read-note "inbox.md")` — one note's text.
- [ ] `(show pim-overdue)` — a saved view. `(items)` — every item.
- [ ] `(browse log)` and `(browse clock)` — the tracker and the clock as tables.

---

## When something doesn't work

| What you see | Why, and what to do |
|---|---|
| No ⌘⌥ key does anything | Section 0: the app's build, another app, or the config. |
| ⌘J, ⌘P, ⌘S do nothing either | The config replaced the app's keys. Keep the `Mod-…` binds at the top of .eeditor/keybindings.eelisp. |
| *Not an agenda task — ⌘⌥T makes it one* | ⌘⌥E and ⌘⌥G need a line with a `{#id}`. ⌘⌥T (or ⌘⌥A on a `- [ ]`) links it first. |
| *#12 isn't in the agenda any more* | The item was deleted in the agenda; the line kept its id. Delete the `{#12}` and ⌘⌥T. |
| *Put the caret on a task or a heading first* | ⌘⌥I needs something to clock. |
| A note didn't tick after finishing an item | The tick runs on the minute — wait, or ⌘⌥S. |
| The reminder never came | It fires only while the app is open, up to `pim-remind-grace` minutes late. |
| The dates look wrong | The sample was made on another day. Make it again (below). |

**Start over:** make a new, empty folder, open it with **⋯ → Open another folder…**, and say yes to the sample notes.
