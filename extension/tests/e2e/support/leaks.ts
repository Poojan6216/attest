/**
 * Seeded-secret leak detection for the @mandatory no-leak test (Hard Rules 2 and 10).
 *
 * A channel is everything the extension could leak through: IndexedDB (via the extension's own export
 * and a raw dump), chrome.storage.local, console output from every context, request URLs and bodies
 * (telemetry from Sprint 5), and later the share output. Each seed's value and every canary fragment
 * must be absent from every channel. Matching is NFKC-normalised, case-insensitive and
 * whitespace-insensitive, and runs over decoded string values as well as the serialised text, so a
 * JSON-escaped or re-cased copy of a secret still counts as a leak.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const SEEDS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/secrets/seeded.json',
);

const SeedSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.string().min(1),
  value: z.string().min(8),
  canaries: z.array(z.string().min(6)),
});

const SeedFileSchema = z.strictObject({
  version: z.literal(1),
  description: z.string(),
  seeds: z.array(SeedSchema).length(15),
});

export type Seed = z.infer<typeof SeedSchema>;

export interface Leak {
  readonly channel: string;
  readonly seedId: string;
  /** Where in the channel it was found (a JSON path or a line number); never the secret itself. */
  readonly location: string;
}

export function loadSeeds(): Seed[] {
  return SeedFileSchema.parse(JSON.parse(readFileSync(SEEDS_PATH, 'utf8'))).seeds;
}

export function normalizeForSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function needles(seed: Seed): string[] {
  return [seed.value, ...seed.canaries].map(normalizeForSearch);
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
    const text = normalizeForSearch(raw);
    for (const seed of seeds) {
      if (needles(seed).some((needle) => text.includes(needle))) {
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
