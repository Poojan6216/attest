/**
 * A batch's claim receipts (docs/grading.md §3, §4.3, §5, §8; the task 1.5 grading perf gate). Internal to
 * gradeBatch.
 *
 * `grade(claim, candidates, grant, policy, coverage, context)` derives its evidence from the claim's exclusive
 * candidates: the coverage it sees, the best candidate, the candidates' `candidatesHash`, and (through its
 * conditions) the claim's eligible coverage. A batch already holds every piece: each pair's exact score
 * (batch-score.ts), each row's `refHash` and id rank (batch-table.ts), and the coverage, grant and eligibility it
 * shares between claims. So it derives the same evidence from its tables and hands it to `gradeClaim`, which
 * decides and writes the receipt exactly as `grade` does. A table holding two rows with one id (a corrupt ledger)
 * is left to `grade` itself, which picks the row it names. The perf gate checks every 50th receipt against `grade`.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { grantOf } from './batch-grants';
import { compareAt, type ScoredClaim } from './batch-score';
import { eligibilityKey, type EligibleCoverage, eligibleCoverage } from './conditions';
import { type BestCandidate, visibleCoverage } from './grade-best';
import { type ClaimEvidence, grade, gradeClaim, type SharedEvidence } from './grade';
import type { Policy } from './policy';
import { candidatesHashById, coverageHash, grantHash } from './receipt';
import type {
  AgentId,
  Claim,
  Coverage,
  GradeContext,
  Grant,
  ModelScores,
  Observation,
  Receipt,
  Sha256,
  Ulid,
} from './schema';

/**
 * Imported functions called once per pair or row, bound here once: the test runner's module transform turns every
 * read of an imported binding into a getter call (normalize-time.ts binds its units for the same reason).
 */
const compareAtLocal = compareAt;

/**
 * What a caller stores beside a batch receipt so replay can grade it again (§3, §9 `receiptInputs`): the grant in
 * force and the context it was graded with, and the policy's hash. The coverage is the batch's own, so it is not
 * repeated per receipt.
 */
export interface BatchInputs {
  readonly grant: Grant;
  readonly context: GradeContext;
  readonly policyHash: Sha256;
}

/** One receipt of a batch and the inputs it was graded with (§3). */
export interface BatchReceipt {
  readonly receipt: Receipt;
  readonly inputs: BatchInputs;
}

/** What every claim receipt of one batch shares. */
export interface ReceiptBatch {
  readonly policy: Policy;
  /** The coverage as given (`grade` filters it itself). */
  readonly coverage: Coverage;
  readonly grants: ReadonlyMap<AgentId, Grant>;
  readonly assignment: ReadonlyMap<Ulid, Ulid>;
  readonly taken: ReadonlySet<Ulid>;
  /**
   * §6.3 `priorSpendCents` of a claim against the batch's spend history (scope.ts `spendIndex`), a missing currency
   * read as the grant's `spendCurrency`.
   */
  readonly priorSpend: (claim: Claim, spendCurrency: string | undefined) => number;
  /** §5.4 (v1.19): the advisory model's scores of a claim's candidates, by claim id; a claim with none has no entry. */
  readonly modelScores: ReadonlyMap<Ulid, ModelScores>;
}

/** The evidence parts every grading of a batch shares, each computed once per batch (or per grant), on first use. */
export class BatchEvidence {
  #visible: Coverage | undefined;
  #coverageHash: Sha256 | undefined;
  readonly #grantHashes = new Map<AgentId, Sha256>();
  readonly #eligible = new Map<string, EligibleCoverage>();

  constructor(readonly batch: Pick<ReceiptBatch, 'policy' | 'coverage'>) {}

  /** The coverage `grade` sees (grade-best.ts `visibleCoverage`). */
  visible(): Coverage {
    this.#visible ??= visibleCoverage(this.batch.coverage);
    return this.#visible;
  }

  /** §3 `coverageHash` of the visible coverage. */
  coverageHash(): Sha256 {
    this.#coverageHash ??= coverageHash(this.visible());
    return this.#coverageHash;
  }

  /** §3 `grantHash` of the grant in force for `grant.agent` (one grant per agent in a batch). */
  grantHash(grant: Grant): Sha256 {
    const held = this.#grantHashes.get(grant.agent);
    if (held !== undefined) return held;
    const hash = grantHash(grant);
    this.#grantHashes.set(grant.agent, hash);
    return hash;
  }

  readonly #scratch: Int32Array[] = [new Int32Array(0), new Int32Array(0)];

  /**
   * Scratch buffer `which` (0 or 1) of at least `length` entries, reused claim after claim: each claim's receipt is
   * finished (its candidates hashed) before the next claim's starts, and nothing else writes it.
   */
  scratch(which: number, length: number): Int32Array {
    const held = this.#scratch[which] ?? new Int32Array(0);
    if (held.length >= length) return held;
    const grown = new Int32Array(Math.max(length, held.length + held.length));
    this.#scratch[which] = grown;
    return grown;
  }

  readonly #shared = new Map<AgentId, SharedEvidence>();

  /** `grade`'s shared evidence for `grant` (`SharedEvidence`), one object per grant (agent) of the batch. */
  shared(grant: Grant): SharedEvidence {
    const held = this.#shared.get(grant.agent);
    if (held !== undefined) return held;
    const made: SharedEvidence = {
      coverage: this.visible(),
      grantHash: () => this.grantHash(grant),
      coverageHash: () => this.coverageHash(),
    };
    this.#shared.set(grant.agent, made);
    return made;
  }

  /** The claim's eligible coverage, shared by every claim of its agent with its eligibility key. */
  eligible(claim: Claim, grant: Grant): EligibleCoverage {
    const { policy } = this.batch;
    const key = `${grant.agent} ${eligibilityKey(claim, policy)}`;
    const held = this.#eligible.get(key);
    if (held !== undefined) return held;
    const eligible = eligibleCoverage(claim, grant, this.visible(), policy);
    this.#eligible.set(key, eligible);
    return eligible;
  }
}

/**
 * Writes to `kept` the positions (into the claim's rows) of the candidates `grade` sees, §4.3
 * `exclusiveCandidates`; returns how many. They pass `grade`'s candidate check (grade-guard.ts) by construction:
 * batch retrieval returns exactly `candidates()` per claim (the same type, source, window and first-seen predicates,
 * order.ts and window.ts).
 */
function keptPositions(scored: ScoredClaim, batch: ReceiptBatch, kept: Int32Array): number {
  const { table, rows } = scored.found;
  let count = 0;
  for (let k = 0; k < rows.length; k += 1) {
    if (!table.visibleTo(rows[k] ?? 0, scored.claim.id, batch.assignment, batch.taken)) continue;
    kept[count] = k;
    count += 1;
  }
  return count;
}

/**
 * grade-best.ts `bestCandidate` from the batch's scores, over the first `count` positions of `kept`: the highest
 * exact score, ties to the lower observation id (ids are distinct here, so the winner does not depend on the order
 * the candidates are read in); its display signals and reasons are `features` of that pair.
 */
function bestOf(scored: ScoredClaim, kept: Int32Array, count: number): BestCandidate | null {
  const { table, rows } = scored.found;
  let best = -1;
  for (let i = 0; i < count; i += 1) {
    const k = kept[i] ?? 0;
    const order = best < 0 ? 1 : compareAtLocal(scored, k, best);
    if (order > 0 || (order === 0 && table.id(rows[k] ?? 0) < table.id(rows[best] ?? 0))) best = k;
  }
  if (best < 0) return null;
  const row = rows[best] ?? 0;
  const observation = table.rows[row];
  if (observation === undefined) return null;
  return { observation, ...scored.scorer.result(table.facts(row)) };
}

/** The rows at `kept` as observations (for `grade` itself). */
function observationsAt(scored: ScoredClaim, kept: Int32Array): Observation[] {
  const { table, rows } = scored.found;
  return Array.from(kept, (k) => table.rows[rows[k] ?? 0]).filter(
    (row): row is Observation => row !== undefined,
  );
}

/** One claim's receipt: `grade` of its exclusive candidates, from the batch's tables (see the file comment). */
function claimReceipt(
  claim: Claim,
  scored: ScoredClaim | null,
  batch: ReceiptBatch,
  shared: BatchEvidence,
): BatchReceipt {
  const length = scored?.found.rows.length ?? 0;
  const [kept, order] = [shared.scratch(0, length), shared.scratch(1, length)];
  const count = scored === null ? 0 : keptPositions(scored, batch, kept);
  const grant = grantOf(batch.grants, claim.agent);
  const modelScores = batch.modelScores.get(claim.id);
  const context: GradeContext = {
    priorSpendCents: batch.priorSpend(claim, grant.spendCurrency),
    ...(modelScores === undefined ? {} : { modelScores }),
  };
  const { policy } = batch;
  const inputs: BatchInputs = { grant, context, policyHash: policy.policyHash };
  if (scored !== null && scored.found.table.ranks() === null) {
    const candidates = observationsAt(scored, kept.subarray(0, count));
    return { receipt: grade(claim, candidates, grant, policy, batch.coverage, context), inputs };
  }
  const candidatesHash = (): string =>
    scored === null
      ? candidatesHashById([])
      : scored.found.table.candidatesHash(scored.found.rows, kept, count, order);
  const evidence: ClaimEvidence = {
    ...shared.shared(grant),
    best: scored === null ? null : bestOf(scored, kept, count),
    candidatesHash,
    eligible: shared.eligible(claim, grant),
  };
  return { receipt: gradeClaim(claim, evidence, grant, policy, context), inputs };
}

/**
 * One receipt per claim, in claim order (§3, §4.3, §6.3), each with its inputs: `scored` holds the batch's
 * assignable claims (the others have no candidates), and `grade` sees each claim's candidates minus those assigned
 * to other claims or taken.
 */
export function claimReceipts(
  claims: readonly Claim[],
  scored: ReadonlyMap<Claim, ScoredClaim>,
  batch: ReceiptBatch,
  shared: BatchEvidence,
): BatchReceipt[] {
  return claims.map((claim) => claimReceipt(claim, scored.get(claim) ?? null, batch, shared));
}
