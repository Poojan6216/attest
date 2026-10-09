/**
 * The clock repairs grading reads (docs/grading.md §3 Clock safety and §6.1 `coverage.clock_repaired`, v1.16;
 * S2-SIM2-1, Decisions [2.7-E] and [3.17]; Hard Rules 4, 5).
 *
 * A repair (./clock-guard.ts) found the clock below the latest instant the ledger stored. Every instant from the
 * clock's now at the repair to that high water may have been stamped by a clock that ran ahead, or, after a clock
 * that stepped back for good, may be stamped again later as an earlier instant. A `calendar.created` claim whose
 * first-seen bound lies in that span can have its event first seen, after the repair, at an instant that reads as
 * earlier than the claim: §4.1's first-seen rule drops the event, and a full, fresh view would say NOT_FOUND.
 *
 * So each repair keeps its span in `meta`, written in the repair's own transaction: the key is `clockRepair.` then
 * the epoch ms of its `from`, the value `<from>/<to>`. Every grading batch passes the spans to grading in its
 * coverage (`Coverage.repairs`), so each receipt's `inputsHash` holds them, its replay record stores them, and replay
 * sees the same fact. A span is purged with the dated history once it ended before the retention cutoff
 * (./retention.ts): no claim it bears on is still graded by then.
 */
import { z } from 'zod';

import { SCHEMA_LIMITS } from '../core/schema';
import { readRow, readRows, type LedgerDb } from './db';
import { epochMs } from './index-fields';
import { IsoTs } from './types';

/** The meta keys of the kept spans: this prefix, then the epoch ms of the span's `from`. */
export const CLOCK_REPAIR_PREFIX = 'clockRepair.';

/** One kept span: from the clock's now at a repair to the high water the repair found. */
export interface RepairSpan {
  readonly from: IsoTs;
  readonly to: IsoTs;
}

/** A kept span as stored: `<from>/<to>`, two instants (an instant holds no `/`), `from` at or before `to`. */
const RepairEntry = z.strictObject({
  key: z.string().startsWith(CLOCK_REPAIR_PREFIX),
  value: z.string().transform((value, context): RepairSpan => {
    const [from, to, ...rest] = value.split('/');
    const span = { from: IsoTs.safeParse(from), to: IsoTs.safeParse(to) };
    if (rest.length === 0 && span.from.success && span.to.success) {
      if (epochMs(span.from.data) <= epochMs(span.to.data)) return { from: span.from.data, to: span.to.data };
    }
    context.addIssue({ code: 'custom', message: 'expected <from>/<to>' });
    return z.NEVER;
  }),
});

function keyOf(from: IsoTs): string {
  return `${CLOCK_REPAIR_PREFIX}${String(epochMs(from))}`;
}

/**
 * Keeps the span `[from, to]` of a repair (call it inside the repair's transaction; its scope must include `meta`).
 * A span already kept from the same instant keeps the later `to`.
 */
export async function keepRepairSpan(db: LedgerDb, from: IsoTs, to: IsoTs): Promise<void> {
  const key = keyOf(from);
  const held = readRow('meta', RepairEntry, await db.meta.get(key))?.value;
  const end = held !== undefined && epochMs(held.to) > epochMs(to) ? held.to : to;
  await db.meta.put({ key, value: `${from}/${end}` });
}

/** Every kept span, in `from` order (a stored value that is not a span is logged and skipped: ./db.ts `readRow`). */
export async function clockRepairs(db: LedgerDb): Promise<RepairSpan[]> {
  const rows = await db.meta.where('key').startsWith(CLOCK_REPAIR_PREFIX).toArray();
  return readRows('meta', RepairEntry, rows)
    .map((entry) => entry.value)
    .sort((a, b) => epochMs(a.from) - epochMs(b.from));
}

/**
 * The spans a batch passes to grading: every kept span, in `from` order. When there are more than a coverage holds
 * (`SCHEMA_LIMITS.LIST`), the oldest are joined into one span, from the earliest `from` to the latest `to` among
 * them: every instant a kept span holds is still held, so a joined span caps more claims, never fewer (Hard Rule 5).
 */
export function batchRepairs(spans: readonly RepairSpan[]): RepairSpan[] {
  const sorted = [...spans].sort((a, b) => epochMs(a.from) - epochMs(b.from));
  const joined = sorted.length - SCHEMA_LIMITS.LIST + 1;
  if (joined <= 1) return sorted;
  const [first, ...rest] = sorted.slice(0, joined);
  if (first === undefined) return sorted;
  const to = rest.reduce((end, span) => (epochMs(span.to) > epochMs(end) ? span.to : end), first.to);
  return [{ from: first.from, to }, ...sorted.slice(joined)];
}

/** Deletes the spans that ended before `cutoffMs` (the retention purge, ./retention.ts); returns how many. */
export async function purgeClockRepairs(db: LedgerDb, cutoffMs: number): Promise<number> {
  const rows = await db.meta.where('key').startsWith(CLOCK_REPAIR_PREFIX).toArray();
  const ended = rows.filter((row) => {
    const span = RepairEntry.safeParse(row);
    return span.success && epochMs(span.data.value.to) < cutoffMs;
  });
  await db.meta.bulkDelete(ended.map((row) => row.key));
  return ended.length;
}
