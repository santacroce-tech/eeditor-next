import { describe, expect, it } from "vitest";
import {
  type TodayItem,
  addDays,
  countByDay,
  dateOf,
  dayStrip,
  dayTitle,
  daysBetween,
  dueLabel,
  greeting,
  planDay,
  repeatLabel,
  summarize,
  timeOf,
  urgency,
} from "./today";

const item = (id: number, text: string, when = "", priority = "", recurrence = ""): TodayItem => ({
  id, text, when, priority, categories: "", recurrence,
});

describe("today: dates", () => {
  it("adds days across a month, a year and a clock change", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-24", "2026-12-01")).toBe(7);
    expect(daysBetween("2026-11-24", "2026-11-20")).toBe(-4);
  });

  it("reads the day and the time out of a when", () => {
    expect(dateOf("2026-11-24")).toBe("2026-11-24");
    expect(dateOf("2026-11-24 16:00")).toBe("2026-11-24");
    expect(dateOf("")).toBe("");
    expect(dateOf("someday")).toBe("");
    expect(timeOf("2026-11-24 9:05")).toBe("09:05");
    expect(timeOf("2026-11-24")).toBe("");
  });

  it("makes a strip of days in a row", () => {
    const s = dayStrip("2026-11-24", 14);
    expect(s).toHaveLength(14);
    expect(s[0]).toEqual({ date: "2026-11-24", day: 24, weekday: "Tue" });
    expect(s[13].date).toBe("2026-12-07");
  });

  it("names a day as seen from today", () => {
    expect(dayTitle("2026-11-24", "2026-11-24")).toBe("Today");
    expect(dayTitle("2026-11-25", "2026-11-24")).toBe("Tomorrow");
    expect(dayTitle("2026-11-23", "2026-11-24")).toBe("Yesterday");
    expect(dayTitle("2026-11-27", "2026-11-24")).toBe("Fri, Nov 27");
    expect(dueLabel("2026-11-27", "2026-11-24")).toBe("3d left");
    expect(dueLabel("2026-11-03", "2026-11-24")).toBe("21d late");
  });
});

describe("today: priorities and repeats", () => {
  it("1 is the most pressing, as the agenda's ! marks store it", () => {
    expect(urgency("1")).toBe(3);
    expect(urgency("2")).toBe(2);
    expect(urgency("3")).toBe(1);
    expect(urgency("")).toBe(0);
    expect(urgency("high")).toBe(3);
    expect(urgency("!!")).toBe(2);
  });

  it("says a recurrence the way a person would", () => {
    expect(repeatLabel("daily")).toBe("daily");
    expect(repeatLabel("every:1:weeks")).toBe("weekly");
    expect(repeatLabel("every:1:days")).toBe("daily");
    expect(repeatLabel("every:2:weeks")).toBe("every 2 weeks");
  });
});

describe("today: the plan of a day", () => {
  const today = "2026-11-24";
  const items = [
    item(1, "late", "2026-11-20"),
    item(2, "due, low", "2026-11-24", "3"),
    item(3, "due, high", "2026-11-24", "1", "daily"),
    item(4, "no day"),
    item(5, "soon", "2026-11-27"),
    item(6, "far", "2026-12-20"),
    item(7, "no day, urgent", "", "1"),
  ];

  it("sorts items into due, overdue, inbox and the week ahead", () => {
    const p = planDay(items, today, today);
    expect(p.due.map((i) => i.id)).toEqual([3, 2]);
    expect(p.overdue.map((i) => i.id)).toEqual([1]);
    expect(p.inbox.map((i) => i.id)).toEqual([7, 4]);
    expect(p.upcoming.map((i) => i.id)).toEqual([5]);
  });

  it("shows nothing as overdue on another day", () => {
    const p = planDay(items, "2026-11-27", today);
    expect(p.due.map((i) => i.id)).toEqual([5]);
    expect(p.overdue).toEqual([]);
  });

  it("sums the day up, leaving out what there is none of", () => {
    expect(summarize(planDay(items, today, today)).map((p) => p.text)).toEqual([
      "2 tasks", "1 repeating", "1 important", "1 overdue",
    ]);
    expect(summarize(planDay([], today, today))).toEqual([]);
    expect(countByDay(items)["2026-11-24"]).toBe(2);
  });

  it("greets by the hour", () => {
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(15)).toBe("Good afternoon");
    expect(greeting(21)).toBe("Good evening");
  });
});
