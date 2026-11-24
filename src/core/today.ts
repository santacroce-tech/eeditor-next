// The Today page's arithmetic (ui/today.ts draws it): which agenda items belong to a day, the strip
// of days across the top, and the sentence that sums the day up. Pure — dates are yyyy-MM-dd
// strings, compared as text, and "today" is always handed in.

export interface TodayItem {
  id: number;
  text: string;
  /** As the agenda keeps it: "", "2026-11-24" or "2026-11-24 16:00". */
  when: string;
  priority: string;
  /** Comma-separated names. */
  categories: string;
  recurrence: string;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** A local date as yyyy-MM-dd. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Noon, so a daylight-saving hour either way never changes the day. */
function atNoon(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(day: string, n: number): string {
  const d = atNoon(day);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Whole days from `from` to `to`: negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((atNoon(to).getTime() - atNoon(from).getTime()) / 86_400_000);
}

/** The day an item is due — "" when it has none (or a `when` that isn't a date). */
export function dateOf(when: string): string {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(when.trim());
  return m ? m[0] : "";
}

/** The time of day in an item's `when`, "16:00" — "" when it only names a day. */
export function timeOf(when: string): string {
  const m = /^\d{4}-\d{2}-\d{2}[ T](\d{1,2}:\d{2})/.exec(when.trim());
  return m ? m[1].padStart(5, "0") : "";
}

/**
 * How pressing a priority is, 0 (none) to 3. The agenda keeps what was typed, so this reads the
 * usual spellings: "!"…"!!!", "high"/"medium"/"low", "A"/"B"/"C", "p1"…"p3" and "1"…"3" (1 highest).
 */
export function urgency(priority: string): 0 | 1 | 2 | 3 {
  const p = priority.trim().toLowerCase();
  if (!p) return 0;
  if (/^!+$/.test(p)) return Math.min(3, p.length) as 1 | 2 | 3;
  if (p === "high" || p === "urgent" || p === "a") return 3;
  if (p === "medium" || p === "normal" || p === "b") return 2;
  if (p === "low" || p === "c") return 1;
  const n = /^p?([1-9])$/.exec(p);
  if (n) return (n[1] === "1" ? 3 : n[1] === "2" ? 2 : 1) as 1 | 2 | 3;
  return 1;
}

export interface StripDay {
  date: string;
  /** Day of the month. */
  day: number;
  /** "Mon" … "Sun". */
  weekday: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `count` days in a row, the first being `start`. */
export function dayStrip(start: string, count: number): StripDay[] {
  const out: StripDay[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(start, i);
    const d = atNoon(date);
    out.push({ date, day: d.getDate(), weekday: WEEKDAYS[d.getDay()] });
  }
  return out;
}

/** "Tuesday, November 24, 2026" */
export function longDate(day: string): string {
  const d = atNoon(day);
  return `${LONG_WEEKDAYS[d.getDay()]}, ${LONG_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Tue, Nov 24" */
export function shortDate(day: string): string {
  const d = atNoon(day);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** The page's title for a day: Today, Tomorrow, Yesterday, or the weekday and date. */
export function dayTitle(day: string, today: string): string {
  const n = daysBetween(today, day);
  return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : shortDate(day);
}

/** How far off a due day is, seen from today: "today", "tomorrow", "3d left", "2d late". */
export function dueLabel(day: string, today: string): string {
  const n = daysBetween(today, day);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `${n}d left` : `${-n}d late`;
}

/** A recurrence as a person says it: "daily" stays, "every:1:weeks" → "weekly", "every:2:weeks" → "every 2 weeks". */
export function repeatLabel(recurrence: string): string {
  const m = /^every:(\d+):(day|week|month|year)s?$/i.exec(recurrence.trim());
  if (!m) return recurrence.trim();
  const unit = m[2].toLowerCase();
  if (m[1] === "1") return unit === "day" ? "daily" : `${unit}ly`;
  return `every ${m[1]} ${unit}s`;
}

/** By time of day (those with none last), then the most pressing first, then as the agenda has them. */
function byTime(a: TodayItem, b: TodayItem): number {
  const ta = timeOf(a.when) || "99:99";
  const tb = timeOf(b.when) || "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  return urgency(b.priority) - urgency(a.priority) || a.id - b.id;
}

export interface DayPlan {
  /** Due on the day. */
  due: TodayItem[];
  /** Due before today and still open — only when the day shown is today. */
  overdue: TodayItem[];
  /** With no day at all. */
  inbox: TodayItem[];
  /** Due in the week after the day shown, soonest first. */
  upcoming: TodayItem[];
}

export function planDay(items: TodayItem[], day: string, today: string): DayPlan {
  const plan: DayPlan = { due: [], overdue: [], inbox: [], upcoming: [] };
  const weekOut = addDays(day, 7);
  for (const it of items) {
    const d = dateOf(it.when);
    if (!d) plan.inbox.push(it);
    else if (d === day) plan.due.push(it);
    else if (day === today && d < today) plan.overdue.push(it);
    else if (d > day && d <= weekOut) plan.upcoming.push(it);
  }
  plan.due.sort(byTime);
  const byDay = (a: TodayItem, b: TodayItem): number => {
    const da = dateOf(a.when);
    const db = dateOf(b.when);
    return da === db ? byTime(a, b) : da < db ? -1 : 1;
  };
  plan.overdue.sort(byDay);
  plan.upcoming.sort(byDay);
  plan.inbox.sort((a, b) => urgency(b.priority) - urgency(a.priority) || a.id - b.id);
  return plan;
}

/** Open items per day, for the dots under the strip. */
export function countByDay(items: TodayItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const d = dateOf(it.when);
    if (d) out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

export function greeting(hour: number): string {
  return hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export interface SummaryPart {
  kind: "due" | "overdue" | "important" | "repeat";
  text: string;
}

/** The chips of "Good morning, you have …": only the counts that aren't zero. */
export function summarize(plan: DayPlan): SummaryPart[] {
  const parts: SummaryPart[] = [];
  const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
  const todays = [...plan.due, ...plan.overdue];
  const repeats = plan.due.filter((it) => it.recurrence).length;
  const important = todays.filter((it) => urgency(it.priority) === 3).length;
  if (plan.due.length) parts.push({ kind: "due", text: n(plan.due.length, "task", "tasks") });
  if (repeats) parts.push({ kind: "repeat", text: n(repeats, "repeating", "repeating") });
  if (important) parts.push({ kind: "important", text: `${important} important` });
  if (plan.overdue.length) parts.push({ kind: "overdue", text: `${plan.overdue.length} overdue` });
  return parts;
}
