/**
 * Edited copies of the shipped policy for the loader's error tests (tests/unit/core/policy-errors.spec.ts,
 * policy-model.spec.ts): each edit sets a value at a path, or removes it, and `issuesOf` reads the loader's issues.
 */
import policyJson from '../../../../policy/default.json';
import { loadPolicy, PolicyError } from '../../../src/core/policy';

export type Segment = string | number;
export type Edit = readonly [path: readonly Segment[], value: unknown];

export const REMOVE = Symbol('remove');

/** A copy of the shipped policy with each edit applied (REMOVE deletes the key). */
export function edited(...edits: readonly Edit[]): unknown {
  const doc: unknown = structuredClone(policyJson);
  for (const [path, value] of edits) {
    let parent = doc as Record<Segment, unknown>;
    for (const segment of path.slice(0, -1)) parent = parent[segment] as Record<Segment, unknown>;
    const last = path.at(-1);
    if (last === undefined) throw new Error('an edit needs a path');
    if (value === REMOVE) Reflect.deleteProperty(parent, last);
    else parent[last] = value;
  }
  return doc;
}

export function issuesOf(raw: unknown): readonly string[] {
  try {
    loadPolicy(raw);
  } catch (error) {
    if (error instanceof PolicyError) return error.issues;
    throw error;
  }
  throw new Error('expected loadPolicy to throw a PolicyError');
}
