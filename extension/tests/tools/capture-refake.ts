/**
 * Re-fakes a committed capture whose fakes came from the public seed (security review SEC-L2), without the originals
 * it never kept: the sanitiser's value rules run again over the committed page, keyed by the capture key
 * (./capture-key.ts), so every amount, card number or ending, phone number, street address, postal address block,
 * labelled order number or code, Meet code and attribute UUID becomes HMAC(key; its old fake), in its shape and the
 * same everywhere on the page. A fake made with the public seed could be reversed by running candidates through the
 * Faker; its keyed re-fake cannot. Emails, names and redacted phrases stay as they are (their fakes only confirm a
 * guess: MANUAL.md has the step that re-fakes them), and so do the seeded secrets the page carries. Labels that hold
 * a re-faked value (an amount, an order number in a subject) are updated from the result; the record of what
 * replaced what (`--record`) holds the old fakes, so it is written only outside the repository.
 *
 * A value no rule finds (a number whose label the capture already faked) is named with `--also`, faked like an id.
 *
 *   tsx tests/tools/capture-refake.ts [--record <file outside the repository>] [--also <value>]… <fixture.html>…
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { Document } from 'happy-dom';

import { attributeVerdict, closeWindow, createInertWindow, textNodes } from './capture-dom';
import { CaptureError } from './capture-error';
import { Faker } from './capture-fakes';
import { captureKey } from './capture-key';
import { type PiiKind, Scrubber } from './capture-pii';
import { fakeRowValues, replaceIds, type RowStats } from './capture-rows';
import { isCalendarPage } from './capture-url';

/** The kinds of value a public-seed fake can be recovered from (SEC-L2); the row rules add ids, codes and blocks. */
const VALUE_KINDS: ReadonlySet<PiiKind> = new Set(['address', 'amount', 'card', 'phone']);
/** Elements whose text is never a page's: a style sheet, a script left by a capture. */
const NOT_TEXT = new Set(['style', 'script']);

export interface Replacement {
  readonly kind: string;
  readonly original: string;
  readonly fake: string;
}

export interface RefakeResult {
  readonly html: string;
  /** What replaced what: the old fakes are reversible, so this never enters the repository. */
  readonly made: readonly Replacement[];
}

/** Kinds whose every copy on a page is the one value: an id, a card's digits, a UUID, an amount. */
const SAME_EVERYWHERE = new Set(['card', 'identifier', 'uuid', 'amount']);

/**
 * Gives every copy of an old fake on the page its new fake, also where no rule saw it (a card ending alone in its span
 * beside "card"): a value is one value wherever it stands, as the sanitiser made it. Short values and old fakes that
 * equal a new one are left, so no unrelated text and no new fake is touched.
 */
function sameEverywhere(doc: Document, faker: Faker, stats: RowStats): void {
  const made = faker.made().filter((entry) => SAME_EVERYWHERE.has(entry.kind) && entry.original.length >= 4);
  const fakes = new Set(made.map((entry) => entry.fake));
  const copies = made.filter((entry) => !fakes.has(entry.original));
  replaceIds(doc, new Map(copies.map((entry) => [entry.original, entry.fake])), stats);
}

/** Re-fakes one committed capture (module comment). Pure: same page and seed, same result. */
export function refakeHtml(
  html: string,
  options: { readonly seed: string; readonly pageUrl?: string; readonly also?: readonly string[] },
): RefakeResult {
  const window = createInertWindow();
  try {
    const doc = new window.DOMParser().parseFromString(html.trimEnd(), 'text/html');
    // The seeded secrets leave the page while it is re-faked, so no rule can touch them, and come back after.
    const seeded = Array.from(doc.querySelectorAll('[data-attest-seeded]'));
    const slots = seeded.map((element) => {
      const slot = doc.createElement('span');
      element.replaceWith(slot);
      return slot;
    });
    const faker = new Faker(options.seed);
    const stats = { rowCards: 0, rowIds: 0, rowAddresses: 0 };
    fakeRowValues(doc, faker, stats, { meetEverywhere: isCalendarPage(options.pageUrl) });
    replaceIds(doc, new Map((options.also ?? []).map((value) => [value, faker.identifier(value)])), stats);
    const scrubber = new Scrubber(faker, {
      globalNames: [],
      nameTokens: new Set(),
      literals: new Map(),
      kinds: VALUE_KINDS,
    });
    for (const node of textNodes(doc)) {
      if (NOT_TEXT.has(node.parentElement?.localName ?? '')) continue;
      const scrubbed = scrubber.scrub(node.data);
      if (scrubbed !== node.data) node.data = scrubbed;
    }
    for (const element of Array.from(doc.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        const value = attribute.value ?? '';
        if (attributeVerdict(element, attribute.name, value) !== 'text') continue;
        const scrubbed = scrubber.scrub(value);
        if (scrubbed !== value) element.setAttribute(attribute.name, scrubbed);
      }
    }
    sameEverywhere(doc, faker, stats);
    slots.forEach((slot, index) => {
      const element = seeded[index];
      if (element !== undefined) slot.replaceWith(element);
    });
    return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}\n`, made: faker.made() };
  } finally {
    closeWindow(window);
  }
}

/** The page address a fixture stands for, enough to tell a Calendar page (its folder: `…/gcal/<date>/`). */
const pageUrlOf = (file: string): string =>
  file.split(path.sep).includes('gcal') ? 'https://calendar.google.com/' : 'https://mail.google.com/';

/** The repository root: a record written under it would commit the old fakes. */
const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { record: { type: 'string' }, also: { type: 'string', multiple: true } },
    allowPositionals: true,
    strict: true,
  });
  const record = values.record === undefined ? undefined : path.resolve(values.record);
  if (record !== undefined && !path.relative(REPOSITORY, record).startsWith('..')) {
    throw new CaptureError(
      'bad_args',
      '--record must name a file outside the repository: it holds the old fakes.',
    );
  }
  const seed = await captureKey();
  const made: (Replacement & { file: string })[] = [];
  for (const file of positionals) {
    const result = refakeHtml(await readFile(file, 'utf8'), {
      seed,
      pageUrl: pageUrlOf(path.resolve(file)),
      also: values.also ?? [],
    });
    await writeFile(file, result.html);
    const counts = new Map<string, number>();
    for (const entry of result.made) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
    console.log(
      `${path.basename(file)}: ${[...counts].map(([kind, n]) => `${String(n)} ${kind}`).join(', ') || 'nothing'}`,
    );
    made.push(...result.made.map((entry) => ({ ...entry, file: path.basename(file) })));
  }
  if (record !== undefined) await writeFile(record, `${JSON.stringify(made, null, 1)}\n`, { mode: 0o600 });
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
