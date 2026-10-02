/**
 * Task 1.2 parity with the golden suite (docs/grading.md §10, §15): for every observation of every golden
 * scenario, project() of the hand-written observation (its ref, source, type, rowKey and observedAt keys
 * included, all of which project must ignore as content) reproduces the loader's Observation exactly: the
 * same kept fields, contentHash and id. The loader computes these from §10 independently of redact.ts.
 */
import { describe, expect, it } from 'vitest';

import { loadPolicy } from '../../../src/core/policy';
import { project } from '../../../src/core/redact';
import { loadScenario, scenarioFiles } from '../../golden/load';

const FILES = scenarioFiles();

describe('project() reproduces every golden observation', () => {
  it('there is a golden suite to check', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(FILES)('%s', (file) => {
    const loaded = loadScenario(file);
    const policy = loadPolicy(loaded.policyJson);
    for (const written of loaded.scenario.input.observations) {
      const built = loaded.observations.get(written.ref);
      expect(built, written.ref).toBeDefined();
      if (built === undefined) continue;
      const ctx = {
        type: written.type,
        observedAt: built.observedAt,
        ...(written.rowKey === undefined ? {} : { rowKey: written.rowKey }),
      };
      const projected = project(written.source, written, ctx, policy);
      expect(projected.contentHash, `${written.ref} contentHash`).toBe(built.contentHash);
      expect(projected.id, `${written.ref} id`).toBe(built.id);
      expect(projected, written.ref).toStrictEqual(built);
      const allowlist: readonly string[] = policy.allowlistedFields[written.source];
      const allowlisted = Object.fromEntries(
        Object.entries(written).filter(([key]) => allowlist.includes(key)),
      );
      expect(
        project(written.source, allowlisted, ctx, policy),
        `${written.ref} allowlisted only`,
      ).toStrictEqual(built);
    }
  });

  it('covers observations with and without a row key', () => {
    const written = FILES.flatMap((file) => loadScenario(file).scenario.input.observations);
    expect(written.some((observation) => observation.rowKey !== undefined)).toBe(true);
    expect(written.filter((observation) => observation.rowKey === undefined).length).toBeGreaterThan(40);
  });
});
