/**
 * The service worker's side of a paste (sprint_3 3.13; docs/claims-import.md §4, §5): a `claims.import` from the side
 * panel (an extension page only, src/bus/listen.ts), carrying claims, never text.
 *
 *  1. The clock guard runs first (src/ledger/clock-guard.ts), as for every message that stores rows.
 *  2. Every agent without a grant gets the default one (./default-grants.ts): a batch grades only agents it can.
 *  3. Each claim is stored on its own through `upsertClaim`, in order (§3): a claim already stored adds nothing, so a
 *     log pasted twice adds nothing the second time. A refusal (`id_conflict`, `invalid_input`) stops the import and
 *     is answered with its code; the claims stored before it stay, and a retry adds only what is missing.
 *  4. The minutes the log's timed entries name become the agent's session pings (../ledger/activity.ts, sprint_3
 *     3.14): the agent's own log says it worked then (§7 `agentSessionActive`).
 *  5. The import's instant becomes the agent's last import (`lastImportAt.<agent>` in meta, never moved back): the
 *     adapter sync UNASKED finality reads (§7), since the log the person pasted shows the agent's actions up to then.
 *  6. A grading batch runs (./grading.ts), so the side panel's answer comes once the receipts are stored. A batch
 *     that fails is logged loud and leaves the claims stored: the grace alarm grades them (./alarms.ts).
 * Logs name the agent, codes and counts only (Hard Rule 10).
 */
import { isoWithLocalOffset } from '../clock';
import type { ClaimsImportMessage, ClaimsImportResult, LedgerTable } from '../bus/messages';
import { instantMs } from '../core/normalize';
import { type AgentId, IsoTs } from '../core/schema';
import { guardClock } from '../ledger/clock-guard';
import type { LedgerDb } from '../ledger/db';
import { LedgerError } from '../ledger/errors';
import { putSessions } from '../ledger/activity';
import { getMeta, setMeta, upsertClaim } from '../ledger/repo';
import { log } from '../log';
import { ensureDefaultGrants } from './default-grants';
import { lastImportKey } from '../ledger/meta-keys';
import { changedReceipts, type GradingDeps, runGradingBatch } from './grading';

export interface ImportContext {
  readonly db: () => Promise<LedgerDb>;
  readonly grading: GradingDeps;
  /** Tells open UI pages which tables moved (src/background/router.ts `announce`). */
  readonly notify: (tables: readonly LedgerTable[]) => void;
}

/** Records `at` as the agent's last import, unless a later one is already recorded. */
async function recordImport(db: LedgerDb, agent: AgentId, at: IsoTs): Promise<void> {
  const held = IsoTs.safeParse(await getMeta(db, lastImportKey(agent)));
  if (!held.success || instantMs(held.data) < instantMs(at)) await setMeta(db, lastImportKey(agent), at);
}

/** Stores each claim in order; the number that were new, or the code of the first refusal. */
async function storeClaims(db: LedgerDb, message: ClaimsImportMessage): Promise<number | ClaimsImportResult> {
  let added = 0;
  for (const claim of message.claims) {
    try {
      if ((await upsertClaim(db, claim)).inserted) added += 1;
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      if (error.code !== 'id_conflict' && error.code !== 'invalid_input') throw error;
      log.warn('import.refused', { agent: message.agent, code: error.code });
      return { ok: false, code: error.code };
    }
  }
  return added;
}

/** Handles one `claims.import` (the steps in the file comment). */
export async function onClaimsImport(
  ctx: ImportContext,
  message: ClaimsImportMessage,
): Promise<ClaimsImportResult> {
  const db = await ctx.db();
  const nowMs = ctx.grading.nowMs();
  await guardClock(db, nowMs);
  const now = IsoTs.parse(isoWithLocalOffset(new Date(nowMs)));
  const granted = await ensureDefaultGrants(db, now);
  const added = await storeClaims(db, message);
  if (typeof added !== 'number') return added;
  await putSessions(db, message.agent, message.activeAt);
  await recordImport(db, message.agent, now);
  ctx.notify(granted > 0 ? ['claims', 'activity', 'grants', 'meta'] : ['claims', 'activity', 'meta']);
  log.info('import.stored', { agent: message.agent, claimCount: message.claims.length, addedCount: added });
  try {
    if (changedReceipts(await runGradingBatch(db, ctx.grading))) ctx.notify(['receipts']);
  } catch (error) {
    log.error('grading.failed', { error });
  }
  return { ok: true, received: message.claims.length, added };
}
