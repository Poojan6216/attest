import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256Hex } from '../../src/core/hash';

describe('hash (property)', () => {
  it('sha256Hex equals Node crypto for any string, including lone surrogates and astral characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
        expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
      }),
      { numRuns: 2000 },
    );
  });

  it('canonicalJson is invariant under key order and parses back to the same value', () => {
    const json = fc.jsonValue({ maxDepth: 4 });
    fc.assert(
      fc.property(json, (value) => {
        const text = canonicalJson(value);
        const reordered = JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
          v !== null && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).reverse())
            : v,
        ) as unknown;
        expect(canonicalJson(reordered)).toBe(text);
        // -0 is written as 0 by design (docs/grading.md §10), exactly as JSON.stringify does.
        expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)));
      }),
      { numRuns: 1000 },
    );
  });
});
