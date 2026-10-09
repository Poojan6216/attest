/**
 * A person's grant from the options page (sprint_4 4.4): a `grant.save` from an extension page. The clock guard runs
 * first, as for every message that stores rows; the person's choices are saved with the mute, what Attest observed
 * kept from the stored grant (src/ledger/grant-save.ts), announced (`ledger.changed`: grants, meta) and logged
 * (`grant.saved`, the agent only); then a grading batch runs, so the agent's open (PENDING) receipts are regraded
 * under it at once. A FINAL receipt is never regraded (docs/grading.md §3,
 * §8): a grant changes what comes, never what was decided. A failing batch is logged loud (`grading.failed`) and the
 * grant stays; the grace alarm grades within 5 minutes.
 */
import type { GrantSaveMessage, GrantSaveResult } from '../bus/messages';
import { guardClock } from '../ledger/clock-guard';
import { saveGrant } from '../ledger/grant-save';
import { log } from '../log';
import type { ImportContext } from './claims-import';
import { changedReceipts, runGradingBatch } from './grading';

/** Handles one `grant.save` (header). */
export async function onGrantSave(ctx: ImportContext, message: GrantSaveMessage): Promise<GrantSaveResult> {
  const db = await ctx.db();
  await guardClock(db, ctx.grading.nowMs());
  const { grant, alertsMuted } = message;
  await saveGrant(db, grant, alertsMuted);
  log.info('grant.saved', { agent: grant.agent });
  ctx.notify(['grants', 'meta']);
  try {
    if (changedReceipts(await runGradingBatch(db, ctx.grading))) ctx.notify(['receipts']);
  } catch (error) {
    log.error('grading.failed', { error });
  }
  return { ok: true };
}
