/**
 * candidates() (docs/grading.md §4.1, §4.2): same type, a source the policy lists for it (§6.1), inclusive window
 * bounds to the millisecond, the calendar.created first-seen rule, contentHash dedupe (lowest id), (occurredAt
 * instant, id) order, exact filtering over an index that over-returns, and independence from the index's return
 * order.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';

import { candidates, type ObservationIndex } from '../../../src/core/candidates';
import { canonicalJson, idFromHash, sha256Hex } from '../../../src/core/hash';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { type ActionType, IsoTs, Observation, type ObservationSource, Ulid } from '../../../src/core/schema';
import type { WindowClaim } from '../../../src/core/window';
import { type IndexImplementation, INDEX_IMPLEMENTATIONS } from '../ledger/index-implementations';

interface ObservationSpec {
  readonly type?: ActionType;
  readonly occurredAt: string;
  readonly observedAt?: string;
  readonly subjectHint?: string;
  readonly counterparty?: string;
  /**
   * Forces an id other than idFromHash(contentHash) (two ids, one contentHash): a corrupt ledger row. The
   * schema rejects it (v1.3 §10), so it is built as a typed object without a parse, as a bad index could hand
   * one to candidates().
   */
  readonly idLabel?: string;
}

const sourceOf = (type: ActionType): ObservationSource =>
  type === 'email.sent' ? 'gmail.sent' : type.startsWith('calendar.') ? 'gcal.event' : 'gmail.receipt';

/** A schema-valid observation whose contentHash covers its content (not observedAt), as in §10. */
function obs(spec: ObservationSpec): Observation {
  const type = spec.type ?? 'email.sent';
  const content = {
    source: sourceOf(type),
    type,
    counterparty: spec.counterparty ?? 'priya@company.com',
    subjectHint: spec.subjectHint ?? 'Q3 deck',
    occurredAt: spec.occurredAt,
  };
  const contentHash = sha256Hex(canonicalJson(content));
  const id = idFromHash(contentHash);
  const parsed = Observation.parse({
    ...content,
    id,
    contentHash,
    observedAt: spec.observedAt ?? spec.occurredAt,
  });
  return spec.idLabel === undefined
    ? parsed
    : { ...parsed, id: Ulid.parse(idFromHash(sha256Hex(spec.idLabel))) };
}

const emailClaim = (claimedAt: string, extra: Partial<WindowClaim> = {}): WindowClaim => ({
  type: 'email.sent',
  claimedAt,
  claimedAtPrecision: 'minute',
  ...extra,
});

/** An index that ignores type and time and returns everything, in the given order: maximal over-return. */
const everything = (observations: readonly Observation[]): ObservationIndex => ({
  byTypeAndBucket: () => Promise.resolve(observations),
  byCounterpartyToken: () => Promise.resolve(observations),
});

/** `run` over one index implementation: the memory index, then the ledger's Dexie index (Sprint 2.6). */
const runner =
  ({ createIndex }: IndexImplementation) =>
  (claim: WindowClaim, observations: readonly Observation[], bucketMinutes = 60) =>
    candidates(claim, createIndex(observations, bucketMinutes), DEFAULT_POLICY);

/** Each block runs once per implementation (tests/unit/ledger/index-implementations.ts). */
const eachIndex = describe.each(INDEX_IMPLEMENTATIONS);

const subjects = (list: readonly Observation[]) => list.map((o) => o.subjectHint);

eachIndex('candidates: the window is inclusive at both ends, to the millisecond ($name index)', (impl) => {
  const run = runner(impl);
  // Claim 14:02 → unit [14:02, 14:03] → window [14:00:00.000, 14:48:00.000].
  const rows = [
    obs({ occurredAt: '2026-10-06T13:59:59.999-04:00', subjectHint: 'just before' }),
    obs({ occurredAt: '2026-10-06T14:00:00.000-04:00', subjectHint: 'from edge' }),
    obs({ occurredAt: '2026-10-06T14:48:00.000-04:00', subjectHint: 'to edge' }),
    obs({ occurredAt: '2026-10-06T14:48:00.001-04:00', subjectHint: 'just after' }),
  ];

  it.each([1, 15, 60, 1440])('with %i-minute buckets', async (bucketMinutes) => {
    const found = await run(emailClaim('2026-10-06T14:02:00-04:00'), rows, bucketMinutes);
    expect(subjects(found)).toEqual(['from edge', 'to edge']);
  });

  it('filters exactly even when the index returns everything', async () => {
    const found = await candidates(emailClaim('2026-10-06T14:02:00-04:00'), everything(rows), DEFAULT_POLICY);
    expect(subjects(found)).toEqual(['from edge', 'to edge']);
  });

  it('claim 23:58, observation 00:01 the next day is a candidate (midnight crossing)', async () => {
    const next = obs({ occurredAt: '2026-10-07T00:01:00-04:00' });
    expect(await run(emailClaim('2026-10-06T23:58:00-04:00'), [next])).toEqual([next]);
  });

  it('25-hour DST day: 23:50 local is a candidate only with claimedAtEnd = the true next midnight', async () => {
    const late = obs({ occurredAt: '2026-11-01T23:50:00-05:00' });
    const day: WindowClaim = emailClaim('2026-11-01T00:00:00-04:00', { claimedAtPrecision: 'day' });
    expect(await run(day, [late])).toEqual([]);
    expect(await run({ ...day, claimedAtEnd: '2026-11-02T00:00:00-05:00' }, [late])).toEqual([late]);
  });
});

eachIndex('candidates: same ActionType only ($name index)', (impl) => {
  const run = runner(impl);
  const at = '2026-10-06T14:02:00-04:00';
  const email = obs({ occurredAt: at, subjectHint: 'email' });
  const receipt = obs({ type: 'purchase.made', occurredAt: at, subjectHint: 'receipt' });
  const event = obs({ type: 'calendar.updated', occurredAt: at, subjectHint: 'event' });

  it('an email claim never gets a receipt or an event at the same instant', async () => {
    expect(subjects(await run(emailClaim(at), [receipt, email, event]))).toEqual(['email']);
  });

  it('even from an index that returns other types', async () => {
    const found = await candidates(emailClaim(at), everything([receipt, email, event]), DEFAULT_POLICY);
    expect(subjects(found)).toEqual(['email']);
  });
});

eachIndex('candidates: duplicates by contentHash count once, lowest id kept ($name index)', (impl) => {
  const run = runner(impl);
  const occurredAt = '2026-10-06T14:02:00-04:00';
  const first = obs({ occurredAt, observedAt: '2026-10-06T14:10:00-04:00' });
  const resighted = obs({ occurredAt, observedAt: '2026-10-06T14:40:00-04:00' });
  const twins = [obs({ occurredAt, idLabel: 'twin-a' }), obs({ occurredAt, idLabel: 'twin-b' })];
  const lowest = [...twins].sort((a, b) => (a.id < b.id ? -1 : 1))[0];

  it('the same row seen by two syncs is one candidate, the earlier sighting', async () => {
    expect(first.id).toBe(resighted.id);
    expect(await run(emailClaim(occurredAt), [resighted, first])).toEqual([first]);
    expect(await run(emailClaim(occurredAt), [first, resighted])).toEqual([first]);
  });

  it.runIf(impl.returnsUnparsedRows)(
    'two ids with one contentHash keep the lowest id, whatever the index order',
    async () => {
      expect(twins[0]?.contentHash).toBe(twins[1]?.contentHash);
      expect(await run(emailClaim(occurredAt), twins)).toEqual([lowest]);
      expect(await run(emailClaim(occurredAt), [...twins].reverse())).toEqual([lowest]);
    },
  );

  it('the same object returned twice by an index counts once', async () => {
    const found = await candidates(emailClaim(occurredAt), everything([first, first]), DEFAULT_POLICY);
    expect(found).toEqual([first]);
  });
});

eachIndex('candidates: memoised instants never go stale ($name index)', (impl) => {
  const run = runner(impl);
  // The inferred Observation type is mutable; a parse cached per object must follow the field's current text.
  it('an observation edited in place is read at its new occurredAt', async () => {
    const row = obs({ occurredAt: '2026-10-06T14:10:00-04:00' });
    const claim = emailClaim('2026-10-06T14:02:00-04:00');
    expect(await run(claim, [row])).toEqual([row]);
    row.occurredAt = IsoTs.parse('2026-10-09T14:10:00-04:00');
    expect(await run(claim, [row])).toEqual([]);
    expect(await candidates(claim, everything([row]), DEFAULT_POLICY)).toEqual([]);
  });

  it('an observation edited in place is read at its new observedAt (calendar.created first-seen)', async () => {
    const row = obs({
      type: 'calendar.created',
      occurredAt: '2026-10-08T14:00:00-04:00',
      observedAt: '2026-10-06T14:40:00-04:00',
    });
    const claim: WindowClaim = {
      type: 'calendar.created',
      claimedAt: '2026-10-06T14:02:00-04:00',
      claimedAtPrecision: 'minute',
      targetAt: '2026-10-08T14:00:00-04:00',
    };
    expect(await run(claim, [row])).toEqual([row]);
    row.observedAt = IsoTs.parse('2026-10-06T09:00:00-04:00');
    expect(await run(claim, [row])).toEqual([]);
  });
});

eachIndex('candidates: ordered by (occurredAt instant, id), never by ISO text ($name index)', (impl) => {
  const run = runner(impl);
  it('an instant written in a later-looking offset sorts by its instant', async () => {
    const a = obs({ occurredAt: '2026-10-06T14:10:00-04:00', subjectHint: 'a 18:10Z' });
    const b = obs({ occurredAt: '2026-10-06T19:05:00+01:00', subjectHint: 'b 18:05Z' });
    const found = await run(emailClaim('2026-10-06T14:02:00-04:00'), [a, b]);
    expect(subjects(found)).toEqual(['b 18:05Z', 'a 18:10Z']);
  });

  it('one instant in two offsets ties on time and orders by id', async () => {
    const x = obs({ occurredAt: '2026-10-06T14:10:00-04:00', subjectHint: 'x' });
    const y = obs({ occurredAt: '2026-10-06T18:10:00Z', subjectHint: 'y' });
    const byId = [x, y].sort((p, q) => (p.id < q.id ? -1 : 1));
    expect(await run(emailClaim('2026-10-06T14:02:00-04:00'), [x, y])).toEqual(byId);
    expect(await run(emailClaim('2026-10-06T14:02:00-04:00'), [y, x])).toEqual(byId);
  });

  it.runIf(impl.returnsUnparsedRows)(
    'one id with two contents at one instant (a corrupt ledger) orders by contentHash, never by index order',
    async () => {
      const occurredAt = '2026-10-06T14:10:00-04:00';
      const p = obs({ occurredAt, subjectHint: 'p', idLabel: 'shared' });
      const q = obs({ occurredAt, subjectHint: 'q', idLabel: 'shared' });
      expect(p.id).toBe(q.id);
      expect(p.contentHash).not.toBe(q.contentHash);
      const byHash = [p, q].sort((a, b) => (a.contentHash < b.contentHash ? -1 : 1));
      const claim = emailClaim('2026-10-06T14:02:00-04:00');
      expect(await run(claim, [p, q])).toEqual(byHash);
      expect(await run(claim, [q, p])).toEqual(byHash);
      expect(await candidates(claim, everything([q, p]), DEFAULT_POLICY)).toEqual(byHash);
      expect(await candidates(claim, everything([p, q]), DEFAULT_POLICY)).toEqual(byHash);
    },
  );
});

eachIndex('candidates: from a source the policy lists for the type only (§6.1) ($name index)', (impl) => {
  const run = runner(impl);
  const at = '2026-10-06T14:02:00-04:00';
  const own = obs({ occurredAt: at, subjectHint: 'own' });
  // An email.sent row the calendar observer read: email.sent's coverage never reads gcal.event.
  const content = { source: 'gcal.event', type: 'email.sent', subjectHint: 'stray', occurredAt: at } as const;
  const contentHash = sha256Hex(canonicalJson(content));
  const stray = Observation.parse({ ...content, id: idFromHash(contentHash), contentHash, observedAt: at });

  it('is no candidate of a claim of its type, from any index', async () => {
    expect(subjects(await run(emailClaim(at), [stray, own]))).toEqual(['own']);
    expect(subjects(await candidates(emailClaim(at), everything([stray, own]), DEFAULT_POLICY))).toEqual([
      'own',
    ]);
  });

  it('is one when the policy lists its source for the type', async () => {
    const sourcesByType = { ...defaultPolicyJson.sourcesByType, 'email.sent': ['gmail.sent', 'gcal.event'] };
    const both = loadPolicy({ ...defaultPolicyJson, sourcesByType });
    const found = await candidates(emailClaim(at), impl.createIndex([stray, own], 60), both);
    expect(subjects(found).sort()).toEqual(['own', 'stray']);
  });
});
