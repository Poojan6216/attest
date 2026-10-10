/**
 * The popup bench's trace names no machine (bench/trace-scrub.ts; sprint_4 close, security review checklist): the
 * repository, the temporary folder and the home folder are each written as a placeholder, the longest first, so a
 * repository inside the home folder reads `<repo>`, never `~/…`. Every path here is invented.
 */
import { describe, expect, it } from 'vitest';

import { scrubPaths } from '../../../../bench/trace-scrub';

const PLACES = [
  { path: '/home/someone', as: '~' },
  { path: '/home/someone/work/attest', as: '<repo>' },
  { path: '/tmp/x1', as: '<tmp>' },
  { path: '/private/tmp/x1', as: '<tmp>' },
];

describe('scrubPaths', () => {
  it('writes each place as its placeholder, the longest first', () => {
    const trace = JSON.stringify({
      args: ['--load-extension=/home/someone/work/attest/extension/.output/chrome-mv3'],
      profile: '/private/tmp/x1/attest-e2e-ab12',
      other: '/tmp/x1/attest-e2e-ab12',
      stack: '/home/someone/.cache/ms-playwright/chromium',
    });
    const scrubbed = scrubPaths(trace, PLACES);
    expect(scrubbed).not.toContain('/home/someone');
    expect(scrubbed).not.toContain('/tmp/x1');
    expect(JSON.parse(scrubbed)).toEqual({
      args: ['--load-extension=<repo>/extension/.output/chrome-mv3'],
      profile: '<tmp>/attest-e2e-ab12',
      other: '<tmp>/attest-e2e-ab12',
      stack: '~/.cache/ms-playwright/chromium',
    });
  });

  it('leaves a trace that names no place as it is, and ignores a place of one character', () => {
    expect(scrubPaths('{"a":"/opt/chrome"}', [...PLACES, { path: '/', as: '?' }])).toBe(
      '{"a":"/opt/chrome"}',
    );
  });
});
