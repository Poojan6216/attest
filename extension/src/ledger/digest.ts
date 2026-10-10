/**
 * The weekly digest in the ledger (sprint_4 4.7): built by the service worker on Monday from what the ledger holds for
 * the week before (./digest-week.ts), and kept, one row per week (`digests`, schema v10), so the digest page reads it
 * and computes nothing (the sprint's rule: the UI is a view of the ledger). In one read transaction:
 *  - each agent's receipts graded that week (`computedAt` in the week), read through `[agent+computedMs]`, superseded
 *    ones aside: FINAL ones and the ones the person marked (USER_OVERRIDDEN) counted by Attest's own grade, the marked
 *    ones also as marked, PENDING ones as still checking, and of the claim receipts so counted that Attest could check
 *    (Verified, Partial, Not found, Over scope), how many are Verified. A mark never changes a count (sprint_4 close,
 *    tech review TECH-4: "they are also how a lazy user hides problems");
 *  - the notable receipts: NOT_FOUND, UNASKED and OVER_SCOPE by Attest's own grade, FINAL or marked, newest first, each
 *    with what a share may show: the action and its time, the counterparty's domain only (an address gives its domain;
 *    a name gives nothing), the amount, the subject hint the ledger keeps, and the person's mark's grade;
 *  - the person's marks, newest first: Attest's grade, theirs, and their reason, which the digest page shows ("The
 *    override reason is required and visible in the digest") and no share holds;
 *  - per source the days of the week no coverage window of it reached (`coverageIntervals` spans): Attest could not
 *    check them;
 *  - each reader's latest health.
 * A week's digest made again replaces the one before (the same key). Digests go in the retention purge once their week
 * ended before the cutoff (./retention.ts), and with everything in Delete all data.
 */
import { isoWithLocalOffset } from '../clock';
import { compareText } from '../core/order';
import { spansEndingIn, readInterval } from './coverage-store';
import { addressDomain, merchantDomain } from './domain';
import { readRow, readRows, type LedgerDb } from './db';
import { type DigestWeek, weekDays } from './digest-week';
import {
  AdapterHealth,
  AgentId,
  type AgentWeek,
  AlertGrade,
  Claim,
  type DigestMark,
  DigestRecord,
  Grade,
  type IsoTs,
  type NotableReceipt,
  Observation,
  type ObservationSource,
  Receipt,
  SCHEMA_LIMITS,
} from './types';
import { parseWrite } from './errors';

/** The sources whose windows a digest checks for days nobody looked at. */
const GAP_SOURCES: readonly ObservationSource[] = ['gmail.sent', 'gcal.event'];

/** The grades a claim receipt Attest could check ends with. */
const CHECKED: ReadonlySet<Grade> = new Set(['VERIFIED', 'PARTIAL', 'NOT_FOUND', 'OVER_SCOPE']);

const zeroGrades = (): Record<Grade, number> =>
  Object.fromEntries(Grade.options.map((grade) => [grade, 0])) as Record<Grade, number>;

/** One agent's counts over its receipts of the week (header). */
function agentWeek(agent: AgentId, receipts: readonly Receipt[]): AgentWeek {
  const grades = zeroGrades();
  let checking = 0;
  let marked = 0;
  let checked = 0;
  let verified = 0;
  for (const receipt of receipts) {
    if (receipt.state === 'PENDING') {
      checking += 1;
      continue;
    }
    if (receipt.state === 'USER_OVERRIDDEN') marked += 1;
    grades[receipt.grade] += 1;
    if (receipt.claimId !== undefined && CHECKED.has(receipt.grade)) checked += 1;
    if (receipt.claimId !== undefined && receipt.grade === 'VERIFIED') verified += 1;
  }
  return { agent, grades, checking, marked, checked, verified };
}

/** Whether the digest calls `receipt` out (header): an alert grade by Attest's own, FINAL or marked. */
const isNotable = (receipt: Receipt): boolean =>
  (receipt.state === 'FINAL' || receipt.state === 'USER_OVERRIDDEN') &&
  AlertGrade.safeParse(receipt.grade).success;

/** The person's marks among `receipts` (header). */
const marksOf = (receipts: readonly Receipt[]): DigestMark[] =>
  receipts.flatMap(({ id: receiptId, agent, grade, override }) =>
    override === undefined
      ? []
      : [{ receiptId, agent, grade, markGrade: override.grade, reason: override.reason }],
  );

/** What a share may show of each notable receipt (header), newest first. */
async function notableOf(db: LedgerDb, receipts: readonly Receipt[]): Promise<NotableReceipt[]> {
  const claimIds = receipts.flatMap(({ claimId }) => (claimId === undefined ? [] : [claimId]));
  const orphanIds = receipts.flatMap(({ claimId, observationIds: [first] }) =>
    claimId === undefined && first !== undefined ? [first] : [],
  );
  const claims = new Map(readRows('claims', Claim, await db.claims.bulkGet(claimIds)).map((c) => [c.id, c]));
  const orphans = new Map(
    readRows('observations', Observation, await db.observations.bulkGet(orphanIds)).map((o) => [o.id, o]),
  );
  return receipts.map((receipt): NotableReceipt => {
    const { id: receiptId, agent, claimId, observationIds } = receipt;
    const grade = parseWrite(AlertGrade, receipt.grade, 'Invalid digest receipt', { table: 'digests' });
    const claim = claimId === undefined ? undefined : claims.get(claimId);
    const [first] = observationIds;
    const orphan = claimId === undefined && first !== undefined ? orphans.get(first) : undefined;
    const action = claim ?? orphan;
    const at = claim?.claimedAt ?? orphan?.occurredAt;
    const domain = addressDomain(action?.counterparty) ?? merchantDomain(orphan?.merchant);
    return {
      receiptId,
      agent,
      grade,
      ...(action === undefined ? {} : { type: action.type }),
      ...(at === undefined ? {} : { at }),
      ...(domain === undefined ? {} : { domain }),
      ...(action?.amountCents === undefined ? {} : { amountCents: action.amountCents }),
      ...(action?.currency === undefined ? {} : { currency: action.currency }),
      ...(action?.subjectHint === undefined ? {} : { subjectHint: action.subjectHint }),
      ...(receipt.override === undefined ? {} : { mark: { grade: receipt.override.grade } }),
    };
  });
}

/** Per source, the days of `week` no stored window of it reached. */
async function gapsOf(db: LedgerDb, week: DigestWeek): Promise<DigestRecord['gaps']> {
  const days = weekDays(week);
  const gaps: DigestRecord['gaps'] = [];
  for (const source of GAP_SOURCES) {
    const spans = (await spansEndingIn(db, source, week.fromMs, Number.MAX_SAFE_INTEGER).toArray())
      .flatMap((row) => {
        const placed = readInterval(row);
        return placed === undefined ? [] : [placed];
      })
      .filter(({ startMs }) => startMs < week.toMs);
    const missed = days.filter(
      ({ startMs, endMs }) => !spans.some((span) => span.startMs < endMs && span.endMs >= startMs),
    );
    if (missed.length > 0) gaps.push({ source, days: missed.map(({ date }) => date) });
  }
  return gaps;
}

const newestFirst = (a: Receipt, b: Receipt): number =>
  Date.parse(b.computedAt) - Date.parse(a.computedAt) || compareText(b.id, a.id);

/** Builds the digest of `week` at `createdAt` (header). */
export async function buildDigest(db: LedgerDb, week: DigestWeek, createdAt: IsoTs): Promise<DigestRecord> {
  const tables = [db.receipts, db.claims, db.observations, db.coverageIntervals, db.adapterHealth];
  return db.transaction('r', tables, async (): Promise<DigestRecord> => {
    const agents: AgentWeek[] = [];
    const notable: Receipt[] = [];
    const marked: Receipt[] = [];
    for (const agent of AgentId.options) {
      const rows = await db.receipts
        .where('[agent+computedMs]')
        .between([agent, week.fromMs], [agent, week.toMs], true, false)
        .toArray();
      const receipts = readRows('receipts', Receipt, rows).filter(
        ({ supersededBy }) => supersededBy === undefined,
      );
      if (receipts.length === 0) continue;
      agents.push(agentWeek(agent, receipts));
      notable.push(...receipts.filter(isNotable));
      marked.push(...receipts.filter(({ override }) => override !== undefined));
    }
    notable.sort(newestFirst);
    marked.sort(newestFirst);
    const digest = {
      week: week.week,
      from: isoWithLocalOffset(new Date(week.fromMs)),
      to: isoWithLocalOffset(new Date(week.toMs)),
      createdAt,
      agents,
      notable: await notableOf(db, notable.slice(0, SCHEMA_LIMITS.LIST)),
      notableCount: notable.length,
      gaps: await gapsOf(db, week),
      health: readRows('adapterHealth', AdapterHealth, await db.adapterHealth.toArray()),
      marks: marksOf(marked.slice(0, SCHEMA_LIMITS.LIST)),
      marksCount: marked.length,
    };
    return parseWrite(DigestRecord, digest, 'Invalid digest', { table: 'digests' });
  });
}

/** Stores `digest`, replacing the week's digest made before (header). */
export async function saveDigest(db: LedgerDb, digest: DigestRecord): Promise<void> {
  await db.digests.put(parseWrite(DigestRecord, digest, 'Invalid digest', { table: 'digests' }));
}

/** The weeks that have a digest, newest first. */
export async function digestWeeks(db: LedgerDb): Promise<string[]> {
  return (await db.digests.orderBy(':id').reverse().primaryKeys()).map(String);
}

/** The digest of `week`, or undefined. */
export async function getDigest(db: LedgerDb, week: string): Promise<DigestRecord | undefined> {
  return readRow('digests', DigestRecord, await db.digests.get(week));
}
