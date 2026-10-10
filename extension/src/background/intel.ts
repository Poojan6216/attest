/**
 * The advisory model in the service worker (sprint_5 5.4; agents/intel_engineer.md rules 4 and 7; docs/grading.md §3,
 * §5.4). After a grading batch (./grading.ts), Attest asks the model about the claims its score could move: each claim
 * whose receipt is PENDING by rule `partial` (its floor at or above `thresholds.partial` and below `verified`, the only
 * outcome §5.4 lets the model change), with the one candidate it took. §5.4 raises that candidate alone, so no other
 * candidate is sent. Each claim is asked once: its ledger row is written before the call (src/ledger/model-answers.ts),
 * and an input the same provider answered before is not sent again. The calls run one at a time, after the batch and
 * never inside it, at most MODEL_ASKS_PER_RUN per run: every receipt is graded rules-only first and never waits for the
 * model, and a call gives up after INTEL_TIMEOUT_MS (src/intel/index.ts). When an answer was stored, one more batch
 * regrades the PENDING receipts with it, and open pages are told. A receipt already FINAL is never regraded (§8), so
 * a claim whose evidence arrives after its grace is graded rules-only, and the model is not asked about it.
 *
 * The provider: Chrome's on-device model when the person turned it on and Chrome has it ready, else the person's own
 * key when they turned that on and saved one, else none, and nothing is asked. The choice that keeps the facts on this
 * computer wins (Decisions [5.3]). The log names the provider and counts, never a claim's facts (Hard Rule 10).
 */
import type { LedgerTable } from '../bus/messages';
import { isoWithLocalOffset } from '../clock';
import { MODEL_ASKS_PER_RUN } from '../config';
import { modelMayRaise } from '../core/model-raise';
import { instantMs } from '../core/normalize';
import { Claim, IsoTs, Observation, Receipt, type Ulid } from '../core/schema';
import { inputFor, type IntelProvider, scoresFor } from '../intel';
import { inputsHash } from '../intel/cache';
import { builtinAvailability, builtinProvider, promptApi, type PromptApi } from '../intel/providers/builtin';
import { byoProvider } from '../intel/providers/byo';
import { modelOn, readFlags } from '../ledger/consent';
import { readRow, readRows, type LedgerDb } from '../ledger/db';
import { answerAsk, askedClaims, claimAsk } from '../ledger/model-answers';
import { log } from '../log';
import { readByo, type StoredByo } from './byo';
import { endModelRun, startModelRun } from './model-run';
import { changedReceipts, type GradingDeps, runGradingBatch } from './grading';

/** Where a provider comes from: Chrome's Prompt API here, and the person's saved key. */
export interface ProviderSources {
  readonly promptApi: () => PromptApi | null;
  readonly byo: () => Promise<StoredByo | null>;
}

const BROWSER_SOURCES: ProviderSources = { promptApi: () => promptApi(), byo: () => readByo() };

/** The provider to ask now (header), or null when the person turned none on or none can answer. */
export async function chooseProvider(
  db: LedgerDb,
  sources: ProviderSources = BROWSER_SOURCES,
): Promise<IntelProvider | null> {
  const flags = await readFlags(db);
  if (flags.ATTEST_MODEL) {
    const api = sources.promptApi();
    if (api !== null && (await builtinAvailability(api)) === 'available') return builtinProvider(api);
  }
  if (!flags.ATTEST_MODEL_BYO) return null;
  const byo = await sources.byo();
  return byo === null ? null : byoProvider(byo.vendor, byo.key);
}

/** A claim the model may be asked about, and the one candidate it took. */
export interface ModelAskItem {
  readonly claim: Claim;
  readonly observation: Observation;
}

/** The receipt's claim and its one observation, when the model may still raise it (core `modelMayRaise`), with one. */
function partialOf(receipt: Receipt): { claimId: Ulid; observationId: Ulid } | null {
  const [observationId, ...more] = receipt.observationIds;
  if (!modelMayRaise(receipt) || receipt.claimId === undefined || observationId === undefined) return null;
  return more.length === 0 ? { claimId: receipt.claimId, observationId } : null;
}

/**
 * The claims to ask about now (header): PENDING by rule `partial`, never asked before, at most MODEL_ASKS_PER_RUN,
 * those claimed earliest first (their grace ends first). A row that does not parse is left out.
 */
export async function claimsToAsk(db: LedgerDb): Promise<ModelAskItem[]> {
  const tables = [db.receipts, db.claims, db.observations, db.modelAnswers];
  return db.transaction('r', tables, async (): Promise<ModelAskItem[]> => {
    const pending = readRows(
      'receipts',
      Receipt,
      await db.receipts.where('state').equals('PENDING').toArray(),
    );
    const open = pending.map(partialOf).filter((pair) => pair !== null);
    const asked = await askedClaims(
      db,
      open.map(({ claimId }) => claimId),
    );
    const fresh = open.filter(({ claimId }) => !asked.has(claimId));
    const claims = await db.claims.bulkGet(fresh.map(({ claimId }) => claimId));
    const observations = await db.observations.bulkGet(fresh.map(({ observationId }) => observationId));
    const items = fresh.flatMap((_, index) => {
      const claim = readRow('claims', Claim, claims[index]);
      const observation = readRow('observations', Observation, observations[index]);
      return claim === undefined || observation === undefined ? [] : [{ claim, observation }];
    });
    items.sort((a, b) => instantMs(a.claim.claimedAt) - instantMs(b.claim.claimedAt));
    return items.slice(0, MODEL_ASKS_PER_RUN);
  });
}

export interface IntelDeps {
  readonly grading: GradingDeps;
  /** Tells open pages which tables moved (./router.ts `announce`). */
  readonly notify: (tables: readonly LedgerTable[]) => void;
  /** The provider to ask (`chooseProvider` when absent). */
  readonly provider?: (db: LedgerDb) => Promise<IntelProvider | null>;
  /** How long one call may take (INTEL_TIMEOUT_MS when absent). */
  readonly timeoutMs?: number;
}

/**
 * Asks `provider` about one claim (header); true when the claim's answer was stored, from the model or the cache. `stop`
 * aborts the call when the person turns the model off or changes the key (./model-run.ts).
 */
async function askOne(
  db: LedgerDb,
  provider: IntelProvider,
  item: ModelAskItem,
  deps: IntelDeps,
  stop: AbortSignal,
): Promise<boolean> {
  const input = inputFor(provider, item.claim, [item.observation]);
  if (input === undefined) return false;
  const askedAt = IsoTs.parse(isoWithLocalOffset(new Date(deps.grading.nowMs())));
  const ask = { claimId: item.claim.id, inputsHash: inputsHash(input), provider: provider.id, askedAt };
  const outcome = await claimAsk(db, ask);
  if (outcome !== 'ask') return outcome === 'cached';
  const scores = await scoresFor(provider, input, deps.timeoutMs, stop);
  return scores !== undefined && answerAsk(db, item.claim.id, scores, askedAt);
}

/** Whether the person still has `provider`'s model on (header): read before each claim of a run (SEC-2). */
async function stillOn(db: LedgerDb, provider: IntelProvider): Promise<boolean> {
  const flags = await readFlags(db);
  return provider.id === 'byo' ? flags.ATTEST_MODEL_BYO : flags.ATTEST_MODEL;
}

/**
 * Asks about `items` one at a time (header), while the run is not stopped and the person still has the model on;
 * resolves how many claims got an answer.
 */
async function askEach(
  db: LedgerDb,
  provider: IntelProvider,
  items: readonly ModelAskItem[],
  deps: IntelDeps,
): Promise<number> {
  const run = startModelRun();
  let answered = 0;
  try {
    for (const item of items) {
      // Turned off, or stopped before or while the switch was read: ask no more.
      if (!(await stillOn(db, provider)) || run.signal.aborted) break;
      if (await askOne(db, provider, item, deps, run.signal)) answered += 1;
    }
  } finally {
    endModelRun(run);
  }
  return answered;
}

/**
 * Asks the model about every claim due (header), one at a time, then regrades when an answer was stored; resolves how
 * many claims got one. Never rejects: a failure is logged, and the receipts stay as the rules graded them.
 */
export async function askTheModel(db: LedgerDb, deps: IntelDeps): Promise<number> {
  try {
    // Nothing is read, and Chrome and the key's storage are not asked, unless a model is on and a claim is due.
    if (!modelOn(await readFlags(db))) return 0;
    const items = await claimsToAsk(db);
    if (items.length === 0) return 0;
    const provider = await (deps.provider ?? chooseProvider)(db);
    if (provider === null) return 0;
    const answered = await askEach(db, provider, items, deps);
    if (answered === 0) return 0;
    log.info('intel.answered', { provider: provider.id, claimCount: answered });
    if (changedReceipts(await runGradingBatch(db, deps.grading))) deps.notify(['receipts']);
    return answered;
  } catch (error) {
    log.error('intel.ask_failed', { error });
    return 0;
  }
}
