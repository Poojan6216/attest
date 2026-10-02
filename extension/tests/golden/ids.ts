/**
 * The ids snapshot (docs/grading.md §15): every claim and observation id each scenario's loader builds, written
 * to __snapshots__/ids.json by `pnpm exec tsx tests/golden/write-ids.ts` and reviewed in the diff. A changed id
 * means a hashing change; a new scenario only adds lines. scenarios.spec.ts fails when the file and the
 * loader disagree, and never rewrites the file itself.
 */
import path from 'node:path';

import { GOLDEN_DIR, loadScenario, scenarioFiles } from './load';

export const IDS_SNAPSHOT = path.join(GOLDEN_DIR, '__snapshots__', 'ids.json');

export type ScenarioIds = Record<string, Record<string, string>>;

/** Ref → id for every scenario, claims first, each group in file order. */
export function scenarioIds(): ScenarioIds {
  return Object.fromEntries(
    scenarioFiles().map((file) => {
      const loaded = loadScenario(file);
      const claims = [...loaded.claims].map(([ref, claim]) => [ref, claim.id] as const);
      const observations = [...loaded.observations].map(([ref, obs]) => [ref, obs.id] as const);
      return [file, Object.fromEntries([...claims, ...observations])];
    }),
  );
}

/** The exact text of the snapshot file (Prettier-stable JSON). */
export function formatIds(ids: ScenarioIds): string {
  return `${JSON.stringify(ids, null, 2)}\n`;
}
