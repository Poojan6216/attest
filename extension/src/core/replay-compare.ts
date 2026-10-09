/**
 * What replay compares (docs/grading.md §3, §8, §9, §10). Internal to replay.ts.
 *
 * `compareReceipts(stored, replayed)`: every computed field of a stored receipt against the receipt `grade` returns
 * for the same subject and inputs. A receipt is reproduced only if grading it again gives it back exactly: §9 names
 * `inputsHash`, `grade`, `ruleId` and `state`, and the receipt carries more that grading decided and that no event
 * changes (state.ts: only `regrade` writes a computed field), so a stored receipt whose evidence (`observationIds`),
 * confidence, signals, reasons, agent, policy, or times were edited is not reproduced either. The lifecycle part is
 * set aside first, because it records user and background events, not grading (§8): an overridden receipt is
 * compared on its `previousState`, and `override`, `reverted`, `supersededBy` and the lifecycle reasons they imply
 * (`override.user`, `superseded`) are not compared.
 *
 * `contentHashOf(observation)`: the §10 content hash recomputed from the observation's own fields, as `project`
 * computes it (SHA-256 of the canonical JSON of everything but `id`, `observedAt` and `contentHash`). `inputsHash`
 * names a candidate by `{id, contentHash, observedAt}` (§3), which pins its content only if `contentHash` really is
 * the hash of that content, so replay checks it for every observation it grades with.
 *
 * Report values are ids, hashes, grades, rule ids, states, numbers and timestamps; `signals` and `reasons` are
 * reported by the SHA-256 of their canonical JSON (Hard Rules 2, 10).
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { canonicalJson, hashCanonical } from './hash';
import { contentHashOf as projectedContentHash } from './redact';
import type { Observation, Reason, Receipt } from './schema';

/** The compared receipt fields, in report order: the subject, the four of §9, then Receipt schema order. */
export const COMPARED_FIELDS = [
  'id',
  'inputsHash',
  'grade',
  'ruleId',
  'state',
  'agent',
  'claimId',
  'observationIds',
  'requestId',
  'confidence',
  'reasons',
  'signals',
  'policyHash',
  'attribution',
  'computedAt',
  'finalAt',
  'finalFrom',
] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

/** One compared field that differs: both values as the report shows them (null: absent). */
export interface FieldDifference {
  readonly field: ComparedField;
  readonly stored: string | null;
  readonly replayed: string | null;
}

/** The reasons an event adds beside the graded ones (§8, §15); replay compares only what grading wrote. */
const LIFECYCLE_REASONS: ReadonlySet<Reason['code']> = new Set(['override.user', 'superseded']);

/** The receipt as grading wrote it: the state before any override, and only the graded reasons. */
function computedPart(receipt: Receipt): Record<ComparedField, unknown> {
  return {
    id: receipt.id,
    inputsHash: receipt.inputsHash,
    grade: receipt.grade,
    ruleId: receipt.ruleId,
    state: receipt.override?.previousState ?? receipt.state,
    agent: receipt.agent,
    claimId: receipt.claimId,
    observationIds: receipt.observationIds,
    requestId: receipt.requestId,
    confidence: receipt.confidence,
    reasons: receipt.reasons.filter((reason) => !LIFECYCLE_REASONS.has(reason.code)),
    signals: receipt.signals,
    policyHash: receipt.policyHash,
    attribution: receipt.attribution,
    computedAt: receipt.computedAt,
    finalAt: receipt.finalAt,
    finalFrom: receipt.finalFrom,
  };
}

/** A compared value as the report shows it: strings as they are, `signals` and `reasons` by hash. */
function shown(field: ComparedField, value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  return field === 'signals' || field === 'reasons' ? hashCanonical(value) : canonicalJson(value);
}

/** Every compared field on which `stored` (lifecycle set aside) and `replayed` differ, in COMPARED_FIELDS order. */
export function compareReceipts(stored: Receipt, replayed: Receipt): FieldDifference[] {
  const was = computedPart(stored);
  const now = computedPart(replayed);
  const found: FieldDifference[] = [];
  for (const field of COMPARED_FIELDS) {
    const [a, b] = [was[field], now[field]];
    if (a === b) continue;
    if (a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b)) continue;
    found.push({ field, stored: shown(field, a), replayed: shown(field, b) });
  }
  return found;
}

/** The §10 content hash of `observation`, recomputed from its own content fields (see the file comment). */
export function contentHashOf(observation: Observation): string {
  return projectedContentHash(observation); // redact.ts: the one definition project() and the ledger use
}
