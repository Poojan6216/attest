/**
 * The inputs receipt.spec.ts and receipt-hash.spec.ts share (docs/grading.md §3, §8): one claim, two observations,
 * a grant, a coverage and a context, the §3 candidatesHash recomputed with Node's crypto, and the parts of a VERIFIED
 * claim receipt.
 */
import { createHash } from 'node:crypto';

import defaultPolicyJson from '../../../../policy/default.json';
import { canonicalJson, sha256Hex } from '../../../src/core/hash';
import { type GradeInputs, type ReceiptParts } from '../../../src/core/receipt';
import { Attribution, IsoTs, type Observation, Sha256 } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export const EVAL = '2026-10-06T15:00:00-04:00';
const VIEW = PolicyView.parse(defaultPolicyJson);
export const CLAIM = buildClaim({
  ref: 'c1',
  agent: 'muse',
  type: 'email.sent',
  counterparty: 'priya@company.com',
  claimedAt: '2026-10-06T14:02:00-04:00',
});
const obs = (ref: string, counterparty: string): Observation =>
  buildObservation(
    { ref, source: 'gmail.sent', type: 'email.sent', counterparty, occurredAt: '2026-10-06T14:02:00-04:00' },
    [],
    EVAL,
    VIEW,
  );
export const O1 = obs('o1', 'priya@company.com');
export const O2 = obs('o2', 'raj@company.com');
export const POLICY_HASH = sha256Hex('policy');

export function inputs(over: Partial<GradeInputs> = {}): GradeInputs {
  return {
    claim: CLAIM,
    candidates: [O1, O2],
    grant: buildGrant(
      {
        agent: 'muse',
        allowedTypes: ['email.sent', 'calendar.created'],
        counterpartyAllowlist: ['company.com', 'b@x.example'],
        declaredScopes: ['gmail.send', 'calendar.write'],
        observedScopes: ['gmail.read', 'gmail.send'],
        accounts: { 'gmail.sent': ['acct-a', 'acct-b'] },
      },
      EVAL,
    ),
    policyHash: POLICY_HASH,
    coverage: buildCoverage(
      [
        { source: 'gmail.sent', lastSyncAt: EVAL, windowStart: '2026-10-06T12:00:00-04:00', windowEnd: EVAL },
        { source: 'gcal.event', lastSyncAt: EVAL, windowStart: '2026-10-01T00:00:00-04:00', windowEnd: EVAL },
      ],
      EVAL,
    ),
    context: {
      priorSpendCents: 0,
      attribution: Attribution.parse({
        agent: 'muse',
        scoreBp: 7000,
        signals: ['userIdle', 'agentSessionActive'],
      }),
    },
    ...over,
  };
}

/** SHA-256 with Node's crypto, independent of core's own implementation. */
export const nodeSha256 = (data: string | Buffer): Buffer => createHash('sha256').update(data).digest();

/**
 * §3 v1.5, recomputed from the contract with Node's crypto: each candidate's refHash is the SHA-256 of the canonical
 * JSON of {id, contentHash, observedAt}; candidatesHash is the SHA-256 of their 32-byte digests concatenated in id
 * order, one per id (the empty list hashes the empty byte string).
 */
export function definedCandidatesHash(candidates: readonly Observation[]): string {
  const byId = new Map(candidates.map((o) => [o.id, o]));
  const refs = [...byId.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((o) =>
      nodeSha256(canonicalJson({ id: o.id, contentHash: o.contentHash, observedAt: o.observedAt })),
    );
  return nodeSha256(Buffer.concat(refs)).toString('hex');
}

/** The parts of a FINAL, VERIFIED receipt for CLAIM matched by O1, with `over` applied. */
export const receiptParts = (over: Partial<ReceiptParts> = {}): ReceiptParts => ({
  subject: { k: 'claim', claimId: CLAIM.id },
  agent: 'muse',
  claim: CLAIM,
  observationIds: [O1.id],
  grade: 'VERIFIED',
  confidence: 1,
  ruleId: 'verified',
  reasons: {
    rule: [],
    allowlist: [],
    coverage: [],
    match: [{ code: 'match.best', params: { observationId: O1.id } }],
  },
  signals: { timeProximity: 1, score: 1 },
  final: true,
  policyHash: Sha256.parse(POLICY_HASH),
  inputsHash: Sha256.parse(sha256Hex('inputs')),
  computedAt: IsoTs.parse(EVAL),
  ...over,
});
