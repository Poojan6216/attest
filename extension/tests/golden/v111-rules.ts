/**
 * The contract v1.11 rules the golden suite must prove (docs/grading.md v1.11 §5.3, §6.1; Sprint 2 wave E): a
 * calendar change claim is never NOT_FOUND, coverage is per bound account, and a pair that matches on time alone is
 * no evidence. Each entry is a `contract:<tag>` that some scenario must carry, and a predicate that the tagged
 * scenario really exercises the rule; every proof is false on a plain exact match, and v111-rules.spec.ts shows each
 * one fails on a broken copy of its own file and, by grading changed copies, what decides each file.
 */
import { z } from 'zod';

import { type PolicyView } from './build';
import { bestOf, claimOf, evidenceOf, minutes, minuteWindow, type Proof } from './proof-helpers';
import {
  type ExpectedReceipt,
  type Scenario,
  type ScenarioClaim,
  type ScenarioCoverage,
} from './scenario-schema';
import { instantMs, truncateIso } from './time';

const CHANGE_TYPES: readonly string[] = ['calendar.updated', 'calendar.deleted'];
const CALENDAR_TYPES: readonly string[] = ['calendar.created', ...CHANGE_TYPES];

/** The policy numbers the time-alone proof reads, beyond what `PolicyView` types. */
const Weights = z.looseObject({
  windows: z.looseObject({ toleranceMin: z.number() }),
  features: z.looseObject({ timeProximity: z.number(), subjectOverlap: z.number() }),
});

interface Span {
  readonly from: number;
  readonly to: number;
}

/** §4.1: a minute-precision claim's window (calendar: targetAt ± calendarDays), or null. */
function windowOf(claim: ScenarioClaim, policy: PolicyView): Span | null {
  if ((claim.claimedAtPrecision ?? 'minute') !== 'minute') return null;
  if (!CALENDAR_TYPES.includes(claim.type)) {
    const window = minuteWindow(claim, policy);
    return { from: window.from, to: window.to };
  }
  if (claim.targetAt === undefined) return null;
  const days = minutes(policy.windows.calendarDays * 24 * 60);
  return { from: instantMs(claim.targetAt) - days, to: instantMs(claim.targetAt) + days };
}

/** `end(p,t) + graceMin` of a minute-precision claim. */
const graceSync = (claim: ScenarioClaim, policy: PolicyView): number =>
  instantMs(truncateIso(claim.claimedAt, 'minute')) + minutes(1 + policy.windows.graceMin);

/** True iff the union of the entries' closed windows contains `span`. */
function contains(entries: readonly ScenarioCoverage[], span: Span): boolean {
  const ordered = [...entries].sort((a, b) => instantMs(a.windowStart) - instantMs(b.windowStart));
  let reached = span.from;
  for (const e of ordered) {
    if (instantMs(e.windowStart) > reached) return false;
    // A window that ends before the point reached adds nothing: a point span is held only by a window over it.
    if (instantMs(e.windowEnd) < reached) continue;
    reached = instantMs(e.windowEnd);
    if (reached >= span.to) return true;
  }
  return false;
}

const sourceOf = (claim: ScenarioClaim): string =>
  claim.type === 'email.sent' ? 'gmail.sent' : 'gcal.event';

/**
 * §6.1 v1.11: a calendar change claim whose views contain its window whole, every calendar, the bound account,
 * synced at or after its grace sync and following changes from before it, is still partial_coverage with
 * `coverage.change_unprovable`; a `calendar.created` claim under fresh views in the same file is NOT_FOUND.
 */
const calendarChangeUnprovable: Proof = (s, policy) => {
  const views = s.input.coverage.filter((v) => v.source === 'gcal.event');
  const plain = views.every((v) => v.allCalendars === true && v.accountHash !== undefined);
  const capped = s.expect.some((e) => {
    const claim = claimOf(s, e);
    const window = claim === undefined ? null : windowOf(claim, policy);
    if (claim === undefined || window === null || !CHANGE_TYPES.includes(claim.type)) return false;
    const before = instantMs(truncateIso(claim.claimedAt, 'minute')) - minutes(policy.windows.beforeClaimMin);
    const followed = views.filter(
      (v) =>
        v.changesSince !== undefined &&
        instantMs(v.changesSince) <= before &&
        instantMs(v.lastSyncAt) >= graceSync(claim, policy),
    );
    return (
      contains(followed, window) &&
      e.ruleId === 'partial_coverage' &&
      e.reasonCodes.includes('coverage.change_unprovable')
    );
  });
  const created = s.expect.some(
    (e) => claimOf(s, e)?.type === 'calendar.created' && e.grade === 'NOT_FOUND' && e.ruleId === 'not_found',
  );
  return plain && views.length > 0 && capped && created && s.expect.every((e) => !isChangeNotFound(s, e));
};

const isChangeNotFound = (s: Scenario, e: ExpectedReceipt): boolean =>
  CHANGE_TYPES.includes(claimOf(s, e)?.type ?? '') && e.grade === 'NOT_FOUND';

/** The accounts the claim's grant binds to its source (the file's only grant of that agent). */
function boundAccounts(s: Scenario, claim: ScenarioClaim): readonly string[] {
  const grant = s.input.grants.find((g) => g.agent === claim.agent);
  const source = sourceOf(claim) as keyof NonNullable<(typeof s.input.grants)[number]['accounts']>;
  return [...new Set(grant?.accounts?.[source] ?? [])];
}

/** Per bound account, whether that account's own entries of the claim's source contain the claim window. */
function perAccount(s: Scenario, e: ExpectedReceipt, policy: PolicyView): readonly boolean[] | null {
  const claim = claimOf(s, e);
  const window = claim === undefined ? null : windowOf(claim, policy);
  if (claim === undefined || window === null) return null;
  const accounts = boundAccounts(s, claim);
  if (accounts.length < 2) return null;
  const own = (account: string) =>
    s.input.coverage.filter((v) => v.source === sourceOf(claim) && v.accountHash === account);
  return accounts.map((account) => contains(own(account), window));
}

/**
 * §6.1 v1.11: under a grant binding two accounts to a source, a claim whose window one account's views contain
 * and the other's do not is partial_coverage with `coverage.account_partial`; one whose window each account's
 * views contain is NOT_FOUND.
 */
const perAccountCoverage: Proof = (s, policy) => {
  const split = s.expect.some((e) => {
    const seen = perAccount(s, e, policy);
    return (
      seen !== null &&
      seen.some(Boolean) &&
      !seen.every(Boolean) &&
      e.ruleId === 'partial_coverage' &&
      e.reasonCodes.includes('coverage.account_partial')
    );
  });
  const whole = s.expect.some((e) => {
    const seen = perAccount(s, e, policy);
    return seen !== null && seen.every(Boolean) && e.grade === 'NOT_FOUND';
  });
  return split && whole;
};

/** Subject words, ASCII-lowercased (golden subjects here are plain words). */
const words = (text: string | undefined): Set<string> =>
  new Set(
    (text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 0),
  );

const shares = (a: Set<string>, b: Set<string>): boolean => [...a].some((word) => b.has(word));

/** A subject-only calendar claim's time-alone score reaches `thresholds.partial` against `at` (exact, in ms). */
function timeAloneReachesPartial(claim: ScenarioClaim, at: string, policy: PolicyView): boolean {
  if (claim.targetAt === undefined) return false;
  const { windows, features } = Weights.parse(policy);
  const edge = minutes(policy.windows.calendarDays * 24 * 60);
  const tolerance = minutes(windows.toleranceMin);
  const delta = Math.abs(instantMs(at) - instantMs(claim.targetAt));
  const time = delta <= tolerance ? 1 : (edge - delta) / (edge - tolerance);
  return (
    features.timeProximity * time >=
    policy.thresholds.partial * (features.timeProximity + features.subjectOverlap)
  );
}

/**
 * §5.3 v1.11: a subject-only calendar claim whose best candidate shares no subject word, and whose time alone would
 * reach `thresholds.partial`, scores 0/1 and is not assigned; another claim whose evidence shares a word is graded on
 * its score.
 */
const noEvidenceOnTimeAlone: Proof = (s, policy) => {
  const gated = s.expect.some((e) => {
    const claim = claimOf(s, e);
    const best = bestOf(s, e);
    if (claim === undefined || best === undefined || claim.counterparty !== undefined) return false;
    return (
      CALENDAR_TYPES.includes(claim.type) &&
      !shares(words(claim.subjectHint), words(best.subjectHint)) &&
      timeAloneReachesPartial(claim, best.occurredAt, policy) &&
      e.score === '0/1' &&
      e.observationRefs.length === 0
    );
  });
  const kept = s.expect.some((e) => {
    const evidence = evidenceOf(s, e);
    return (
      (e.grade === 'PARTIAL' || e.grade === 'VERIFIED') &&
      evidence !== undefined &&
      shares(words(claimOf(s, e)?.subjectHint), words(evidence.subjectHint))
    );
  });
  return gated && kept;
};

export const V111_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['calendar_change_unprovable', calendarChangeUnprovable],
  ['per_account_coverage', perAccountCoverage],
  ['no_evidence_on_time_alone', noEvidenceOnTimeAlone],
];
