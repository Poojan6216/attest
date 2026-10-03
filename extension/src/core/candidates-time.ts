/**
 * `occurredAt`, `observedAt` and the first sighting as epoch ms, memoised per observation object (docs/grading.md
 * §4; task 1.3 perf gate). Pure: a memo never changes a result.
 *
 * An index hands the same objects to many claims (a calendar event lies in every window within ±calendarDays
 * of it), and ISO parsing dominates lookup time. The memo is keyed by object identity and weakly held, so it
 * never outlives the observation. Each entry also keeps the text it was parsed from and is used only while the
 * field still holds that text: the inferred `Observation` type is mutable, and an object edited in place must
 * never be read at its old instant (Hard Rule 4).
 */
import { instantMs } from './normalize';
import type { Observation } from './schema';

/**
 * Imported functions called once per pair or row, bound here once: the test runner's module transform turns every
 * read of an imported binding into a getter call (normalize-time.ts binds its units for the same reason).
 */
const instantMsLocal = instantMs;

interface Parsed {
  readonly text: string;
  readonly ms: number;
}

const OCCURRED_MS = new WeakMap<Observation, Parsed>();
const OBSERVED_MS = new WeakMap<Observation, Parsed>();
const SIGHTED_MS = new WeakMap<Observation, Parsed>();

function memoised(memo: WeakMap<Observation, Parsed>, observation: Observation, text: string): number {
  const cached = memo.get(observation);
  if (cached?.text === text) return cached.ms;
  const ms = instantMsLocal(text);
  memo.set(observation, { text, ms });
  return ms;
}

/** `instantMs(observation.occurredAt)`, parsed once per object and text. Throws `NormalizeError` like it. */
export function occurredMs(observation: Observation): number {
  return memoised(OCCURRED_MS, observation, observation.occurredAt);
}

/** `instantMs(observation.observedAt)`, parsed once per object and text. Throws `NormalizeError` like it. */
export function observedMs(observation: Observation): number {
  return memoised(OBSERVED_MS, observation, observation.observedAt);
}

/**
 * `instantMs(text)` for `text`, the first sighting of `observation` (order.ts `firstSeenAt`, the one reader of it),
 * parsed once per object and text. Throws `NormalizeError` like it.
 */
export function sightedMs(observation: Observation, text: string): number {
  return memoised(SIGHTED_MS, observation, text);
}
