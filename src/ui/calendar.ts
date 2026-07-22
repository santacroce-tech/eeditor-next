// Calendar view — a month grid (Monday-first, from the tested calendar.ts) with agenda-item dots,
// backed by the engine's (items-between …) / (items-on …). Click a day to see its items.

import { monthGrid, countByDate } from "../core/calendar";
import type { EngineClient } from "../engine/client";
import type { Envelope, JsonValue } from "../engine/types";
import { isResultSet } from "../engine/types";

export interface CalendarView {
  open(): void;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function records(env: Envelope): { id: number; data: Record<string, JsonValue> }[] {
  if (env.ok && isResultSet(env.result)) return env.result.$resultSet.records;
  return [];
}
function whenOf(rec: { data: Record<string, JsonValue> }): string {
  const w = rec.data.when;
  return typeof w === "string" ? w : "";
}

export function createCalendar(engine: EngineClient): CalendarView {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1; // 1–12
  let selectedDate: string | null = null;

  const overlay = document.createElement("div");
  overlay.className = "qo-overlay";
  overlay.style.display = "none";
  const panel = document.createElement("div");
  panel.className = "cal-panel";

  const header = document.createElement("div");
  header.className = "cal-header";
  const prev = document.createElement("button");
  prev.className = "cal-nav";
  prev.textContent = "‹";
  const title = document.createElement("div");
  title.className = "cal-title";
  const next = document.createElement("button");
  next.className = "cal-nav";
  next.textContent = "›";
  header.append(prev, title, next);

  const weekdays = document.createElement("div");
  weekdays.className = "cal-weekdays";
  for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    const el = document.createElement("div");
    el.textContent = d;
    weekdays.appendChild(el);
  }

  const grid = document.createElement("div");
  grid.className = "cal-grid";
  const dayList = document.createElement("div");
  dayList.className = "cal-daylist";

  panel.append(header, weekdays, grid, dayList);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  async function loadMonth(): Promise<void> {
    title.textContent = `${MONTHS[month - 1]} ${year}`;
    dayList.innerHTML = "";
    const cells = monthGrid(year, month);
    const first = cells[0].date;
    const last = cells[cells.length - 1].date;
    const env = await engine.evalSrc(`(items-between "${first}" "${last}")`);
    const counts = countByDate(records(env).map(whenOf).filter(Boolean));

    grid.innerHTML = "";
    for (const cell of cells) {
      const el = document.createElement("button");
      el.className = "cal-day" + (cell.inMonth ? "" : " out") + (cell.date === todayKey ? " today" : "");
      const num = document.createElement("span");
      num.textContent = String(cell.day);
      el.appendChild(num);
      const n = counts[cell.date] ?? 0;
      if (n > 0) {
        const dot = document.createElement("span");
        dot.className = "cal-dot";
        dot.textContent = n > 1 ? String(n) : "";
        el.appendChild(dot);
      }
      el.addEventListener("click", () => void loadDay(cell.date));
      // drop target — drag an item here to reschedule its :when to this day
      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        el.classList.add("cal-drop");
      });
      el.addEventListener("dragleave", () => el.classList.remove("cal-drop"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("cal-drop");
        const id = e.dataTransfer?.getData("text/plain");
        if (!id) return;
        void engine.evalSrc(`(item-set ${id} :when "${cell.date}")`).then(() => {
          void loadMonth();
          if (selectedDate) void loadDay(selectedDate);
        });
      });
      grid.appendChild(el);
    }
  }

  async function loadDay(date: string): Promise<void> {
    selectedDate = date;
    const env = await engine.evalSrc(`(items-on "${date}")`);
    const recs = records(env);
    dayList.innerHTML = "";
    const head = document.createElement("div");
    head.className = "cal-daylist-head";
    head.textContent = `${date} — ${recs.length} item(s) · drag to a day to reschedule`;
    dayList.appendChild(head);
    for (const r of recs) {
      const row = document.createElement("div");
      row.className = "cal-item";
      const text = typeof r.data.text === "string" ? r.data.text : "";
      const pr = typeof r.data.priority === "string" ? r.data.priority : "";
      row.textContent = (pr ? `[${pr}] ` : "") + text;
      row.draggable = true;
      row.dataset.id = String(r.id);
      row.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/plain", String(r.id)));
      dayList.appendChild(row);
    }
  }

  prev.addEventListener("click", () => {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    void loadMonth();
  });
  next.addEventListener("click", () => {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    void loadMonth();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.style.display !== "none") overlay.style.display = "none";
  });

  return {
    open: () => {
      overlay.style.display = "flex";
      void loadMonth();
    },
  };
}
