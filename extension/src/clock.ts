/**
 * The one clock at the edge (src/core never reads one: Hard Rule 4). Every timestamp the extension stamps
 * itself (export time, receipt computedAt, finalAt, …) comes from nowIso(), ISO 8601 with the writer's
 * local offset, so `dateKey()` (the first ten characters) is the writer's local date, the same date the user
 * sees. Ordering never compares these strings: the ledger compares epoch milliseconds, so an instant written
 * with `-05:00` and with `Z` orders the same (Decisions.md [0.close]).
 */

/** `YYYY-MM-DDTHH:mm:ss.sss±hh:mm` for `date` in the host's time zone. */
export function isoWithLocalOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `${shifted.toISOString().slice(0, 23)}${sign}${hours}:${minutes}`;
}

/** Now, with the local offset. */
export function nowIso(): string {
  return isoWithLocalOffset(new Date());
}
