/**
 * Task 1.5: receipt ids, `inputsHash` and the receipt builder (docs/grading.md §3, §8, §10, §15).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { GradeError } from '../../../src/core/grade';
import { canonicalJson, idFromHash, sha256Hex } from '../../../src/core/hash';
import {
  buildReceipt,
  type GradeInputs,
  inputsHash,
  orderReasons,
  reasonCode,
  receiptId,
  type ReceiptParts,
  uniqueById,
} from '../../../src/core/receipt';
import {
  Attribution,
  IsoTs,
  type Observation,
  type Reason,
  ReasonCode,
  Receipt,
  Sha256,
  Ulid,
} from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { receiptIdFor } from '../../golden/load';

const EVAL = '2026-10-06T15:00:00-04:00';
const VIEW = PolicyView.parse(defaultPolicyJson);
const CLAIM = buildClaim({
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
const O1 = obs('o1', 'priya@company.com');
const O2 = obs('o2', 'raj@company.com');
const POLICY_HASH = sha256Hex('policy');

function inputs(over: Partial<GradeInputs> = {}): GradeInputs {
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

describe('receiptId (§3)', () => {
  it('is idFromHash(sha256Hex(canonicalJson(subject))) for each kind of subject, as the golden loader computes', () => {
    const subjects = [
      { k: 'claim', claimId: CLAIM.id },
      { k: 'unasked', observationId: O1.id },
      { k: 'scope', agent: 'muse', scope: 'gmail.read' },
    ] as const;
    for (const subject of subjects) {
      expect(receiptId(subject)).toBe(idFromHash(sha256Hex(canonicalJson(subject))));
      expect(receiptId(subject)).toBe(receiptIdFor(subject));
      expect(Ulid.safeParse(receiptId(subject)).success).toBe(true);
    }
  });

  it('depends on the subject only: different subjects, different ids', () => {
    const ids = new Set([
      receiptId({ k: 'claim', claimId: CLAIM.id }),
      receiptId({ k: 'unasked', observationId: O1.id }),
      receiptId({ k: 'unasked', observationId: O2.id }),
      receiptId({ k: 'scope', agent: 'muse', scope: 'gmail.read' }),
      receiptId({ k: 'scope', agent: 'claude', scope: 'gmail.read' }),
    ]);
    expect(ids.size).toBe(5);
  });
});

describe('inputsHash (§3, §10)', () => {
  const base = inputsHash(inputs());

  it('is a SHA-256 of the canonical JSON of the six inputs', () => {
    expect(Sha256.safeParse(base).success).toBe(true);
    const { grant, coverage, context } = inputs();
    const sorted = {
      claim: CLAIM,
      candidates: [O1, O2].sort((a, b) => (a.id < b.id ? -1 : 1)),
      grant: {
        ...grant,
        allowedTypes: [...grant.allowedTypes].sort(),
        counterpartyAllowlist: [...grant.counterpartyAllowlist].sort(),
        declaredScopes: [...grant.declaredScopes].sort(),
        observedScopes: [...(grant.observedScopes ?? [])].sort(),
        accounts: { 'gmail.sent': [...(grant.accounts?.['gmail.sent'] ?? [])].sort() },
      },
      policyHash: POLICY_HASH,
      coverage: {
        ...coverage,
        // Entries ordered by source first (then the other fields): gcal.event before gmail.sent.
        observers: [...coverage.observers].sort((a, b) => (a.source < b.source ? -1 : 1)),
      },
      context: {
        ...context,
        attribution: { ...context.attribution, signals: ['agentSessionActive', 'userIdle'] },
      },
    };
    expect(base).toBe(sha256Hex(canonicalJson(sorted)));
  });
});

describe('inputsHash: set-like arrays and sensitivity (§3)', () => {
  const base = inputsHash(inputs());

  it('ignores the order and repetition of every set-like array', () => {
    const { grant, coverage, context } = inputs();
    const reversed = <T>(values: readonly T[] | undefined): T[] => [...(values ?? [])].reverse();
    const shuffled = inputs({
      candidates: [O2, O1, O2],
      grant: {
        ...grant,
        allowedTypes: reversed(grant.allowedTypes),
        counterpartyAllowlist: [...reversed(grant.counterpartyAllowlist), 'company.com'],
        declaredScopes: reversed(grant.declaredScopes),
        observedScopes: reversed(grant.observedScopes),
        accounts: { 'gmail.sent': reversed(grant.accounts?.['gmail.sent']) },
      },
      coverage: { ...coverage, observers: [...reversed(coverage.observers), ...coverage.observers] },
      context: {
        ...context,
        attribution: Attribution.parse({
          agent: 'muse',
          scoreBp: 7000,
          signals: ['agentSessionActive', 'userIdle'],
        }),
      },
    });
    expect(inputsHash(shuffled)).toBe(base);
  });

  it('changes when any input changes', () => {
    const { coverage, context } = inputs();
    const changed = [
      inputs({ claim: null }),
      inputs({ candidates: [O1] }),
      inputs({ grant: buildGrant({ agent: 'muse' }, EVAL) }),
      inputs({ policyHash: sha256Hex('another policy') }),
      inputs({ coverage: { ...coverage, evaluatedAt: IsoTs.parse('2026-10-06T15:00:01-04:00') } }),
      inputs({ coverage: { ...coverage, observers: coverage.observers.slice(1) } }),
      inputs({ context: { ...context, priorSpendCents: 1 } }),
      inputs({ context: { priorSpendCents: 0, scope: { observed: 'gmail.read' } } }),
    ];
    const hashes = new Set([base, ...changed.map(inputsHash)]);
    expect(hashes.size).toBe(changed.length + 1);
  });
});

describe('uniqueById', () => {
  it('keeps one row per id, the one whose canonical JSON sorts first, in id order', () => {
    const seenLater = { ...O1, observedAt: IsoTs.parse('2026-10-06T14:59:00-04:00') };
    const first = canonicalJson(O1) < canonicalJson(seenLater) ? O1 : seenLater;
    expect(uniqueById([seenLater, O2, O1])).toEqual(uniqueById([O1, O2, seenLater]));
    expect(uniqueById([seenLater, O1]).map((o) => o.observedAt)).toEqual([first.observedAt]);
    expect(uniqueById([O2, O1]).map((o) => o.id)).toEqual([O1.id, O2.id].sort());
  });
});

describe('reasons (§15 order)', () => {
  const r = (code: ReasonCode, params: Reason['params'] = {}): Reason => ({ code, params });

  it('orders by group (rule, allowlist, coverage, match), then table order within a group, stably', () => {
    const ordered = orderReasons({
      rule: [
        r('ceiling.currency_mismatch', { currency: 'EUR', spendCurrency: 'USD' }),
        r('ceiling.exceeded', { amountCents: 1, ceilingCents: 0 }),
      ],
      allowlist: [r('allowlist.unchecked')],
      coverage: [
        r('coverage.no_account', { source: 'gmail.sent' }),
        r('coverage.account_unbound', { source: 'gcal.event' }),
        r('coverage.account_unbound', { source: 'gmail.sent' }),
      ],
      match: [r('cp.plus_tag'), r('match.best', { observationId: O1.id })],
    });
    expect(ordered.map((reason) => [reason.code, reason.params.source])).toEqual([
      ['ceiling.exceeded', undefined],
      ['ceiling.currency_mismatch', undefined],
      ['allowlist.unchecked', undefined],
      ['coverage.account_unbound', 'gcal.event'],
      ['coverage.account_unbound', 'gmail.sent'],
      ['coverage.no_account', 'gmail.sent'],
      ['match.best', undefined],
      ['cp.plus_tag', undefined],
    ]);
  });

  it('reasonCode accepts every schema code and fails loud on an unknown one', () => {
    for (const code of ReasonCode.options) expect(reasonCode(code)).toBe(code);
    expect(() => reasonCode('coverage.made_up')).toThrow(new GradeError('unknown_reason_code'));
  });
});

describe('buildReceipt (§8 invariants by construction)', () => {
  const parts = (over: Partial<ReceiptParts> = {}): ReceiptParts => ({
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

  it('FINAL with finalAt = computedAt; PENDING without finalAt; always schema-valid', () => {
    const finalReceipt = buildReceipt(parts());
    expect(finalReceipt).toMatchObject({
      state: 'FINAL',
      finalAt: EVAL,
      claimId: CLAIM.id,
      id: receiptId({ k: 'claim', claimId: CLAIM.id }),
    });
    const pending = buildReceipt(parts({ final: false }));
    expect(pending.state).toBe('PENDING');
    expect('finalAt' in pending).toBe(false);
    for (const receipt of [finalReceipt, pending]) expect(Receipt.parse(receipt)).toEqual(receipt);
  });

  it("UNASKED: attribution 'likely', no claimId; only UNASKED carries attribution", () => {
    const unasked = buildReceipt(
      parts({
        subject: { k: 'unasked', observationId: O1.id },
        claim: null,
        grade: 'UNASKED',
        reasons: { rule: [], allowlist: [], coverage: [], match: [] },
        signals: {},
      }),
    );
    expect(unasked).toMatchObject({ grade: 'UNASKED', attribution: 'likely' });
    expect('claimId' in unasked).toBe(false);
    expect(Receipt.safeParse(unasked).success).toBe(true);
    expect('attribution' in buildReceipt(parts())).toBe(false);
  });
});

describe('buildReceipt: claim fields and refusals (§8)', () => {
  const parts = (over: Partial<ReceiptParts> = {}): ReceiptParts => ({
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

  it('carries the claim requestId when the claim has one, and never an override or supersededBy', () => {
    const requestId = Ulid.parse(idFromHash(sha256Hex('request')));
    const receipt = buildReceipt(parts({ claim: { ...CLAIM, requestId } }));
    expect(receipt.requestId).toBe(requestId);
    expect(['override', 'supersededBy'].filter((key) => key in receipt)).toEqual([]);
  });

  it('refuses an UNASKED grade on a claim receipt', () => {
    expect(() => buildReceipt(parts({ grade: 'UNASKED' }))).toThrow(new GradeError('unasked_with_claim'));
  });
});
