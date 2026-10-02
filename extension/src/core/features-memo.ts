/**
 * Per-object memos for features.ts (docs/grading.md §5; the task 1.5 grading perf gate). Internal. Pure: a
 * memo never changes a result (Hard Rule 4).
 *
 * `gradeBatch` scores every (claim, candidate) pair twice (assignment, then `grade`'s best candidate), and an
 * index hands one observation to many claims, so a claim's facts and an observation's parsed subject, merchant,
 * address and instant were recomputed for every pair. Each memo is keyed by object identity and weakly held, so
 * it never outlives the object, and an entry is used only while every input it was computed from is still the
 * same value (`Object.is`): the parsed `Claim` and `Observation` types are mutable, and an object edited in place
 * must never be scored from its old fields.
 */

interface Entry<Value> {
  readonly inputs: readonly unknown[];
  readonly value: Value;
}

/** A weakly held memo over objects of type `Key`. */
export type Memo<Key extends object, Value> = WeakMap<Key, Entry<Value>>;

function sameInputs(held: readonly unknown[], inputs: readonly unknown[]): boolean {
  return held.length === inputs.length && held.every((value, i) => Object.is(value, inputs[i]));
}

/**
 * `compute()`, remembered for `key` while `inputs` (everything `compute` reads) stay the same. A `compute` that
 * throws stores nothing, so the next call throws again.
 */
export function memoised<Key extends object, Value>(
  memo: Memo<Key, Value>,
  key: Key,
  inputs: readonly unknown[],
  compute: () => Value,
): Value {
  const cached = memo.get(key);
  if (cached !== undefined && sameInputs(cached.inputs, inputs)) return cached.value;
  const value = compute();
  memo.set(key, { inputs, value });
  return value;
}
