// A sample workspace for the PIM (docs/PIM.md) with something in every part of it, to try it by hand:
// an agenda with overdue, today, upcoming, repeating, undated and inbox items, a reminder a few
// minutes away, notes whose tasks are linked to those items, a tracker and a clock with history,
// a dashboard of blocks, and "TRY ME.md" — a walkthrough of every key.
//
//   npm run pim:sample                 → ./pim-sample
//   npm run pim:sample -- ~/pim-demo   → there
//
// Then open that folder as the workspace (open… in the app). Dates are relative to the day it's
// made, so make it again on the day you try it: it starts from scratch each time.

import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { clockDefs, lispString, parseKeybindings } from "../src/core/keybindings";

const root = fileURLToPath(new URL("..", import.meta.url));
const BIN = process.env.EELISP_BIN ?? path.join(root, "../eelisp-rs/target/release/eelisp");
const out = path.resolve(process.argv[2] ?? "pim-sample");

type Env = { ok: boolean; result: unknown; error?: string };

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, ".eeditor"), { recursive: true });

const child = spawn(BIN, ["--serve", "--db", path.join(out, ".eeditor/eeditor.db"), "--workspace", out], {
  stdio: ["pipe", "pipe", "inherit"],
});
const rl = readline.createInterface({ input: child.stdout });
const waiting: ((e: Env) => void)[] = [];
rl.on("line", (l) => waiting.shift()?.(JSON.parse(l)));
const raw = (src: string) => new Promise<Env>((res) => (waiting.push(res), child.stdin.write(JSON.stringify({ src }) + "\n")));
/** Evaluate with the context a key press would have (no note in front). */
async function ev(src: string): Promise<unknown> {
  const env = await raw(`(def *file* "")\n${clockDefs()}\n${src}`);
  if (!env.ok) throw new Error(`${src.slice(0, 80)} → ${env.error}`);
  return env.result;
}
const str = async (src: string) => String(await ev(src));
const id = async (src: string) => Number(await ev(`(dict-get ${src} :id)`));

// ── the library, as the app would load it ──
const config = await readFile(path.join(root, "docs/pim/pim.eelisp"), "utf8");
const parsed = parseKeybindings(config, true);
await ev(await readFile(path.join(root, "src/keybindings/prelude.eelisp"), "utf8"));
for (const h of parsed.load) await ev(h.source);

const pad2 = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const TODAY = await str("*date*");
const day = (n: number) => str(`(date-add *date* ${n} :days)`);
const hm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const soon = new Date(now.getTime() + 3 * 60_000);
const nearMidnight = soon.getDate() !== now.getDate();

// ── the agenda ──
const passport = await id(`(item->dict (add-item "renew the passport" :when "${await day(-3)}" :priority 1))`);
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
const write = async (p: string, text: string) => {
  await mkdir(path.dirname(path.join(out, p)), { recursive: true });
  await writeFile(path.join(out, p), text);
};
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

⌃⌥U refreshes every block below.

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

// "pay the gas bill" in a note, finished in the agenda already: the first tick (or ⌃⌥S) ticks it here
const gas = await id(`(item->dict (add "pay the gas bill"))`);
await write("bills.md", `# Bills\n\n- [ ] pay the gas bill {#${gas}}\n- [ ] send the invoice in 3 days #work/admin | ask for the PDF {#${invoice}}\n`);
await ev(`(item-done ${gas})`);

await write("TRY ME.md", `# Trying the PIM

Made ${TODAY} at ${hm(now)} by \`npm run pim:sample\`. Every step says what to press and what should
happen. ⌃⌥ is Control+Option. The REPL is ⌘J. Guide: docs/PIM.md in the repo.

## Live sync and every note at once

- [ ] Wait for the next minute: **bills.md** gets \`pay the gas bill\` ticked (it was finished in the agenda already). Open it to see — the tick runs once a minute.
- [ ] In the agenda panel, mark *design the landing page* done. Within a minute it's ticked in **projects/site.md**.
- [ ] ⌃⌥S anywhere: *write the spec* and *pick the fonts* in **projects/site.md** become agenda items (\`projects\` is in \`pim-agenda-files\`, set at the bottom of the config). A toast says how many notes changed.
- [ ] Type \`- [ ] something\` in **inbox.md**, ⌃⌥S: it stays unlinked (inbox.md isn't an agenda file).

## Tasks in a note (today's note, ⌘D)

- [ ] On \`- [ ] fix the bike\`, ⌃⌥T twice: ticked, then plain. ⌃⌥T again: it's an agenda item with a \`{#id}\`.
- [ ] On it, ⌃⌥D, type \`in 3 days\`, Enter: the toast gives the date; the agenda panel agrees. ⌃⌥D \`none\` takes it away; \`whenever\` is refused.
- [ ] On it, ⌃⌥G: the categories are offered as you type; pick \`home\` or type a new one.
- [ ] ⌃⌥P cycles \`!!!\` → \`!!\` → \`!\` → none, and the item's priority follows.
- [ ] On *water the plants* (repeats weekly), ⌃⌥T: it stays open and its \`{#id}\` moves to next week's.
- [ ] Edit *pay the rent today* to *pay the rent tomorrow*, ⌃⌥A: the item moves to tomorrow.

## Reminders

- [ ] ${ana ? `At **${hm(soon)}**, *call Ana* notifies you (a toast; a system notification if EEditor isn't in front).` : "It was too close to midnight to set one up — see the next line."}
- [ ] Your own: in the REPL, \`(item-set ${rent} :remind "HH:MM")\` with a time a minute or two ahead.

## Capture, refile

- [ ] ⌃⌥N, *inbox*, \`ask about the boiler\`, Enter: a line appears under \`## Inbox\` in **inbox.md**, linked.
- [ ] ⌃⌥N, *log*, \`water 2 glass\`: under \`## Log\` in today's note. *task*: under \`## Tasks\`.
- [ ] In **inbox.md**, on *look into solar panels*, ⌃⌥F, type \`home\`, pick \`projects/home.md › ## Someday\`: the line moves there.

## Blocks, clock, tracker, notes

- [ ] Open **dashboard.md**, ⌃⌥U: every block is recomputed.
- [ ] ⌃⌥W in any note: the next 7 days as a block.
- [ ] On a task or a heading, ⌃⌥I clocks in; ⌃⌥K says what's running; ⌃⌥O stops it.
- [ ] In today's Log, on \`coffee 1\`, ⌃⌥L: it's logged with the time. ⌃⌥C logs a coffee; ⌃⌥R puts today's log at the caret.
- [ ] ⌃⌥X moves the \`- [x]\` lines to \`## Archive\` at the end of the note.
- [ ] ⌃⌥V opens this week's review, filled in.

## The config itself

- [ ] ⌘⇧K, change \`pim-remind-grace\` (or anything in the library), ⌘S: it takes effect without a restart.
- [ ] In the REPL: \`(notes)\`, \`(read-note "inbox.md")\`, \`(show pim-overdue)\`, \`(browse log)\`.
`);

// ── the config: the PIM, then the sample's own settings and start page ──
await write(".eeditor/keybindings.eelisp", `${config}
;; ── this sample ──────────────────────────────────────────────────────────────
;; Later forms win (on-start) or add up (on-load): projects/ is an agenda file, and EEditor opens
;; on the walkthrough instead of today's note.
(on-load (set! pim-agenda-files (list "projects")))
(on-start (ed-open "TRY ME.md"))
`);
await mkdir(path.join(out, "pim"), { recursive: true });
await copyFile(path.join(root, "docs/pim/Capture.eeform"), path.join(out, "pim/Capture.eeform"));

const items = await ev("(item-count)");
child.stdin.end();
await new Promise((res) => child.on("exit", res));
console.log(`PIM sample: ${out}
  ${items} agenda items (overdue ${passport ? 1 : 0}, ${ana ? `a reminder at ${hm(soon)}, ` : ""}repeating, inbox, undated…), notes, history
  Open that folder as the workspace (open… in EEditor) and start with "TRY ME.md".`);
