/**
 * Calendar dates as the project's records and outputs write them: `YYYY-MM-DD` (design §4.11,
 * §5.4). A decision record carries the local date it was taken; the order is judged as of a date
 * (the stale-price rule), today's local date unless one is given.
 */

/** A date as YYYY-MM-DD in local time; today by default. */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True for a real calendar date written YYYY-MM-DD (2026-02-30 is not one). */
export function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
