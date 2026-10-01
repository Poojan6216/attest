import path from 'node:path';

import fc from 'fast-check';
import { describe, it } from 'vitest';

import { resolveInside } from '../tools/serve-fixtures';

const ROOT = path.resolve('/srv/fixtures');

describe('resolveInside (property)', () => {
  it('never resolves a request path outside the fixture root', () => {
    const segment = fc.oneof(
      fc.constantFrom(
        '..',
        '.',
        '%2e%2e',
        '%2E%2E',
        '..%2f',
        '%00',
        '',
        'a',
        'gmail',
        '2026-10-01',
        'x.html',
      ),
      fc.string({ maxLength: 12 }),
    );
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 8 }), (segments) => {
        const resolved = resolveInside(ROOT, `/${segments.join('/')}`);
        return resolved === null || (resolved.startsWith(`${ROOT}${path.sep}`) && !resolved.includes('\0'));
      }),
      { numRuns: 2000 },
    );
  });
});
