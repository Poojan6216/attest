/**
 * The opt-in telemetry's payload, built from the ledger (sprint_5 5.7; ./schema.ts; agents/backend_engineer.md rule 2):
 * one install's last whole day on the browser's clock, counts only.
 *  - `counts`: each agent's receipts graded that day (`computedAt` in the day, read through `[agent+computedMs]` as the
 *    weekly digest reads them), a FINAL one by its grade and one the person marked by their mark (docs/grading.md §8:
 *    overridden receipts are counted by their override grade), PENDING and superseded ones left out (§2).
 *  - `adapterHealth`: each reader's latest health report, when it was made that day: OK or DEGRADED, and nothing for an
 *    IDLE one (a reader that read no page says nothing of how it reads).
 *  - `coverageHours`: the whole hours of the day the windows of each page reader covered (Gmail's Sent list, the
 *    Calendar), single instants aside.
 *  - `adaptersEnabled`, `observersEnabled`: which readers are on.
 * The install id and the two versions are the caller's (./facts.ts). The payload is parsed by its schema before it is
 * returned; a day it cannot describe gives none.
 */
import { AGENT_READERS } from '../config';
import { instantMs } from '../core/normalize';
import { AgentId, type ObservationSource, Receipt } from '../core/schema';
import { MS_PER_HOUR } from '../core/units';
import { readFlags, readersOff } from '../ledger/consent';
import { readInterval, spansEndingIn } from '../ledger/coverage-store';
import { readRows, type LedgerDb } from '../ledger/db';
import { localDate } from '../ledger/digest-week';
import { listAdapterHealth } from '../ledger/repo';
import { TELEMETRY_COMPONENTS, TELEMETRY_COUNT_MAX, TelemetryPayload } from './schema';

/** The day a payload reports, as `YYYY-MM-DD`, and its bounds in epoch ms on the browser's clock. */
export interface TelemetryDay {
  readonly bucket: string;
  readonly fromMs: number;
  readonly toMs: number;
}

/** What the ledger does not hold: the install id, the extension's version, and Chrome's (null when unknown). */
export interface TelemetryFacts {
  readonly installId: string;
  readonly extVersion: string;
  readonly chromeMajor: number | null;
}

/** The last whole day before `nowMs` on the browser's clock: yesterday. */
export function reportedDay(nowMs: number): TelemetryDay {
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return { bucket: localDate(yesterday), fromMs: yesterday.getTime(), toMs: today.getTime() };
}

type Counts = TelemetryPayload['counts'];

const noCounts = (): Counts['muse'] => ({
  VERIFIED: 0,
  PARTIAL: 0,
  NOT_FOUND: 0,
  UNASKED: 0,
  OVER_SCOPE: 0,
  UNVERIFIABLE: 0,
});

/** Each agent's receipts graded on `day`, by the grade they count as (header). */
async function countsOf(db: LedgerDb, day: TelemetryDay): Promise<Counts> {
  const counts: Counts = { muse: noCounts(), chatgpt: noCounts(), dots: noCounts(), claude: noCounts() };
  for (const agent of AgentId.options) {
    const rows = await db.receipts
      .where('[agent+computedMs]')
      .between([agent, day.fromMs], [agent, day.toMs], true, false)
      .toArray();
    for (const receipt of readRows('receipts', Receipt, rows)) {
      if (receipt.state === 'PENDING' || receipt.supersededBy !== undefined) continue;
      const grade = receipt.override?.grade ?? receipt.grade;
      counts[agent][grade] = Math.min(counts[agent][grade] + 1, TELEMETRY_COUNT_MAX);
    }
  }
  return counts;
}

/** Each reader's latest health report made on `day`, OK or DEGRADED (header). */
async function healthOf(db: LedgerDb, day: TelemetryDay): Promise<TelemetryPayload['adapterHealth']> {
  const health: TelemetryPayload['adapterHealth'] = {};
  for (const report of await listAdapterHealth(db)) {
    const component = TELEMETRY_COMPONENTS.find((id) => id === report.adapterId);
    const checkedMs = instantMs(report.checkedAt);
    if (component === undefined || report.status === 'IDLE') continue;
    if (checkedMs >= day.fromMs && checkedMs < day.toMs) health[component] = report.status;
  }
  return health;
}

/** The whole hours of `day` the windows of `source` covered (header): their union, clipped to the day. */
async function hoursOf(db: LedgerDb, source: ObservationSource, day: TelemetryDay): Promise<number> {
  const spans = (await spansEndingIn(db, source, day.fromMs, Number.MAX_SAFE_INTEGER).toArray())
    .flatMap((row) => {
      const placed = readInterval(row);
      return placed === undefined ? [] : [placed];
    })
    .map(({ startMs, endMs }) => [Math.max(startMs, day.fromMs), Math.min(endMs, day.toMs)] as const)
    .filter(([from, to]) => from < to)
    .sort(([a], [b]) => a - b);
  let covered = 0;
  let reached = day.fromMs;
  for (const [from, to] of spans) {
    covered += Math.max(0, to - Math.max(from, reached));
    reached = Math.max(reached, to);
  }
  return Math.floor(covered / MS_PER_HOUR);
}

/** `day`'s payload (header), or null when it is not one the schema takes (Chrome's version unknown, say). */
export async function buildTelemetry(
  db: LedgerDb,
  facts: TelemetryFacts,
  day: TelemetryDay,
): Promise<TelemetryPayload | null> {
  const tables = [db.receipts, db.adapterHealth, db.coverageIntervals, db.meta];
  const read = await db.transaction('r', tables, async () => ({
    counts: await countsOf(db, day),
    adapterHealth: await healthOf(db, day),
    coverageHours: {
      gmail: await hoursOf(db, 'gmail.sent', day),
      gcal: await hoursOf(db, 'gcal.event', day),
    },
    off: await readersOff(db),
    flags: await readFlags(db),
  }));
  const on = (agent: keyof typeof AGENT_READERS): boolean => AGENT_READERS[agent] === 'on';
  const parsed = TelemetryPayload.safeParse({
    installId: facts.installId,
    extVersion: facts.extVersion,
    chromeMajor: facts.chromeMajor,
    dayBucket: day.bucket,
    adaptersEnabled: {
      muse: on('muse'),
      chatgpt: on('chatgpt'),
      dots: on('chatgpt') && read.flags.ATTEST_DOTS,
      claude: on('claude'),
    },
    observersEnabled: { gmail: !read.off.has('gmail'), gcal: !read.off.has('gcal') },
    counts: read.counts,
    adapterHealth: read.adapterHealth,
    coverageHours: read.coverageHours,
  });
  return parsed.success ? parsed.data : null;
}
