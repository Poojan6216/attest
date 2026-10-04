/**
 * The §3/§4.1 rules written once in src/core/order.ts, and the paths that share them (Sprint 1 tech review TECH-C4),
 * each against a reference (1,000 runs each, qa_tester rule 4):
 *  - `mergeIntervals` against a fixpoint merge written from scratch; `representative` against "the first by (id,
 *    first sighting instant, observedAt instant, observedAt text, sightedAt text)", whatever order the rows are folded
 *    in (some rows stored later than sighted, carrying `sightedAt`, SIM-2);
 *  - the batch's retrieval (batch-retrieve.ts `candidatesOfAll`) against `candidates()` claim by claim, the path
 *    replay rebuilds batches with (re-sightings, twin ids, rows read by a source not listed for their type, rows
 *    first seen exactly at a calendar.created claim's first-seen bound, and a corrupt content hash at two instants,
 *    which sends a type down the claim-by-claim path);
 *  - orphan discovery (batch-orphans.ts `coveredObservations` over `visibleAt`) against §3 written out with
 *    Date.parse: first seen by evaluatedAt, from a source the policy lists for its type, inside a window of a pass of
 *    its own source synced by evaluatedAt, once per content hash (the representative), in candidate order.
 * The last two run over the memory index and the ledger's Dexie index (Sprint 2.6), each given the rows it holds.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';

import { coveredObservations, visibleAt } from '../../src/core/batch-orphans';
import { candidatesOfAll } from '../../src/core/batch-retrieve';
import { candidates } from '../../src/core/candidates';
import { TextFacts } from '../../src/core/features';
import { idFromHash } from '../../src/core/hash';
import { firstSeenFromMs, mergeIntervals, representative } from '../../src/core/order';
import { loadPolicy } from '../../src/core/policy';
import { type ActionType, type Claim, Coverage, Observation, Ulid } from '../../src/core/schema';
import type { Interval } from '../../src/core/window';
import { buildClaim, isoAt, MS_PER_MINUTE } from '../tools/attest-world';
import { INDEX_IMPLEMENTATIONS } from '../unit/ledger/index-implementations';

const RUNS = 1_000;
const eachIndex = describe.each(INDEX_IMPLEMENTATIONS);
const POLICY = loadPolicy(defaultPolicyJson);
const BASE_MS = Date.parse('2026-10-06T00:00:00Z');
const SPAN_MINUTES = 3 * 24 * 60;
const EVALUATED_MS = BASE_MS + SPAN_MINUTES * MS_PER_MINUTE;
const SOURCES = ['gmail.sent', 'gmail.receipt', 'gcal.event'] as const;
/** Types with sources (each source's own, and calendar.created's first-seen rule) and one without (message.sent). */
const TYPES: readonly ActionType[] = ['email.sent', 'calendar.created', 'purchase.made', 'message.sent'];
const OWN_SOURCE: Partial<Record<ActionType, string>> = {
  'email.sent': 'gmail.sent',
  'calendar.created': 'gcal.event',
  'purchase.made': 'gmail.receipt',
};
const offsetArb = fc.constantFrom(-240, 0, 330);
const compareText = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);
const minutesAt = (minutes: number, offset = 0) => isoAt(BASE_MS + minutes * MS_PER_MINUTE, offset);

/** How often the runs reached each case: asserted after each property so it can never pass vacuously. */
const tally = { candidates: 0, corrupt: 0, atBound: 0, stamped: 0, orphans: 0, strayExcluded: 0 };
/** §4.1, §7: when a row was first seen, written out (its `sightedAt` when the ledger stored it later). */
const firstSeenMs = (o: Observation) => Date.parse(o.sightedAt ?? o.observedAt);

// ── order.ts against definitions written from scratch ──────────────────────────────────────────

/** Merges any two overlapping or touching intervals until none are left, then sorts: no sweep, no order. */
function unionOracle(intervals: readonly Interval[]): Interval[] {
  const held = [...intervals];
  for (let i = 0; i < held.length; i += 1) {
    for (let j = i + 1; j < held.length; j += 1) {
      const [a, b] = [held[i], held[j]];
      if (a === undefined || b === undefined || a.startMs > b.endMs || b.startMs > a.endMs) continue;
      held[i] = { startMs: Math.min(a.startMs, b.startMs), endMs: Math.max(a.endMs, b.endMs) };
      held.splice(j, 1);
      i = -1;
      break;
    }
  }
  return held.sort((a, b) => a.startMs - b.startMs);
}

const intervalArb = fc
  .tuple(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 12 }))
  .map(([startMs, length]) => ({ startMs, endMs: startMs + length }));

/** Rows sharing one content hash: ids from three, sightings in three offsets, so instants tie with other text. */
const sharedArb = fc.array(
  fc.record({
    id: fc.nat({ max: 2 }),
    seenMinutes: fc.nat({ max: 2 }),
    offset: offsetArb,
    /** Sometimes stored 1–2 minutes after the sighting (SIM-2): `sightedAt` keeps the sighting. */
    laterMinutes: fc.nat({ max: 2 }),
  }),
  { minLength: 1, maxLength: 6 },
);

/** A row of content `k` seen at `observedAt`: the honest id for twin 0, another id for twins 1–2 (no parse). */
function row(k: number, twin: number, fields: Record<string, unknown>): Observation {
  // k in both halves: idFromHash reads only the first 128 bits, so each content gets its own id.
  const contentHash = k.toString(16).padStart(32, '0').repeat(2);
  const honest = Observation.parse({ ...fields, id: idFromHash(contentHash), contentHash });
  // Twin ids start at 100: an honest id is base32 of k (at most "…09"), so no twin can take one.
  return twin === 0 ? honest : { ...honest, id: Ulid.parse(String(100 + k * 10 + twin).padStart(26, '0')) };
}

function sharedRows(rows: Generated<typeof sharedArb>): Observation[] {
  return rows.map(({ id, seenMinutes, offset, laterMinutes }) =>
    row(0, id, {
      source: 'gmail.sent',
      type: 'email.sent',
      occurredAt: minutesAt(0),
      observedAt: minutesAt(seenMinutes + laterMinutes, offset),
      ...(laterMinutes === 0 ? {} : { sightedAt: minutesAt(seenMinutes, offset) }),
    }),
  );
}

/** §4.1 written out: the lowest id, the earliest first sighting, the earliest observedAt, then the smaller texts. */
function firstBySpec(rows: readonly Observation[]): Observation | undefined {
  return [...rows].sort(
    (a, b) =>
      compareText(a.id, b.id) ||
      firstSeenMs(a) - firstSeenMs(b) ||
      Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
      compareText(a.observedAt, b.observedAt) ||
      compareText(a.sightedAt ?? '', b.sightedAt ?? ''),
  )[0];
}

describe('order.ts against definitions written from scratch', () => {
  it('mergeIntervals is the union of its inputs: disjoint, ascending, never touching', () => {
    fc.assert(
      fc.property(fc.array(intervalArb, { maxLength: 12 }), (intervals) => {
        expect(mergeIntervals(intervals)).toEqual(unionOracle(intervals));
      }),
      { numRuns: RUNS },
    );
  });

  it('representative keeps the first by (id, first sighting, observedAt, texts) in any fold order', () => {
    fc.assert(
      fc.property(sharedArb, fc.nat(), (generated, rotate) => {
        const rows = sharedRows(generated);
        const at = rotate % rows.length;
        const orders = [rows, [...rows].reverse(), [...rows.slice(at), ...rows.slice(0, at)]];
        for (const order of orders) {
          const [first, ...rest] = order;
          if (first === undefined) continue;
          expect(rest.reduce(representative, first)).toEqual(firstBySpec(rows));
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ── the batch paths against the reference paths ────────────────────────────────────────────────

/** The value type an arbitrary generates. */
type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;

/** `arb` one time in `1 + nullWeight`, null otherwise. */
const rarely = <T>(arb: fc.Arbitrary<T>, nullWeight: number) =>
  fc.oneof({ arbitrary: fc.constant(null), weight: nullWeight }, { arbitrary: arb, weight: 1 });

const contentArb = fc.record({
  type: fc.constantFrom(...TYPES),
  /** Mostly the type's own source (null); any source, often one not listed for the type, otherwise. */
  source: rarely(fc.constantFrom(...SOURCES), 3),
  atMinutes: fc.integer({ min: 0, max: SPAN_MINUTES }),
  offset: offsetArb,
  /** A corrupt ledger: some sightings of this content hash at another instant. */
  shiftMinutes: rarely(fc.integer({ min: 1, max: 120 }), 19),
});
const sightingArb = fc.record({
  content: fc.nat({ max: 9 }),
  twin: fc.nat({ max: 2 }),
  seenMinutes: fc.integer({ min: -24 * 60, max: SPAN_MINUTES + 60 }),
  offset: offsetArb,
  shifted: fc.boolean(),
  /** Sometimes: seen exactly at the first-seen bound of a claim that has one (and of that claim's content). */
  atBound: rarely(fc.nat({ max: 7 }), 2),
  /** Sometimes: stored this many minutes after the sighting, which it keeps as `sightedAt` (§3, SIM-2). */
  storedLater: rarely(fc.integer({ min: 1, max: 90 }), 2),
});
const rowsArb = fc.record({
  contents: fc.array(contentArb, { minLength: 1, maxLength: 10 }),
  sightings: fc.array(sightingArb, { minLength: 1, maxLength: 30 }),
});

/** A claim's content (index into the generated contents) and its first-seen bound (null: no first-seen rule). */
interface Bound {
  readonly content: number;
  readonly boundMs: number | null;
}

/**
 * Twin 0 is the honest row; twins 1 and 2 carry another id with the same content hash (a corrupt index). A sighting
 * with `atBound` is of the content of one of the claims that have a first-seen bound (`bounds`), seen exactly at it.
 */
function buildRows(
  { contents, sightings }: Generated<typeof rowsArb>,
  bounds: readonly Bound[] = [],
): Observation[] {
  const bounded = bounds.filter((bound) => bound.boundMs !== null);
  return sightings.flatMap((s) => {
    const pinned = s.atBound === null ? undefined : bounded[s.atBound % Math.max(1, bounded.length)];
    const boundMs = pinned?.boundMs ?? null;
    const k = boundMs === null || pinned === undefined ? s.content % contents.length : pinned.content;
    const c = contents[k];
    if (c === undefined) return [];
    const shift = s.shifted && c.shiftMinutes !== null ? c.shiftMinutes : 0;
    if (shift !== 0) tally.corrupt += 1;
    const sightedMs = boundMs ?? BASE_MS + s.seenMinutes * MS_PER_MINUTE;
    const stamp = s.storedLater === null ? {} : { sightedAt: isoAt(sightedMs, s.offset) };
    return [
      row(k, s.twin, {
        source: c.source ?? OWN_SOURCE[c.type] ?? 'gmail.sent',
        type: c.type,
        occurredAt: minutesAt(c.atMinutes + shift, c.offset),
        observedAt: isoAt(sightedMs + (s.storedLater ?? 0) * MS_PER_MINUTE, s.offset),
        ...stamp,
      }),
    ];
  });
}

const claimArb = fc.record({
  content: fc.nat({ max: 9 }),
  /** Mostly the content's own type (null). */
  type: rarely(fc.constantFrom(...TYPES), 3),
  deltaMinutes: fc.integer({ min: -90, max: 90 }),
  precision: fc.constantFrom('minute', 'hour', 'day'),
  offset: offsetArb,
  target: fc.boolean(),
});

/** Each claim's content and first-seen bound, for `buildRows`. */
function boundsOf(
  generated: readonly Generated<typeof claimArb>[],
  claims: readonly Claim[],
  count: number,
): Bound[] {
  return claims.map((claim, i) => ({
    content: (generated[i]?.content ?? 0) % count,
    boundMs: firstSeenFromMs(claim, POLICY),
  }));
}

/**
 * Whether a candidate in `found` was first seen exactly at `claim`'s first-seen bound (the earliest sighting of its
 * content hash among `observations` is the bound): the equality the rule's `≥` must keep.
 */
function firstSeenAtBound(
  claim: Claim,
  found: readonly Observation[],
  observations: readonly Observation[],
): boolean {
  const boundMs = firstSeenFromMs(claim, POLICY);
  if (boundMs === null) return false;
  return found.some((candidate) => {
    const seen = observations.filter((o) => o.contentHash === candidate.contentHash);
    return Math.min(...seen.map(firstSeenMs)) === boundMs;
  });
}

/** Claims near the generated contents (so they have candidates), some of another type, some without a target. */
function buildClaims(generated: readonly Generated<typeof claimArb>[], rows: Generated<typeof rowsArb>) {
  return generated.map((c, i) => {
    const content = rows.contents[c.content % rows.contents.length];
    const type = c.type ?? content?.type ?? 'email.sent';
    const at = minutesAt((content?.atMinutes ?? 0) + c.deltaMinutes, c.offset);
    const target = type.startsWith('calendar.') && c.target ? { targetAt: at } : {};
    return buildClaim(i, {
      agent: 'muse',
      type,
      claimedAt: at,
      claimedAtPrecision: c.precision,
      observedAt: at,
      ...target,
    });
  });
}

eachIndex('the batch paths against the reference paths ($name index)', ({ createIndex, held }) => {
  it('candidatesOfAll (batch-retrieve.ts) equals candidates() claim by claim', async () => {
    await fc.assert(
      fc.asyncProperty(
        rowsArb,
        fc.array(claimArb, { minLength: 1, maxLength: 8 }),
        fc.constantFrom(1, 15, 1440),
        async (rows, generated, bucket) => {
          const claims = buildClaims(generated, rows);
          const observations = held(buildRows(rows, boundsOf(generated, claims, rows.contents.length)));
          const index = createIndex(observations, bucket);
          const found = await candidatesOfAll(
            claims,
            index,
            POLICY,
            new TextFacts(POLICY.normalize.stopWords),
          );
          for (const claim of claims) {
            const expected = await candidates(claim, index, POLICY);
            const own = found.get(claim);
            expect(own?.rows.map((row) => own.table.rows[row])).toEqual(expected);
            if (expected.length > 0) tally.candidates += 1;
            if (firstSeenAtBound(claim, expected, observations)) tally.atBound += 1;
            if (expected.some((o) => o.sightedAt !== undefined)) tally.stamped += 1;
          }
        },
      ),
      { numRuns: RUNS },
    );
    expect(tally.candidates).toBeGreaterThan(RUNS / 2);
    expect(tally.corrupt).toBeGreaterThan(RUNS / 10);
    expect(tally.atBound).toBeGreaterThan(RUNS / 20);
    expect(tally.stamped).toBeGreaterThan(RUNS / 5);
  }, 120_000);
});

const passArb = fc.record({
  source: fc.constantFrom(...SOURCES),
  startMinutes: fc.integer({ min: -60, max: SPAN_MINUTES }),
  lengthMinutes: fc.integer({ min: 0, max: 2 * 24 * 60 }),
  /** Synced after evaluatedAt: a pass the batch must not count. */
  late: fc.oneof({ arbitrary: fc.constant(false), weight: 3 }, { arbitrary: fc.constant(true), weight: 1 }),
});

function buildCoverage(passes: readonly Generated<typeof passArb>[]): Coverage {
  const observers = passes.map((pass, i) => {
    const endMinutes = Math.min(pass.startMinutes + pass.lengthMinutes, SPAN_MINUTES);
    const sync = pass.late ? SPAN_MINUTES + 1 : endMinutes;
    return {
      observerId: `pass-${String(i)}`,
      source: pass.source,
      lastSyncAt: minutesAt(sync),
      windowStart: minutesAt(Math.min(pass.startMinutes, endMinutes)),
      windowEnd: minutesAt(endMinutes),
    };
  });
  return Coverage.parse({ evaluatedAt: isoAt(EVALUATED_MS), observers });
}

/** Whether a pass of `o`'s own source synced by evaluatedAt saw its `occurredAt`. */
function seenByOwnSource(o: Observation, coverage: Coverage): boolean {
  const t = Date.parse(o.occurredAt);
  return coverage.observers.some(
    (e) =>
      e.source === o.source &&
      Date.parse(e.lastSyncAt) <= EVALUATED_MS &&
      Date.parse(e.windowStart) <= t &&
      t <= Date.parse(e.windowEnd),
  );
}

/** §3 written out with Date.parse, for every row: no window merge, no index, no shared helper. */
function orphanOracle(observations: readonly Observation[], coverage: Coverage) {
  const covered = observations.filter((o) => {
    if (Date.parse(o.observedAt) > EVALUATED_MS) return false;
    return POLICY.sourcesByType[o.type].includes(o.source) && seenByOwnSource(o, coverage);
  });
  const groups = new Map<string, Observation[]>();
  for (const o of covered) groups.set(o.contentHash, [...(groups.get(o.contentHash) ?? []), o]);
  const kept = [...groups.values()].flatMap((group) => {
    const best = firstBySpec(group);
    return best === undefined ? [] : [{ observation: best, atMs: Date.parse(best.occurredAt) }];
  });
  return kept.sort(
    (a, b) =>
      a.atMs - b.atMs ||
      compareText(a.observation.id, b.observation.id) ||
      compareText(a.observation.contentHash, b.observation.contentHash),
  );
}

eachIndex('orphan discovery against §3 written out ($name index)', ({ createIndex, held }) => {
  it('coveredObservations over visibleAt equals the oracle: rows from unlisted sources are never orphans', async () => {
    await fc.assert(
      fc.asyncProperty(
        rowsArb,
        fc.array(passArb, { minLength: 1, maxLength: 6 }),
        fc.constantFrom(1, 15, 1440),
        async (rows, passes, bucket) => {
          const observations = held(buildRows(rows));
          const coverage = buildCoverage(passes);
          const index = visibleAt(createIndex(observations, bucket), EVALUATED_MS);
          const expected = orphanOracle(observations, coverage);
          expect(await coveredObservations(index, coverage, POLICY)).toEqual(expected);
          tally.orphans += expected.length;
          // Rows a window of their own source saw, from a source their type does not list: excluded.
          tally.strayExcluded += observations.filter(
            (o) =>
              Date.parse(o.observedAt) <= EVALUATED_MS &&
              POLICY.sourcesByType[o.type].length > 0 &&
              !POLICY.sourcesByType[o.type].includes(o.source) &&
              seenByOwnSource(o, coverage),
          ).length;
        },
      ),
      { numRuns: RUNS },
    );
    expect(tally.orphans).toBeGreaterThan(RUNS / 5);
    expect(tally.strayExcluded).toBeGreaterThan(RUNS / 50);
    console.log(`candidates-shared tally: ${JSON.stringify(tally)}`);
  }, 120_000);
});
