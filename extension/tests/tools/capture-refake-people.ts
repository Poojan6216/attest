/**
 * The second re-fake (MANUAL.md, before the repository goes public; security review SEC-L2): the emails, names and
 * phrases a capture faked with the public seed. None can be reversed, but each confirms a guess (run a guessed name
 * through the public seed and look for its fake), so each becomes HMAC(capture key; its old fake) in the faker's own
 * shape (./capture-fakes.ts): an address of two pool names at a reserved domain another such address; a kept receipt
 * sender's, whose local part the capture faked at the sender's own domain (./capture-pii.ts), another local part at
 * that domain; a pool name another; a phrase (a capitalised pool word and the lower-case ones after it) another of as
 * many words, on the same side of a subject hint's 80 characters, so every hint is cut where it was, and a label's
 * hint cut from a long phrase becomes the new phrase's cut. Each length is otherwise free: a new fake as long as its
 * old one would let a guess be confirmed by length. They are found by those shapes alone, never by guessing what a
 * name is; ./capture-refake.ts re-fakes the values beside them.
 *
 * One mapping serves every file named, the pages and their labels alike. It is built in sorted order over every fake
 * those files hold, and those of the `--scan` files (the same pages' older versions), with every old fake reserved, so
 * one old fake has one new fake wherever and whenever it stands, and no new fake is an old one. A shape the mapping
 * does not hold fails loudly. The record (`--record`) is that mapping: it holds the old fakes, so it is written only
 * outside the repository, owner-only.
 *
 *   tsx tests/tools/capture-refake-people.ts --record <file outside the repository> [--scan <file>]… [--dry-run] <file>…
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { CaptureError } from './capture-error';
import { Faker, matchCase, NAME_HEADS, NAME_TAILS, PHRASE_WORDS } from './capture-fakes';
import { captureKey } from './capture-key';
import { escapeRegExp } from './capture-pii';
import { SCHEMA_LIMITS } from '../../src/core/schema-primitives';

type Kind = 'email' | 'name' | 'phrase';

/**
 * Old fake → new fake, per kind: an email and a name keyed in lower case, a phrase as written; and `clamp`, a long
 * phrase's first HINT characters (a label's subject hint, src/core/redact.ts `clampSubjectHint`) → the new phrase's.
 */
export type PeopleMapping = Readonly<Record<Kind | 'clamp', ReadonlyMap<string, string>>>;

/** A subject hint's length: a new phrase stays on its old one's side of it, so every hint is cut as before. */
const HINT = SCHEMA_LIMITS.SUBJECT_HINT;
const MAX_TRIES = 10_000;
/** Tries at one word count before a new phrase takes one more word (at most four more), as the faker does. */
const TRIES_PER_LENGTH = 1_000;

const titled = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
const either = (words: readonly string[]): string => `(?:${words.join('|')})`;
const lowerHeads = NAME_HEADS.map((head) => head.toLowerCase());
const nameWord = (heads: readonly string[], tails: readonly string[]): string =>
  `${either(heads)}${either(tails)}`;
const upperWord = nameWord(
  NAME_HEADS.map((head) => head.toUpperCase()),
  NAME_TAILS.map((tail) => tail.toUpperCase()),
);
/** A pool name as the faker writes it (a head and a tail, then a lower-case second one past 64 tries), in its case. */
const NAME = [
  `${nameWord(NAME_HEADS, NAME_TAILS)}(?:${nameWord(lowerHeads, NAME_TAILS)})?`,
  `${upperWord}(?:${upperWord})?`,
  `${nameWord(lowerHeads, NAME_TAILS)}(?:${nameWord(lowerHeads, NAME_TAILS)})?`,
].join('|');
const EMAIL = `${nameWord(lowerHeads, NAME_TAILS)}\\.${nameWord(lowerHeads, NAME_TAILS)}\\d*@[a-z0-9-]+(?:\\.[a-z0-9-]+)+`;
const RESERVED_DOMAIN = /@example\.(?:com|org|net)$/u;
const PHRASE = `${either(PHRASE_WORDS.map(titled))}(?: ${either(PHRASE_WORDS)})*`;
/** One pass over the three shapes, so a new fake is never read again as an old one. */
const SHAPES = new RegExp(
  `(?<![A-Za-z0-9])(?:(?<email>${EMAIL})|(?<name>${NAME})(?!@)|(?<phrase>${PHRASE}))(?![A-Za-z0-9])`,
  'gu',
);

interface Found {
  readonly kind: Kind | 'clamp';
  readonly written: string;
  readonly key: string;
}

function foundIn(match: RegExpMatchArray): Found | undefined {
  const { clamp, email, name, phrase } = match.groups ?? {};
  if (clamp !== undefined) return { kind: 'clamp', written: clamp, key: clamp };
  if (email !== undefined) return { kind: 'email', written: email, key: email.toLowerCase() };
  if (name !== undefined) return { kind: 'name', written: name, key: name.toLowerCase() };
  if (phrase !== undefined) return { kind: 'phrase', written: phrase, key: phrase };
  return undefined;
}

/** The first HINT characters of each long phrase: a label holds them as its subject hint. */
const cutsOf = (phrases: Iterable<string>): string[] =>
  [...phrases].filter((phrase) => phrase.length > HINT).map((phrase) => phrase.slice(0, HINT));

/**
 * Every old fake in `texts`, per kind, as the mapping keys it. A quoted cut of a long phrase (a label's subject hint)
 * is that phrase's, not a phrase of its own, so a second pass reads the texts without them.
 */
export function fakesIn(texts: Iterable<string>): Record<Kind, Set<string>> {
  const all = [...texts];
  const collect = (cuts: readonly string[]): Record<Kind, Set<string>> => {
    const found: Record<Kind, Set<string>> = { email: new Set(), name: new Set(), phrase: new Set() };
    for (const text of all) {
      const rest = cuts.reduce((left, cut) => left.replaceAll(`"${cut}"`, '""'), text);
      for (const match of rest.matchAll(SHAPES)) {
        const shape = foundIn(match);
        if (shape !== undefined && shape.kind !== 'clamp') found[shape.kind].add(shape.key);
      }
    }
    return found;
  };
  return collect(cutsOf(collect([]).phrase));
}

/** A fake at a reserved domain gets another; a kept sender's fake local part another, at the sender's own domain. */
function reEmail(faker: Faker, old: string): string {
  const fake = faker.email(old);
  if (RESERVED_DOMAIN.test(old)) return fake;
  return `${fake.slice(0, fake.lastIndexOf('@'))}${old.slice(old.lastIndexOf('@'))}`;
}

function poolWord(bytes: Buffer, at: number): string {
  const word = PHRASE_WORDS[bytes.readUInt8(at % bytes.length) % PHRASE_WORDS.length];
  if (word === undefined) throw new RangeError('an empty phrase pool');
  return word;
}

/**
 * A phrase of as many pool words as `old`, on its side of HINT, neither taken nor an old fake (module comment). Every
 * one-word phrase may be an old fake (the pool has 32 words), so a phrase that finds none takes one more word.
 */
function rePhrase(faker: Faker, old: string, taken: Set<string>): string {
  const count = old.split(' ').length;
  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
    const words = count + Math.min(Math.floor(attempt / TRIES_PER_LENGTH), 4);
    const bytes = faker.bytes('phrase', old, attempt);
    const phrase = titled(Array.from({ length: words }, (_, at) => poolWord(bytes, at)).join(' '));
    if (phrase.length <= HINT === old.length <= HINT && !taken.has(phrase.toLowerCase())) {
      taken.add(phrase.toLowerCase());
      return phrase;
    }
  }
  throw new CaptureError('bad_args', 'No new phrase could be found for an old one.');
}

/** The mapping for `fakes`, keyed by `seed` (module comment): sorted, every old fake reserved. Pure. */
export function peopleMapping(
  fakes: Readonly<Record<Kind, ReadonlySet<string>>>,
  seed: string,
): PeopleMapping {
  const faker = new Faker(seed);
  faker.reserve([...fakes.email, ...fakes.name, ...fakes.phrase]);
  const sorted = (kind: Kind): string[] => [...fakes[kind]].sort();
  const taken = new Set(sorted('phrase').map((old) => old.toLowerCase()));
  const phrase = new Map(sorted('phrase').map((old) => [old, rePhrase(faker, old, taken)]));
  const clamp = new Map<string, string>();
  for (const [old, fake] of phrase) {
    if (old.length <= HINT) continue;
    const cut = old.slice(0, HINT);
    if (clamp.has(cut)) throw new CaptureError('bad_args', 'Two long phrases share their subject hint.');
    clamp.set(cut, fake.slice(0, HINT));
  }
  return {
    email: new Map(sorted('email').map((old) => [old, reEmail(faker, old)])),
    name: new Map(sorted('name').map((old) => [old, faker.nameToken(old)])),
    phrase,
    clamp,
  };
}

/** The shapes, and before them each quoted subject hint the mapping cuts from a long phrase. */
function patternOf(mapping: PeopleMapping): RegExp {
  if (mapping.clamp.size === 0) return SHAPES;
  const cuts = [...mapping.clamp.keys()].map(escapeRegExp).join('|');
  return new RegExp(`"(?<clamp>${cuts})"|${SHAPES.source}`, 'gu');
}

/** `text` with every old fake replaced by its new one, in the case it was written, and the count per kind. */
export function applyPeople(
  text: string,
  mapping: PeopleMapping,
): { text: string; counts: Record<Kind | 'clamp', number> } {
  const counts: Record<Kind | 'clamp', number> = { email: 0, name: 0, phrase: 0, clamp: 0 };
  let out = '';
  let last = 0;
  for (const match of text.matchAll(patternOf(mapping))) {
    const shape = foundIn(match);
    const fake = shape === undefined ? undefined : mapping[shape.kind].get(shape.key);
    if (shape === undefined || fake === undefined) {
      throw new CaptureError('bad_args', 'A fake the mapping does not hold: name its file with --scan.');
    }
    counts[shape.kind] += 1;
    const replacement =
      shape.kind === 'clamp' ? `"${fake}"` : shape.kind === 'phrase' ? fake : matchCase(fake, shape.written);
    out += text.slice(last, match.index) + replacement;
    last = match.index + match[0].length;
  }
  return { text: out + text.slice(last), counts };
}

/** The repository root: a record written under it would commit the old fakes. */
const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const recordOf = (mapping: PeopleMapping): string =>
  `${JSON.stringify(
    Object.fromEntries(Object.entries(mapping).map(([kind, map]) => [kind, Object.fromEntries(map)])),
    null,
    1,
  )}\n`;

export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      record: { type: 'string' },
      scan: { type: 'string', multiple: true },
      'dry-run': { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });
  const record = values.record === undefined ? undefined : path.resolve(values.record);
  if (record === undefined || !path.relative(REPOSITORY, record).startsWith('..')) {
    throw new CaptureError(
      'bad_args',
      '--record must name a file outside the repository: it holds the old fakes.',
    );
  }
  const texts = new Map<string, string>();
  for (const file of positionals) texts.set(file, await readFile(file, 'utf8'));
  const scanned = await Promise.all((values.scan ?? []).map((file) => readFile(file, 'utf8')));
  const mapping = peopleMapping(fakesIn([...texts.values(), ...scanned]), await captureKey());
  for (const [file, text] of texts) {
    const result = applyPeople(text, mapping);
    if (values['dry-run'] !== true) await writeFile(file, result.text);
    const { email, name, phrase, clamp } = result.counts;
    console.log(
      `${file}: ${String(email)} emails, ${String(name)} names, ${String(phrase)} phrases, ${String(clamp)} cut hints`,
    );
  }
  await writeFile(record, recordOf(mapping), { mode: 0o600 });
  const sizes = Object.entries(mapping).map(([kind, map]) => `${String(map.size)} ${kind}s`);
  console.log(`mapping: ${sizes.join(', ')}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
