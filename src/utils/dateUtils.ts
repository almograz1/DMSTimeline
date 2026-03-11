// ─── Date Utilities ───────────────────────────────────────────────────────────
// All date math lives here. Components never do raw Date arithmetic.
// Dates in the app are ISO strings ('YYYY-MM-DD'); we parse to Date only when computing.

/** Convert a Date to 'YYYY-MM-DD' string (local time, not UTC) */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a 'YYYY-MM-DD' string into a local Date object.
 * Using `new Date('YYYY-MM-DD')` would give UTC midnight, which shifts
 * the date in negative-UTC-offset timezones — this avoids that.
 */
export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Return a new Date that is `n` days after `date` */
export function addDays(date: Date, n: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + n);
  return result;
}

/**
 * Number of whole calendar days from `from` to `to`.
 * Positive when `to` is after `from`.
 */
export function dayDiff(from: Date, to: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  // Strip time component to avoid DST surprises
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Return the Monday of the week containing `date` */
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon…
  // Distance to previous Monday: if Sunday (0) → go back 6; otherwise go back (day - 1)
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d;
}

/** ISO week number (1–53) using the ISO-8601 algorithm */
export function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayOfWeek = d.getUTCDay() || 7; // make Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Short day names indexed by getDay() */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function getDayName(date: Date): string { return DAY_NAMES[date.getDay()]; }

/** Short month names indexed by getMonth() */
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function getMonthName(date: Date): string { return MONTH_NAMES[date.getMonth()]; }
export function getMonthFullName(date: Date): string {
  return ['January','February','March','April','May','June',
          'July','August','September','October','November','December'][date.getMonth()];
}

/** True if the date falls on a Saturday or Sunday */
export function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

/**
 * Build an array of Date objects for the daily-view columns.
 * Starts at `calStart` and produces `count` consecutive days.
 */
export function buildDailyColumns(calStart: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(calStart, i));
}

/**
 * Build an array of Monday-Date objects for weekly-view columns.
 * Starts at the Monday of the week containing `calStart`, produces `weekCount` weeks.
 */
export function buildWeeklyColumns(calStart: Date, weekCount: number): Date[] {
  const firstMonday = getMondayOfWeek(calStart);
  return Array.from({ length: weekCount }, (_, i) => addDays(firstMonday, i * 7));
}

/**
 * Compute the default calendar window: 4 weeks before today through 16 weeks after.
 * Returns { startDate, totalDays }.
 */
export function defaultCalendarWindow(): { startDate: Date; totalDays: number } {
  const today = new Date();
  const startDate = addDays(getMondayOfWeek(today), -28); // 4 weeks back
  return { startDate, totalDays: 28 + 7 * 16 }; // 20 weeks total
}
