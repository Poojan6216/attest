/**
 * The one place that knows where the seeded secrets live and what a seed looks like (TECH-12). Two loaders
 * build on this base schema with their own rules:
 *  - tests/e2e/support/leaks.ts (the @mandatory no-leak test): strict, version 1, at least 15 seeds, every
 *    value and canary long enough to search for;
 *  - tests/tools/capture-output.ts (the capture CLI, which also accepts `--seeds <path>`): lenient, ids only.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export const SEEDS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/secrets/seeded.json',
);

export const SEED_ID = z.string().regex(/^[a-z0-9_]+$/);

/** Fields every seed has, whoever reads it. */
export const BaseSeed = z.object({
  id: SEED_ID,
  value: z.string().min(1),
  canaries: z.array(z.string()).default([]),
});

export const uniqueIds = (seeds: readonly { readonly id: string }[]): boolean =>
  new Set(seeds.map((seed) => seed.id)).size === seeds.length;
