/**
 * `inputsHash` (docs/grading.md §3 "Hashes", §10, contract v1.5): SHA-256 of the canonical JSON of every grading
 * input, so replay can prove a receipt (Hard Rule 4). Internal to receipt.ts: import from there.
 *
 *   inputsHash = sha256(canonicalJson({claim, candidatesHash, grantHash, policyHash, coverageHash, context}))
 *
 * `candidatesHash` is Merkle-style: each candidate's `refHash` is the SHA-256 of `canonicalJson({id, contentHash,
 * observedAt, sightedAt?})` (its content is pinned by `contentHash`, and its id derives from it, §10; `sightedAt`,
 * the first sighting §4.1 and §7 read, is bound when the row has one, and canonical JSON drops it when it has none,
 * so a row without it hashes as it did before contract v1.8), computed once per observation object, and `candidatesHash` is the SHA-256 of the concatenated 32-byte `refHash` digests of the
 * candidates de-duplicated by id and sorted by id (among rows sharing an id, the one whose canonical JSON sorts
 * first is named, which `grade()` also grades); the empty list hashes the empty byte string. It binds exactly
 * the facts listing the refs would, without re-encoding them for every receipt.
 *
 * `grantHash` and `coverageHash` are the SHA-256 of the canonical JSON of the grant and of the coverage after
 * every set-like array is sorted and de-duplicated: `coverage.observers` (identical entries once), the grant's
 * `allowedTypes`, `counterpartyAllowlist`, `declaredScopes`, `observedScopes` and each `accounts[source]` list.
 * `context.attribution.signals` is sorted and de-duplicated too, so the hash depends on the inputs as sets,
 * never on the order a ledger reader returned them in. Strings sort by UTF-16 code unit, as canonical JSON keys
 * do. Every hash written into the canonical JSON is lowercase hex.
 *
 * The sub-hashes are computed once per batch (§3): one grant object and one coverage object are hashed for every
 * receipt of a batch, so each is remembered per object (hash.ts `memoHash`) while everything its canonical JSON
 * reads is unchanged, and so is each observation's `refHash` (`refHash`). A memo never changes a result.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { canonicalJson, type HashMemo, hashCanonical, memoHash, plainJson } from './hash';
import {
  type Claim,
  type Coverage,
  type GradeContext,
  type Grant,
  type Observation,
  type ObserverCoverage,
  Sha256,
} from './schema';
import { DIGEST_WORDS, sha256OfDigests, Sha256Writer } from './sha256';
import { compareText as compareTextShared } from './order';

/** What `grade()` hashes, after it dropped the coverage entries and candidates it ignores (§3). */
export interface GradeInputs {
  readonly claim: Claim | null;
  readonly candidates: readonly Observation[];
  readonly grant: Grant;
  readonly policyHash: string;
  readonly coverage: Coverage;
  readonly context: GradeContext;
}

/** The one code-unit order (order.ts), bound once: the test transform turns an imported call into a getter. */
const compareText = compareTextShared;

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

/**
 * How §3 names a candidate: its content is pinned by `contentHash`, and its id derives from it; when it was stored
 * (`observedAt`) and, when the ledger stored it later, when it was first seen (`sightedAt`, §4.1, §7).
 */
function candidateRef(
  candidate: Observation,
): Pick<Observation, 'id' | 'contentHash' | 'observedAt' | 'sightedAt'> {
  const { id, contentHash, observedAt, sightedAt } = candidate;
  return { id, contentHash, observedAt, sightedAt };
}

/** The writer of `refHash`, reset for each ref (synchronous: no ref ever sees another's state). */
const REF_WRITER = new Sha256Writer();

/**
 * SHA-256 of `canonicalJson({id, contentHash, observedAt, sightedAt?})`, as digest words: written piece by piece in
 * canonical key order (contentHash < id < observedAt < sightedAt; an absent `sightedAt` is left out, as canonical
 * JSON drops it), each value as `JSON.stringify` writes it, when each is a string, as a parsed Observation's are (the
 * bytes are exactly the canonical JSON's, without building it as one string); anything else goes through
 * `canonicalJson`, which also throws for what it cannot write.
 */
function writeRef(candidate: Observation): Sha256Writer {
  const { id, contentHash, observedAt, sightedAt } = candidate;
  const writer = REF_WRITER.reset();
  if (
    typeof id !== 'string' ||
    typeof contentHash !== 'string' ||
    typeof observedAt !== 'string' ||
    (sightedAt !== undefined && typeof sightedAt !== 'string')
  ) {
    writer.write(canonicalJson(candidateRef(candidate)));
    return writer;
  }
  const plain = plainJson(contentHash) && plainJson(id) && plainJson(observedAt);
  if (plain && (sightedAt === undefined || plainJson(sightedAt))) {
    // Each value is its JSON text between quotes (hash.ts `plainJson`), so the quotes join the fixed pieces.
    writer.write('{"contentHash":"');
    writer.write(contentHash);
    writer.write('","id":"');
    writer.write(id);
    writer.write('","observedAt":"');
    writer.write(observedAt);
    if (sightedAt !== undefined) {
      writer.write('","sightedAt":"');
      writer.write(sightedAt);
    }
    writer.write('"}');
    return writer;
  }
  writer.write('{"contentHash":');
  writer.write(JSON.stringify(contentHash));
  writer.write(',"id":');
  writer.write(JSON.stringify(id));
  writer.write(',"observedAt":');
  writer.write(JSON.stringify(observedAt));
  if (sightedAt !== undefined) {
    writer.write(',"sightedAt":');
    writer.write(JSON.stringify(sightedAt));
  }
  writer.write('}');
  return writer;
}

/**
 * `refHash(candidate)`'s words written into `out` from index `at`, computed afresh (no memo): a batch keeps each
 * row's refHash in its own table, one row per observation object, so each is still computed once per batch.
 */
export function refHashInto(candidate: Observation, out: Int32Array, at: number): void {
  writeRef(candidate).wordsInto(out, at);
}

interface HeldRef {
  readonly id: string;
  readonly contentHash: string;
  readonly observedAt: string;
  readonly sightedAt: string | undefined;
  readonly hash: Int32Array;
}

/**
 * Each observation's `refHash`, per object: an index hands one observation to every claim whose window holds it,
 * and its ref is hashed into each of their receipts (§3: "computed once per observation"). Used only while the
 * fields it was computed from are unchanged, so an observation edited in place is hashed again, never stale.
 */
const REF_HASHES = new WeakMap<Observation, HeldRef>();

/**
 * §3 `refHash` (v1.5; `sightedAt` bound since v1.8): SHA-256 of `canonicalJson({id, contentHash, observedAt,
 * sightedAt?})`, as its 32 raw bytes held in DIGEST_WORDS big-endian words. Remembered per observation object (see
 * above); callers never modify it.
 */
export function refHash(candidate: Observation): Int32Array {
  const { id, contentHash, observedAt, sightedAt } = candidate;
  const held = REF_HASHES.get(candidate);
  if (
    held?.id === id &&
    held.contentHash === contentHash &&
    held.observedAt === observedAt &&
    held.sightedAt === sightedAt
  ) {
    return held.hash;
  }
  const hash = writeRef(candidate).words();
  REF_HASHES.set(candidate, { id, contentHash, observedAt, sightedAt, hash });
  return hash;
}

/**
 * §3 v1.5 `candidatesHash` of `rows` (indexes into a table of refHash words, DIGEST_WORDS per row), in the order
 * given: SHA-256 of the concatenation of their 32-byte refHash digests, lowercase hex (no rows: SHA-256 of the
 * empty byte string). The caller gives the rows of distinct ids in id order.
 */
export function candidatesHashOfRows(refs: Int32Array, rows: ArrayLike<number>, count: number): string {
  return sha256OfDigests(refs, rows, count);
}

/** §3 v1.5 `candidatesHash` of candidates already one per id and in id order (`uniqueById`). */
export function candidatesHashById(sorted: readonly Observation[]): string {
  const writer = new Sha256Writer();
  for (const candidate of sorted) writer.writeWords(refHash(candidate), 0, DIGEST_WORDS);
  return writer.hex();
}

/** §3 v1.5 `candidatesHash` of a candidate list: one per id (`uniqueById`), in id order. */
export function candidatesHash(candidates: readonly Observation[]): string {
  return candidatesHashById(uniqueById(candidates));
}

/** What `inputsHash` hashes (§3), every hash lowercase hex: the candidates as `candidatesHash`, and so on. */
export interface HashedInputs {
  readonly claim: Claim | null;
  readonly candidatesHash: string;
  readonly grantHash: Sha256;
  readonly policyHash: string;
  readonly coverageHash: Sha256;
  readonly context: GradeContext;
}

/**
 * §3 `inputsHash` from its parts: SHA-256 of `canonicalJson({claim, candidatesHash, grantHash, policyHash,
 * coverageHash, context})`, `context.attribution.signals` sorted and de-duplicated.
 */
export function inputsHashOf(parts: HashedInputs): Sha256 {
  const { claim, candidatesHash: candidates, grantHash: grant, policyHash, coverageHash: coverage } = parts;
  const hashed = { claim, candidatesHash: candidates, grantHash: grant, policyHash, coverageHash: coverage };
  return Sha256.parse(hashCanonical({ ...hashed, context: canonicalContext(parts.context) }));
}

/**
 * §3 `inputsHash` (v1.5): SHA-256 of `canonicalJson({claim, candidatesHash, grantHash, policyHash, coverageHash,
 * context})`, the candidates de-duplicated by id and sorted by id inside `candidatesHash`, every set-like array
 * sorted and de-duplicated. Permuting or repeating a set's members never changes it.
 */
export function inputsHash(inputs: GradeInputs): Sha256 {
  return inputsHashOf({
    claim: inputs.claim,
    candidatesHash: candidatesHash(inputs.candidates),
    grantHash: grantHash(inputs.grant),
    policyHash: inputs.policyHash,
    coverageHash: coverageHash(inputs.coverage),
    context: inputs.context,
  });
}
