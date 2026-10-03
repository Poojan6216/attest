import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CDP,
  DEFAULT_SEED,
  isLoopbackEndpoint,
  localDate,
  parseCaptureArgs,
  resolveCaptureOptions,
} from '../../tools/capture-args';
import { CaptureError } from '../../tools/capture-error';
import { describeUrl, isCapturable } from '../../tools/capture-fixture';
import { FIXTURE_PAGES_ROOT } from '../../tools/serve-fixtures';

const NOW = new Date(2026, 9, 1, 0, 30); // 1 Oct 2026, 00:30 local time

describe('parseCaptureArgs', () => {
  it('applies the defaults for a minimal command', () => {
    expect(parseCaptureArgs(['--vendor', 'muse', '--name', 'activity'], NOW)).toEqual({
      vendor: 'muse',
      name: 'activity',
      cdp: DEFAULT_CDP,
      seed: DEFAULT_SEED,
      date: '2026-10-01',
      names: [],
      redactSelectors: [],
      outRoot: FIXTURE_PAGES_ROOT,
      force: false,
    });
  });

  it('reads every option, repeats --redact-selector, splits --names, and tolerates a leading --', () => {
    const options = parseCaptureArgs(
      [
        '--',
        '--vendor=gmail',
        '--name',
        'sent-list',
        '--cdp',
        'http://localhost:9333',
        '--seed',
        's1',
        '--date',
        '2024-02-29',
        '--tab',
        'mail.google.com',
        '--names',
        ' Priya Raman, Daniel Okafor ,,',
        '--redact-selector',
        '[data-subject]',
        '--redact-selector',
        '.snippet',
        '--out-root',
        '/tmp/fixtures',
        '--force',
      ],
      NOW,
    );
    expect(options).toEqual({
      vendor: 'gmail',
      name: 'sent-list',
      cdp: 'http://localhost:9333',
      seed: 's1',
      date: '2024-02-29',
      tab: 'mail.google.com',
      names: ['Priya Raman', 'Daniel Okafor'],
      redactSelectors: ['[data-subject]', '.snippet'],
      outRoot: '/tmp/fixtures',
      force: true,
    });
  });
});

describe('parseCaptureArgs: help and invalid commands', () => {
  it('returns help for -h and --help', () => {
    expect(parseCaptureArgs(['-h'], NOW)).toBe('help');
    expect(parseCaptureArgs(['--help', '--vendor', 'x'], NOW)).toBe('help');
  });

  it.each([
    ['missing --vendor', ['--name', 'a']],
    ['missing --name', ['--vendor', 'a']],
    ['upper-case vendor', ['--vendor', 'Muse', '--name', 'a']],
    ['path traversal in name', ['--vendor', 'muse', '--name', '../x']],
    ['underscore vendor (reserved for _harness)', ['--vendor', '_harness', '--name', 'a']],
    ['unknown option', ['--vendor', 'muse', '--name', 'a', '--headless']],
    ['positional argument', ['muse', '--vendor', 'muse', '--name', 'a']],
    ['impossible date', ['--vendor', 'muse', '--name', 'a', '--date', '2026-02-30']],
    ['badly formatted date', ['--vendor', 'muse', '--name', 'a', '--date', '1/10/2026']],
    ['remote CDP host', ['--vendor', 'muse', '--name', 'a', '--cdp', 'http://10.0.0.5:9222']],
    ['non-URL CDP', ['--vendor', 'muse', '--name', 'a', '--cdp', 'localhost:9222']],
    ['empty seed', ['--vendor', 'muse', '--name', 'a', '--seed', '']],
    ['one-letter name to scrub', ['--vendor', 'muse', '--name', 'a', '--names', 'J']],
  ])('rejects %s with CaptureError(bad_args)', (_label, argv) => {
    expect(() => parseCaptureArgs(argv, NOW)).toThrow(expect.objectContaining({ code: 'bad_args' }));
    expect(() => parseCaptureArgs(argv, NOW)).toThrow(CaptureError);
  });
});

describe('resolveCaptureOptions', () => {
  it('fills the date from the clock it is given', () => {
    expect(resolveCaptureOptions({ vendor: 'v', name: 'n' }, new Date(2027, 0, 9, 23, 59)).date).toBe(
      '2027-01-09',
    );
  });

  it('rejects unknown keys (strict schema)', () => {
    expect(() => resolveCaptureOptions({ vendor: 'v', name: 'n', ...{ headless: true } }, NOW)).toThrow(
      expect.objectContaining({ code: 'bad_args' }),
    );
  });
});

describe('small helpers', () => {
  it('localDate pads month and day', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it.each([
    ['http://127.0.0.1:9222', true],
    ['ws://localhost:9222/devtools/browser/abc', true],
    ['http://[::1]:9222', true],
    ['http://127.0.0.2:9222', false],
    ['http://example.com:9222', false],
    ['file:///tmp/x', false],
    ['not a url', false],
  ])('isLoopbackEndpoint(%s) → %s', (value, expected) => {
    expect(isLoopbackEndpoint(value)).toBe(expected);
  });

  it.each([
    ['https://mail.google.com/mail/u/0/#inbox', true],
    ['http://127.0.0.1:4173/_harness/capture-sample.html', true],
    ['file:///Users/me/page.html', true],
    ['devtools://devtools/bundled/inspector.html', false],
    ['chrome-extension://abcdef/popup.html', false],
    ['chrome://newtab/', false],
    ['about:blank', false],
  ])('isCapturable(%s) → %s', (url, expected) => {
    expect(isCapturable(url)).toBe(expected);
  });

  it('describeUrl prints origin and path only', () => {
    expect(describeUrl('https://mail.example/u/0/?ik=secret#inbox/123')).toBe('https://mail.example/u/0/');
    expect(describeUrl('file:///tmp/a.html?x=1')).toBe('file:///tmp/a.html');
    expect(describeUrl('::')).toBe('(unparseable url)');
  });
});
