/**
 * `inputsHash` (docs/grading.md §3, §10): SHA-256 of the canonical JSON of every grading input, so replay can
 * prove a receipt (Hard Rule 4). Internal to receipt.ts: import from there.
 *
 * Every set-like array is sorted and de-duplicated before hashing, so the hash depends on the inputs as sets,
 * never on the order a ledger reader returned them in: `coverage.observers` (identical entries once), the grant's
 * `allowedTypes`, `counterpartyAllowlist`, `declaredScopes`, `observedScopes` and each `accounts[source]` list,
 * `context.attribution.signals`, and the candidates (by id; among rows sharing an id, the one whose canonical
 * JSON sorts first, which `grade()` also grades). Strings sort by UTF-16 code unit, as canonical JSON keys do.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { canonicalJson, sha256Hex } from './hash';
import {
  type Claim,
  type Coverage,
  type GradeContext,
  type Grant,
  type Observation,
  type ObserverCoverage,
  Sha256,
} from './schema';

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
 * One candidate per id, sorted by id. Ids derive from content hashes (§10), so two rows sharing an id are the
 * same observation; if a corrupt ledger hands over two different rows with one id, the one whose canonical JSON
 * sorts first is kept, so the choice never depends on input order.
 */
export function uniqueById<T extends Observation>(candidates: readonly T[]): T[] {
  const kept = new Map<string, T>();
  for (const candidate of candidates) {
    const held = kept.get(candidate.id);
    if (held === undefined || (held !== candidate && canonicalJson(candidate) < canonicalJson(held))) {
      kept.set(candidate.id, candidate);
    }
  }
  return [...kept.values()].sort((a, b) => compareText(a.id, b.id));
}

/** An absent value sorts first; then by UTF-16 code unit (`false` before `true`). */
function compareOptional(a: string | boolean | undefined, b: string | boolean | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return compareText(String(a), String(b));
}

/**
 * A total order on observer entries: field by field (cheap: one coverage list is hashed for every receipt of a
 * batch), then, only for entries equal on every field compared, by canonical JSON, so two entries are ever
 * treated as one only when their canonical JSON is identical.
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

function canonicalContext(context: GradeContext): Record<string, unknown> {
  const { attribution } = context;
  return {
    ...context,
    attribution:
      attribution === undefined ? undefined : { ...attribution, signals: sortedSet(attribution.signals) },
  };
}

/**
 * §3 `inputsHash`: SHA-256 of `canonicalJson({claim, candidates, grant, policyHash, coverage, context})` after
 * every set-like array is sorted and de-duplicated. Permuting or repeating a set's members never changes it.
 */
export function inputsHash(inputs: GradeInputs): Sha256 {
  const canonical = {
    claim: inputs.claim,
    candidates: uniqueById(inputs.candidates),
    grant: canonicalGrant(inputs.grant),
    policyHash: inputs.policyHash,
    coverage: {
      evaluatedAt: inputs.coverage.evaluatedAt,
      observers: canonicalObservers(inputs.coverage.observers),
    },
    context: canonicalContext(inputs.context),
  };
  return Sha256.parse(sha256Hex(canonicalJson(canonical)));
}
