/**
 * Lone surrogates in hashes (docs/grading.md §10; Decisions.md, the [1.close-r3] [SEC-1] correction). A hash of
 * plain UTF-8 text (`hashText`, `sha256Hex` of a bare string) reads a lone half as U+FFFD, as WHATWG TextEncoder
 * does. Every canonical-JSON hash escapes it first, so two texts that differ only in a lone half read the same in
 * every reader yet keep distinct hashes. The earlier [1.close-r2] entry said "every hash" folds a lone half to
 * U+FFFD; the correction must follow it, and the digests it quotes are recomputed here (docs_writer rule 1: no
 * number without a source).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalJson, hashCanonical, sha256Hex } from '../../../src/core/hash';
import { hashText } from '../../../src/core/redact';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const DECISIONS = readFileSync(path.join(REPO_ROOT, 'Decisions.md'), 'utf8').split('\n');

const LONE = 'Priya \uD833';
const REPLACED = 'Priya �';

/** The line index of the first Decisions.md line `match` accepts, or -1. */
const lineWhere = (match: (line: string) => boolean): number => DECISIONS.findIndex(match);

describe('lone surrogates in hashes (docs/grading.md §10)', () => {
  it('a hash of plain UTF-8 text reads a lone half as U+FFFD', () => {
    expect(hashText(LONE)).toBe(hashText(REPLACED));
    expect(sha256Hex(LONE)).toBe(sha256Hex(REPLACED));
  });

  it('canonical JSON escapes a lone half, so its hash keeps the two texts apart', () => {
    expect(canonicalJson({ cp: LONE })).toBe('{"cp":"Priya \\ud833"}');
    expect(hashCanonical({ cp: LONE })).toBe(sha256Hex(canonicalJson({ cp: LONE })));
    expect(hashCanonical({ cp: LONE })).not.toBe(hashCanonical({ cp: REPLACED }));
  });
});

describe('Decisions.md states it as the code computes it', () => {
  const earlier = lineWhere((line) => line.includes('and so every hash, makes of a lone half'));
  const correction = lineWhere((line) =>
    line.startsWith(
      '- 2026-10-03 [1.close-r3] [SEC-1] Correction to the [1.close-r2] [SEC-1] lone-surrogate entry',
    ),
  );

  it('corrects, after it, the [1.close-r2] entry that says every hash makes U+FFFD of a lone half', () => {
    expect(earlier).toBeGreaterThan(-1);
    expect(correction).toBeGreaterThan(earlier);
    expect(DECISIONS[correction]).toContain('canonical-JSON hash');
  });

  it('quotes the digests the code computes', () => {
    const text = DECISIONS[correction] ?? '';
    const digests = [hashCanonical({ cp: LONE }), hashCanonical({ cp: REPLACED }), hashText(LONE)];
    for (const digest of digests) expect(text).toContain(digest.slice(0, 12));
  });
});
