/**
 * How the weekly digest is worded (sprint_4 4.7; agents/ux_engineer.md copy rules: short, grades as nouns, no
 * exclamation mark). Every number written is one the digest stored (src/ledger/digest.ts); these only format them: a
 * week by its Monday ("week of 5 Oct 2026"), the days a source was not checked as weekday runs ("Calendar was not
 * checked Tue–Thu."), and the notice that a digest is ready. Pure: a date is read from its own `YYYY-MM-DD` text, never
 * from a clock or a time zone.
 */
import type { AdapterHealth, DigestRecord, ObservationSource } from '../ledger/types';
import { adapterName, sourceName } from './receipt-labels';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` as the UTC midnight of that date, for reading its weekday and the date after it. */
function utcOf(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** "5 Oct 2026". */
export function dateLabel(date: string): string {
  const at = new Date(utcOf(date));
  return `${String(at.getUTCDate())} ${MONTHS[at.getUTCMonth()] ?? ''} ${String(at.getUTCFullYear())}`;
}

/** "6 Oct 2026, 14:00": a stored instant on the clock it was read on (its own date and time, as written). */
export const instantLabel = (at: string): string => `${dateLabel(at.slice(0, 10))}, ${at.slice(11, 16)}`;

const HEALTH_WORDS: Readonly<Record<AdapterHealth['status'], string>> = Object.freeze({
  OK: 'working',
  IDLE: 'idle',
  DEGRADED: 'needs repair',
});

/** A reader's health in a word: working, idle or needs repair. */
export const healthWord = (status: AdapterHealth['status']): string => HEALTH_WORDS[status];

/** "Week of 5 Oct 2026": a digest's week, by its Monday. */
export const weekLabel = (week: string): string => `Week of ${dateLabel(week)}`;

const weekday = (date: string): string => WEEKDAYS[new Date(utcOf(date)).getUTCDay()] ?? date;

/** The days as runs of consecutive weekdays: "Mon", "Tue–Thu", "Mon, Wed–Fri". */
export function dayRuns(days: readonly string[]): string {
  const runs: string[][] = [];
  for (const day of [...days].sort()) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run !== undefined && last !== undefined && utcOf(day) - utcOf(last) === MS_PER_DAY) run.push(day);
    else runs.push([day]);
  }
  return runs
    .map((run) => {
      const [first] = run;
      const end = run.at(-1);
      if (first === undefined || end === undefined) return '';
      return first === end ? weekday(first) : `${weekday(first)}–${weekday(end)}`;
    })
    .join(', ');
}

/** "Calendar was not checked Tue–Thu.", or "… all week." */
export function gapLine(source: ObservationSource, days: readonly string[]): string {
  const name = sourceName(source);
  return days.length >= 7 ? `${name} was not checked all week.` : `${name} was not checked ${dayRuns(days)}.`;
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/**
 * The notice that a digest is ready (a notification, shown on the lock screen too): its week, then what it holds that
 * needs a look: the receipts it calls out, the claims Attest could not check, each source not checked on some days,
 * each reader that needs repair, and the person's marks. Never an "all clear" (Hard Rules 5, 6; sprint_4 close,
 * security review SEC-4): only with none of these does it say that no receipt ended Not found, Unasked or Over scope.
 */
export function digestReadyText(digest: DigestRecord): { readonly title: string; readonly message: string } {
  const parts: string[] = [];
  if (digest.notableCount > 0)
    parts.push(`${plural(digest.notableCount, 'receipt', 'receipts')} to look at.`);
  const unchecked = digest.agents.reduce((sum, { grades }) => sum + grades.UNVERIFIABLE, 0);
  if (unchecked > 0) parts.push(`${plural(unchecked, 'claim', 'claims')} could not be checked.`);
  for (const { source, days } of digest.gaps) parts.push(gapLine(source, days));
  for (const { adapterId, status } of digest.health) {
    if (status === 'DEGRADED') parts.push(`The ${adapterName(adapterId)} needs repair.`);
  }
  const marks = digest.marksCount ?? 0;
  if (marks > 0) parts.push(`You marked ${plural(marks, 'receipt', 'receipts')}.`);
  if (parts.length === 0) parts.push('No receipt ended Not found, Unasked or Over scope.');
  return { title: 'Your weekly digest', message: `${weekLabel(digest.week)}: ${parts.join(' ')}` };
}
