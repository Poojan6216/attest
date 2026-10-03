/**
 * Task 1.5: receipt ids, `inputsHash` and the receipt builder (docs/grading.md §3, §8, §10, §15).
 */
import { describe, expect, it } from 'vitest';

import { GradeError } from '../../../src/core/grade';
import { canonicalJson, idFromHash, sha256Hex } from '../../../src/core/hash';
import {
  buildReceipt,
  candidatesHash,
  coverageHash,
  type GradeInputs,
  grantHash,
  inputsHash,
  orderReasons,
  reasonCode,
  receiptId,
  refHash,
  uniqueById,
} from '../../../src/core/receipt';
import { IsoTs, type Reason, ReasonCode, Receipt, Sha256, Ulid } from '../../../src/core/schema';
import { receiptIdFor } from '../../golden/load';
import {
  CLAIM,
  definedCandidatesHash,
  EVAL,
  inputs,
  nodeSha256,
  O1,
  O2,
  POLICY_HASH,
  receiptParts,
} from './receipt-fixtures';

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

/** §3 v1.4, written out from the contract: the grant and the coverage with every set-like array sorted. */
function canonicalParts(input: GradeInputs) {
  const { grant, coverage } = input;
  return {
    grant: {
      ...grant,
      allowedTypes: [...grant.allowedTypes].sort(),
      counterpartyAllowlist: [...grant.counterpartyAllowlist].sort(),
      declaredScopes: [...grant.declaredScopes].sort(),
      observedScopes: [...(grant.observedScopes ?? [])].sort(),
      accounts: { 'gmail.sent': [...(grant.accounts?.['gmail.sent'] ?? [])].sort() },
    },
    coverage: {
      ...coverage,
      // Entries ordered by source first (then the other fields): gcal.event before gmail.sent.
      observers: [...coverage.observers].sort((a, b) => (a.source < b.source ? -1 : 1)),
    },
  };
}

describe('inputsHash (§3 v1.5, §10)', () => {
  const base = inputsHash(inputs());

  it('grantHash and coverageHash are the SHA-256 of the canonical grant and coverage', () => {
    const parts = canonicalParts(inputs());
    expect(grantHash(inputs().grant)).toBe(sha256Hex(canonicalJson(parts.grant)));
    expect(coverageHash(inputs().coverage)).toBe(sha256Hex(canonicalJson(parts.coverage)));
  });

  it('refHash and candidatesHash are the Merkle-style hashes the contract defines', () => {
    for (const o of [O1, O2]) {
      const ref = canonicalJson({ id: o.id, contentHash: o.contentHash, observedAt: o.observedAt });
      const words = refHash(o);
      const bytes = Buffer.alloc(32);
      words.forEach((word, i) => bytes.writeInt32BE(word, i * 4));
      expect(bytes.toString('hex')).toBe(nodeSha256(ref).toString('hex'));
    }
    expect(candidatesHash([O2, O1])).toBe(definedCandidatesHash([O1, O2]));
    expect(candidatesHash([O1])).toBe(definedCandidatesHash([O1]));
    expect(candidatesHash([])).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('is the SHA-256 of the canonical JSON of the claim, candidatesHash, sub-hashes, policyHash and context', () => {
    expect(Sha256.safeParse(base).success).toBe(true);
    const { context } = inputs();
    const parts = canonicalParts(inputs());
    const defined = {
      claim: CLAIM,
      candidatesHash: definedCandidatesHash([O1, O2]),
      grantHash: nodeSha256(canonicalJson(parts.grant)).toString('hex'),
      policyHash: POLICY_HASH,
      coverageHash: nodeSha256(canonicalJson(parts.coverage)).toString('hex'),
      context: {
        ...context,
        attribution: { ...context.attribution, signals: ['agentSessionActive', 'userIdle'] },
      },
    };
    expect(base).toBe(nodeSha256(canonicalJson(defined)).toString('hex'));
    const none = inputsHash(inputs({ candidates: [] }));
    expect(none).toBe(
      nodeSha256(canonicalJson({ ...defined, candidatesHash: definedCandidatesHash([]) })).toString('hex'),
    );
  });

  it('names a candidate by id, contentHash and observedAt: a re-sighting changes the hash', () => {
    const seenLater = { ...O1, observedAt: IsoTs.parse('2026-10-06T14:59:00-04:00') };
    expect(inputsHash(inputs({ candidates: [seenLater, O2] }))).not.toBe(base);
    expect(inputsHash(inputs({ candidates: [{ ...O1 }, { ...O2 }] }))).toBe(base);
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
  it('FINAL with finalAt = computedAt; PENDING without finalAt; always schema-valid', () => {
    const finalReceipt = buildReceipt(receiptParts());
    expect(finalReceipt).toMatchObject({
      state: 'FINAL',
      finalAt: EVAL,
      claimId: CLAIM.id,
      id: receiptId({ k: 'claim', claimId: CLAIM.id }),
    });
    const pending = buildReceipt(receiptParts({ final: false }));
    expect(pending.state).toBe('PENDING');
    expect('finalAt' in pending).toBe(false);
    for (const receipt of [finalReceipt, pending]) expect(Receipt.parse(receipt)).toEqual(receipt);
  });

  it("UNASKED: attribution 'likely', no claimId; only UNASKED carries attribution", () => {
    const unasked = buildReceipt(
      receiptParts({
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
    expect('attribution' in buildReceipt(receiptParts())).toBe(false);
  });
});

describe('buildReceipt: claim fields and refusals (§8)', () => {
  it('carries the claim requestId when the claim has one, and never an override or supersededBy', () => {
    const requestId = Ulid.parse(idFromHash(sha256Hex('request')));
    const receipt = buildReceipt(receiptParts({ claim: { ...CLAIM, requestId } }));
    expect(receipt.requestId).toBe(requestId);
    expect(['override', 'supersededBy'].filter((key) => key in receipt)).toEqual([]);
  });

  it('refuses an UNASKED grade on a claim receipt', () => {
    expect(() => buildReceipt(receiptParts({ grade: 'UNASKED' }))).toThrow(
      new GradeError('unasked_with_claim'),
    );
  });
});
