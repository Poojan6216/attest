/**
 * candidates() for calendar claims (docs/grading.md §4.1): the window is targetAt ± calendarDays; a calendar
 * claim without targetAt has no candidates (and reads nothing); calendar.created needs
 * observedAt ≥ claimedAt − beforeClaimMin, measured over every sighting of the event.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { candidates, createMemoryIndex, type ObservationIndex } from '../../../src/core/candidates';
import { canonicalJson, idFromHash, sha256Hex } from '../../../src/core/hash';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { type ActionType, Observation } from '../../../src/core/schema';
import type { WindowClaim } from '../../../src/core/window';

const event = (type: ActionType, occurredAt: string, observedAt: string, subjectHint = 'Q3 review') => {
  const content = { source: 'gcal.event', type, subjectHint, occurredAt };
  const contentHash = sha256Hex(canonicalJson(content));
  return Observation.parse({ ...content, id: idFromHash(contentHash), contentHash, observedAt });
};

const calendarClaim = (type: ActionType, extra: Partial<WindowClaim> = {}): WindowClaim => ({
  type,
  claimedAt: '2026-10-06T14:02:00-04:00',
  claimedAtPrecision: 'minute',
  targetAt: '2026-10-08T14:00:00-04:00',
  ...extra,
});

const run = (claim: WindowClaim, observations: readonly Observation[]) =>
  candidates(claim, createMemoryIndex(observations, 60), DEFAULT_POLICY);

describe('calendar windows: targetAt ± calendarDays (3), inclusive', () => {
  it.each(['calendar.created', 'calendar.updated', 'calendar.deleted'] as const)('%s', async (type) => {
    const seen = '2026-10-06T14:40:00-04:00';
    const inFrom = event(type, '2026-10-05T14:00:00-04:00', seen, 'from edge');
    const outFrom = event(type, '2026-10-05T13:59:59.999-04:00', seen, 'before');
    const inTo = event(type, '2026-10-11T14:00:00-04:00', seen, 'to edge');
    const outTo = event(type, '2026-10-11T14:00:00.001-04:00', seen, 'after');
    const found = await run(calendarClaim(type), [outTo, inTo, outFrom, inFrom]);
    expect(found).toEqual([inFrom, inTo]);
  });

  it('without targetAt there are no candidates and the index is never read', async () => {
    let reads = 0;
    const counting: ObservationIndex = {
      byTypeAndBucket: () => {
        reads += 1;
        return Promise.resolve([]);
      },
      byCounterpartyToken: () => {
        reads += 1;
        return Promise.resolve([]);
      },
    };
    const claim: WindowClaim = {
      type: 'calendar.created',
      claimedAt: '2026-10-06T14:02:00-04:00',
      claimedAtPrecision: 'minute',
    };
    expect(await candidates(claim, counting, DEFAULT_POLICY)).toEqual([]);
    expect(reads).toBe(0);
  });
});

describe('calendar.created: an event already on the calendar before the claim cannot verify "created"', () => {
  const occurredAt = '2026-10-08T14:00:00-04:00';

  it('first seen exactly at claimedAt − beforeClaimMin (14:00:00.000) is a candidate', async () => {
    const fresh = event('calendar.created', occurredAt, '2026-10-06T14:00:00.000-04:00');
    expect(await run(calendarClaim('calendar.created'), [fresh])).toEqual([fresh]);
  });

  it('first seen 1 ms earlier is not', async () => {
    const old = event('calendar.created', occurredAt, '2026-10-06T13:59:59.999-04:00');
    expect(await run(calendarClaim('calendar.created'), [old])).toEqual([]);
  });

  it('a later re-sighting of a pre-existing event does not pass, in either index order', async () => {
    const before = event('calendar.created', occurredAt, '2026-10-06T09:00:00-04:00');
    const after = event('calendar.created', occurredAt, '2026-10-06T14:40:00-04:00');
    expect(before.id).toBe(after.id);
    expect(await run(calendarClaim('calendar.created'), [after, before])).toEqual([]);
    expect(await run(calendarClaim('calendar.created'), [before, after])).toEqual([]);
  });

  it.each(['calendar.updated', 'calendar.deleted'] as const)('%s has no first-seen rule', async (type) => {
    const old = event(type, occurredAt, '2026-10-01T09:00:00-04:00');
    expect(await run(calendarClaim(type), [old])).toEqual([old]);
  });

  it('a day-precision claim measures from the start of its day, not from claimedAt', async () => {
    const morning = event('calendar.created', occurredAt, '2026-10-06T08:00:00-04:00');
    const dayBefore = event('calendar.created', '2026-10-08T15:00:00-04:00', '2026-10-05T23:57:59-04:00');
    const claim = calendarClaim('calendar.created', {
      claimedAt: '2026-10-06T12:00:00-04:00',
      claimedAtPrecision: 'day',
    });
    expect(await run(claim, [morning, dayBefore])).toEqual([morning]);
  });

  it('follows policy.windows.beforeClaimMin', async () => {
    const early = event('calendar.created', occurredAt, '2026-10-06T13:55:00-04:00');
    const policy = loadPolicy({
      ...defaultPolicyJson,
      windows: { ...defaultPolicyJson.windows, beforeClaimMin: 10 },
    });
    const claim = calendarClaim('calendar.created');
    expect(await candidates(claim, createMemoryIndex([early], 60), DEFAULT_POLICY)).toEqual([]);
    expect(await candidates(claim, createMemoryIndex([early], 60), policy)).toEqual([early]);
  });
});
