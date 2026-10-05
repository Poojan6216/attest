/**
 * docs/grading.md §3 orphans written out with Date.parse, for the property tests (no src/core helper): whether a row's
 * own source saw it, whether a `gcal.event` row is a change a Calendar view followed (v1.9), and every orphan
 * candidate of a batch, once per content hash.
 */
import type { Policy } from '../../src/core/policy';
import type { Coverage, Observation } from '../../src/core/schema';

const compareText = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

/** Whether a pass of `o`'s own source synced by `evaluatedMs` saw its `occurredAt`. */
export function seenByOwnSource(o: Observation, coverage: Coverage, evaluatedMs: number): boolean {
  const t = Date.parse(o.occurredAt);
  return coverage.observers.some(
    (e) =>
      e.source === o.source &&
      Date.parse(e.lastSyncAt) <= evaluatedMs &&
      Date.parse(e.windowStart) <= t &&
      t <= Date.parse(e.windowEnd),
  );
}

/** `changed`: an orphan candidate; `firstLook`: a view began comparing at its first sighting; `unfollowed`: neither. */
export type CalendarVerdict = 'changed' | 'unfollowed' | 'firstLook';

/**
 * Over the gcal.event passes synced by `evaluatedMs` whose window holds the row's start: `firstLook` if one began
 * comparing at the row's first sighting (changesSince equal to it), or one without changesSince was synced at or
 * after it; else `changed` if one has changesSince < first sighting ≤ lastSyncAt; else `unfollowed`.
 */
export function calendarVerdict(o: Observation, coverage: Coverage, evaluatedMs: number): CalendarVerdict {
  const t = Date.parse(o.occurredAt);
  const seen = Date.parse(o.sightedAt ?? o.observedAt);
  const covering = coverage.observers.filter(
    (e) =>
      e.source === 'gcal.event' &&
      Date.parse(e.lastSyncAt) <= evaluatedMs &&
      Date.parse(e.windowStart) <= t &&
      t <= Date.parse(e.windowEnd),
  );
  const firstLook = (e: (typeof covering)[number]) =>
    e.changesSince === undefined ? Date.parse(e.lastSyncAt) >= seen : Date.parse(e.changesSince) === seen;
  if (covering.some(firstLook)) return 'firstLook';
  const followed = covering.some(
    (e) =>
      e.changesSince !== undefined && Date.parse(e.changesSince) < seen && seen <= Date.parse(e.lastSyncAt),
  );
  return followed ? 'changed' : 'unfollowed';
}

/**
 * §3 for every row: first seen by `evaluatedMs`, from a source the policy lists for its type, seen by its own source,
 * once per content hash (`firstBy` picks the representative), a gcal.event representative a followed change; in
 * candidate order (occurredAt instant, id, content hash).
 */
export function orphanOracle(
  observations: readonly Observation[],
  coverage: Coverage,
  policy: Pick<Policy, 'sourcesByType'>,
  evaluatedMs: number,
  firstBy: (rows: readonly Observation[]) => Observation | undefined,
): { observation: Observation; atMs: number }[] {
  const covered = observations.filter((o) => {
    if (Date.parse(o.observedAt) > evaluatedMs) return false;
    return policy.sourcesByType[o.type].includes(o.source) && seenByOwnSource(o, coverage, evaluatedMs);
  });
  const groups = new Map<string, Observation[]>();
  for (const o of covered) groups.set(o.contentHash, [...(groups.get(o.contentHash) ?? []), o]);
  const kept = [...groups.values()].flatMap((group) => {
    const best = firstBy(group);
    if (best === undefined) return [];
    if (best.source === 'gcal.event' && calendarVerdict(best, coverage, evaluatedMs) !== 'changed') return [];
    return [{ observation: best, atMs: Date.parse(best.occurredAt) }];
  });
  return kept.sort(
    (a, b) =>
      a.atMs - b.atMs ||
      compareText(a.observation.id, b.observation.id) ||
      compareText(a.observation.contentHash, b.observation.contentHash),
  );
}
