/**
 * Property tests for windows and retrieval (docs/grading.md §4.1, §4.2), each against an oracle written from
 * the contract alone with Date.parse on hand-built ISO strings (never window.ts or candidates.ts helpers):
 *  - precisionBounds is the unit containing claimedAt in claimedAt's own offset, for any offset and year;
 *  - candidates() equals the oracle for random honest observation sets (re-sightings, twin ids, edge-snapped
 *    times, calendar.created first-seen), for any bucket width and any index return order.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { candidates, createMemoryIndex, type ObservationIndex } from '../../src/core/candidates';
import { DEFAULT_POLICY } from '../../src/core/policy';
import { type ActionType, type ClaimPrecision, Observation } from '../../src/core/schema';
import { precisionBounds, type WindowClaim } from '../../src/core/window';

const RUNS = 1_000;
const MINUTE = 60_000;
const UNIT = { minute: MINUTE, hour: 60 * MINUTE, day: 24 * 60 * MINUTE } as const;
const { beforeClaimMin, afterClaimMin, calendarDays } = DEFAULT_POLICY.windows;

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

function offsetText(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const magnitude = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`;
}

/** `ms` as local time at `offsetMinutes`, written with that offset (UTC arithmetic only). */
function isoAt(ms: number, offsetMinutes: number): string {
  return `${new Date(ms + offsetMinutes * MINUTE).toISOString().slice(0, 23)}${offsetText(offsetMinutes)}`;
}

/** Real-world offsets: −12:00 … +14:00 in quarter hours. */
const offsetArb = fc.integer({ min: -48, max: 56 }).map((quarters) => quarters * 15);
const precisionArb = fc.constantFrom<ClaimPrecision>('minute', 'hour', 'day');

const localArb = fc.record({
  year: fc.integer({ min: 1960, max: 2090 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }),
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
  second: fc.integer({ min: 0, max: 59 }),
  milli: fc.integer({ min: 0, max: 999 }),
  offset: offsetArb,
});

describe('precisionBounds (property)', () => {
  it('is [unit start written from the local fields, + unit] in the claim offset', () => {
    fc.assert(
      fc.property(localArb, precisionArb, (t, precision) => {
        const date = `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;
        const off = offsetText(t.offset);
        const claimedAt = `${date}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}.${pad(t.milli, 3)}${off}`;
        const startIso = {
          minute: `${date}T${pad(t.hour)}:${pad(t.minute)}:00${off}`,
          hour: `${date}T${pad(t.hour)}:00:00${off}`,
          day: `${date}T00:00:00${off}`,
        }[precision];
        const startMs = Date.parse(startIso);
        const bounds = precisionBounds({ type: 'email.sent', claimedAt, claimedAtPrecision: precision });
        expect(bounds).toEqual({ startMs, endMs: startMs + UNIT[precision] });
      }),
      { numRuns: RUNS },
    );
  });
});

// ── candidates() against the oracle ─────────────────────────────────────────────────────────────

const TYPES: readonly ActionType[] = ['email.sent', 'calendar.created', 'calendar.updated'];
const BASE_MS = Date.parse('2026-10-06T14:00:00Z');
const sourceOf = (type: ActionType) => (type === 'email.sent' ? 'gmail.sent' : 'gcal.event');

/** Parts per million of the window's length, for a time placed strictly by position inside it. */
const PPM = 1_000_000;

/**
 * Where a time lands: on a window edge or the first-seen bound (± 1 ms), anywhere inside the window, or
 * anywhere within ± 4 days of the base instant.
 */
const placeArb = fc.oneof(
  fc.record({ kind: fc.constantFrom('from', 'to', 'firstSeen'), delta: fc.integer({ min: -1, max: 1 }) }),
  fc.record({ kind: fc.constant('inside'), delta: fc.integer({ min: 0, max: PPM }) }),
  fc.record({ kind: fc.constant('free'), delta: fc.integer({ min: -4 * UNIT.day, max: 4 * UNIT.day }) }),
);

const contentArb = fc.record({ type: fc.constantFrom(...TYPES), at: placeArb, offset: offsetArb });
const sightingArb = fc.record({
  content: fc.nat({ max: 7 }),
  twin: fc.nat({ max: 2 }),
  seen: placeArb,
  offset: offsetArb,
});

/** The value type an arbitrary generates. */
type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;

const claimArb = fc.record({
  type: fc.constantFrom(...TYPES),
  minutes: fc.integer({ min: -600, max: 600 }),
  seconds: fc.integer({ min: 0, max: 59 }),
  precision: precisionArb,
  offset: offsetArb,
  targetHours: fc.option(fc.integer({ min: -72, max: 72 }), { nil: undefined }),
});

interface OracleWindow {
  readonly fromMs: number;
  readonly toMs: number;
  /** claim unit start − beforeClaimMin: the calendar.created first-seen bound. */
  readonly firstSeenMs: number;
}

function oracleWindow(claim: WindowClaim, unitStartMs: number): OracleWindow | null {
  const firstSeenMs = unitStartMs - beforeClaimMin * MINUTE;
  if (claim.type.startsWith('calendar.')) {
    if (claim.targetAt === undefined) return null;
    const target = Date.parse(claim.targetAt);
    return { fromMs: target - calendarDays * UNIT.day, toMs: target + calendarDays * UNIT.day, firstSeenMs };
  }
  const end = unitStartMs + UNIT[claim.claimedAtPrecision];
  return { fromMs: unitStartMs - beforeClaimMin * MINUTE, toMs: end + afterClaimMin * MINUTE, firstSeenMs };
}

function placed(at: { kind: string; delta: number }, window: OracleWindow | null): number {
  if (window === null || at.kind === 'free') return BASE_MS + at.delta;
  if (at.kind === 'inside')
    return window.fromMs + Math.floor(((window.toMs - window.fromMs) * at.delta) / PPM);
  const anchor = at.kind === 'from' ? window.fromMs : at.kind === 'to' ? window.toMs : window.firstSeenMs;
  return anchor + at.delta;
}

/** A claim from generated fields, and its unit start written from its local ISO fields (Date.parse only). */
function buildClaim(c: {
  type: ActionType;
  minutes: number;
  seconds: number;
  precision: ClaimPrecision;
  offset: number;
  targetHours: number | undefined;
}): { claim: WindowClaim; unitStartMs: number } {
  const claimedMs = BASE_MS + c.minutes * MINUTE + c.seconds * 1000;
  const claimedAt = isoAt(claimedMs, c.offset);
  const local = claimedAt.slice(0, 16); // YYYY-MM-DDThh:mm
  const startText = {
    minute: `${local}:00`,
    hour: `${local.slice(0, 13)}:00:00`,
    day: `${local.slice(0, 10)}T00:00:00`,
  };
  const unitStartMs = Date.parse(`${startText[c.precision]}${offsetText(c.offset)}`);
  const base = { type: c.type, claimedAt, claimedAtPrecision: c.precision };
  const claim: WindowClaim =
    c.targetHours === undefined ? base : { ...base, targetAt: isoAt(BASE_MS + c.targetHours * UNIT.hour, 0) };
  return { claim, unitStartMs };
}

/** ids are unique per (content, twin); a content's sightings share type, occurredAt and contentHash. */
function buildObservations(
  contents: readonly Generated<typeof contentArb>[],
  sightings: readonly Generated<typeof sightingArb>[],
  window: OracleWindow | null,
): Observation[] {
  return sightings.flatMap((s) => {
    const k = s.content % contents.length;
    const content = contents[k];
    if (content === undefined) return [];
    return [
      Observation.parse({
        id: pad(k * 10 + s.twin, 26),
        source: sourceOf(content.type),
        type: content.type,
        subjectHint: `content ${String(k)}`,
        occurredAt: isoAt(placed(content.at, window), content.offset),
        observedAt: isoAt(placed(s.seen, window), s.offset),
        contentHash: k.toString(16).padStart(64, '0'),
      }),
    ];
  });
}

const compareText = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

/** How often the runs exercised each rule: asserted after the property so it can never pass vacuously. */
const tally = { nonEmpty: 0, firstSeenExcluded: 0, merged: 0, noWindow: 0 };

/** §4.1 written out directly: type, inclusive window, first-seen over every sighting, lowest id, order. */
function oracle(claim: WindowClaim, window: OracleWindow | null, observations: readonly Observation[]) {
  if (window === null) {
    tally.noWindow += 1;
    return [];
  }
  const groups = new Map<string, Observation[]>();
  for (const o of observations) {
    const t = Date.parse(o.occurredAt);
    if (o.type !== claim.type || t < window.fromMs || t > window.toMs) continue;
    groups.set(o.contentHash, [...(groups.get(o.contentHash) ?? []), o]);
  }
  const kept: Observation[] = [];
  for (const group of groups.values()) {
    const firstSeen = Math.min(...group.map((o) => Date.parse(o.observedAt)));
    if (claim.type === 'calendar.created' && firstSeen < window.firstSeenMs) {
      tally.firstSeenExcluded += 1;
      continue;
    }
    if (group.length > 1) tally.merged += 1;
    const [best] = [...group].sort(
      (a, b) =>
        compareText(a.id, b.id) ||
        Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
        compareText(a.observedAt, b.observedAt),
    );
    if (best !== undefined) kept.push(best);
  }
  if (kept.length > 0) tally.nonEmpty += 1;
  return kept.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || compareText(a.id, b.id));
}

/** A seeded Fisher–Yates shuffle (mulberry32), so each run tries another index return order. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const held = out[i];
    const other = out[j];
    if (held === undefined || other === undefined) continue;
    out[i] = other;
    out[j] = held;
  }
  return out;
}

const everything = (observations: readonly Observation[]): ObservationIndex => ({
  byTypeAndBucket: () => Promise.resolve(observations),
  byCounterpartyToken: () => Promise.resolve(observations),
});

describe('candidates (property)', () => {
  it('equals the oracle for any bucket width and any index return order', async () => {
    await fc.assert(
      fc.asyncProperty(
        claimArb,
        fc.array(contentArb, { minLength: 1, maxLength: 8 }),
        fc.array(sightingArb, { maxLength: 24 }),
        fc.constantFrom(1, 7, 15, 60, 1440),
        fc.integer(),
        async (c, contents, sightings, bucketMinutes, seed) => {
          const { claim, unitStartMs } = buildClaim(c);
          const window = oracleWindow(claim, unitStartMs);
          const observations = buildObservations(contents, sightings, window);
          const expected = oracle(claim, window, observations);
          const shuffled = shuffle(observations, seed);
          const index = createMemoryIndex(shuffled, bucketMinutes);
          expect(await candidates(claim, index, DEFAULT_POLICY)).toEqual(expected);
          expect(await candidates(claim, everything(shuffled), DEFAULT_POLICY)).toEqual(expected);
        },
      ),
      { numRuns: RUNS },
    );
    // Non-vacuous: the generators reach every branch of the contract many times.
    expect(tally.nonEmpty).toBeGreaterThan(RUNS / 5);
    expect(tally.firstSeenExcluded).toBeGreaterThan(RUNS / 50);
    expect(tally.merged).toBeGreaterThan(RUNS / 10);
    expect(tally.noWindow).toBeGreaterThan(RUNS / 50);
    console.log(`candidates property tally: ${JSON.stringify(tally)}`);
  });
});
