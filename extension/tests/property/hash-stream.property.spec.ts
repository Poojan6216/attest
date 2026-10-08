/**
 * The task 1.5 grading perf gate's hashing shortcuts are the definitions, byte for byte (Hard Rule 4; docs/grading.md
 * §3, §10):
 *  - `hashCanonical(v)` streams the canonical JSON into the hash instead of building it: it equals
 *    `sha256Hex(canonicalJson(v))` for any value, and throws exactly when and what canonicalJson throws, also when a
 *    getter asks for another hash while one is being written;
 *  - `plainJson(text)` is true only when `JSON.stringify(text)` is the text between quotes;
 *  - `refHash` writes a plain id, contentHash and observedAt without JSON.stringify: its digest is the SHA-256 of
 *    `canonicalJson({id, contentHash, observedAt})` for any three strings;
 *  - a batch table's `ranks()` sorts ids natively: each row's position in UTF-16 code unit order, null exactly when
 *    two rows share an id, whether the ids are read by number (the ULID form) or as text.
 */
import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CandidateTable } from '../../src/core/batch-table';
import { TextFacts } from '../../src/core/features';
import { canonicalJson, HashError, hashCanonical, plainJson, sha256Hex } from '../../src/core/hash';
import { refHash } from '../../src/core/receipt';
import { Observation } from '../../src/core/schema';

const RUNS = { numRuns: 2_000 };

/** What a hash call gives: the hex, or the error it threw (a HashError by its code). */
function outcome(hash: () => string): string {
  try {
    return hash();
  } catch (error) {
    return error instanceof HashError ? `HashError ${error.code}` : `other ${String(error)}`;
  }
}

/** Code units JSON escapes or that sit at the edges of the plain range, plus lone and paired surrogates. */
const TRICKY = ['"', '\\', '\n', '\u0000', '\u001f', ' ', '~', '\u007f', 'é', ' ', '\ud800', '\udc00', '😀'];
const text = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 40 }),
  fc.string({ unit: fc.constantFrom(...TRICKY, 'a', 'Z', '0', ':'), maxLength: 20 }),
  fc.string({ maxLength: 80 }),
);

/** Leaves canonical JSON writes, and some it refuses (NaN, ±Infinity, bigint, functions, symbols, class instances). */
const leaf = fc.oneof(
  { arbitrary: text, weight: 4 },
  { arbitrary: fc.double(), weight: 2 },
  { arbitrary: fc.integer(), weight: 2 },
  { arbitrary: fc.boolean(), weight: 1 },
  { arbitrary: fc.constant(null), weight: 1 },
  { arbitrary: fc.constant(undefined), weight: 1 },
  {
    arbitrary: fc.constantFrom<unknown>(
      1n,
      () => 1,
      Symbol('s'),
      new Map(),
      new Date(0),
      Object.create(null),
    ),
    weight: 1,
  },
);

/** Nested arrays (sparse ones too) and objects (keys with tricky characters, `undefined` members) of leaves. */
const value = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small' },
    leaf,
    fc.array(tie('node'), { maxLength: 5 }),
    fc.sparseArray(tie('node'), { maxLength: 5 }),
    fc.dictionary(text, tie('node'), { maxKeys: 5 }),
  ),
})).node;

describe('hashCanonical streams exactly the bytes of canonicalJson', () => {
  it('equals sha256Hex(canonicalJson(v)) for any value, and throws the same error where it throws', () => {
    fc.assert(
      fc.property(value, (v) => {
        expect(outcome(() => hashCanonical(v))).toBe(outcome(() => sha256Hex(canonicalJson(v))));
      }),
      RUNS,
    );
  });

  it('agrees with Node crypto on what canonicalJson writes', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const node = createHash('sha256').update(canonicalJson(v), 'utf8').digest('hex');
        expect(hashCanonical(v)).toBe(node);
      }),
      RUNS,
    );
  });

  it('a getter that asks for a hash mid-write never mixes the two hashes', () => {
    fc.assert(
      fc.property(value, value, (inner, outer) => {
        const seen: string[] = [];
        const tricky = {
          before: outer,
          get middle() {
            seen.push(outcome(() => hashCanonical(inner)));
            return 'm';
          },
          after: [outer],
        };
        const streamed = outcome(() => hashCanonical(tricky));
        const built = outcome(() => sha256Hex(canonicalJson(tricky)));
        expect(streamed).toBe(built);
        // The getter ran once per write that reached it (none when `before` threw), each time hashing `inner` alone.
        const alone = outcome(() => sha256Hex(canonicalJson(inner)));
        for (const hash of seen) expect(hash).toBe(alone);
        expect(outcome(() => hashCanonical(outer))).toBe(outcome(() => sha256Hex(canonicalJson(outer))));
      }),
      { numRuns: 1_000 },
    );
  });
});

describe('plainJson', () => {
  it('is true only when JSON.stringify writes the text between quotes, and for every printable ASCII text', () => {
    const printable = fc.string({
      unit: fc.integer({ min: 0x20, max: 0x7e }).map((code) => String.fromCharCode(code)),
      maxLength: 40,
    });
    fc.assert(
      fc.property(fc.oneof(text, printable), (raw) => {
        if (plainJson(raw)) expect(JSON.stringify(raw)).toBe(`"${raw}"`);
        const quoteless = !raw.includes('"') && !raw.includes('\\');
        if (/^[\x20-\x7e]*$/.test(raw) && quoteless) expect(plainJson(raw)).toBe(true);
      }),
      RUNS,
    );
  });
});

const BASE = Observation.parse({
  id: '5ANANANANANANANANANANANANA',
  source: 'gmail.sent',
  type: 'email.sent',
  counterparty: 'a@example.com',
  occurredAt: '2026-10-06T14:02:00-04:00',
  observedAt: '2026-10-06T14:03:00-04:00',
  contentHash: 'a'.repeat(64),
});

/** An Observation-typed row holding any three strings (refHash and ranks read only these). */
function rowOf(
  id: string,
  contentHash: string = BASE.contentHash,
  observedAt: string = BASE.observedAt,
): Observation {
  return { ...BASE, id, contentHash, observedAt } as Observation;
}

function hexOf(words: Int32Array): string {
  return Array.from(words, (word) => (word >>> 0).toString(16).padStart(8, '0')).join('');
}

describe('refHash', () => {
  it('is the SHA-256 of canonicalJson({id, contentHash, observedAt}) for any three strings', () => {
    fc.assert(
      fc.property(text, text, text, (id, contentHash, observedAt) => {
        const expected = sha256Hex(canonicalJson({ id, contentHash, observedAt }));
        expect(hexOf(refHash(rowOf(id, contentHash, observedAt)))).toBe(expected);
      }),
      RUNS,
    );
  });
});

/** Ids drawn from a few shared prefixes and a small alphabet, so equal ids and long common prefixes are frequent. */
const ids = fc.array(
  fc
    .tuple(
      fc.constantFrom('', '0000000000', '01J9ZK5Y8M', 'é\ud800'),
      fc.string({ unit: fc.constantFrom('0', '1', 'A', 'z', 'é', '\udc00'), maxLength: 4 }),
    )
    .map(([prefix, rest]) => prefix + rest),
  { maxLength: 30 },
);

/**
 * Ids of the ULID form, read by `ranks()` as numbers (base32.ts `idDigitsValue`): heads shared to every depth make
 * prefixes tie, a repeated id is frequent in a long list, and one id now and then leaves the alphabet.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const crockfordIds = fc
  .array(
    fc
      .tuple(
        fc.constantFrom(
          '',
          '01J9ZK',
          '01J9ZK5Y8M7Q',
          '7ZZZZZZZZZZZZZZZZZZZZZZZZ',
          '0000000000000000000000000',
        ),
        fc.string({ unit: fc.constantFrom(...Array.from(CROCKFORD)), minLength: 26, maxLength: 26 }),
      )
      .map(([head, tail]) => (head + tail).slice(0, 26)),
    { maxLength: 300 },
  )
  .chain((list) =>
    fc.oneof(
      { weight: 8, arbitrary: fc.constant(list) },
      { weight: 1, arbitrary: fc.constant(list.length > 0 ? [...list, list[0] ?? ''] : list) },
      { weight: 1, arbitrary: fc.constant([...list, '01J9ZK5Y8M7Qz000000000000']) },
    ),
  );

/** `ranks()` of a table of `list`: each row's position in id order (UTF-16 code units), null when an id repeats. */
function expectRanks(list: readonly string[]): void {
  const table = new CandidateTable(
    list.map((id) => rowOf(id)),
    list.map(() => 0),
    new TextFacts([]),
  );
  const ranks = table.ranks();
  if (new Set(list).size < list.length) {
    expect(ranks).toBeNull();
    return;
  }
  const order = list.map((_, row) => row).sort((a, b) => ((list[a] ?? '') < (list[b] ?? '') ? -1 : 1));
  const expected = new Int32Array(list.length);
  order.forEach((row, rank) => (expected[row] = rank));
  expect(ranks).toEqual(expected);
}

describe('CandidateTable.ranks', () => {
  it('gives each row its position in id order (UTF-16 code units), or null exactly when an id repeats', () => {
    fc.assert(fc.property(ids, expectRanks), RUNS);
  });

  it('reads ULID-form ids by number exactly as by text: ties broken by whole id, repeats null', () => {
    fc.assert(fc.property(crockfordIds, expectRanks), RUNS);
  });
});
