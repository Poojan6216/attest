/**
 * The advisory model's answers (sprint_5 5.4; agents/intel_engineer.md rule 7; docs/grading.md §3, §5.4): one row per
 * claim the service worker asked the model about (./types.ts `ModelAnswer`), keyed by the claim's id.
 *  - `claimAsk` writes the row before the call, in one readwrite transaction, unless the claim has one: a claim is
 *    asked once, even by two runs at once, and a worker stopped mid-call leaves a row that never gets scores, so that
 *    call is never made twice. When the same provider answered an input with the same hash before (the cache by
 *    `inputsHash`), the row is written with those scores and nothing is sent.
 *  - `answerAsk` adds the scores when the answer comes, as a stored fact, so the next batch grades with them.
 *  - `modelScoresOf` gives a grading batch the scores of the claims it grades, inside the batch's own transaction.
 *  - A claim's row goes with the claim in the retention purge (`purgeModelAnswers`, ./retention.ts), and with
 *    everything in Delete all data.
 * Ids, a hash, a provider id, an instant and numbers only: never the input, the answer's hint or a key (Hard Rule 2).
 */
import { noteStoredInstant } from './clock-high-water';
import { readRow, readRows, type LedgerDb } from './db';
import { parseWrite } from './errors';
import {
  type IsoTs,
  ModelAnswer,
  type ModelProvider,
  type ModelScores,
  type Sha256,
  type Ulid,
} from './types';

const WHERE = { table: 'modelAnswers' };
const REFUSED = 'Invalid model answer';

/** One ask, as `claimAsk` records it before the call. */
export interface ModelAsk {
  readonly claimId: Ulid;
  readonly inputsHash: Sha256;
  readonly provider: ModelProvider;
  readonly askedAt: IsoTs;
}

/** What `claimAsk` found: ask now, the answer copied from the cache, or the claim asked before. */
export type AskOutcome = 'ask' | 'cached' | 'asked';

/** The scores `provider` gave an input with this hash before, if it gave any. */
async function cachedScores(
  db: LedgerDb,
  inputsHash: Sha256,
  provider: ModelProvider,
): Promise<ModelScores | undefined> {
  const rows = await db.modelAnswers.where('inputsHash').equals(inputsHash).toArray();
  return readRows('modelAnswers', ModelAnswer, rows).find(
    (row) => row.provider === provider && row.scores !== undefined,
  )?.scores;
}

/** Records `ask` (header); `asked` when the claim has a row already, a row that does not parse included. */
export async function claimAsk(db: LedgerDb, ask: ModelAsk): Promise<AskOutcome> {
  return db.transaction('rw', [db.modelAnswers, db.meta], async (): Promise<AskOutcome> => {
    if ((await db.modelAnswers.get(ask.claimId)) !== undefined) return 'asked';
    const scores = await cachedScores(db, ask.inputsHash, ask.provider);
    const row = scores === undefined ? ask : { ...ask, scores };
    await db.modelAnswers.add(parseWrite(ModelAnswer, row, REFUSED, WHERE));
    if (scores === undefined) return 'ask';
    await noteStoredInstant(db, ask.askedAt);
    return 'cached';
  });
}

/** Adds the scores the model gave `claimId` (header), stored at `at`; false when its row is gone (purged meanwhile). */
export async function answerAsk(
  db: LedgerDb,
  claimId: Ulid,
  scores: ModelScores,
  at: IsoTs,
): Promise<boolean> {
  return db.transaction('rw', [db.modelAnswers, db.meta], async (): Promise<boolean> => {
    const row = readRow('modelAnswers', ModelAnswer, await db.modelAnswers.get(claimId));
    if (row === undefined) return false;
    await db.modelAnswers.put(parseWrite(ModelAnswer, { ...row, scores }, REFUSED, WHERE));
    await noteStoredInstant(db, at);
    return true;
  });
}

/** Which of `claimIds` were asked about already: a row of any kind counts. */
export async function askedClaims(db: LedgerDb, claimIds: readonly Ulid[]): Promise<Set<Ulid>> {
  const rows = await db.modelAnswers.bulkGet([...claimIds]);
  return new Set(claimIds.filter((_, index) => rows[index] !== undefined));
}

/** The scores of those of `claimIds` the model answered for, by claim id (header). */
export async function modelScoresOf(
  db: LedgerDb,
  claimIds: readonly Ulid[],
): Promise<Map<Ulid, ModelScores>> {
  const scores = new Map<Ulid, ModelScores>();
  for (const row of await db.modelAnswers.bulkGet([...claimIds])) {
    const answer = readRow('modelAnswers', ModelAnswer, row);
    if (answer?.scores !== undefined) scores.set(answer.claimId, answer.scores);
  }
  return scores;
}

/** Deletes the rows of `claimIds`, with their claims (./retention.ts rule 12); returns how many went. */
export async function purgeModelAnswers(db: LedgerDb, claimIds: readonly string[]): Promise<number> {
  const held = (await db.modelAnswers.bulkGet([...claimIds])).filter((row) => row !== undefined).length;
  await db.modelAnswers.bulkDelete([...claimIds]);
  return held;
}
