/**
 * pnpm capture --vendor <v> --name <n> [options]
 *
 * Dev-only. Attaches to the founder's already-running Chrome over CDP (127.0.0.1 only), snapshots ONE open
 * tab strictly read-only (see capture-page.ts), sanitises it in Node (see sanitize.ts), and writes
 * tests/fixtures/pages/<vendor>/<yyyy-mm-dd>/<name>.html plus a labels.json entry. It never navigates,
 * clicks, types, scrolls or closes anything in that browser, and it disconnects when done.
 *
 * Programmatic use (tests): `await captureFixture({ vendor, name, cdp, outRoot, ... })`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Browser, chromium, type Page } from '@playwright/test';

import { type CaptureOptionsInput, HELP, parseCaptureArgs, resolveCaptureOptions } from './capture-args';
import { CaptureError } from './capture-error';
import { assertWritable, fixtureTarget, loadSeeds, SEEDS_PATH, writeFixture } from './capture-output';
import { type PageSnapshot, PageSnapshotSchema, SNAPSHOT_CONFIG, snapshotDocument } from './capture-page';
import { assertSelectorsValid, sanitizeHtml, type SanitizeStats } from './sanitize';

const CDP_CONNECT_TIMEOUT_MS = 10_000;
const CAPTURABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

export interface CaptureResult {
  readonly htmlPath: string;
  readonly labelsPath: string;
  /** origin + path of the captured tab (no query, no fragment). */
  readonly source: string;
  readonly seededSecrets: readonly string[];
  readonly stats: Readonly<SanitizeStats>;
}

/** origin + pathname only: queries and fragments carry ids and tokens. */
export function describeUrl(url: string): string {
  if (!URL.canParse(url)) return '(unparseable url)';
  const parsed = new URL(url);
  return parsed.protocol === 'file:' ? `file://${parsed.pathname}` : `${parsed.origin}${parsed.pathname}`;
}

/** Web pages only: never DevTools, extension, chrome:// or about: pages. */
export function isCapturable(url: string): boolean {
  return URL.canParse(url) && CAPTURABLE_PROTOCOLS.has(new URL(url).protocol);
}

function pickPage(browser: Browser, tab: string | undefined): Page {
  const pages = browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => isCapturable(page.url()));
  const matches = tab === undefined ? pages.slice(0, 1) : pages.filter((page) => page.url().includes(tab));
  const [page] = matches;
  if (page === undefined) {
    const which =
      tab === undefined ? 'no web page is open' : `no open tab URL contains ${JSON.stringify(tab)}`;
    throw new CaptureError('no_tab', `Nothing to capture: ${which}.`);
  }
  if (matches.length > 1) {
    const where = matches.map((match) => describeUrl(match.url())).join(', ');
    throw new CaptureError(
      'ambiguous_tab',
      `--tab matches ${matches.length} tabs (${where}); make it more specific.`,
    );
  }
  return page;
}

async function connect(cdp: string): Promise<Browser> {
  try {
    // noDefaults: no focus emulation, media emulation or download overrides on the founder's browser.
    // Without it, attaching and detaching fires a trusted blur/focus on the captured page.
    return await chromium.connectOverCDP(cdp, { timeout: CDP_CONNECT_TIMEOUT_MS, noDefaults: true });
  } catch (error) {
    throw new CaptureError(
      'cdp_unreachable',
      `No Chrome DevTools endpoint at ${cdp} (${error instanceof Error ? error.name : 'error'}). Start Chrome with ` +
        '--remote-debugging-port=9222 and a dedicated --user-data-dir (Chrome 136+ refuses the default profile); ' +
        'see docs/adapters.md.',
    );
  }
}

/** Disconnects Playwright from the founder's Chrome. For a CDP-attached browser this does not close it. */
async function disconnect(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch (error) {
    console.warn('capture.cdp.disconnect_failed', error instanceof Error ? error.name : 'error');
  }
}

/** Attach, read one tab, detach. The only code that touches the founder's browser. */
async function snapshotTab(cdp: string, tab: string | undefined): Promise<PageSnapshot> {
  const browser = await connect(cdp);
  try {
    const page = pickPage(browser, tab);
    return PageSnapshotSchema.parse(await page.evaluate(snapshotDocument, SNAPSHOT_CONFIG));
  } finally {
    await disconnect(browser);
  }
}

export async function captureFixture(input: CaptureOptionsInput): Promise<CaptureResult> {
  const options = resolveCaptureOptions(input, new Date());
  const target = fixtureTarget(options.outRoot, options.vendor, options.date, options.name);
  await assertWritable(target, options.force);
  assertSelectorsValid([...options.redactSelectors, ...options.keepSelectors]);
  const seeds = await loadSeeds(options.seedsPath ?? SEEDS_PATH);
  const snapshot = await snapshotTab(options.cdp, options.tab);
  const sanitized = sanitizeHtml(snapshot.html, {
    seed: options.seed,
    seeds,
    names: options.names,
    redactSelectors: options.redactSelectors,
    keepSelectors: options.keepSelectors,
    pageUrl: snapshot.url,
  });
  await writeFixture(
    target,
    sanitized.html,
    {
      capturedAt: options.date,
      selectorsVersion: null,
      seededSecrets: [...sanitized.seededSecrets],
      expected: [],
      notes: '',
    },
    options.force,
  );
  return {
    htmlPath: target.htmlPath,
    labelsPath: target.labelsPath,
    source: describeUrl(snapshot.url),
    seededSecrets: sanitized.seededSecrets,
    stats: sanitized.stats,
  };
}

function summary(result: CaptureResult): string {
  const s = result.stats;
  const relative = path.relative(process.cwd(), result.htmlPath);
  return [
    `captured ${result.source}`,
    `  -> ${relative}`,
    `  replaced: ${s.email} emails, ${s.phone} phones, ${s.card} cards, ${s.amount} amounts, ` +
      `${s.address} addresses, ${s.name} names, ${s.redactedTexts + s.literal} redacted texts, ` +
      `${s.strayAt} stray '@'`,
    `  removed: ${s.removedElements} elements, ${s.removedAttributes} handlers, script URLs and secrets, ` +
      `${s.neutralisedResources} external resources, ${s.removedComments} comments`,
    `  seeded: ${result.seededSecrets.join(', ')}`,
    '  next: read the file top to bottom before committing (docs/adapters.md, review checklist).',
  ].join('\n');
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const parsed = parseCaptureArgs(argv, new Date());
    if (parsed === 'help') {
      console.log(HELP);
      return 0;
    }
    console.log(summary(await captureFixture(parsed)));
    return 0;
  } catch (error) {
    if (error instanceof CaptureError) {
      console.error(`capture failed [${error.code}]: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
