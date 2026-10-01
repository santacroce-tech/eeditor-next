// Checks docs/pim/pim.eelisp — the PIM keybindings from docs/PIM.md — against the real engine.
// Run: npx vite-node dev/pim-check.ts
//
// It does what the app does: parses the config with core/keybindings.ts, loads the ed-* prelude,
// runs (on-start …), then for each "key press" defines the same *context* ui/keybindings.ts does
// and applies the editor commands that come back to a document held here — offsets in UTF-16,
// like CodeMirror's. Only the DOM is missing.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { parseKeybindings, lispString, type Binding } from "../src/core/keybindings";

const root = fileURLToPath(new URL("..", import.meta.url));
const BIN = process.env.EELISP_BIN ?? path.join(root, "../eelisp-rs/target/release/eelisp");

type Env = { ok: boolean; result: unknown; output?: string; error?: string };

function serve(args: string[]) {
  const child = spawn(BIN, ["--serve", ...args], { stdio: ["pipe", "pipe", "inherit"] });
  const rl = readline.createInterface({ input: child.stdout });
  const q: ((e: Env) => void)[] = [];
  rl.on("line", (l) => q.shift()?.(JSON.parse(l)));
  return {
    ev: (src: string) => new Promise<Env>((res) => (q.push(res), child.stdin.write(JSON.stringify({ src }) + "\n"))),
    close: () => new Promise((res) => (child.on("exit", res), child.stdin.end())),
  };
}

let total = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  total++;
  if (cond) console.log("  ok  ", name);
  else {
    failed++;
    console.error("  FAIL", name, detail === undefined ? "" : JSON.stringify(detail));
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const d = new Date();
const TODAY = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// ── a document, edited the way ui/keybindings.ts edits CodeMirror's ──
const doc = { file: "", text: "", cursor: 0, messages: [] as string[], opened: [] as unknown[][], forms: [] as string[] };

function context(b: { source: string }): string {
  const lineFrom = doc.text.lastIndexOf("\n", doc.cursor - 1) + 1;
  const lineEnd = doc.text.indexOf("\n", doc.cursor);
  const lineText = doc.text.slice(lineFrom, lineEnd === -1 ? undefined : lineEnd);
  const now = new Date();
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const defs = [
    `(def *file* ${lispString(doc.file)})`,
    `(def *cursor* ${doc.cursor})`,
    `(def *line* ${doc.text.slice(0, doc.cursor).split("\n").length})`,
    `(def *col* ${doc.cursor - lineFrom + 1})`,
    `(def *line-text* ${lispString(lineText)})`,
    `(def *lines* ${doc.text.split("\n").length})`,
    `(def *sel-from* ${doc.cursor})`,
    `(def *sel-to* ${doc.cursor})`,
    `(def *date* ${lispString(date)})`,
    `(def *time* ${lispString(time)})`,
    `(def *now* ${lispString(`${date} ${time}:${pad2(now.getSeconds())}`)})`,
  ];
  if (b.source.includes("*selection*")) defs.push(`(def *selection* "")`);
  if (b.source.includes("*buffer*")) defs.push(`(def *buffer* ${lispString(doc.text)})`);
  return defs.join("\n");
}

const COMMANDS = new Set(["command", "insert", "insert-at", "goto", "goto-line", "select", "replace",
  "replace-range", "set-buffer", "open", "new", "form", "export", "message"]);

function exec(name: string, a: unknown[]): void {
  const pos = (v: unknown) => Math.max(0, Math.min(Number(v) || 0, doc.text.length));
  const s = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));
  switch (name) {
    case "insert":
      doc.text = doc.text.slice(0, doc.cursor) + s(a[0]) + doc.text.slice(doc.cursor);
      doc.cursor += s(a[0]).length;
      break;
    case "replace-range": {
      const from = pos(a[0]);
      const to = Math.max(from, pos(a[1]));
      doc.text = doc.text.slice(0, from) + s(a[2]) + doc.text.slice(to);
      doc.cursor = from + s(a[2]).length;
      break;
    }
    case "set-buffer":
      doc.text = s(a[0]);
      doc.cursor = Math.min(doc.cursor, doc.text.length);
      break;
    case "goto":
      doc.cursor = pos(a[0]);
      break;
    case "message":
      doc.messages.push(s(a[0]));
      break;
    case "new":
    case "open":
    case "command":
      doc.opened.push([name, ...a]);
      break;
    case "form":
      doc.forms.push(s(a[0]));
      break;
  }
}
function apply(v: unknown): void {
  if (!Array.isArray(v) || v.length === 0) return;
  if (typeof v[0] === "string" && COMMANDS.has(v[0])) return exec(v[0], v.slice(1));
  for (const x of v) apply(x);
}

// ── setup ──
const dir = await mkdtemp(path.join(tmpdir(), "pim-check-"));
const engine = serve(["--db", path.join(dir, "eeditor.db"), "--workspace", dir]);
const config = await readFile(path.join(root, "docs/pim/pim.eelisp"), "utf8");
const parsed = parseKeybindings(config, true);
check("config parses without errors", parsed.errors.length === 0, parsed.errors);
check("config has an (on-start …)", !!parsed.start);
const keys = new Map<string, Binding>(parsed.bindings.map((b) => [b.spec, b]));

const prelude = await engine.ev(await readFile(path.join(root, "src/keybindings/prelude.eelisp"), "utf8"));
check("prelude loads", prelude.ok, prelude.error);

async function run(b: { source: string }, label: string): Promise<Env> {
  doc.messages = [];
  const env = await engine.ev(`${context(b)}\n${b.source}`);
  if (!env.ok) console.error(`       ${label}: ${env.error}`);
  else apply(env.result);
  return env;
}
async function press(spec: string): Promise<Env> {
  const b = keys.get(spec);
  if (!b) throw new Error(`no binding ${spec}`);
  return run(b, spec);
}
/** Put `text` in the document with the caret at the end of line `n` (1-based). */
function setDoc(text: string, n: number): void {
  doc.text = text;
  const lines = text.split("\n");
  doc.cursor = lines.slice(0, n).join("\n").length;
}
const lineAt = (n: number) => doc.text.split("\n")[n - 1];
const ev = async (src: string) => { const e = await engine.ev(src); if (!e.ok) console.error("       eval:", src.slice(0, 60), "→", e.error); return e.result; };

// ── on-start ──
const start = await run(parsed.start!, "on-start");
check("on-start runs", start.ok, start.error);
check("on-start opens today's note from the template",
  doc.opened.some((c) => c[0] === "new" && c[1] === `${TODAY}.md` && String(c[2]).includes("## Agenda")), doc.opened);
check("tables exist", JSON.stringify(await ev("(tables)")).match(/clock|done|log/g)?.length === 3, await ev("(tables)"));

// ── TODO cycling ──
doc.file = "todo.md";
setDoc("# Things\n\n  buy milk\nafter", 3);
const ids = async () => (await ev("(pim-live-ids)")) as number[];
await press("Ctrl-Alt-t");
const milk = Number(/\{#(\d+)\}$/.exec(lineAt(3))?.[1]);
check("text → - [ ] {#id} (indent kept)", lineAt(3) === `  - [ ] buy milk {#${milk}}`, lineAt(3));
check("…and the task is an agenda item — what the panel's (items) lists", (await ids()).includes(milk) &&
  (await ev(`(field-get (first (records (items :search "milk"))) :text)`)) === "buy milk");
check("…with a message saying so", doc.messages[0] === `Agenda #${milk} (no date)`, doc.messages);
await press("Ctrl-Alt-t");
check("- [ ] → - [x] … ✓ date", lineAt(3) === `  - [x] buy milk {#${milk}} ✓ ${TODAY}`, lineAt(3));
check("…and it's done in the agenda", !(await ids()).includes(milk));
check("the finished task is in the done log, with its item", (await ev(`(count-records done :where "task = ? AND item = ?" :params (list "buy milk" ${milk}))`)) === 1);
await press("Ctrl-Alt-t");
check("- [x] → - (stamp and link dropped)", lineAt(3) === "  - buy milk", lineAt(3));
await press("Ctrl-Alt-t");
check("…and a new task from it is a new item", /^ {2}- \[ \] buy milk \{#\d+\}$/.test(lineAt(3)) && !lineAt(3).includes(`{#${milk}}`), lineAt(3));
check("the lines around are untouched", lineAt(1) === "# Things" && lineAt(4) === "after", doc.text);

setDoc("- 🍕 pizza night\nnext line", 1);
await press("Ctrl-Alt-t");
check("an emoji on the line doesn't eat the next one", /^- \[ \] 🍕 pizza night \{#\d+\}\nnext line$/.test(doc.text), doc.text);

// ── the agenda's own machinery ──
await ev(`(defrule pim-test-bills :when (str-contains (str-lower text) "invoice") :assign "money")`);
setDoc("pay the invoice in 3 days urgent #work/admin | ask for the PDF", 1);
await press("Ctrl-Alt-t");
const inv = Number(/\{#(\d+)\}$/.exec(lineAt(1))?.[1]);
const invd = JSON.stringify(await ev(`(item->dict (item-get ${inv}))`));
check("a task: smart-parsed date and priority", invd.includes(String(await ev(`(date-add "${TODAY}" 3 :days)`))) && invd.includes('"1"'), invd);
check("…#tag → category, defined in the tree the ⚙ panel shows", invd.includes("work/admin") &&
  String(await ev("(categories)")).includes("work/admin"), await ev("(categories)"));
check("…your rules file it", invd.includes('"money"'), invd);
check("…text after | is its notes, and the tags are out of its text", invd.includes("ask for the PDF") &&
  (await ev(`(field-get (first (records (items :search "invoice"))) :text)`)) === "pay the invoice", invd);
check("…the line keeps what you wrote", lineAt(1) === `- [ ] pay the invoice in 3 days urgent #work/admin | ask for the PDF {#${inv}}`, lineAt(1));
check("(items :category \"work\") includes it", String(await ev(`(pim-category "work")`)).includes("pay the invoice"));

// edit the linked line, ⌃⌥A pushes it to the item
doc.text = doc.text.replace("in 3 days urgent", "in 2 weeks !!").replace("ask for the PDF", "PDF + receipt");
doc.cursor = 5;
await press("Ctrl-Alt-a");
const inv2 = JSON.stringify(await ev(`(item->dict (item-get ${inv}))`));
check("⌃⌥A on a linked line updates its item", inv2.includes(String(await ev(`(date-add "${TODAY}" 14 :days)`))) &&
  inv2.includes('"2"') && inv2.includes("PDF + receipt"), inv2);
check("…and says so", doc.messages[0]?.startsWith(`Updated Agenda #${inv} on`), doc.messages);
await press("Ctrl-Alt-p");
check("priority on a linked line changes the item", lineAt(1).startsWith("- [ ] !!! pay") &&
  JSON.stringify(await ev(`(item->dict (item-get ${inv}))`)).includes('["priority","1"]'), await ev(`(item->dict (item-get ${inv}))`));

// done in the agenda panel → ⌃⌥U ticks the line
await ev(`(item-done ${inv})`);
await press("Ctrl-Alt-u");
check("an item finished in the panel is ticked by ⌃⌥U", lineAt(1).startsWith("- [x] !!! pay the invoice") && lineAt(1).endsWith(`{#${inv}} ✓ ${TODAY}`), lineAt(1));
check("…and logged", (await ev(`(count-records done :where "item = ?" :params (list ${inv}))`)) === 1);
await press("Ctrl-Alt-u");
check("…once", (await ev(`(count-records done :where "item = ?" :params (list ${inv}))`)) === 1);
await press("Ctrl-Alt-a");
check("⌃⌥A on a line whose item is gone says so", doc.messages[0] === `#${inv} isn't in the agenda any more — ⌃⌥U ticks it here`, doc.messages);

// ── priority ──
setDoc("- [ ] call the bank", 1);
await press("Ctrl-Alt-p");
check("priority → !!!", lineAt(1) === "- [ ] !!! call the bank", lineAt(1));
await press("Ctrl-Alt-p");
await press("Ctrl-Alt-p");
check("→ !! → !", lineAt(1) === "- [ ] ! call the bank", lineAt(1));
await press("Ctrl-Alt-p");
check("→ none", lineAt(1) === "- [ ] call the bank", lineAt(1));

// ── agenda ──
setDoc("- [ ] dentist tomorrow !! #health", 1);
await press("Ctrl-Alt-a");
const m = /\{#(\d+)\}$/.exec(lineAt(1));
check("schedule links the line to an item", !!m, lineAt(1));
const id = m ? Number(m[1]) : 0;
const item = (await ev(`(item->dict (item-get ${id}))`)) as Record<string, unknown>;
const tomorrow = (await ev(`(date-add "${TODAY}" 1 :days)`)) as string;
const dict = (item as { $dict?: Record<string, unknown> }).$dict ?? item;
check("…dated tomorrow, priority 2, category health",
  JSON.stringify(dict).includes(tomorrow) && JSON.stringify(dict).includes('"health"') && JSON.stringify(dict).includes('"2"'), dict);


await ev(`(add-item "pay rent" :when "${TODAY}" :priority 1)`);
await ev(`(add-item "renew passport" :when "${await ev(`(date-add "${TODAY}" -3 :days)`)}")`);
await ev(`(add-item "learn the cello")`);
const week = (await ev("(pim-agenda 7)")) as string;
check("agenda: overdue first", week.startsWith("**Overdue**\n\n- [ ] renew passport"), week);
check("agenda: today's items aren't overdue", !week.split("— today")[0].includes("pay rent"), week);
check("the pim-overdue view is saved in the agenda", String(await ev("(views)")).includes("pim-overdue"));
check("agenda: today, with the !!! item", week.includes("— today**\n\n- [ ] !!! pay rent"), week);
check("agenda: tomorrow's dentist", week.includes("!! dentist"), week);
check("agenda lines link their item", /pay rent \{#\d+\}/.test(week), week);
check("someday lists the undated", String(await ev("(pim-someday)")).includes("learn the cello"));

// recurring: done in the note → the line stays open and points at the next one
await ev(`(add-item "water the plants" :when "${TODAY}")`);
const rid = (await ev(`(record-id (first (records (items :search "water"))))`)) as number;
await ev(`(item-set ${rid} :recurrence (every 1 :weeks))`);
setDoc(`- [ ] water the plants {#${rid}}`, 1);
await press("Ctrl-Alt-t");
const nid = /\{#(\d+)\}/.exec(lineAt(1))?.[1];
check("a repeating item stays open, linked to the next one", lineAt(1).startsWith("- [ ] water the plants {#") && Number(nid) !== rid, lineAt(1));
const nextWeek = await ev(`(date-add "${TODAY}" 1 :weeks)`);
check("…and says when", doc.messages[0] === `Done — next one ${nextWeek}`, doc.messages);

// ── dynamic blocks ──
setDoc("# Plan\n\n- [ ] ", 3);
await press("Ctrl-Alt-w");
check("⌃⌥W puts an agenda block on a bullet-only line", doc.text.startsWith("# Plan\n\n<!-- eel: (pim-agenda 7) -->\n**Overdue**") && doc.text.endsWith("<!-- /eel -->"), doc.text);
setDoc("# Plan\nsome words", 2);
doc.cursor = 9;
await press("Ctrl-Alt-w");
check("…or below a line that has words, whatever the caret", doc.text.startsWith("# Plan\nsome words\n<!-- eel: (pim-agenda 7) -->"), doc.text);
setDoc("# Plan\n\n", 3);
await press("Ctrl-Alt-w");
await ev(`(add-item "brand new thing" :when "${TODAY}")`);
doc.text = doc.text + "\nkept after\n<!-- eel: (+ 1 2) -->\nstale\n<!-- /eel -->\nend";
doc.cursor = 3;
await press("Ctrl-Alt-u");
check("⌃⌥U refreshes every block", doc.text.includes("brand new thing") && doc.text.includes("<!-- eel: (+ 1 2) -->\n3\n<!-- /eel -->\nend"), doc.text);
check("…and keeps the text between them", doc.text.includes("kept after") && doc.text.startsWith("# Plan\n\n<!-- eel:"), doc.text);
setDoc("a\n<!-- eel: (+ 2 2) -->\nb", 1);
await press("Ctrl-Alt-u");
check("a block with no closing marker gets one", doc.text === "a\n<!-- eel: (+ 2 2) -->\n4\n<!-- /eel -->\n\nb", doc.text);
await ev(`(set! pim-kinds (dict-set pim-kinds :kombucha "drink"))`);
check("the tracker learns a new thing", (await ev(`(pim-kind-of "kombucha")`)) === "drink");
setDoc("# Plan\n\n<!-- eel: (pim-agenda 7) -->\nold\n<!-- /eel -->\nkept after\n<!-- eel: (+ 1 2) -->\nstale\n<!-- /eel -->\nend", 1);
await press("Ctrl-Alt-u");
const before = doc.text;
await press("Ctrl-Alt-u");
check("refreshing is stable", doc.text === before);

// ── archive ──
setDoc("# Todo\n- [x] a ✓ 2026-01-01\n- [ ] b\n- [x] c ✓ 2026-01-02\n", 1);
await press("Ctrl-Alt-x");
check("⌃⌥X moves the done lines to ## Archive", doc.text === "# Todo\n- [ ] b\n\n## Archive\n\n- [x] a ✓ 2026-01-01\n- [x] c ✓ 2026-01-02\n", doc.text);
doc.text = doc.text.replace("- [ ] b", "- [x] b ✓ 2026-01-03");
await press("Ctrl-Alt-x");
check("…a second time, into the same section", (doc.text.match(/## Archive/g) ?? []).length === 1 && doc.text.includes("- [x] b ✓ 2026-01-03"), doc.text);

// ── clock ──
setDoc("## Write the report\n- [ ] !! review budget {#99}", 1);
await press("Ctrl-Alt-i");
check("clock in on a heading", doc.messages[0] === "⏱ Write the report", doc.messages);
doc.cursor = doc.text.length;
await press("Ctrl-Alt-i");
check("clock in on a task stops the other", doc.messages[0]?.startsWith("⏱ review budget  (stopped Write the report"), doc.messages);
await press("Ctrl-Alt-k");
check("status", doc.messages[0]?.startsWith("⏱ review budget — "), doc.messages);
await press("Ctrl-Alt-o");
check("clock out", doc.messages[0]?.startsWith("Stopped review budget"), doc.messages);
await press("Ctrl-Alt-o");
check("nothing to clock out", doc.messages[0] === "No clock running", doc.messages);
setDoc("- [ ] write the grant {#0}", 1);
doc.text = "write the grant";
doc.cursor = doc.text.length;
await press("Ctrl-Alt-t");
const grant = Number(/\{#(\d+)\}$/.exec(lineAt(1))?.[1]);
await press("Ctrl-Alt-i");
await ev(`(update clock (record-id (first (pim-running))) (dict :start (- (now) 1500)))`);
await press("Ctrl-Alt-o");
check("clocking a linked task puts its total on the item", JSON.stringify(await ev(`(item->dict (item-get ${grant}))`)).includes("0:25"),
  await ev(`(item->dict (item-get ${grant}))`));
await ev(`(insert clock (dict :task "deep work" :item 0 :file "" :day "${TODAY}" :start 0 :stop 1 :mins 95))`);
const rep = String(await ev(`(pim-clock-report "${TODAY}" "${TODAY}")`));
check("clock report: a table, longest first, with a total", rep.split("\n")[2] === "| deep work | 1:35 |" && rep.endsWith("| **total** | **2:00** |"), rep);

// ── tracker ──
setDoc("coffee 2 cup | with Ana\nwalk 30\n🍕 Pizza 800 kcal\njoint", 1);
await press("Ctrl-Alt-l");
check("log a line", /^- \d\d:\d\d {2}coffee 2 cup \| with Ana$/.test(lineAt(1)), lineAt(1));
await press("Ctrl-Alt-l");
check("the same line twice is refused", doc.messages[0] === "Already logged", doc.messages);
doc.cursor = doc.text.indexOf("walk 30") + 7;
await press("Ctrl-Alt-l");
check("default unit by kind", /^- \d\d:\d\d {2}walk 30 min$/.test(lineAt(2)), lineAt(2));
doc.cursor = doc.text.indexOf("800 kcal") + 8;
await press("Ctrl-Alt-l");
check("an emoji line is logged whole", /^- \d\d:\d\d {2}🍕 pizza 800 kcal$/.test(lineAt(3)) && lineAt(4) === "joint", doc.text);
doc.cursor = doc.text.length;
await press("Ctrl-Alt-l");
check("a bare thing counts 1", /^- \d\d:\d\d {2}joint 1 un$/.test(lineAt(4)), lineAt(4));
await press("Ctrl-Alt-c");
check("⌃⌥C logs a coffee", doc.messages[0] === "Logged coffee 1 un", doc.messages);
const tr = String(await ev(`(pim-track-report "${TODAY}" "${TODAY}")`));
check("report sums by kind", tr.includes("drink 3") && tr.includes("exercise 30 min") && tr.includes("weed 1 un"), tr);
check("streak: today counts", (await ev(`(pim-streak "exercise")`)) === 1);
await ev(`(insert log (dict :at "x" :day "${await ev(`(date-add "${TODAY}" -1 :days)`)}" :kind "exercise" :item "run" :qty 20 :unit "min" :note ""))`);
check("streak: two days in a row", (await ev(`(pim-streak "exercise")`)) === 2);
check("streak: none", (await ev(`(pim-streak "smoke")`)) === 0);
setDoc("", 0);
await press("Ctrl-Alt-r");
check("⌃⌥R block starts the empty note", doc.text.startsWith("<!-- eel: (pim-day-log"), doc.text);
check("⌃⌥R: today's log as a block", doc.text.includes("coffee 2 cup | with Ana") && doc.text.includes("drink 3"), doc.text);

// ── notes ──
doc.opened = [];
await press("Mod-d");
check("⌘D: today's note from the template", doc.opened[0]?.[1] === `${TODAY}.md` && String(doc.opened[0]?.[2]).includes("## Log"), doc.opened);
doc.opened = [];
await press("Ctrl-Alt-v");
const monday = String(doc.opened[0]?.[1] ?? "");
check("⌃⌥V: this week's review", /^reviews\/\d{4}-\d\d-\d\d week\.md$/.test(monday) &&
  (await ev(`(date-format "${monday.slice(8, 18)}" "EEEE")`)) === "Monday", doc.opened);
const review = String(doc.opened[0]?.[2] ?? "");
check("…with done, time, tracker, coming up", review.includes("buy milk") && review.includes("deep work") && review.includes("drink") && review.includes("pay rent"), review);

// ── capture ──
await press("Ctrl-Alt-n");
check("⌃⌥N opens the capture form", doc.forms[0] === "pim/Capture", doc.forms);
check("capture a task", String(await ev(`(pim-capture "task" "call Ana in 3 days #family")`)).startsWith("Agenda #"));
check("capture to the inbox", String(await ev(`(pim-capture "inbox" "look into solar panels")`)).startsWith("Agenda #") &&
  String(await ev("(pim-inbox)")).includes("look into solar panels"), await ev("(pim-inbox)"));
check("capture a log line", String(await ev(`(pim-capture "log" "water 3 glass | hot day")`)) === "Logged water 3 glass | hot day");
check("capture nothing", (await ev(`(pim-capture "task" "  ")`)) === "Nothing to capture");

const formPrelude = await engine.ev(await readFile(path.join(root, "src/forms/prelude.eelisp"), "utf8"));
const form = await engine.ev(await readFile(path.join(root, "docs/pim/Capture.eeform"), "utf8"));
check("Capture.eeform loads", formPrelude.ok && form.ok, form.error ?? formPrelude.error);
const saved = await engine.ev(`(ui-run cap-save {"txtWhat" "stretch 10" "optKind" "log"})`);
check("its Save handler captures and clears the box", saved.ok && JSON.stringify(saved.result).includes("Logged stretch 10 min") &&
  JSON.stringify(saved.result).includes('"txtWhat",{"$kw":"value"},""'), saved);

// ── reloading the library ──
const again = await engine.ev(parsed.start ? `(on-start (def pim-reloaded 1))` : "");
check("(on-start …) re-runs as a plain form after launch", again.ok && (await ev("pim-reloaded")) === 1, again.error);

// ── persistence ──
await engine.close();
const e2 = serve(["--db", path.join(dir, "eeditor.db"), "--workspace", dir]);
const n = (await e2.ev("(count-records log)")).result;
check("the tracker survives a restart", n === 8, n);
const items2 = (await e2.ev("(item-count)")).result;
check("…and so do the agenda items", Number(items2) > 5, items2);
await e2.close();
await rm(dir, { recursive: true, force: true });

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
