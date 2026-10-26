// A sample workspace for the PIM (docs/PIM.md) with something in every part of it, to try it by hand:
// an agenda with overdue, today, upcoming, repeating, undated and inbox items, a reminder a few
// minutes away, notes whose tasks are linked to those items, a tracker and a clock with history,
// a dashboard of blocks, and "TRY ME.md" — a tutorial: a setup check, every key, a lesson per
// feature with what you should see, and what to do when something doesn't work.
//
// Two ways in, one recipe: `npm run pim:sample` (scripts/pim-sample.ts, on the engine binary) and
// the app's *Add sample notes* (src/samples/workspace.ts, on the app's own engine). Either way the
// host's engine must already have the sample folder's database open. Dates are relative to the day
// it's made, so make it again on the day you try it.

import CONFIG from "../../docs/pim/pim.eelisp?raw";
import CAPTURE from "../../docs/pim/Capture.eeform?raw";
import PRELUDE from "../keybindings/prelude.eelisp?raw";
import DEFAULTS from "../keybindings/default.eelisp?raw";
import { clockDefs, lispString, parseKeybindings } from "../core/keybindings";
import { pimBlock } from "../core/pim-install";

export interface PimSampleHost {
  /** Evaluate on the sample's engine: the value, or throw with the engine's error. */
  eval(src: string): Promise<unknown>;
  /** Write a file relative to the sample's root, its folders created as needed. */
  write(path: string, text: string): Promise<void>;
}

export interface PimSampleOptions {
  /** Who made it, for the tutorial's first lines — `npm run pim:sample` or the app. */
  by: "script" | "app";
  /** The note EEditor opens at launch. */
  startPage?: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Every file the sample writes, so a caller can make sure none of them is there already. */
export function pimSamplePaths(now: Date = new Date()): string[] {
  return [`${ymd(now)}.md`, "inbox.md", "bills.md", "dashboard.md", "projects/site.md", "projects/home.md",
    "TRY ME.md", "pim/Capture.eeform", ".eeditor/keybindings.eelisp"];
}

/** Fill the agenda and write the notes. Returns how many agenda items there are now. */
export async function makePimSample(host: PimSampleHost, opts: PimSampleOptions): Promise<number> {
  /** Evaluate with the context a key press would have (no note in front). */
  const ev = (src: string) => host.eval(`(def *file* "")\n${clockDefs()}\n${src}`);
  const str = async (src: string) => String(await ev(src));
  const id = async (src: string) => Number(await ev(`(dict-get ${src} :id)`));
  const write = host.write;
  const startPage = opts.startPage ?? "TRY ME.md";
  const madeBy = opts.by === "app" ? "EEditor's *Add sample notes*" : "`npm run pim:sample`";

  // ── the library, as the app would load it ──
  const parsed = parseKeybindings(CONFIG, true);
  await ev(PRELUDE);
  for (const h of parsed.load) await ev(h.source);

  const now = new Date();
  const TODAY = await str("*date*");
  const day = (n: number) => str(`(date-add *date* ${n} :days)`);
  const hm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const soon = new Date(now.getTime() + 3 * 60_000);
  const nearMidnight = soon.getDate() !== now.getDate();

  // ── the agenda ──
  await id(`(item->dict (add-item "renew the passport" :when "${await day(-3)}" :priority 1))`);
  const rent = await id(`(pim-add "!!! pay the rent today" (list "home"))`);
  const ana = nearMidnight ? 0 : await id(`(pim-add "call Ana at ${hm(soon)} today about the flat" (list))`);
  const dentist = await id(`(pim-add "dentist tomorrow !! #health | bring the X-rays" (list))`);
  const invoice = await id(`(pim-add "send the invoice in 3 days #work/admin | ask for the PDF" (list))`);
  const plants = await id(`(item->dict (add-item "water the plants" :when "${TODAY}"))`);
  await ev(`(item-set ${plants} :recurrence (every 1 :weeks))`);
  const cello = await id(`(pim-add "learn the cello" (list))`);
  const solar = await id(`(pim-add "look into solar panels" (list "inbox"))`);
  const insurance = await id(`(pim-add "renew the car insurance" (list "inbox"))`);
  const design = await id(`(pim-add "design the landing page #work" (list))`);
  const domain = await id(`(pim-add "renew the domain #work/admin" (list))`);
  await ev(`(defrule sample-bills :when (str-contains (str-lower text) "invoice") :assign "money")`);
  await ev(`(apply-rules ${invoice})`);

  // ── history: what the review, the reports and the streaks read ──
  for (const [n, kind, item, qty, unit] of [
    [-2, "exercise", "run", 25, "min"], [-1, "exercise", "walk", 40, "min"], [-1, "drink", "coffee", 3, "un"],
    [-1, "sleep", "sleep", 7, "h"], [0, "drink", "coffee", 2, "un"], [0, "exercise", "yoga", 20, "min"],
  ] as const) {
    const d = await day(n);
    await ev(`(insert log (dict :at "${d} 08:${pad2(10 + qty)}:00" :day "${d}" :kind "${kind}" :item "${item}" :qty ${qty} :unit "${unit}" :note ""))`);
  }
  for (const [n, task, mins] of [[-1, "Write the report", 95], [-1, "review the budget", 40], [0, "Write the report", 50]] as const) {
    const d = await day(n);
    await ev(`(insert clock (dict :task "${task}" :item 0 :file "projects/site.md" :day "${d}" :start 0 :stop 1 :mins ${mins}))`);
  }
  for (const [n, task] of [[-2, "book the train"], [-1, "pay the gas bill"], [-1, "call the bank"]] as const) {
    const d = await day(n);
    await ev(`(insert done (dict :at "${d} 17:00:00" :day "${d}" :task "${task}" :item 0 :file "${d}.md"))`);
  }

  // ── notes ──
  const daily = String(await ev("(pim-daily-template *date*)")).replace(
    "## Log\n\n\n",
    `## Tasks\n\n- [ ] !!! pay the rent today #home {#${rent}}\n${ana ? `- [ ] call Ana at ${hm(soon)} today about the flat {#${ana}}\n` : ""}- [ ] water the plants {#${plants}}\n- [ ] fix the bike\n\n## Log\n\n- 08:12  coffee 2 un\n- 08:30  yoga 20 min\ncoffee 1\n\n`,
  );
  await write(`${TODAY}.md`, daily);
  await write("inbox.md", `# Inbox\n\n## Inbox\n\n- [ ] look into solar panels {#${solar}}\n- [ ] renew the car insurance {#${insurance}}\n`);
  await write("projects/site.md",
    `# The new site\n\n## Tasks\n\n- [ ] design the landing page #work {#${design}}\n- [ ] renew the domain #work/admin {#${domain}}\n- [ ] write the spec\n- [ ] pick the fonts\n\n## Later\n\n- the blog can wait\n`);
  await write("projects/home.md", `# Home\n\n## Errands\n\n- [ ] dentist tomorrow !! #health | bring the X-rays {#${dentist}}\n\n## Someday\n\n- [ ] learn the cello {#${cello}}\n`);
  await write("dashboard.md", `# Dashboard

⌘⌥U refreshes every block below.

## Next 7 days

${await str('(pim-block "(pim-agenda 7)")')}

## Inbox

${await str('(pim-block "(pim-inbox)")')}

## Work

${await str('(pim-block "(pim-category \\"work\\")")')}

## This week

${await str(`(pim-block "(pim-done-report \\"${await day(-6)}\\" \\"${TODAY}\\")")`)}

${await str(`(pim-block "(pim-clock-report \\"${await day(-6)}\\" \\"${TODAY}\\")")`)}

${await str(`(pim-block "(pim-track-report \\"${await day(-6)}\\" \\"${TODAY}\\")")`)}

## Streaks

${await str(`(pim-block "(str \\"Exercise: \\" (pim-streak \\"exercise\\") \\" days in a row\\")")`)}
`);

  // "pay the gas bill" in a note, finished in the agenda already: the first tick (or ⌘⌥S) ticks it here
  const gas = await id(`(item->dict (add "pay the gas bill"))`);
  await write("bills.md", `# Bills\n\n- [ ] pay the gas bill {#${gas}}\n- [ ] send the invoice in 3 days #work/admin | ask for the PDF {#${invoice}}\n`);
  await ev(`(item-done ${gas})`);

  // what the reminder lesson says depends on whether there was time to set one up before midnight
  const remindStep = ana
    ? `At **${hm(soon)}**, *call Ana* notifies you: a toast, or a system notification if EEditor isn't in front. (Leave the app open.)`
    : "It was too close to midnight to set one up when this was made — try the next step instead.";

  await write("TRY ME.md", `# PIM tutorial

A hands-on tour of the PIM in this workspace: every key, what it should do, and what to check when it
doesn't. Made ${TODAY} at ${hm(now)} by ${madeBy}; the dates in the notes are relative to
that day, so make the workspace again on the day you try it. The full guide is docs/PIM.md in the repo.
The rest of the app is here too: **examples/** has the example forms and **EEditor.mindmap.md** — every
shortcut and the EELisp dialect, drawn as a mind map.

**How to read this.** ⌘⌥T means hold **Command** and **Option** together, then press **T** (Ctrl+Alt on Windows and Linux). The *caret*
is the text cursor: most keys act on the line it's on. A *toast* is the short message that appears at
the bottom of the window. Tick the boxes here as you go — this note is only a checklist; nothing reads it.

---

## 0 · Check your setup first (2 minutes)

The keys only work in a build of EEditor that has the PIM, with this folder open as the workspace.

- [ ] The window's file tree shows **dashboard.md**, **inbox.md**, **bills.md**, **projects/** and today's note. If not, use **folder…** above the tree and pick this folder.
- [ ] ⌘J opens the REPL. Type \`(notes)\` and press Enter: you get a list of the notes here. *Undefined symbol: notes* means the app was built before the PIM — rebuild it (below).
- [ ] ⌘⌥K anywhere in a note: the toast says **No clock running**. That proves the PIM's keys are live.
- [ ] Open **.eeditor/keybindings.eelisp** with ⌘⇧K. This file *is* the shortcut table: the app's own keys at the top, the PIM library below, this sample's two settings at the end.

**If ⌘⌥K does nothing:**

1. **The app is too old.** The PIM landed on 2026-10-05; an app built before that has none of it. From the repo: \`git pull\`, then \`(cd ../eelisp-rs && git pull)\` — the app compiles the engine from that checkout — then \`npm run tauri build\`, and copy \`src-tauri/target/release/bundle/macos/eeditor-next.app\` over the one in /Applications.
2. **Another app took the key.** Window managers and launchers sometimes claim ⌘⌥ + a letter for the whole system; quit the app or change its shortcut.
3. **The config didn't load.** A toast says *keybindings: N problem(s)*; open the REPL (⌘J) to see which line. Save the file again (⌘S) after fixing it — it reloads on every save.
4. **The caret isn't in a note.** Click into the text first. Keys pressed while the agenda or a form has focus go there.

---

## Every key

| Key | What it does | Where the caret should be |
|---|---|---|
| ⌘D | Today's note, from the template (created if missing) | anywhere |
| ⌘⌥T | Cycle a line: text → agenda task \`- [ ] … {#id}\` → done \`- [x] … ✓ date\` → plain \`- …\` | on the line |
| ⌘⌥P | Priority \`!!!\` → \`!!\` → \`!\` → none | on a task |
| ⌘⌥A | Re-read the line into its agenda item (date, priority, tags, notes); links a hand-typed \`- [ ]\` | on a task |
| ⌘⌥E | Ask *When?* and set the date (\`tomorrow\`, \`in 3 days\`, \`2026-12-01\`, \`none\`) | on a linked task |
| ⌘⌥G | Ask *Category* and file the item under it | on a linked task |
| ⌘⌥S | Bring every note in step with the agenda now (the minute tick does it too) | anywhere |
| ⌘⌥N | Capture window: a task, an inbox item or a log line | anywhere |
| ⌘⌥F | Refile the line under a heading of another note | on the line |
| ⌘⌥W | Insert the next 7 days as a block | where you want it |
| ⌘⌥U | Recompute every block in this note | anywhere in the note |
| ⌘⌥I / ⌘⌥O / ⌘⌥K | Clock in on the task or heading / clock out / what's running | on a task or heading (⌘⌥I) |
| ⌘⌥L | Log the line (\`coffee 1\`, \`run 30 min\`) in the tracker | on the line |
| ⌘⌥C | Log a coffee | anywhere |
| ⌘⌥R | Insert today's log as a block | where you want it |
| ⌘⌥X | Move the \`- [x]\` lines to \`## Archive\` at the end | anywhere in the note |
| ⌘⌥V | Open this week's review, filled in | anywhere |

The app's own keys still work: ⌘P quick-open, ⌘⇧F search, ⌘E preview, ⌘J REPL, ⌘S save.

---

## 1 · A look around

- [ ] The **agenda** section in the sidebar lists the items: *renew the passport* is overdue, *pay the rent today* is today and urgent, *dentist tomorrow* is tomorrow. The 📅 button above it opens the calendar; ⚙ opens rules & categories.
- [ ] ⌘D opens today's note (**${TODAY}.md**). Its tasks end in \`{#12}\`-style ids: each one *is* an agenda item, shown in the note.
- [ ] ⌘P, type \`dash\`, Enter: **dashboard.md** — blocks of live results (next 7 days, inbox, work, this week's done/clock/tracker, a streak). ⌘E shows it as a page; ⌘E again to edit.

## 2 · Tasks in a note

In today's note (⌘D):

- [ ] Caret on \`- [ ] fix the bike\` (not linked yet: no \`{#id}\`). ⌘⌥T: it becomes \`- [x] fix the bike ✓ ${TODAY}\`. ⌘⌥T again: plain \`- fix the bike\`.
- [ ] ⌘⌥T once more: \`- [ ] fix the bike {#…}\` and a toast *Agenda #… (no date)*. It's in the agenda section now.
- [ ] Type a new line \`call the plumber tomorrow !! #home | ask about the boiler\`, ⌘⌥T: the agenda read the words — dated tomorrow, priority 2, category *home*, and the text after \` | \` became its notes. Click it in the agenda to see.

## 3 · Dates, categories, priority

On the *fix the bike* task from lesson 2:

- [ ] ⌘⌥E, type \`in 3 days\`, Enter: the toast gives the date; the agenda moves it. ⌘⌥E \`none\` takes the date away; ⌘⌥E \`whenever\` is refused (*isn't a date I know*).
- [ ] ⌘⌥G: the categories are offered as you type. Pick \`home\`, or type a new name to make one.
- [ ] ⌘⌥P four times: \`!!!\` → \`!!\` → \`!\` → none. The item's priority follows each time.
- [ ] Edit *pay the rent today* to *pay the rent tomorrow*, then ⌘⌥A: *Updated Agenda #${rent} on …* — the item moved to tomorrow.

## 4 · Repeating tasks

- [ ] On \`- [ ] water the plants {#${plants}}\` (repeats weekly), ⌘⌥T: it stays open and the toast says *Done — next one …* a week from today, and the line now links the next one (a new \`{#id}\`).

## 5 · The agenda and the notes stay in step

- [ ] Wait for the next minute, then open **bills.md**: \`pay the gas bill\` is ticked. It was finished in the agenda already; the once-a-minute tick brought the note in line.
- [ ] In the agenda section, mark *design the landing page* done. Within a minute it's ticked in **projects/site.md** (or ⌘⌥S to do it now).

## 6 · Agenda files: plain checkboxes become tasks

This sample makes \`projects/\` an agenda file (the last lines of the config).

- [ ] ⌘⌥S: *write the spec* and *pick the fonts* in **projects/site.md** get \`{#id}\`s and appear in the agenda. The toast says how many notes changed.
- [ ] In **inbox.md**, type \`- [ ] something\`, ⌘⌥S: it stays as it is — inbox.md isn't an agenda file.

## 7 · Reminders

- [ ] ${remindStep}
- [ ] Your own: ⌘J, then \`(item-set ${rent} :remind "HH:MM")\` with a time a minute or two ahead. Wait for it.

## 8 · Capture

- [ ] ⌘⌥N opens the capture window. Pick *inbox*, type \`ask about the boiler\`, Enter: a linked line appears under \`## Inbox\` in **inbox.md**, and the item is in the agenda under *inbox*.
- [ ] ⌘⌥N, *log*, \`water 2 glass\`, Enter: under \`## Log\` in today's note, and in the tracker. *task* goes under \`## Tasks\`.

## 9 · Refile

- [ ] In **inbox.md**, caret on *look into solar panels*, ⌘⌥F, type \`home\`, pick \`projects/home.md › ## Someday\`, Enter: the line moves there, still linked.

## 10 · Blocks and the dashboard

- [ ] In **dashboard.md**, ⌘⌥U: every block between \`<!-- eel: … -->\` and \`<!-- /eel -->\` is recomputed. What you did above shows up: fewer items in *Inbox*, today's done tasks in *This week*.
- [ ] In any note, on an empty line, ⌘⌥W: the next 7 days as a block. ⌘⌥U refreshes it later.
- [ ] Write your own: a line \`<!-- eel: (str "Items: " (item-count)) -->\` and a line \`<!-- /eel -->\` under it, then ⌘⌥U.

## 11 · Clocking time

- [ ] In today's note, caret on a task (or a heading), ⌘⌥I: *⏱ …*.
- [ ] ⌘⌥K: what's running and for how long. ⌘⌥O: *Stopped … — N min*. A linked task also records the time on its agenda item.

## 12 · The life tracker

- [ ] In today's \`## Log\`, caret on \`coffee 1\`, ⌘⌥L: it becomes \`- HH:MM  coffee 1 un\` and is in the tracker. ⌘⌥L again: *Already logged*.
- [ ] ⌘⌥C anywhere: *Logged coffee 1 un*.
- [ ] On an empty line, ⌘⌥R: today's log as a block.

## 13 · Archive and the weekly review

- [ ] In today's note, ⌘⌥X: the \`- [x]\` lines move under \`## Archive\` at the end. With none: *No finished tasks here*.
- [ ] ⌘⌥V: **reviews/… week.md** opens, filled in — done this week, time, tracker, the next 7 days, undated items, and questions to answer.

## 14 · Change the config

- [ ] ⌘⇧K, find \`(def pim-remind-grace 60)\` and make it \`30\`, ⌘S: the toast says *Keybindings reloaded — N shortcuts*. No restart.
- [ ] Add a key of your own at the end: \`(bind "Mod-Alt-y" (ed-message "hello"))\`, ⌘S, ⌘⌥Y.

## 15 · The REPL (⌘J)

- [ ] \`(notes)\` — every note. \`(read-note "inbox.md")\` — one note's text.
- [ ] \`(show pim-overdue)\` — a saved view. \`(items)\` — every item.
- [ ] \`(browse log)\` and \`(browse clock)\` — the tracker and the clock as tables.

---

## When something doesn't work

| What you see | Why, and what to do |
|---|---|
| No ⌘⌥ key does anything | Section 0: the app's build, another app, or the config. |
| ⌘J, ⌘P, ⌘S do nothing either | The config replaced the app's keys. Keep the \`Mod-…\` binds at the top of .eeditor/keybindings.eelisp. |
| *Not an agenda task — ⌘⌥T makes it one* | ⌘⌥E and ⌘⌥G need a line with a \`{#id}\`. ⌘⌥T (or ⌘⌥A on a \`- [ ]\`) links it first. |
| *#12 isn't in the agenda any more* | The item was deleted in the agenda; the line kept its id. Delete the \`{#12}\` and ⌘⌥T. |
| *Put the caret on a task or a heading first* | ⌘⌥I needs something to clock. |
| A note didn't tick after finishing an item | The tick runs on the minute — wait, or ⌘⌥S. |
| The reminder never came | It fires only while the app is open, up to \`pim-remind-grace\` minutes late. |
| The dates look wrong | The sample was made on another day. Make it again (below). |

${opts.by === "app"
    ? "**Start over:** make a new, empty folder, open it with **folder…**, and say yes to the sample notes."
    : "**Start over:** `npm run pim:sample -- ~/pim-demo` from the repo. It deletes that folder first —\nanything you wrote there goes too."}
`);

  // ── the config: the app's own keys, the PIM, then the sample's settings and start page ──
  // The workspace's file replaces the bundled defaults outright, so they go first — what docs/PIM.md's
  // install step does by appending. Without them ⌘J, ⌘P, ⌘S and ⌘⇧K would do nothing here.
  await write(".eeditor/keybindings.eelisp", `${DEFAULTS}
${pimBlock(CONFIG)}
;; ── this sample ──────────────────────────────────────────────────────────────
;; Later forms win (on-start) or add up (on-load): projects/ is an agenda file, and EEditor opens
;; on ${startPage} instead of today's note.
(on-load (set! pim-agenda-files (list "projects")))
(on-start (ed-open ${lispString(startPage)}))
`);
  await write("pim/Capture.eeform", CAPTURE);

  return Number(await ev("(item-count)"));
}
