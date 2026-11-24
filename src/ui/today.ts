// The Today page: the agenda as a day. A strip of days across the top, a sentence that sums the day
// up, what is due (and, today, what is overdue), and beside it the inbox — items with no day yet —
// and the week ahead. It fills the editor pane; opening any file puts the editor back.
//
// It keeps nothing of its own: every draw reads `(items)`, and a tick, a new task or a move to
// another day is one engine call followed by a redraw. The arithmetic is core/today.ts.

import type { EngineClient } from "../engine/client";
import type { Envelope, JsonValue } from "../engine/types";
import { isItem, isResultSet } from "../engine/types";
import {
  type DayPlan,
  type TodayItem,
  addDays,
  countByDay,
  dateOf,
  dayStrip,
  dayTitle,
  dueLabel,
  repeatLabel,
  greeting,
  isoDate,
  longDate,
  planDay,
  shortDate,
  summarize,
  urgency,
} from "../core/today";

export interface TodayView {
  el: HTMLElement;
  /** Read the agenda again and redraw — a no-op while the page isn't showing. */
  refresh(): Promise<void>;
  /** Back to today's date, drawn fresh. */
  reset(): void;
  focus(): void;
}

export interface TodayHost {
  /** Open (or make) the daily note of a day. */
  openDaily(day: string): void;
  /** Whether a day has a daily note already. */
  hasDaily(day: string): boolean;
  /** The agenda changed here: let the sidebar's list and the panels follow. */
  changed(): void;
  /** Leave the page for the editor. */
  close(): void;
  isShown(): boolean;
}

const STRIP_DAYS = 14;

const s = (v: JsonValue | undefined): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** The agenda's open items, as the page reads them. */
export async function loadItems(engine: EngineClient): Promise<TodayItem[]> {
  return parseItems(await engine.evalSrc("(items)"));
}

function parseItems(env: Envelope): TodayItem[] {
  if (!env.ok || !isResultSet(env.result)) return [];
  return env.result.$resultSet.records.map((r) => ({
    id: r.id,
    text: s(r.data.text),
    when: s(r.data.when),
    priority: s(r.data.priority),
    categories: s(r.data.categories),
    recurrence: s(r.data.recurrence),
  }));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const ICON = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const CHEVRON_LEFT = ICON('<path d="m15 6-6 6 6 6"/>');
const CHEVRON_RIGHT = ICON('<path d="m9 6 6 6-6 6"/>');
const CLOSE = ICON('<path d="M6 6l12 12M18 6 6 18"/>');
const CHECK = ICON('<path d="m5 12.5 4.5 4.5L19 7.5"/>');

/** A category's chip colour: the same name is always the same one of six. */
export function hueOf(name: string): number {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6;
}

export function createTodayView(engine: EngineClient, host: TodayHost): TodayView {
  const root = el("div", "today");
  root.tabIndex = -1;

  // ── the day ──
  const main = el("section", "today-main");
  const head = el("header", "today-head");
  const titles = el("div", "today-titles");
  const title = el("h1", "today-title");
  const sub = el("div", "today-sub");
  titles.append(title, sub);
  const nav = el("div", "today-nav");
  const todayBtn = el("button", "today-pill", "Today");
  const prevBtn = el("button", "today-round");
  prevBtn.innerHTML = CHEVRON_LEFT;
  prevBtn.title = "The day before";
  prevBtn.setAttribute("aria-label", "The day before");
  const nextBtn = el("button", "today-round");
  nextBtn.innerHTML = CHEVRON_RIGHT;
  nextBtn.title = "The day after";
  nextBtn.setAttribute("aria-label", "The day after");
  const closeBtn = el("button", "today-round today-close");
  closeBtn.innerHTML = CLOSE;
  closeBtn.title = "Back to the editor (Esc)";
  closeBtn.setAttribute("aria-label", "Back to the editor");
  nav.append(todayBtn, prevBtn, nextBtn, closeBtn);
  head.append(titles, nav);

  const strip = el("div", "today-strip");
  strip.setAttribute("role", "tablist");
  const summary = el("div", "today-summary");
  const add = el("label", "today-add");
  const addRing = el("span", "today-check");
  const addInput = el("input", "today-add-input");
  addInput.placeholder = "New task";
  addInput.spellcheck = false;
  add.append(addRing, addInput);
  const list = el("div", "today-list");
  const body = el("div", "today-body");
  body.append(strip, summary, add, list);
  main.append(head, body);

  // ── beside it: no day yet, and the week ahead ──
  const side = el("aside", "today-side");
  const sideHead = el("header", "today-head");
  sideHead.append(el("h2", "today-side-title", "Inbox"));
  const sideList = el("div", "today-list");
  const sideBody = el("div", "today-body");
  sideBody.append(sideList);
  side.append(sideHead, sideBody);

  // the page measures itself (a container query), so the columns sit in a grid of their own
  const grid = el("div", "today-grid");
  grid.append(main, side);
  root.append(grid);

  let today = isoDate(new Date());
  let day = today;
  /** The first day of the strip: it moves only when the day shown walks off either end. */
  let stripStart = today;
  let drawing = 0;

  function show(d: string): void {
    day = d;
    if (day < stripStart) stripStart = day;
    else if (day > addDays(stripStart, STRIP_DAYS - 1)) stripStart = addDays(day, 1 - STRIP_DAYS);
    void refresh();
  }

  async function act(src: string): Promise<Envelope> {
    const env = await engine.evalSrc(src);
    await refresh();
    host.changed();
    return env;
  }

  function chip(text: string, cls: string): HTMLElement {
    return el("span", `today-chip ${cls}`, text);
  }

  function row(it: TodayItem, where: "due" | "overdue" | "inbox" | "upcoming"): HTMLElement {
    const r = el("div", "today-item");
    r.dataset.id = String(it.id);
    const u = urgency(it.priority);
    const check = el("button", `today-check pri-${u}`);
    check.innerHTML = CHECK;
    check.title = it.recurrence ? "Done — it comes back at its next date" : "Done";
    check.setAttribute("aria-label", `Done: ${it.text}`);
    check.addEventListener("click", () => {
      r.classList.add("done");
      check.disabled = true;
      // long enough to see the tick land before the row goes
      setTimeout(() => void act(`(item-done ${it.id})`), 260);
    });

    const text = el("div", "today-item-text", it.text);
    const meta = el("div", "today-item-meta");
    const d = dateOf(it.when);
    if (d && where !== "due") {
      meta.append(el("span", "today-date", shortDate(d)));
      meta.append(chip(dueLabel(d, today), where === "overdue" ? "late" : "plain"));
    }
    if (it.recurrence) meta.append(chip(`⟳ ${repeatLabel(it.recurrence)}`, "plain"));
    if (u === 3) meta.append(chip("important", "warn"));
    for (const c of it.categories.split(",").map((x) => x.trim()).filter(Boolean)) meta.append(chip(c, `hue-${hueOf(c)}`));

    const texts = el("div", "today-item-body");
    texts.append(text);
    if (meta.childElementCount) texts.append(meta);

    // one press to bring it to the day shown — what an inbox item or a late one usually wants
    const acts = el("div", "today-item-acts");
    if (where !== "due") {
      const move = el("button", "today-pill small", dayTitle(day, today) === "Today" ? "→ today" : `→ ${shortDate(day)}`);
      move.title = `Due ${longDate(day)}`;
      move.addEventListener("click", () => void act(`(item-set ${it.id} :when ${JSON.stringify(day)})`));
      acts.append(move);
    } else {
      const later = el("button", "today-pill small", "→ next day");
      later.title = `Due ${longDate(addDays(day, 1))} instead`;
      later.addEventListener("click", () => void act(`(item-set ${it.id} :when ${JSON.stringify(addDays(day, 1))})`));
      acts.append(later);
    }
    r.append(check, texts, acts);
    return r;
  }

  function group(into: HTMLElement, label: string, items: TodayItem[], where: Parameters<typeof row>[1]): void {
    if (items.length === 0) return;
    if (label) {
      const h = el("div", "today-group");
      h.append(el("span", "", label), el("span", "today-count", String(items.length)));
      into.append(h);
    }
    for (const it of items) into.append(row(it, where));
  }

  function drawStrip(counts: Record<string, number>): void {
    strip.replaceChildren();
    for (const d of dayStrip(stripStart, STRIP_DAYS)) {
      const b = el("button", "today-day");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(d.date === day));
      b.classList.toggle("selected", d.date === day);
      b.classList.toggle("is-today", d.date === today);
      b.title = longDate(d.date);
      b.append(el("span", "today-day-num", String(d.day)), el("span", "today-day-name", d.weekday));
      if (counts[d.date]) b.append(el("span", "today-day-dot"));
      b.addEventListener("click", () => show(d.date));
      strip.append(b);
    }
  }

  function drawSummary(plan: DayPlan): void {
    summary.replaceChildren();
    const parts = summarize(plan);
    const isToday = day === today;
    const lead = isToday ? `${greeting(new Date().getHours())}, you have` : `${dayTitle(day, today)} has`;
    if (parts.length === 0) {
      summary.append(el("span", "", isToday ? `${greeting(new Date().getHours())} — nothing due today.` : `Nothing due ${dayTitle(day, today).toLowerCase()}.`));
    } else {
      summary.append(el("span", "", lead));
      parts.forEach((p, i) => {
        if (i > 0 && i === parts.length - 1) summary.append(el("span", "", "and"));
        summary.append(chip(p.text, `big kind-${p.kind}`));
      });
    }
    const note = el("button", "today-pill today-note", host.hasDaily(day) ? "Daily note" : "＋ Daily note");
    note.title = `${day}.md`;
    note.addEventListener("click", () => host.openDaily(day));
    summary.append(note);
  }

  async function refresh(): Promise<void> {
    if (!host.isShown()) return;
    const mine = ++drawing;
    const env = await engine.evalSrc("(items)");
    if (mine !== drawing) return; // a later draw is on its way
    today = isoDate(new Date());
    const items = parseItems(env);
    const plan = planDay(items, day, today);

    title.textContent = dayTitle(day, today);
    sub.textContent = longDate(day);
    todayBtn.disabled = day === today;
    drawStrip(countByDay(items));
    drawSummary(plan);
    addInput.placeholder = day === today ? "New task" : `New task for ${shortDate(day)}`;

    list.replaceChildren();
    group(list, plan.overdue.length ? "Overdue" : "", plan.overdue, "overdue");
    group(list, plan.overdue.length ? dayTitle(day, today) : "", plan.due, "due");
    if (plan.due.length + plan.overdue.length === 0) list.append(el("div", "today-empty", "Nothing here. Type a task above, or bring one over from the inbox."));

    sideList.replaceChildren();
    group(sideList, "No day yet", plan.inbox, "inbox");
    group(sideList, "Next 7 days", plan.upcoming, "upcoming");
    if (plan.inbox.length + plan.upcoming.length === 0) sideList.append(el("div", "today-empty", "The inbox is empty."));
  }

  addInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const text = addInput.value.trim();
    if (!text) return;
    addInput.value = "";
    void (async () => {
      // `add` reads a date out of the text ("friday", "tomorrow"); with none, it is for the day shown
      const env = await engine.evalSrc(`(add ${JSON.stringify(text)})`);
      const item = env.ok && isItem(env.result) ? env.result.$item : undefined;
      if (item && !s(item.properties?.when)) await engine.evalSrc(`(item-set ${item.id} :when ${JSON.stringify(day)})`);
      await refresh();
      host.changed();
    })();
  });

  todayBtn.addEventListener("click", () => show(isoDate(new Date())));
  prevBtn.addEventListener("click", () => show(addDays(day, -1)));
  nextBtn.addEventListener("click", () => show(addDays(day, 1)));
  closeBtn.addEventListener("click", () => host.close());
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      host.close();
      return;
    }
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "ArrowLeft") show(addDays(day, -1));
    else if (e.key === "ArrowRight") show(addDays(day, 1));
    else if (e.key === "t" && !e.metaKey && !e.ctrlKey && !e.altKey) show(isoDate(new Date()));
    else if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) addInput.focus();
    else return;
    e.preventDefault();
  });

  return {
    el: root,
    refresh,
    reset() {
      today = isoDate(new Date());
      day = today;
      stripStart = today;
      void refresh();
    },
    focus: () => root.focus(),
  };
}
