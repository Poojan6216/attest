/**
 * The activity attribution reads (sprint_3 3.14; docs/grading.md §7): the moments an agent's own log says it worked
 * (session pings, from the timed entries of a pasted log) and the intervals Chrome reported the person away (idle,
 * opt-in). Instants and an agent id only, never content (Hard Rule 2). Stored in `activity` (schema v6); each row
 * raises the clock high water like every stored instant (docs/grading.md §3 Clock safety); the grading batch reads
 * them over its horizon; the purge removes them after retention; the export carries them.
 *
 * Idle is positive evidence only (§7: missing data never counts as idle). An interval is stored when Chrome says the
 * person went away, from the instant their last input could have been to the instant Chrome said so, and it is
 * extended to the instant they came back when Chrome says that (`closeIdle`). The interval still open is named in
 * meta, so a service worker that restarted meanwhile still closes it; one never closed keeps only what was confirmed.
 */
import { canonicalJson, sha256Hex } from '../core/hash';
import { instantMs } from '../core/normalize';
import type { AgentId, IsoTs } from '../core/schema';
import { noteStoredInstant } from './clock-high-water';
import { readRows, type LedgerDb } from './db';
import { ActivityRecord, type ActivityRecordInput } from './types';

/** The meta key naming the idle interval still open, if any. */
export const OPEN_IDLE = 'idleOpen';

/** A stored activity row: the record plus the epoch ms its window spans, for range reads by kind. */
export type ActivityRow = ActivityRecord & { readonly startMs: number; readonly endMs: number };

const idOf = (fields: object): string => sha256Hex(canonicalJson(fields));

function toRow(record: ActivityRecord): ActivityRow {
  const [from, to] = record.kind === 'session' ? [record.at, record.at] : [record.from, record.to];
  return { ...record, startMs: instantMs(from), endMs: instantMs(to) };
}

async function put(db: LedgerDb, input: ActivityRecordInput): Promise<void> {
  const record = ActivityRecord.parse(input);
  await db.activity.put(toRow(record));
  await noteStoredInstant(db, record.kind === 'session' ? record.at : record.to);
}

/** Stores a session ping of `agent` at each of `instants`, each once; returns how many were new. */
export async function putSessions(db: LedgerDb, agent: AgentId, instants: readonly IsoTs[]): Promise<number> {
  return db.transaction('rw', [db.activity, db.meta], async () => {
    let added = 0;
    for (const at of instants) {
      const id = idOf({ kind: 'session', agent, ms: instantMs(at) });
      if ((await db.activity.get(id)) !== undefined) continue;
      await put(db, { id, kind: 'session', agent, at });
      added += 1;
    }
    return added;
  });
}

/** Chrome says the person went away at `to`, idle since `from`: stores the interval and names it open. */
export async function openIdle(db: LedgerDb, from: IsoTs, to: IsoTs): Promise<void> {
  await db.transaction('rw', [db.activity, db.meta], async () => {
    if ((await db.meta.get(OPEN_IDLE)) !== undefined) return;
    const id = idOf({ kind: 'idle', ms: instantMs(from) });
    await put(db, { id, kind: 'idle', from, to });
    await db.meta.put({ key: OPEN_IDLE, value: id });
  });
}

/** Chrome says the person is back at `at`: the open interval, if any, is extended to it and closed. */
export async function closeIdle(db: LedgerDb, at: IsoTs): Promise<void> {
  await db.transaction('rw', [db.activity, db.meta], async () => {
    const open = await db.meta.get(OPEN_IDLE);
    await db.meta.delete(OPEN_IDLE);
    if (typeof open?.value !== 'string') return;
    const [held] = readRows('activity', ActivityRecord, [await db.activity.get(open.value)]);
    if (held?.kind !== 'idle' || instantMs(at) <= instantMs(held.to)) return;
    await put(db, { ...held, to: at });
  });
}

/** The session pings and idle intervals that reach into [fromMs, toMs], in the shape grading reads (§7). */
export async function activityIn(
  db: LedgerDb,
  fromMs: number,
  toMs: number,
): Promise<{ sessions: { agent: AgentId; at: IsoTs }[]; idle: { from: IsoTs; to: IsoTs }[] }> {
  const rows = await db.activity
    .where('endMs')
    .between(fromMs, Number.MAX_SAFE_INTEGER, true, true)
    .toArray();
  const records = readRows(
    'activity',
    ActivityRecord,
    rows.filter((row) => row.startMs <= toMs),
  );
  return {
    sessions: records.flatMap((r) => (r.kind === 'session' ? [{ agent: r.agent, at: r.at }] : [])),
    idle: records.flatMap((r) => (r.kind === 'idle' ? [{ from: r.from, to: r.to }] : [])),
  };
}

/** The person turned away detection off: every idle interval goes, and none stays open; returns how many went. */
export async function forgetIdle(db: LedgerDb): Promise<number> {
  return db.transaction('rw', [db.activity, db.meta], async () => {
    await db.meta.delete(OPEN_IDLE);
    return db.activity.filter((row) => row.kind === 'idle').delete();
  });
}

/** The purge's part (./retention.ts): every row whose window ended before the cutoff; returns how many. */
export async function purgeActivity(db: LedgerDb, cutoffMs: number): Promise<number> {
  return db.activity.where('endMs').below(cutoffMs).delete();
}
