/**
 * `inputsHash` (docs/grading.md §3 "Hashes", §10): SHA-256 of the canonical JSON of every grading input, so
 * replay can prove a receipt (Hard Rule 4). Internal to receipt.ts: import from there.
 *
 *   inputsHash = sha256(canonicalJson({claim, candidates: [{id, contentHash, observedAt}] sorted by id,
 *                                      grantHash, policyHash, coverageHash, context}))
 *
 * `grantHash` and `coverageHash` are the SHA-256 of the canonical JSON of the grant and of the coverage after
 * every set-like array is sorted and de-duplicated: `coverage.observers` (identical entries once), the grant's
 * `allowedTypes`, `counterpartyAllowlist`, `declaredScopes`, `observedScopes` and each `accounts[source]` list.
 * `context.attribution.signals` is sorted and de-duplicated too, so the hash depends on the inputs as sets,
 * never on the order a ledger reader returned them in. Strings sort by UTF-16 code unit, as canonical JSON keys
 * do. A candidate is named by `{id, contentHash, observedAt}`: its content is pinned by `contentHash`, and its id
 * derives from it (§10); among rows sharing an id, the one whose canonical JSON sorts first is named, which
 * `grade()` also grades.
 *
 * The two sub-hashes are computed once per batch (§3): one grant object and one coverage object are hashed for
 * every receipt of a batch, so each is remembered per object (hash.ts `memoHash`) while everything its canonical
 * JSON reads is unchanged. A memo never changes a result.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { canonicalJson, type HashMemo, memoHash } from './hash';
import {
  type Claim,
  type Coverage,
  type GradeContext,
  type Grant,
  type Observation,
  type ObserverCoverage,
  Sha256,
} from './schema';
import { Sha256Writer } from './sha256';

/** What `grade()` hashes, after it dropped the coverage entries and candidates it ignores (§3). */
export interface GradeInputs {
  readonly claim: Claim | null;
  readonly candidates: readonly Observation[];
  readonly grant: Grant;
  readonly policyHash: string;
  readonly coverage: Coverage;
  readonly context: GradeContext;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The distinct values, sorted by UTF-16 code unit. */
function sortedSet<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareText);
}

/**
 * One candidate per id, in first-seen order. Ids derive from content hashes (§10), so two rows sharing an id are
 * the same observation; if a corrupt ledger hands over two different rows with one id, the one whose canonical
 * JSON sorts first is kept, so the choice never depends on input order.
 */
export function uniqueRows<T extends Observation>(candidates: readonly T[]): T[] {
  const kept = new Map<string, T>();
  for (const candidate of candidates) {
    const held = kept.get(candidate.id);
    if (held === undefined || (held !== candidate && canonicalJson(candidate) < canonicalJson(held))) {
      kept.set(candidate.id, candidate);
    }
  }
  return [...kept.values()];
}

/** One candidate per id (`uniqueRows`), sorted by id. */
export function uniqueById<T extends Observation>(candidates: readonly T[]): T[] {
  return uniqueRows(candidates).sort((a, b) => compareText(a.id, b.id));
}

/**
 * Id-sorted forms of frozen candidate lists with no repeated id, recorded by `grade`'s `visibleInputs` (which sorts
 * by id anyway, to find repeats) so `inputsHash` does not sort the same list again.
 */
const BY_ID = new WeakMap<readonly Observation[], readonly Observation[]>();

/** Records `sorted` as `uniqueById(list)`: `list` must be frozen, and `sorted` its members by strictly rising id. */
export function rememberById(list: readonly Observation[], sorted: readonly Observation[]): void {
  if (Object.isFrozen(list) && sorted.length === list.length) BY_ID.set(list, sorted);
}

function risingIds(sorted: readonly Observation[]): boolean {
  for (let i = 1; i < sorted.length; i += 1) {
    if ((sorted[i - 1]?.id ?? '') >= (sorted[i]?.id ?? '')) return false;
  }
  return true;
}

/**
 * `uniqueById(candidates)`, from the record when there is one and it still holds: the list is frozen, so the
 * recorded members are its members, and while their ids still rise strictly they are distinct and in id order,
 * which is exactly what `uniqueById` returns (it drops nothing from a list with no repeated id).
 */
function candidatesById(candidates: readonly Observation[]): readonly Observation[] {
  const held = BY_ID.get(candidates);
  if (held?.length === candidates.length && risingIds(held)) return held;
  return uniqueById(candidates);
}

/** An absent value sorts first; then by UTF-16 code unit (`false` before `true`). */
function compareOptional(a: string | boolean | undefined, b: string | boolean | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return compareText(String(a), String(b));
}

/**
 * A total order on observer entries: field by field, then, only for entries equal on every field compared, by
 * canonical JSON, so two entries are ever treated as one only when their canonical JSON is identical.
 */
function compareObservers(a: ObserverCoverage, b: ObserverCoverage): number {
  return (
    compareText(a.source, b.source) ||
    compareText(a.lastSyncAt, b.lastSyncAt) ||
    compareText(a.windowStart, b.windowStart) ||
    compareText(a.windowEnd, b.windowEnd) ||
    compareText(a.observerId, b.observerId) ||
    compareOptional(a.accountHash, b.accountHash) ||
    compareOptional(a.allCalendars, b.allCalendars) ||
    compareText(canonicalJson(a), canonicalJson(b))
  );
}

/** The observer entries as a set: sorted by `compareObservers`, identical entries once. */
function canonicalObservers(observers: readonly ObserverCoverage[]): ObserverCoverage[] {
  const sorted = [...observers].sort(compareObservers);
  return sorted.filter((observer, i) => {
    const previous = sorted[i - 1];
    return previous === undefined || compareObservers(previous, observer) !== 0;
  });
}

function canonicalAccounts(accounts: NonNullable<Grant['accounts']>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [source, hashes] of Object.entries(accounts)) out[source] = sortedSet(hashes);
  return out;
}

/** The grant with every set-like array sorted and de-duplicated (§3). */
function canonicalGrant(grant: Grant): Record<string, unknown> {
  return {
    ...grant,
    allowedTypes: sortedSet(grant.allowedTypes),
    counterpartyAllowlist: sortedSet(grant.counterpartyAllowlist),
    declaredScopes: sortedSet(grant.declaredScopes),
    observedScopes: grant.observedScopes === undefined ? undefined : sortedSet(grant.observedScopes),
    accounts: grant.accounts === undefined ? undefined : canonicalAccounts(grant.accounts),
  };
}

/** The coverage with its observer entries as a set (§3). */
function canonicalCoverage(coverage: Coverage): Record<string, unknown> {
  return { ...coverage, observers: canonicalObservers(coverage.observers) };
}

function canonicalContext(context: GradeContext): Record<string, unknown> {
  const { attribution } = context;
  return {
    ...context,
    attribution:
      attribution === undefined ? undefined : { ...attribution, signals: sortedSet(attribution.signals) },
  };
}

const GRANT_HASHES: HashMemo<Grant, Sha256> = new WeakMap();
const COVERAGE_HASHES: HashMemo<Coverage, Sha256> = new WeakMap();
const asSha256 = (hex: string): Sha256 => Sha256.parse(hex);

/** §3 `grantHash`: SHA-256 of the canonical JSON of the grant, its set-like arrays sorted and de-duplicated. */
export function grantHash(grant: Grant): Sha256 {
  return memoHash(GRANT_HASHES, grant, canonicalGrant, asSha256);
}

/** §3 `coverageHash`: SHA-256 of the canonical JSON of the coverage, its observer entries as a set. */
export function coverageHash(coverage: Coverage): Sha256 {
  return memoHash(COVERAGE_HASHES, coverage, canonicalCoverage, asSha256);
}

/** How §3 names a candidate: its content is pinned by `contentHash`, and its id derives from it. */
function candidateRef(candidate: Observation): Pick<Observation, 'id' | 'contentHash' | 'observedAt'> {
  return { id: candidate.id, contentHash: candidate.contentHash, observedAt: candidate.observedAt };
}

interface RefText {
  readonly id: string;
  readonly contentHash: string;
  readonly observedAt: string;
  /** `,` and the canonical JSON of the ref (the first ref of a list is written without its comma). */
  readonly text: string;
}

/**
 * The canonical JSON of each candidate's ref, per observation object: an index hands one observation to every
 * claim whose window holds it, and its ref is hashed into each of their receipts. Used only while the three
 * fields it was written from are unchanged, so an observation edited in place is written again, never stale.
 */
const REF_TEXTS = new WeakMap<Observation, RefText>();

/**
 * `,` and `canonicalJson({id, contentHash, observedAt})`: written out in canonical key order (contentHash < id <
 * observedAt) when all three are strings, as a parsed Observation's are; anything else goes through
 * `canonicalJson`, which also throws for what it cannot write.
 */
function writeRef(candidate: Observation): string {
  const { id, contentHash, observedAt } = candidate;
  if (typeof id !== 'string' || typeof contentHash !== 'string' || typeof observedAt !== 'string') {
    return `,${canonicalJson(candidateRef(candidate))}`;
  }
  const hash = JSON.stringify(contentHash);
  return `,{"contentHash":${hash},"id":${JSON.stringify(id)},"observedAt":${JSON.stringify(observedAt)}}`;
}

function refText(candidate: Observation): string {
  const { id, contentHash, observedAt } = candidate;
  const held = REF_TEXTS.get(candidate);
  if (held?.id === id && held.contentHash === contentHash && held.observedAt === observedAt) return held.text;
  const text = writeRef(candidate);
  REF_TEXTS.set(candidate, { id, contentHash, observedAt, text });
  return text;
}

/**
 * §3 `inputsHash`: SHA-256 of `canonicalJson({claim, candidates, grantHash, policyHash, coverageHash, context})`,
 * candidates named by `{id, contentHash, observedAt}` and sorted by id, every set-like array sorted and
 * de-duplicated. Permuting or repeating a set's members never changes it.
 *
 * `candidates` sorts before every other key, so the canonical JSON of the whole object is `{"candidates":[…],`
 * followed by the canonical JSON of the rest without its opening brace (the rest is never empty: it always holds
 * the three hashes). It is streamed into the hash piece by piece (each ref written once per observation,
 * `refText`) rather than built as one string: a calendar claim names hundreds of candidates. receipt.spec.ts pins
 * this to the plain `canonicalJson` of the whole object.
 */
export function inputsHash(inputs: GradeInputs): Sha256 {
  const rest = canonicalJson({
    claim: inputs.claim,
    grantHash: grantHash(inputs.grant),
    policyHash: inputs.policyHash,
    coverageHash: coverageHash(inputs.coverage),
    context: canonicalContext(inputs.context),
  });
  const writer = new Sha256Writer();
  writer.write('{"candidates":[');
  candidatesById(inputs.candidates).forEach((candidate, i) => {
    writer.write(refText(candidate), i === 0 ? 1 : 0);
  });
  writer.write('],');
  writer.write(rest, 1);
  return Sha256.parse(writer.hex());
}
