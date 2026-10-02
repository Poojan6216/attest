/**
 * The build_spec §2 demo, end to end through `gradeBatch`: the canonical worked example of docs/grading.md
 * (task 1.10). demo-ledger.ts builds the ledger the story leaves behind; each `describe` below is one step of §2,
 * and each assertion names the contract section that decides it. Exact numbers are basis points (bp, §5.3).
 *
 *   §2.1 the ask            → one Request
 *   §2.2 Muse's two lines   → two claims: an email to "Priya" (a name) and a calendar event on Thursday at 14:00
 *   §2.3 Gmail and Calendar → two sent rows (priya@ at 14:02, vendor@ at 14:03); no calendar event
 *   §2.4 the receipts       → Email VERIFIED; Calendar NOT_FOUND, and only once grace has elapsed
 *   §2.5 the unclaimed send → UNASKED, "likely" Muse, on two signals
 *   §2.6 the digest         → "Muse: 2 tasks claimed, 1 verified, 1 not found, 1 unasked."
 *   §9 replay               → grade() over each receipt's stored inputs reproduces it exactly (Hard Rule 4)
 *   Hard Rule 5             → Calendar never opened: UNVERIFIABLE, never NOT_FOUND; the rest unchanged
 */
import { describe, expect, it } from 'vitest';

import { attribute } from '../../../src/core/attribution';
import type { BatchInputs } from '../../../src/core/batch';
import { applicableFeatures, features } from '../../../src/core/features';
import { grade } from '../../../src/core/grade';
import { hashCanonical, idFromHash } from '../../../src/core/hash';
import { instantMs } from '../../../src/core/normalize';
import { compareRatio, ratio, ratioGteBasisPoints } from '../../../src/core/ratio';
import { reasonText } from '../../../src/core/reason-text';
import { hashText, project } from '../../../src/core/redact';
import type { Claim, Observation, Receipt } from '../../../src/core/schema';
import { claimWindow } from '../../../src/core/window';
import { digestCounts, digestLine } from './demo-digest';
import { ASK, AT, buildDemo, GMAIL_ROWS, gradeDemo, POLICY } from './demo-ledger';

/** The UTC weekday of an instant (0 = Sunday). UTC−04:00 is behind UTC, so local 00:00–19:59 keeps its date. */
const weekday = (iso: string): number => new Date(instantMs(iso)).getUTCDay();

/** A receipt with its inputsHash blanked: two gradings over different coverage can agree on everything else. */
const decided = (receipt: Receipt) => ({ ...receipt, inputsHash: null });

describe('the §2 demo: the policy numbers this worked example uses', () => {
  it('reads the shipped policy (policy/default.json) in basis points; a policy change must update this example', () => {
    expect(POLICY.bp.features).toMatchObject({
      timeProximity: 2500,
      counterpartyName: 2500,
      subjectOverlap: 1500,
    });
    expect(POLICY.bp.thresholds).toEqual({ verified: 8500, partial: 5000 });
    expect(POLICY.bp.unasked.signals).toMatchObject({ agentSessionActive: 4000, userIdle: 3000 });
    expect(POLICY.bp.unasked.threshold).toBe(6000);
    expect(POLICY.windows).toMatchObject({
      beforeClaimMin: 2,
      afterClaimMin: 45,
      graceMin: 30,
      calendarDays: 3,
      finalizeUnverifiableHours: 24,
    });
    expect(POLICY.unasked.windows).toEqual({ sessionMin: 10, idleMin: 2, adjacentMin: 2 });
  });
});

describe('§2.1–§2.3 the ledger the story leaves behind', () => {
  const ledger = buildDemo();

  it('happens on Tuesday 6 October; the review is claimed for Thursday 8 October at 14:00', () => {
    expect(weekday(AT.claimed)).toBe(2);
    expect(weekday(AT.thursday2pm)).toBe(4);
    expect(weekday(AT.calendarWeekFrom)).toBe(1);
  });

  it('§2.1 holds one Request for the ask, whose id derives from its hash (§10)', () => {
    const { agent, conversationId, textHash, ts, id } = ledger.request;
    expect(ledger.request).toMatchObject({ agent: 'muse', textHint: ASK, ts: AT.ask });
    expect(textHash).toBe(hashText(ASK));
    expect(id).toBe(idFromHash(hashCanonical({ agent, conversationId, textHash, ts })));
  });

  it('§2.2 holds two Muse claims tied to the ask, each id = idFromHash(rawHash) (§10)', () => {
    const { emailClaim, calendarClaim, request } = ledger;
    expect(emailClaim).toMatchObject({
      agent: 'muse',
      requestId: request.id,
      type: 'email.sent',
      counterparty: 'Priya',
      subjectHint: 'Q3 deck',
      claimedAt: AT.claimed,
      claimedAtPrecision: 'minute',
    });
    expect(calendarClaim).toMatchObject({
      agent: 'muse',
      requestId: request.id,
      type: 'calendar.created',
      subjectHint: 'Q3 review',
      targetAt: AT.thursday2pm,
    });
    expect(calendarClaim.counterparty).toBeUndefined();
    for (const claim of [emailClaim, calendarClaim]) expect(claim.id).toBe(idFromHash(claim.rawHash));
    expect(emailClaim.id).not.toBe(calendarClaim.id);
  });

  it('§2.3 holds two Gmail rows reduced to allowlisted facts by project() (Hard Rule 2)', () => {
    for (const row of [ledger.priyaRow, ledger.vendorRow]) {
      expect(Object.keys(row).sort()).toEqual([
        'contentHash',
        'counterparty',
        'id',
        'observedAt',
        'occurredAt',
        'rowKeyHash',
        'source',
        'subjectHint',
        'type',
      ]);
      expect(row.id).toBe(idFromHash(row.contentHash));
      expect(row.observedAt).toBe(AT.firstLook);
    }
    expect(JSON.stringify([ledger.priyaRow, ledger.vendorRow])).not.toMatch(/attached|charge the card/);
    expect(ledger.priyaRow).toMatchObject({
      counterparty: 'priya@northwind.example',
      occurredAt: AT.claimed,
    });
    expect(ledger.vendorRow).toMatchObject({
      counterparty: 'vendor@supplier.example',
      occurredAt: AT.unaskedSend,
    });
  });

  it('§2.3 reading a row again at a later look is the same observation (observedAt is not hashed, §10)', () => {
    const context = {
      type: 'email.sent',
      observedAt: AT.secondLook,
      rowKey: GMAIL_ROWS.priya.rowKey,
    } as const;
    expect(project('gmail.sent', GMAIL_ROWS.priya.raw, context, POLICY).id).toBe(ledger.priyaRow.id);
  });
});

describe('§2.4 at 14:20, after the first look but before grace: everything is still "checking"', () => {
  it('Email already matches but is PENDING; Calendar is rule pending, never NOT_FOUND before grace (Hard Rule 5)', async () => {
    const { email, calendar, unasked, all } = await gradeDemo(buildDemo(), AT.beforeGrace);
    // VERIFIED is FINAL only after a Gmail sync ≥ end(p,t) + graceMin = 14:33 (§8); only the 14:10 one is seen.
    expect(email).toMatchObject({ grade: 'VERIFIED', ruleId: 'verified', state: 'PENDING' });
    // No calendar sync ≥ 14:33 yet: graceElapsed is false, so the outcome is PENDING (grade placeholder, §2).
    expect(calendar).toMatchObject({ grade: 'UNVERIFIABLE', ruleId: 'pending', state: 'PENDING' });
    expect(calendar.reasons).toEqual([
      { code: 'grace.waiting', params: { source: 'gcal.event' } },
      { code: 'match.none', params: {} },
    ]);
    // Muse's adapter last synced at 14:05 < 14:03 + beforeClaimMin + graceMin = 14:35 (§7): a claim may still come.
    expect(unasked).toMatchObject({ grade: 'UNASKED', ruleId: 'unasked', state: 'PENDING' });
    expect(digestCounts(all, 'muse')).toMatchObject({ receipts: 0, checking: 3 });
  });
});

describe('§2.4 at 15:00: Email → VERIFIED', () => {
  const ledger = buildDemo();

  it('matches the sent row to priya@ exactly: S = (2500 + 2500 + 1500) / 6500 = 1 ≥ 8500 bp (§5)', () => {
    const { emailClaim, priyaRow } = ledger;
    // A name counterparty drops counterpartyExact and counterpartyDomain (§5.2).
    expect(applicableFeatures(emailClaim, POLICY)).toEqual([
      'timeProximity',
      'counterpartyName',
      'subjectOverlap',
    ]);
    // Window [14:02 − 2 min, 14:03 + 45 min] = [14:00, 14:48] (§4.1): both rows are candidates.
    const window = claimWindow(emailClaim, POLICY);
    expect(window).toMatchObject({ fromMs: instantMs(AT.ask), toMs: instantMs('2026-10-06T14:48:00-04:00') });
    // 14:02 is inside [14:02, 14:03]; "priya" is the address's local part; {q3, deck} = {q3, deck}.
    const pair = features(emailClaim, priyaRow, POLICY);
    expect(pair.signals).toEqual({ timeProximity: 1, counterpartyName: 1, subjectOverlap: 1, score: 1 });
    expect(compareRatio(pair.score, ratio(1, 1))).toBe(0);
    expect(ratioGteBasisPoints(pair.score, POLICY.bp.thresholds.verified)).toBe(true);
  });

  it('is VERIFIED by rule verified, FINAL, with the priya@ row as its evidence', async () => {
    const { email } = await gradeDemo(ledger, AT.evaluated);
    expect(email).toMatchObject({
      agent: 'muse',
      claimId: ledger.emailClaim.id,
      requestId: ledger.request.id,
      grade: 'VERIFIED',
      ruleId: 'verified',
      state: 'FINAL',
      confidence: 1,
      observationIds: [ledger.priyaRow.id],
      // §2.4's evidence: the sent row at 14:02, a recipient match and a subject match (display numbers, §5.3).
      signals: { timeProximity: 1, counterpartyName: 1, subjectOverlap: 1, score: 1 },
      computedAt: AT.evaluated,
      finalAt: AT.evaluated,
    });
    expect(email.reasons).toEqual([{ code: 'match.best', params: { observationId: ledger.priyaRow.id } }]);
    expect(email.attribution).toBeUndefined();
  });
});

describe('§2.4 at 15:00: Calendar → NOT_FOUND, after grace', () => {
  const ledger = buildDemo();

  it('looks ±3 days around Thursday 14:00, inside the week view checked at 14:10 and 14:40 (§4.1, §6.1)', () => {
    const window = claimWindow(ledger.calendarClaim, POLICY);
    expect(window).toMatchObject({
      fromMs: instantMs('2026-10-05T14:00:00-04:00'),
      toMs: instantMs('2026-10-11T14:00:00-04:00'),
    });
    const passes = ledger.observers.filter((entry) => entry.source === 'gcal.event');
    expect(passes.map((entry) => entry.lastSyncAt)).toEqual([AT.firstLook, AT.secondLook]);
    for (const entry of passes) {
      expect(entry.allCalendars).toBe(true);
      expect(entry.accountHash).toBeDefined();
      expect(instantMs(entry.windowStart)).toBeLessThanOrEqual(window?.fromMs ?? Number.NaN);
      expect(instantMs(entry.windowEnd)).toBeGreaterThanOrEqual(window?.toMs ?? Number.NaN);
    }
  });

  it('is NOT_FOUND by rule not_found, FINAL: full coverage, a sync ≥ 14:33 (grace), no candidate (§6.2, §8)', async () => {
    const { calendar } = await gradeDemo(ledger, AT.evaluated);
    expect(calendar).toMatchObject({
      agent: 'muse',
      claimId: ledger.calendarClaim.id,
      requestId: ledger.request.id,
      grade: 'NOT_FOUND',
      ruleId: 'not_found',
      state: 'FINAL',
      confidence: 1,
      observationIds: [],
      finalAt: AT.evaluated,
    });
    // The default grant binds no account, so Attest says it cannot rule out the wrong account (§6.1).
    expect(calendar.reasons).toEqual([
      { code: 'coverage.account_unbound', params: { source: 'gcal.event' } },
      { code: 'match.none', params: {} },
    ]);
  });
});

describe('§2.5 at 15:00: the 14:03 send to vendor@ → UNASKED (likely Muse)', () => {
  const ledger = buildDemo();

  it('cannot be the email claim: S = 2500 / 6500 = 5/13 < 5000 bp, so it is never assigned and stays an orphan (§4.3)', () => {
    // 14:03 is inside [14:02, 14:03]; "priya" is not a token of "vendor"; "Re: invoice" → {invoice}.
    const pair = features(ledger.emailClaim, ledger.vendorRow, POLICY);
    expect(pair.signals).toMatchObject({ timeProximity: 1, counterpartyName: 0, subjectOverlap: 0 });
    expect(compareRatio(pair.score, ratio(5, 13))).toBe(0);
    expect(ratioGteBasisPoints(pair.score, POLICY.bp.thresholds.partial)).toBe(false);
  });

  it('is attributed to Muse on two signals: session 4000 + idle 3000 = 7000 bp ≥ 6000 (§7)', () => {
    const attribution = attribute(ledger.vendorRow, ledger.activity, POLICY, AT.evaluated);
    expect(attribution).toEqual({
      agent: 'muse',
      scoreBp: 4000 + 3000,
      signals: ['agentSessionActive', 'userIdle'],
      adapterLastSyncAt: AT.museResync,
    });
    expect(attribution?.scoreBp).toBeGreaterThanOrEqual(POLICY.bp.unasked.threshold);
  });

  it('is UNASKED by rule unasked, FINAL, labelled "likely" with ≥ 2 signals, every reason text saying "likely"', async () => {
    const { unasked } = await gradeDemo(ledger, AT.evaluated);
    expect(unasked).toMatchObject({
      agent: 'muse',
      grade: 'UNASKED',
      ruleId: 'unasked',
      state: 'FINAL',
      attribution: 'likely',
      confidence: 0.7,
      observationIds: [ledger.vendorRow.id],
      finalAt: AT.evaluated,
    });
    // No claim and no request explain it: Attest cannot prove who sent it (Hard Rule 7).
    expect(unasked.claimId).toBeUndefined();
    expect(unasked.requestId).toBeUndefined();
    expect(unasked.reasons).toEqual([
      { code: 'unasked.session', params: { agent: 'muse' } },
      { code: 'unasked.idle', params: { agent: 'muse' } },
    ]);
    expect(
      unasked.reasons.filter((reason) => reason.code.startsWith('unasked.')).length,
    ).toBeGreaterThanOrEqual(2);
    for (const reason of unasked.reasons) expect(reasonText(reason)).toMatch(/\blikely\b/);
  });

  it('leaves exactly three receipts: Email, Calendar, UNASKED, ordered by receipt id (§3)', async () => {
    const { all, email, calendar, unasked } = await gradeDemo(ledger, AT.evaluated);
    expect(all).toHaveLength(3);
    expect(all.map((receipt) => receipt.id)).toEqual([email.id, calendar.id, unasked.id].sort());
  });
});

describe('§2.6 the weekly digest', () => {
  it('counts Muse: 3 receipts, 1 verified, 1 not found, 1 unasked', async () => {
    const { all } = await gradeDemo(buildDemo(), AT.evaluated);
    const counts = digestCounts(all, 'muse');
    expect(counts).toEqual({
      receipts: 3,
      claimed: 2,
      byGrade: { VERIFIED: 1, PARTIAL: 0, NOT_FOUND: 1, UNASKED: 1, OVER_SCOPE: 0, UNVERIFIABLE: 0 },
      checking: 0,
    });
    expect(digestLine('muse', counts)).toBe('Muse: 2 tasks claimed, 1 verified, 1 not found, 1 unasked.');
    expect(digestCounts(all, 'claude').receipts).toBe(0);
  });
});

describe('§9 replay: each receipt is graded again from what the ledger stores', () => {
  it('stores the shipped policy, the grant in force and each context; grade() reproduces every receipt (Hard Rule 4)', async () => {
    const ledger = buildDemo();
    const graded = await gradeDemo(ledger, AT.evaluated);
    const stored = (receipt: Receipt): BatchInputs => {
      const inputs = graded.inputs.get(receipt.id);
      if (inputs === undefined) throw new Error(`demo: no stored inputs for receipt ${receipt.id}`);
      return inputs;
    };
    expect(graded.inputs.size).toBe(graded.all.length);
    for (const receipt of graded.all) {
      expect(receipt.policyHash).toBe(POLICY.policyHash);
      expect(stored(receipt)).toMatchObject({ grant: ledger.grant, policyHash: POLICY.policyHash });
    }
    // No spend type, so no prior spend (§6.3); the UNASKED context carries Muse's attribution (§3, §7).
    expect(stored(graded.email).context).toEqual({ priorSpendCents: 0 });
    expect(stored(graded.calendar).context).toEqual({ priorSpendCents: 0 });
    expect(stored(graded.unasked).context).toEqual({
      priorSpendCents: 0,
      attribution: {
        agent: 'muse',
        scoreBp: 4000 + 3000,
        signals: ['agentSessionActive', 'userIdle'],
        adapterLastSyncAt: AT.museResync,
      },
    });
    const regrade = (claim: Claim | null, candidates: readonly Observation[], receipt: Receipt) => {
      const { grant, context } = stored(receipt);
      return grade(claim, candidates, grant, POLICY, graded.coverage, context);
    };
    // The email claim's candidates are both rows in its window (§4.1): the vendor row, at 5/13, is assigned to no
    // claim, so it stays the email claim's candidate (§4.3) and is also the orphan. inputsHash binds both.
    expect(regrade(ledger.emailClaim, [ledger.priyaRow, ledger.vendorRow], graded.email)).toEqual(
      graded.email,
    );
    expect(regrade(ledger.emailClaim, [ledger.priyaRow], graded.email).inputsHash).not.toBe(
      graded.email.inputsHash,
    );
    expect(regrade(ledger.calendarClaim, [], graded.calendar)).toEqual(graded.calendar);
    expect(regrade(null, [ledger.vendorRow], graded.unasked)).toEqual(graded.unasked);
  });
});

describe('Hard Rule 5 variant: the user never opens Calendar', () => {
  it('Calendar → UNVERIFIABLE by rule no_coverage, still checking; Email and UNASKED unchanged', async () => {
    const opened = await gradeDemo(buildDemo('opened'), AT.evaluated);
    const never = await gradeDemo(buildDemo('never-opened'), AT.evaluated);
    expect(never.calendar).toMatchObject({
      claimId: opened.calendar.claimId,
      grade: 'UNVERIFIABLE',
      ruleId: 'no_coverage',
      state: 'PENDING',
      confidence: 0,
      observationIds: [],
    });
    expect(never.calendar.reasons).toEqual([
      { code: 'coverage.none', params: { source: 'gcal.event' } },
      { code: 'match.none', params: {} },
    ]);
    expect(decided(never.email)).toEqual(decided(opened.email));
    expect(decided(never.unasked)).toEqual(decided(opened.unasked));
    // The decisions agree; the proofs differ, because inputsHash binds the coverage graded against (§3).
    expect(never.email.inputsHash).not.toBe(opened.email.inputsHash);
    expect(never.all).toHaveLength(3);
    expect(digestCounts(never.all, 'muse')).toMatchObject({ receipts: 2, checking: 1 });
  });

  it('a day later Calendar is FINAL UNVERIFIABLE, never NOT_FOUND: Attest did not see it (§8)', async () => {
    const { calendar, all } = await gradeDemo(buildDemo('never-opened'), AT.nextDay);
    expect(calendar).toMatchObject({
      grade: 'UNVERIFIABLE',
      ruleId: 'no_coverage',
      state: 'FINAL',
      finalAt: AT.nextDay,
    });
    expect(digestLine('muse', digestCounts(all, 'muse'))).toBe(
      'Muse: 2 tasks claimed, 1 verified, 1 unasked, 1 unverifiable.',
    );
  });
});
