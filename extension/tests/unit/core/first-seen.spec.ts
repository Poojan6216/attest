/**
 * SIM-2 (Hard Rule 5): an observation's first sighting is kept apart from the instant the ledger stored it. The ledger
 * stamps `observedAt` no earlier than the write and after the last batch (§3), and keeps the observer's sighting as
 * `sightedAt` when the stamp is later. §4.1's calendar first-seen rule and the §7 calendar anchor read the first
 * sighting (order.ts `firstSeenAt`: `sightedAt`, else `observedAt`), `observedAt` still decides which batches read the
 * row, and the candidate `refHash` binds `sightedAt` when present, so replay stays exact. A row without `sightedAt`
 * hashes and grades exactly as before (docs/grading.md §3, §4.1, §7, §10).
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { attribute } from '../../../src/core/attribution';
import { gradeBatch } from '../../../src/core/batch';
import { candidates, createMemoryIndex } from '../../../src/core/candidates';
import { GradeError } from '../../../src/core/grade';
import { checkCandidates } from '../../../src/core/grade-guard';
import { canonicalJson } from '../../../src/core/hash';
import { anchorAt, firstSeenAt, representative } from '../../../src/core/order';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { candidatesHash, receiptId } from '../../../src/core/receipt';
import { contentHashOf, observationIntegrityProblems } from '../../../src/core/redact';
import { Activity, type Claim, Coverage, IsoTs, Observation } from '../../../src/core/schema';
import {
  buildClaim,
  buildObservation,
  isoAt,
  makeGrants,
  makePass,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  START_MS,
} from '../../tools/attest-world';

const DAY_MS = START_MS + MS_PER_DAY;
const at = (hours: number, minutes = 0, ms = 0) =>
  isoAt(DAY_MS + hours * MS_PER_HOUR + minutes * MS_PER_MINUTE + ms);

/** An event on the calendar for tomorrow 16:00, sighted at `sighted`, stored at `stored` (the ledger's stamp). */
function event(sighted: string, stored = sighted): Observation {
  const row = buildObservation(1, {
    type: 'calendar.created',
    counterparty: 'priya@acme.io',
    subjectHint: 'q3 review',
    occurredAt: at(40),
    observedAt: stored,
  });
  return stored === sighted ? row : Observation.parse({ ...row, sightedAt: sighted });
}

/** "Created the q3 review" at 14:02 (first-seen bound 14:00), read at 14:10. */
const CLAIM: Claim = buildClaim(1, {
  agent: 'muse',
  type: 'calendar.created',
  counterparty: 'priya@acme.io',
  subjectHint: 'q3 review',
  claimedAt: at(14, 2),
  targetAt: at(40),
  observedAt: at(14, 10),
});
const STAMPED = at(14, 5, 500);

describe('Observation.sightedAt: strictly before observedAt, or absent', () => {
  it('accepts a sighting before the stored instant', () => {
    expect(event(at(13, 50), STAMPED).sightedAt).toBe(at(13, 50));
  });

  it.each([
    ['at the stored instant', STAMPED],
    ['at the stored instant in another offset', isoAt(Date.parse(STAMPED), -240)],
    ['after the stored instant', at(14, 6)],
  ])('refuses one %s', (_label, sightedAt) => {
    const parsed = Observation.safeParse({ ...event(STAMPED), sightedAt });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['sightedAt']]);
  });
});

describe('firstSeenAt and anchorAt (order.ts): the one reading of a first sighting', () => {
  it('reads sightedAt when the row has one, else observedAt', () => {
    expect(firstSeenAt(event(at(13, 50), STAMPED))).toBe(at(13, 50));
    expect(firstSeenAt(event(at(13, 50)))).toBe(at(13, 50));
  });

  it('anchors a calendar orphan on its first sighting and any other on occurredAt (§7)', () => {
    expect(anchorAt(event(at(13, 50), STAMPED))).toBe(at(13, 50));
    const sent = buildObservation(2, {
      type: 'email.sent',
      counterparty: 'priya@acme.io',
      occurredAt: at(13),
      observedAt: STAMPED,
    });
    expect(anchorAt(Observation.parse({ ...sent, sightedAt: at(13, 1) }))).toBe(at(13));
  });

  it('keeps the row first seen earliest as the representative, in either order', () => {
    const early = event(at(13, 50), STAMPED);
    const late = event(at(14, 1), STAMPED);
    expect(representative(early, late)).toBe(early);
    expect(representative(late, early)).toBe(early);
  });
});

describe('§4.1: an event on the calendar before the claim never verifies "created", however late it was stored', () => {
  const index = (observation: Observation) => createMemoryIndex([observation], 15);

  it('candidates() reads the first sighting, not the stamp', async () => {
    expect(await candidates(CLAIM, index(event(at(13, 50), STAMPED)), DEFAULT_POLICY)).toEqual([]);
    const fresh = event(at(14, 3), STAMPED);
    expect(await candidates(CLAIM, index(fresh), DEFAULT_POLICY)).toEqual([fresh]);
  });

  it('grade refuses as foreign a candidate first seen before the bound, though stored after it', () => {
    expect(() => {
      checkCandidates(CLAIM, [event(at(13, 50), STAMPED)], DEFAULT_POLICY);
    }).toThrow(new GradeError('foreign_candidate'));
    expect(() => {
      checkCandidates(CLAIM, [event(at(14, 3), STAMPED)], DEFAULT_POLICY);
    }).not.toThrow();
  });

  it('gradeBatch grades the event stored late exactly as the event stored on time', async () => {
    const coverage = Coverage.parse({
      evaluatedAt: at(16),
      observers: [makePass('gcal.event', DAY_MS + 15 * MS_PER_HOUR, 3 * MS_PER_DAY)],
    });
    const activity = Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims: [] });
    const grade = async (observation: Observation) => {
      const graded = await gradeBatch(
        [CLAIM],
        index(observation),
        makeGrants(DAY_MS + 30 * MS_PER_DAY),
        DEFAULT_POLICY,
        coverage,
        activity,
        [],
      );
      const id = receiptId({ k: 'claim', claimId: CLAIM.id });
      const receipt = graded.find((entry) => entry.receipt.id === id)?.receipt;
      return [receipt?.grade, receipt?.ruleId, receipt?.state, receipt?.observationIds];
    };
    const onTime = await grade(event(at(13, 50)));
    expect(await grade(event(at(13, 50), STAMPED))).toEqual(onTime);
    expect(onTime[3]).toEqual([]);
    expect((await grade(event(at(14, 3), STAMPED)))[3]).toEqual([event(at(14, 3)).id]);
  });
});

describe('§7: a calendar orphan is anchored on its first sighting', () => {
  const ping = (minutes: number) =>
    Activity.parse({
      sessions: [{ agent: 'muse', at: at(14, minutes) }],
      idle: [],
      entries: [],
      adapterSyncs: [],
      claims: [],
    });
  const orphan = event(at(14, 10), at(14, 40));

  it('a session near the sighting fires; one near the stamp alone does not', () => {
    expect(attribute(orphan, ping(12), DEFAULT_POLICY)?.signals).toEqual(['agentSessionActive']);
    expect(attribute(orphan, ping(38), DEFAULT_POLICY)).toBeNull();
  });
});

/** §3 `candidatesHash` of `rows` as defined: SHA-256 of their refs' digests in id order (Node's crypto). */
function definedCandidatesHash(rows: readonly Observation[]): string {
  const sha = (data: string | Buffer) => createHash('sha256').update(data).digest();
  const refs = [...rows]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(({ id, contentHash, observedAt, sightedAt }) =>
      sha(canonicalJson({ id, contentHash, observedAt, sightedAt })),
    );
  return sha(Buffer.concat(refs)).toString('hex');
}

describe('refHash binds sightedAt when present, and a row without it hashes as before', () => {
  it('equals the canonical JSON of {id, contentHash, observedAt, sightedAt?}', () => {
    const plain = event(at(13, 50));
    const stamped = event(at(13, 50), STAMPED);
    expect(candidatesHash([plain])).toBe(definedCandidatesHash([plain]));
    expect(candidatesHash([stamped])).toBe(definedCandidatesHash([stamped]));
    const { id, contentHash, observedAt } = plain;
    const before = createHash('sha256').update(canonicalJson({ id, contentHash, observedAt })).digest();
    expect(candidatesHash([plain])).toBe(createHash('sha256').update(before).digest('hex'));
    expect(candidatesHash([stamped])).not.toBe(candidatesHash([{ ...stamped, sightedAt: undefined }]));
  });

  it('is never stale: a sightedAt edited in place is hashed again', () => {
    const edited: { -readonly [K in keyof Observation]: Observation[K] } = { ...event(at(13, 50), STAMPED) };
    const before = candidatesHash([edited]);
    edited.sightedAt = IsoTs.parse(at(13, 55));
    expect(candidatesHash([edited])).toBe(definedCandidatesHash([edited]));
    expect(candidatesHash([edited])).not.toBe(before);
  });
});

describe("redact: sightedAt is the ledger's, never content", () => {
  it('is not hashed into the content, and an observer can never set it', () => {
    const stamped = event(at(13, 50), STAMPED);
    expect(contentHashOf(stamped)).toBe(stamped.contentHash);
    expect(observationIntegrityProblems(event(at(13, 50)), DEFAULT_POLICY)).toEqual([]);
    expect(observationIntegrityProblems(stamped, DEFAULT_POLICY)).toEqual([
      ['sightedAt', 'is set by the ledger only'],
    ]);
  });
});
