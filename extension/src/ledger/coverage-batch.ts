/**
 * The coverage of a whole grading batch (sprint_3 3.13; docs/grading.md §3 Background obligations): `coverageFor` of
 * each claim's window and of the window orphans are looked for in, as one `Coverage`, since `gradeBatch` grades every
 * claim and orphan of a batch with one. Kept apart from ./coverage.ts, whose readers it shares.
 */
import { instantMs } from '../core/normalize';
import type { Policy } from '../core/policy';
import type { PlacedEntry } from './coverage-merge';
import { parseCoverageInput } from './coverage-store';
import { checkQuery, type CoverageQuery, coverageOf, entriesIn, type ReadCache } from './coverage';
import type { LedgerDb } from './db';
import { LedgerError } from './errors';
import { type Coverage, IsoTs } from './types';

/**
 * The one coverage a grading batch grades with (§3; src/background/grading.ts): every entry `coverageFor` returns
 * for any of `queries`, each once, in the same fixed order, read in one transaction (the caller's when there is one).
 * A union of entry sets each closed under overlap is closed under overlap, so its `gcal.event` entries stay closed
 * (v1.9). Every query must be evaluated at `evaluatedAt` (`LedgerError('invalid_input')` otherwise, before any read).
 */
export async function coverageForBatch(
  db: LedgerDb,
  evaluatedAt: string,
  queries: readonly CoverageQuery[],
  policy: Pick<Policy, 'sourcesByType'>,
): Promise<Coverage> {
  const at = parseCoverageInput(IsoTs, evaluatedAt, 'evaluatedAt');
  const checked = queries.map(checkQuery);
  if (checked.some((query) => query.evaluatedMs !== instantMs(at))) {
    throw new LedgerError('invalid_input', 'Every query of a batch is evaluated at its instant', {
      field: 'evaluatedAt',
    });
  }
  return db.transaction('r', db.coverageIntervals, async (): Promise<Coverage> => {
    const cache: ReadCache = new Map();
    const found = new Map<string, PlacedEntry>();
    for (const query of checked) {
      for (const [key, placed] of await entriesIn(db, query, policy, cache)) found.set(key, placed);
    }
    return coverageOf(at, found);
  });
}
