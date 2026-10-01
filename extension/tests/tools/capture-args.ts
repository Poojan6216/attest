/**
 * Options for the fixture-capture tool: one Zod schema shared by the CLI and the programmatic API.
 */
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { CaptureError } from './capture-error';
import { FIXTURE_PAGES_ROOT } from './serve-fixtures';

export const DEFAULT_CDP = 'http://127.0.0.1:9222';
export const DEFAULT_SEED = 'attest';
const SLUG = /^[a-z0-9-]+$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const CDP_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** The CDP endpoint must be on this machine: attaching to a remote browser is out of scope (Hard Rule 1). */
export function isLoopbackEndpoint(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return CDP_PROTOCOLS.has(url.protocol) && LOOPBACK_HOSTS.has(url.hostname);
}

/** Today's date in the local timezone, YYYY-MM-DD (the fixture folder name). */
export function localDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export const CaptureOptionsSchema = z.strictObject({
  vendor: z.string().regex(SLUG, '--vendor must match /^[a-z0-9-]+$/'),
  name: z.string().regex(SLUG, '--name must match /^[a-z0-9-]+$/'),
  cdp: z
    .string()
    .refine(isLoopbackEndpoint, '--cdp must be an http(s)/ws(s) URL on 127.0.0.1, localhost or [::1]')
    .default(DEFAULT_CDP),
  seed: z.string().min(1).max(200).default(DEFAULT_SEED),
  date: z.iso.date('--date must be a real calendar date, YYYY-MM-DD').optional(),
  tab: z.string().min(1).max(500).optional(),
  names: z.array(z.string().trim().min(2).max(100)).max(500).default([]),
  redactSelectors: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  outRoot: z.string().min(1).default(FIXTURE_PAGES_ROOT),
  force: z.boolean().default(false),
  seedsPath: z.string().min(1).optional(),
});

/** What callers pass (defaults optional). */
export type CaptureOptionsInput = z.input<typeof CaptureOptionsSchema>;
/** What the tool runs with (defaults applied; `date` resolved). */
export type CaptureOptions = z.output<typeof CaptureOptionsSchema> & { readonly date: string };

export function resolveCaptureOptions(input: CaptureOptionsInput, now: Date): CaptureOptions {
  const parsed = CaptureOptionsSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new CaptureError('bad_args', issues);
  }
  return { ...parsed.data, date: parsed.data.date ?? localDate(now) };
}

export const HELP = `Capture a sanitised fixture from a page open in your own Chrome (read-only).

  pnpm capture --vendor <slug> --name <slug> [options]

  --vendor <slug>            vendor folder, e.g. muse, gmail (required, [a-z0-9-])
  --name <slug>              fixture file name without .html (required, [a-z0-9-])
  --cdp <url>                Chrome DevTools endpoint on this machine (default ${DEFAULT_CDP})
  --tab <text>               capture the one tab whose URL contains <text> (default: first web page)
  --names <a,b>              real names to replace everywhere, comma-separated
  --redact-selector <css>    replace the text and labels of matching elements (repeatable)
  --seed <text>              seed for fakes and injected secrets (default ${DEFAULT_SEED})
  --date <yyyy-mm-dd>        fixture folder date (default: today, local time)
  --out-root <dir>           fixture root (default tests/fixtures/pages)
  --force                    overwrite an existing fixture and its labels.json entry
  -h, --help                 show this help

Read docs/adapters.md before committing a fixture.`;

const ARG_OPTIONS = {
  vendor: { type: 'string' },
  name: { type: 'string' },
  cdp: { type: 'string' },
  seed: { type: 'string' },
  date: { type: 'string' },
  tab: { type: 'string' },
  names: { type: 'string' },
  'redact-selector': { type: 'string', multiple: true },
  'out-root': { type: 'string' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

function readArgv(
  args: string[],
): ReturnType<typeof parseArgs<{ args: string[]; options: typeof ARG_OPTIONS }>>['values'] {
  try {
    return parseArgs({ args, options: ARG_OPTIONS, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new CaptureError('bad_args', error instanceof Error ? error.message : 'unreadable arguments');
  }
}

/** Parses `pnpm capture` argv. Returns 'help' when help was asked for. */
export function parseCaptureArgs(argv: readonly string[], now: Date): CaptureOptions | 'help' {
  const values = readArgv(argv[0] === '--' ? argv.slice(1) : [...argv]);
  if (values.help === true) return 'help';
  const input: CaptureOptionsInput = {
    vendor: values.vendor ?? '',
    name: values.name ?? '',
    names: (values.names ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== ''),
    redactSelectors: values['redact-selector'] ?? [],
    force: values.force ?? false,
    ...(values.cdp === undefined ? {} : { cdp: values.cdp }),
    ...(values.seed === undefined ? {} : { seed: values.seed }),
    ...(values.date === undefined ? {} : { date: values.date }),
    ...(values.tab === undefined ? {} : { tab: values.tab }),
    ...(values['out-root'] === undefined ? {} : { outRoot: values['out-root'] }),
  };
  return resolveCaptureOptions(input, now);
}
