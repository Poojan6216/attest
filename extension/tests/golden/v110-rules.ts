/**
 * The contract v1.10 rules the golden suite must prove (docs/grading.md v1.10 §3, §6.1, §7; Sprint 2 wave D): the
 * Calendar first-look marker and the cap on a calendar view looked at before a claim's grace sync. Each entry is a
 * `contract:<tag>` that some scenario must carry, and a predicate that the tagged scenario really exercises the rule;
 * every proof is false on a plain exact match, and v110-rules.spec.ts shows each one fails on a broken copy of its own
 * file and, by grading broken copies, that the marker and the cap decide the files' outcomes.
 */
import { type PolicyView } from './build';
import { claimOf, minutes, type Proof } from './proof-helpers';
import {
  type ExpectedReceipt,
  type Scenario,
  type ScenarioCoverage,
  type ScenarioObservation,
} from './scenario-schema';
import { instantMs, truncateIso } from './time';

const CALENDAR_TYPES: readonly string[] = ['calendar.created', 'calendar.updated', 'calendar.deleted'];

/** When an observation was first seen: the file's `observedAt` (golden files carry no `sightedAt`). */
export const firstSeen = (o: ScenarioObservation): number => instantMs(o.observedAt ?? '');

const calendarViews = (s: Scenario): ScenarioCoverage[] =>
  s.input.coverage.filter((e) => e.source === 'gcal.event');

const holds = (e: ScenarioCoverage, iso: string): boolean =>
  instantMs(e.windowStart) <= instantMs(iso) && instantMs(iso) <= instantMs(e.windowEnd);

/**
 * §3 v1.10: `e` is `o`'s first-look marker: a `gcal.event` point at `o`'s start whose `lastSyncAt` and
 * `changesSince` are `o`'s first sighting.
 */
export function isMarkerOf(e: ScenarioCoverage, o: ScenarioObservation): boolean {
  const seen = firstSeen(o);
  const at = instantMs(o.occurredAt);
  return (
    e.source === 'gcal.event' &&
    instantMs(e.windowStart) === at &&
    instantMs(e.windowEnd) === at &&
    instantMs(e.lastSyncAt) === seen &&
    e.changesSince !== undefined &&
    instantMs(e.changesSince) === seen
  );
}

/** Rule (a): a view holding `o`'s start followed changes from strictly before its first sighting through it. */
export function followedOver(s: Scenario, o: ScenarioObservation): boolean {
  const seen = firstSeen(o);
  return calendarViews(s).some(
    (e) =>
      holds(e, o.occurredAt) &&
      e.changesSince !== undefined &&
      instantMs(e.changesSince) < seen &&
      seen <= instantMs(e.lastSyncAt),
  );
}

/** Some agent's session ping lies within ±sessionMin of `atMs`: the row would otherwise be attributed (§7). */
export function sessionNear(s: Scenario, atMs: number, policy: PolicyView): boolean {
  const reach = minutes(policy.unasked.windows.sessionMin);
  return (s.input.activity?.sessions ?? []).some((p) => Math.abs(instantMs(p.at) - atMs) <= reach);
}

export const calendarRows = (s: Scenario): ScenarioObservation[] =>
  s.input.observations.filter((o) => o.source === 'gcal.event' && o.observedAt !== undefined);

/**
 * §3, §7 v1.10: a gcal.event row that a followed view would make an orphan (rule (a)), near an agent's session, has
 * a first-look marker and no receipt, while another gcal.event row, with no marker, is UNASKED.
 */
const calendarFirstLookMarker: Proof = (s, policy) => {
  const graded = new Set(s.expect.map((e) => e.ref));
  const rows = calendarRows(s);
  const marked = (o: ScenarioObservation): boolean => s.input.coverage.some((e) => isMarkerOf(e, o));
  const spared = rows.some(
    (o) => !graded.has(o.ref) && marked(o) && followedOver(s, o) && sessionNear(s, firstSeen(o), policy),
  );
  const accused = s.expect.some((e) => {
    const o = rows.find((row) => row.ref === e.ref);
    return e.grade === 'UNASKED' && o !== undefined && !marked(o) && followedOver(s, o);
  });
  return spared && accused;
};

/** §4.1, §6.1: a minute-precision calendar claim's window and its grace sync `end(p,t) + graceMin`, in epoch ms. */
function calendarTimes(
  claimedAt: string,
  targetAt: string,
  policy: PolicyView,
): { from: number; to: number; graceSync: number } {
  const end = instantMs(truncateIso(claimedAt, 'minute')) + minutes(1);
  const days = minutes(policy.windows.calendarDays * 24 * 60);
  return {
    from: instantMs(targetAt) - days,
    to: instantMs(targetAt) + days,
    graceSync: end + minutes(policy.windows.graceMin),
  };
}

/** The claim's overlapping Calendar views, each of a known account showing every calendar, or null. */
function viewsOver(s: Scenario, e: ExpectedReceipt, policy: PolicyView) {
  const claim = claimOf(s, e);
  if (claim?.targetAt === undefined || !CALENDAR_TYPES.includes(claim.type)) return null;
  if ((claim.claimedAtPrecision ?? 'minute') !== 'minute') return null;
  const times = calendarTimes(claim.claimedAt, claim.targetAt, policy);
  const views = calendarViews(s).filter(
    (v) => instantMs(v.windowStart) <= times.to && instantMs(v.windowEnd) >= times.from,
  );
  const plain = views.every((v) => v.allCalendars === true && v.accountHash !== undefined);
  return views.length > 0 && plain ? { views, times } : null;
}

/**
 * §6.1 v1.10: a calendar claim whose overlapping views see its whole window, every calendar, a known account, but
 * were all last synced before `end(p,t) + graceMin` is partial_coverage with `coverage.changes_unfollowed`, never
 * NOT_FOUND; another calendar claim whose view synced at or after its grace sync is NOT_FOUND.
 */
const calendarStaleViewCapped: Proof = (s, policy) => {
  const capped = s.expect.some((e) => {
    const over = viewsOver(s, e, policy);
    if (over === null) return false;
    const whole = over.views.some(
      (v) => instantMs(v.windowStart) <= over.times.from && instantMs(v.windowEnd) >= over.times.to,
    );
    const stale = over.views.every((v) => instantMs(v.lastSyncAt) < over.times.graceSync);
    return (
      whole &&
      stale &&
      e.ruleId === 'partial_coverage' &&
      e.reasonCodes.includes('coverage.changes_unfollowed')
    );
  });
  const fresh = s.expect.some((e) => {
    const over = viewsOver(s, e, policy);
    return (
      over !== null &&
      e.grade === 'NOT_FOUND' &&
      over.views.some((v) => instantMs(v.lastSyncAt) >= over.times.graceSync)
    );
  });
  return capped && fresh;
};

export const V110_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['calendar_first_look_marker', calendarFirstLookMarker],
  ['calendar_stale_view_capped', calendarStaleViewCapped],
];
