/**
 * `pnpm attest replay <export.json>` (task 1.9; docs/grading.md §9): the replay export format
 * (tests/tools/attest-snapshot.ts), the summary, and the exit codes — 0 when every receipt is reproduced, 1 on any
 * mismatch, 2 for bad arguments or an unreadable export. The exports are written to a temporary directory from the
 * hand-built scenario and from a synthetic multi-batch ledger; the real entry point is also run under tsx.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { canonicalJson, sha256Hex } from '../../../src/core/hash';
import { replay, type ReplayReport } from '../../../src/core/replay';
import { EXIT, HELP, LISTED_MISMATCHES, main, summarize } from '../../tools/attest-cli';
import { simulate } from '../../tools/attest-ledger';
import { OBSERVATIONS, receiptIdOf, scenarioLedger, scenarioWorld } from '../../tools/attest-scenario';
import { readSnapshot, ReplayExport, toReplayExport } from '../../tools/attest-snapshot';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const TSX = path.join(EXTENSION, 'node_modules', '.bin', 'tsx');
const CLI = path.join(EXTENSION, 'tests', 'tools', 'attest-cli.ts');
const EXPORTED_AT = '2026-10-02T09:00:00+00:00';

let dir: string;
let scenarioJson: Record<string, unknown>;

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
}

async function run(argv: readonly string[], cwd = dir): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (line) => out.push(line), err: (line) => err.push(line) }, cwd);
  return { code, out, err };
}

async function write(name: string, value: unknown): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

/** The export read loosely: just enough shape to tamper with its receipts. */
const LooseExport = z.looseObject({
  tables: z.looseObject({ receipts: z.array(z.record(z.string(), z.unknown())) }),
});
type LooseExport = z.infer<typeof LooseExport>;

/** A deep copy of the scenario export with `change` applied. */
function changed(change: (json: LooseExport) => void): LooseExport {
  const copy = LooseExport.parse(JSON.parse(JSON.stringify(scenarioJson)));
  change(copy);
  return copy;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'attest-cli-'));
  const { snapshot } = await scenarioLedger();
  const world = scenarioWorld();
  const documents = new Map(world.policies.map((version) => [version.policy.policyHash, version.document]));
  scenarioJson = toReplayExport(snapshot, { grants: world.grants, documents, exportedAt: EXPORTED_AT });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the replay export format', () => {
  it('round-trips a snapshot: readSnapshot(JSON of toReplayExport(s)) replays like s', async () => {
    const parsed = readSnapshot(JSON.parse(JSON.stringify(scenarioJson)));
    const { snapshot } = await scenarioLedger();
    expect(parsed.receipts).toEqual(snapshot.receipts);
    expect(parsed.claims).toEqual(snapshot.claims);
    expect(parsed.observations).toEqual(snapshot.observations);
    expect([...parsed.receiptInputs.keys()].sort()).toEqual([...snapshot.receiptInputs.keys()].sort());
    expect([...parsed.policies.keys()]).toEqual([...snapshot.policies.keys()]);
  });

  it('is the Sprint 0 ledger export plus receiptInputs and policies, strict at every level', () => {
    expect(ReplayExport.safeParse(scenarioJson).success).toBe(true);
    expect(ReplayExport.safeParse({ ...scenarioJson, extra: 1 }).success).toBe(false);
    const withoutInputs = { ...scenarioJson };
    delete withoutInputs.receiptInputs;
    expect(ReplayExport.safeParse(withoutInputs).success).toBe(false);
  });
});

describe('pnpm attest replay <export.json>', () => {
  it('exits 0 and prints the counts when every receipt is reproduced', async () => {
    const file = await write('scenario.json', scenarioJson);
    const { code, out, err } = await run(['replay', file]);
    expect({ code, err }).toEqual({ code: EXIT.reproduced, err: [] });
    expect(out).toEqual([
      `attest replay ${file}`,
      '  receipts    13 in 2 batches',
      '  reproduced  13',
      '  mismatched  0',
    ]);
  });

  it('exits 1 and lists the mismatch by field when a stored grade was changed', async () => {
    const id = receiptIdOf('c1');
    const tampered = changed((json) => {
      const receipt = json.tables.receipts.find((r) => r.id === id);
      if (receipt !== undefined) receipt.grade = 'PARTIAL';
    });
    const file = await write('tampered.json', tampered);
    const { code, out } = await run(['replay', file]);
    expect(code).toBe(EXIT.mismatch);
    expect(out.slice(1)).toEqual([
      '  receipts    13 in 2 batches',
      '  reproduced  12',
      '  mismatched  1',
      '  by field    grade 1',
      '  mismatches (1 of 1 listed):',
      `    ${id} grade: stored PARTIAL, replayed VERIFIED`,
    ]);
  });

  it('exits 1 when an observation was edited under its old contentHash, naming hashes, never the content', async () => {
    const tampered = changed((json) => {
      const observations = z.array(z.record(z.string(), z.unknown())).parse(json.tables.observations);
      const o1 = observations.find((o) => o.id === OBSERVATIONS.o1.id);
      if (o1 !== undefined) o1.subjectHint = 'edited after export';
      json.tables.observations = observations;
    });
    const { code, out } = await run(['replay', await write('edited.json', tampered)]);
    expect(code).toBe(EXIT.mismatch);
    const edited = { ...OBSERVATIONS.o1, subjectHint: 'edited after export' };
    const recomputed = sha256Hex(
      canonicalJson({ ...edited, id: undefined, observedAt: undefined, contentHash: undefined }),
    );
    const stored = OBSERVATIONS.o1.contentHash;
    expect(out).toContain(`    ${receiptIdOf('c1')} contentHash: stored ${stored}, replayed ${recomputed}`);
    expect(out.join('\n')).not.toContain('edited after export');
  });
});

describe('pnpm attest replay <export.json>, wherever it is typed and on bigger exports', () => {
  it('reads a relative path from the directory it was typed in', async () => {
    await write('relative.json', scenarioJson);
    expect((await run(['replay', 'relative.json'], dir)).code).toBe(EXIT.reproduced);
    expect((await run(['replay', 'relative.json'], os.tmpdir())).code).toBe(EXIT.unusable);
  });

  it('works on a synthetic multi-batch export (overrides, two policies, a grant change)', async () => {
    const { snapshot, world } = await simulate({
      seed: 19,
      claims: 40,
      observations: 400,
      batches: 4,
      overridesPerGap: 2,
    });
    const documents = new Map(world.policies.map((version) => [version.policy.policyHash, version.document]));
    const json = toReplayExport(snapshot, { grants: world.grants, documents, exportedAt: EXPORTED_AT });
    const { code, out } = await run(['replay', await write('synthetic.json', json)]);
    expect(code).toBe(EXIT.reproduced);
    const receipts = String(snapshot.receipts.length);
    expect(out[2]).toBe(`  reproduced  ${receipts}`);
    expect(snapshot.policies.size).toBe(2);
  }, 60_000);
});

describe('an export replay cannot use exits 2 and says why, without values', () => {
  it.each([
    ['not JSON', '{ not json', 'is not JSON'],
    ['not an export', { format: 'something else' }, 'not an attest replay export'],
  ])('%s', async (_name, content, message) => {
    const { code, err } = await run(['replay', await write('bad.json', content)]);
    expect(code).toBe(EXIT.unusable);
    expect(err.join('\n')).toContain('[invalid_snapshot]');
    expect(err.join('\n')).toContain(message);
  });

  it('a missing file', async () => {
    const { code, err } = await run(['replay', path.join(dir, 'missing.json')]);
    expect(code).toBe(EXIT.unusable);
    expect(err.join('\n')).toContain('ENOENT');
  });

  it('a receipt with an unknown key, named by its path', async () => {
    const leaky = changed((json) => {
      const [first] = json.tables.receipts;
      if (first !== undefined) first.body = 'secret';
    });
    const { code, err } = await run(['replay', await write('leaky.json', leaky)]);
    expect(code).toBe(EXIT.unusable);
    expect(err.join('\n')).toContain('tables.receipts.0');
    expect(err.join('\n')).not.toContain('secret');
  });

  it('a policy filed under another hash, or one that is not a policy', async () => {
    const policies = Object.values(ReplayExport.parse(scenarioJson).policies);
    const misfiled = { ...scenarioJson, policies: { ['0'.repeat(64)]: policies[0] } };
    const misfiledRun = await run(['replay', await write('misfiled.json', misfiled)]);
    expect(misfiledRun.code).toBe(EXIT.unusable);
    expect(misfiledRun.err.join('\n')).toContain('[policy_hash]');
    const broken = { ...scenarioJson, policies: { ['0'.repeat(64)]: { version: 2 } } };
    const brokenRun = await run(['replay', await write('broken.json', broken)]);
    expect(brokenRun.code).toBe(EXIT.unusable);
    expect(brokenRun.err.join('\n')).toContain('is not a valid policy');
  });
});

describe('arguments', () => {
  it.each([[[]], [['replay']], [['replay', 'a.json', 'b.json']], [['verify', 'a.json']]])(
    '%j prints the usage and exits 2',
    async (argv) => {
      const { code, err } = await run(argv);
      expect(code).toBe(EXIT.unusable);
      expect(err).toEqual([HELP]);
    },
  );

  it('--help prints the usage and exits 0', async () => {
    expect(await run(['--help'])).toEqual({ code: EXIT.reproduced, out: [HELP], err: [] });
  });
});

describe('the summary', () => {
  it(`lists at most ${String(LISTED_MISMATCHES)} mismatches and counts every field that has one`, async () => {
    const mismatches = Array.from({ length: 25 }, (_, n) => ({
      receiptId: receiptIdOf('c1'),
      field: n % 2 === 0 ? ('grade' as const) : ('state' as const),
      stored: 'A',
      replayed: null,
    }));
    const empty = await replay({
      claims: [],
      observations: [],
      receipts: [],
      receiptInputs: new Map(),
      policies: new Map(),
    });
    expect(Object.values(empty.byField).every((count) => count === 0)).toBe(true);
    const report: ReplayReport = {
      receipts: 30,
      batches: 3,
      reproduced: 5,
      mismatched: 25,
      byField: { ...empty.byField, grade: 13, state: 12 },
      mismatches,
    };
    const lines = summarize('x.json', report);
    expect(lines).toContain('  by field    grade 13, state 12');
    expect(lines).toContain('  mismatches (20 of 25 listed):');
    expect(lines.filter((line) => line.startsWith('    '))).toHaveLength(LISTED_MISMATCHES);
    expect(lines.at(-1)).toContain('stored A, replayed (none)');
  });
});

/** Runs the real entry point under tsx, as `pnpm attest` does; resolves with the exit code. */
function runTsx(args: readonly string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(TSX, [CLI, ...args], { cwd: EXTENSION }, (error, stdout) => {
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : -1, stdout });
    });
  });
}

describe('the real entry point under tsx', () => {
  it('exits 0 on the scenario export and 1 on a tampered one', async () => {
    const good = await write('entry-good.json', scenarioJson);
    const bad = await write(
      'entry-bad.json',
      changed((json) => {
        const receipt = json.tables.receipts.find((r) => r.id === receiptIdOf('c8'));
        if (receipt !== undefined) receipt.ruleId = 'partial';
      }),
    );
    const [ok, mismatch] = await Promise.all([runTsx(['replay', good]), runTsx(['replay', bad])]);
    expect(ok).toMatchObject({ code: 0 });
    expect(ok.stdout).toContain('reproduced  13');
    expect(mismatch.code).toBe(1);
    expect(mismatch.stdout).toContain('by field    ruleId 1');
  }, 60_000);
});
