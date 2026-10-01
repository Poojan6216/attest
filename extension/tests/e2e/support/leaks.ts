/**
 * Seeded-secret leak detection for the @mandatory no-leak test (Hard Rules 2 and 10).
 *
 * A channel is everything the extension could leak through: IndexedDB (via the extension's own export
 * and a raw dump), chrome.storage, web storage and CacheStorage, the storage and cookies of the pages it
 * reads, console output from every context, request URLs and bodies (telemetry from Sprint 5), and later
 * the share output. Each seed's value and every canary fragment must be absent from every channel.
 *
 * Matching is on a compact form of both sides: NFKC, lower case, and every whitespace, punctuation and
 * symbol character removed, so `Ottoline Vasquez-Brannigan`, `ottoline.vasquez-brannigan` and
 * `OttolineVasquezBrannigan` are the same needle, and `912-44-7031` matches `912447031`. Canaries catch
 * partial leaks (name tokens, three-word windows, 16-character windows of keys and blobs). Every string is
 * searched as it is, percent-decoded, and with each base64/base64url run decoded, and the serialised JSON
 * of structured content is searched too, so an escaped, encoded or re-cased copy still counts as a leak.
 */
import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { BaseSeed, SEEDS_PATH, uniqueIds } from '../../tools/seeds';

/** Shorter needles than this would match by chance; seeded.json is validated against it. */
const MIN_NEEDLE = 6;

const SeedSchema = BaseSeed.extend({
  kind: z.string().min(1),
  value: z.string().min(8),
  canaries: z.array(z.string().min(MIN_NEEDLE)),
}).strict();

const SeedFileSchema = z.strictObject({
  version: z.literal(1),
  description: z.string(),
  // At least the 15 formats of task 0.5; more may be added (the identifier-shaped seeds of the Sprint 0 close).
  seeds: z.array(SeedSchema).min(15).refine(uniqueIds, 'seed ids must be unique'),
});

export type Seed = z.infer<typeof SeedSchema>;

export interface Leak {
  readonly channel: string;
  readonly seedId: string;
  /** Where in the channel it was found (a JSON path or a line number); never the secret itself. */
  readonly location: string;
}

/** The compact search form: NFKC, lower case, no whitespace, punctuation or symbols. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}\p{Z}\p{C}]+/gu, '');
}

export function loadSeeds(): Seed[] {
  const seeds = SeedFileSchema.parse(JSON.parse(readFileSync(SEEDS_PATH, 'utf8'))).seeds;
  for (const seed of seeds) {
    for (const needle of [seed.value, ...seed.canaries]) {
      if (normalizeForSearch(needle).length < MIN_NEEDLE) {
        throw new Error(`seed ${seed.id}: a needle is shorter than ${String(MIN_NEEDLE)} once compacted`);
      }
    }
  }
  return seeds;
}

function needles(seed: Seed): string[] {
  return [seed.value, ...seed.canaries].map(normalizeForSearch);
}

/** Percent-decodes what it can; a malformed escape leaves the rest of the text as it was. */
function percentDecoded(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

const BASE64_RUN = /[A-Za-z0-9+/_-]{12,}={0,2}/g;

/** Every base64 or base64url run in `text`, decoded as UTF-8 (lossy; only searched, never trusted). */
function base64Decoded(text: string): string[] {
  const out: string[] = [];
  for (const [run] of text.matchAll(BASE64_RUN)) {
    const standard = run.replace(/-/g, '+').replace(/_/g, '/');
    out.push(Buffer.from(standard, 'base64').toString('utf8'));
  }
  return out;
}

/** The text plus every decoding of it worth searching. */
function variants(text: string): string[] {
  const decoded = percentDecoded(text);
  return [text, decoded, ...base64Decoded(text), ...(decoded === text ? [] : base64Decoded(decoded))];
}

/** Every string inside a JSON-like value, with its path. */
function* strings(value: unknown, at: string): Generator<[string, string]> {
  if (typeof value === 'string') {
    yield [at, value];
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* strings(item, `${at}[${String(index)}]`);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      yield [`${at}.<key>`, key];
      yield* strings(item, `${at}.${key}`);
    }
  } else if (typeof value === 'number' || typeof value === 'bigint') {
    yield [at, String(value)];
  }
}

/**
 * Searches one channel. `content` may be structured data (walked value by value, then also searched
 * as serialised JSON) or plain text lines.
 */
export function findLeaks(channel: string, content: unknown, seeds: readonly Seed[]): Leak[] {
  const leaks: Leak[] = [];
  const haystacks: [string, string][] = [...strings(content, '$')];
  // JSON.stringify returns undefined for undefined input despite its declared type.
  const serialised = JSON.stringify(content) as string | undefined;
  haystacks.push(['$<serialised>', serialised ?? '']);
  for (const [location, raw] of haystacks) {
    const texts = variants(raw).map(normalizeForSearch);
    for (const seed of seeds) {
      if (needles(seed).some((needle) => texts.some((text) => text.includes(needle)))) {
        leaks.push({ channel, seedId: seed.id, location });
      }
    }
  }
  // One leak per (channel, seed) is enough to fail; keep the first location for the report.
  const seen = new Set<string>();
  return leaks.filter((leak) => {
    const key = `${leak.channel}\u0000${leak.seedId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
