/**
 * The contract v1.9 rules the golden suite must prove (docs/grading.md v1.9 §3, §6.1, §7; Sprint 2 wave C): receipt
 * point intervals and the calendar's followed changes. Each entry is a `contract:<tag>` that some scenario must carry,
 * and a predicate that the tagged scenario really exercises the rule; every proof is false on a plain exact match,
 * and v19-rules.spec.ts shows each one fails on a broken copy of its own file.
 */
import { type PolicyView } from './build';
import { claimOf, evidenceOf, minutes, type Proof } from './proof-helpers';
import {
  type ExpectedReceipt,
  type Scenario,
  type ScenarioCoverage,
  type ScenarioObservation,
} from './scenario-schema';
import { instantMs } from './time';

const CHANGE_TYPES: readonly string[] = ['calendar.updated', 'calendar.deleted'];

const isPoint = (e: ScenarioCoverage): boolean => instantMs(e.windowStart) === instantMs(e.windowEnd);
const receiptEntries = (s: Scenario): ScenarioCoverage[] =>
  s.input.coverage.filter((e) => e.source === 'gmail.receipt');
const holds = (e: ScenarioCoverage, iso: string): boolean =>
  instantMs(e.windowStart) <= instantMs(iso) && instantMs(iso) <= instantMs(e.windowEnd);

/** A purchase-like claim: its type's only source is gmail.receipt (§6.1). */
function purchaseLike(s: Scenario, e: ExpectedReceipt, policy: PolicyView): boolean {
  const claim = claimOf(s, e);
  const sources = claim === undefined ? [] : (policy.sourcesByType?.[claim.type] ?? []);
  return sources.length === 1 && sources[0] === 'gmail.receipt';
}

/**
 * §3, §6.1 v1.9: every gmail.receipt entry is a point; an exact receipt still verifies a purchase, and a purchase
 * whose window holds a point but no evidence is partial_coverage, never NOT_FOUND.
 */
const receiptPointCoverage: Proof = (s, policy) => {
  const points = receiptEntries(s);
  if (points.length === 0 || !points.every(isPoint)) return false;
  const purchases = s.expect.filter((e) => purchaseLike(s, e, policy));
  const verified = purchases.some((e) => e.grade === 'VERIFIED' && evidenceOf(s, e) !== undefined);
  const unseen = purchases.some((e) => e.ruleId === 'partial_coverage' && e.observationRefs.length === 0);
  return verified && unseen && purchases.every((e) => e.grade !== 'NOT_FOUND');
};

/** §3, §7 v1.9: an unclaimed receipt whose own instant is a point is UNASKED. */
const receiptPointOrphan: Proof = (s) => {
  const points = receiptEntries(s);
  if (points.length === 0 || !points.every(isPoint)) return false;
  return s.expect.some((e) => {
    const orphan = s.input.observations.find((o) => o.ref === e.ref);
    return (
      e.grade === 'UNASKED' &&
      orphan?.source === 'gmail.receipt' &&
      points.some((p) => instantMs(p.windowStart) === instantMs(orphan.occurredAt))
    );
  });
};

/** When an observation was first seen: the file's `observedAt` (golden files carry no `sightedAt`). */
const firstSeen = (o: ScenarioObservation): number => instantMs(o.observedAt ?? '');

/**
 * A gcal.event entry that holds `o`'s start and may have found it already there: it began comparing at its first
 * sighting, or it compared nothing and synced at or after it (§3 v1.9 (b)).
 */
function firstLookOf(s: Scenario, o: ScenarioObservation): boolean {
  return s.input.coverage.some(
    (e) =>
      e.source === 'gcal.event' &&
      holds(e, o.occurredAt) &&
      (e.changesSince === undefined
        ? instantMs(e.lastSyncAt) >= firstSeen(o)
        : instantMs(e.changesSince) === firstSeen(o)),
  );
}

/** Some agent's session ping lies within ±sessionMin of `atMs`: the row would otherwise be attributed (§7). */
function sessionNear(s: Scenario, atMs: number, policy: PolicyView): boolean {
  const reach = minutes(policy.unasked.windows.sessionMin);
  return (s.input.activity?.sessions ?? []).some((p) => Math.abs(instantMs(p.at) - atMs) <= reach);
}

/**
 * §3, §7 v1.9: a gcal.event row a first look found, near an agent's session, has no receipt, while a row first seen
 * by a pass that followed changes is UNASKED.
 */
const calendarFirstLookNoOrphan: Proof = (s, policy) => {
  const graded = new Set(s.expect.map((e) => e.ref));
  const calendar = s.input.observations.filter(
    (o) => o.source === 'gcal.event' && o.observedAt !== undefined,
  );
  const spared = calendar.some(
    (o) => !graded.has(o.ref) && firstLookOf(s, o) && sessionNear(s, firstSeen(o), policy),
  );
  const accused = s.expect.some((e) => {
    const o = calendar.find((row) => row.ref === e.ref);
    return e.grade === 'UNASKED' && o !== undefined && !firstLookOf(s, o);
  });
  return spared && accused;
};

/**
 * §6.1 v1.9, v1.11: a calendar change claim whose only views see every calendar of a known account is still capped
 * (`coverage.change_unprovable` since v1.11: no snapshot view can show a change was never made): never NOT_FOUND.
 */
const calendarChangeUnfollowed: Proof = (s) =>
  s.expect.some((e) => {
    const claim = claimOf(s, e);
    const views = s.input.coverage.filter((v) => v.source === 'gcal.event');
    return (
      claim !== undefined &&
      CHANGE_TYPES.includes(claim.type) &&
      e.ruleId === 'partial_coverage' &&
      e.reasonCodes.includes('coverage.change_unprovable') &&
      views.length > 0 &&
      views.every((v) => v.allCalendars === true && v.accountHash !== undefined)
    );
  });

/**
 * §6.1 v1.9, v1.11: with a first look and then views that followed changes, a calendar change claim verifies on the
 * change row the followed view saw, and one with no such row is partial_coverage (`coverage.change_unprovable`),
 * never NOT_FOUND (v1.9 and v1.10 graded it NOT_FOUND).
 */
const calendarChangeFollowed: Proof = (s) => {
  const views = s.input.coverage.filter((v) => v.source === 'gcal.event');
  if (!views.some((v) => v.changesSince === undefined) || !views.some((v) => v.changesSince !== undefined))
    return false;
  const changes = s.expect.filter((e) => CHANGE_TYPES.includes(claimOf(s, e)?.type ?? ''));
  const verified = changes.some(
    (e) => e.grade === 'VERIFIED' && evidenceOf(s, e)?.type === claimOf(s, e)?.type,
  );
  const unseen = changes.some(
    (e) => e.ruleId === 'partial_coverage' && e.reasonCodes.includes('coverage.change_unprovable'),
  );
  return verified && unseen && changes.every((e) => e.grade !== 'NOT_FOUND');
};

export const V19_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['receipt_point_coverage', receiptPointCoverage],
  ['receipt_point_orphan', receiptPointOrphan],
  ['calendar_first_look_no_orphan', calendarFirstLookNoOrphan],
  ['calendar_change_unfollowed', calendarChangeUnfollowed],
  ['calendar_change_followed', calendarChangeFollowed],
];
