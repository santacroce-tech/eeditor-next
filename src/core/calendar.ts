// Month-grid math — ported from EEditorCore/CalendarViewModel (ANALYSIS §3.9).
// ISO-8601, Monday-first; leading/trailing days fill whole weeks. UTC to stay timezone-stable.

export interface CalendarDay {
  date: string; // yyyy-MM-dd
  day: number;
  inMonth: boolean;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A Monday-first month grid (length is a multiple of 7). `month` is 1–12. */
export function monthGrid(year: number, month: number): CalendarDay[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7; // days before the 1st (Mon=0)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totalCells = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;

  const start = new Date(first);
  start.setUTCDate(1 - mondayOffset); // the grid's first (Monday) cell

  const cells: CalendarDay[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dt = new Date(start);
    dt.setUTCDate(start.getUTCDate() + i);
    cells.push({ date: iso(dt), day: dt.getUTCDate(), inMonth: dt.getUTCMonth() === month - 1 });
  }
  return cells;
}

/** Bucket item/file dates (yyyy-MM-dd) into per-day counts for activity dots. */
export function countByDate(dates: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dates) {
    const key = d.slice(0, 10);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
