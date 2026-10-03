/**
 * src/core run with every impure global poisoned (Hard Rule 4: grade() is pure and deterministic; PI-1 to PI-4,
 * PI-6, FR3-1, FR3-3). The third check on core purity, after lint (eslint-rules/core-fences.js,
 * attest/core-determinism) and the grep test (core-purity.spec.ts). Those read src/core's text, so a spelling they do
 * not know gets past them; this one catches any impure call src/core actually makes, whatever its syntax.
 * ./core-poison.ts says what is poisoned and how a call from src/core is told apart from one by the harness.
 *
 * The guard is installed, armed, before any src/core module is evaluated (FR3-1): this file imports nothing from
 * src/core statically, installs the guard at the top, and only then loads src/core and the harness modules that use
 * it, so a built-in src/core captures or calls while its modules load is the twin, and a use made then is recorded
 * (and must be none). The unpoisoned baseline is computed with the guard disarmed. The workloads are every golden
 * scenario through the golden runner, the build_spec §2 demo ledger built and graded at four instants, a synthetic
 * ledger graded batch by batch with overrides and then replayed (tests/tools/attest-ledger.ts), a slice of the
 * gradeBatch bench workload (bench/core.ts), and the text and time API those reach least (relative times read in US
 * Eastern, the text of every reason the other workloads gave, punycode domains, policy errors). Each must give exactly
 * what it gave unpoisoned, no impure use may be recorded, no built-in may have changed (FR3-3), and the poison must
 * have seen src/core's own pure calls (`Date.UTC`, `new Date(ms)`), so it was live while src/core ran. Afterwards
 * every property it replaced is the original again. The whole of tests/unit/core, tests/golden and tests/property
 * runs under the same guard in the poisoned run (vitest.poison.config.ts, FR3-4); the negative controls are in
 * core-poison-controls.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BatchReceipt } from '../../../src/core/batch';
import type { Reason, Receipt } from '../../../src/core/schema';
import type { LoadedScenario } from '../../golden/load';
import { installPoison, POISONED_GLOBALS } from './core-poison';
import { intrinsicChanges, snapshotIntrinsics } from './core-poison-intrinsics';

/** A Sprint 1 Gate check on Hard Rule 4, with the grep test: `vitest run --tags-filter gate` runs it too. */
const GATE = { tags: ['gate'] };

/** Every property the poison replaces, as it is before any poison: compared once it is gone. */
const PRISTINE = [
  ...['Date', 'Math', ...POISONED_GLOBALS].map((key) => [globalThis, key] as const),
  ...['now', 'parse', 'UTC'].map((key) => [Date, key] as const),
  ...['constructor', 'getHours', 'getTimezoneOffset', 'toString', Symbol.toPrimitive].map(
    (key) => [Date.prototype, key] as const,
  ),
  [Math, 'random'] as const,
  [String.prototype, 'localeCompare'] as const,
].map(([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)] as const);

/** Installed and armed before src/core loads (FR3-1); restored after the file, or by the test that checks it is. */
const poison = installPoison();
const BUILT_INS = snapshotIntrinsics(POISONED_GLOBALS);
afterAll(() => {
  poison.restore();
});

/** src/core and the harness modules that drive it, loaded only now, under the armed guard. */
const [bench, batch, candidates, relative, time, policy, punycode, reasonText, replay, schema] =
  await Promise.all([
    import('../../../../bench/core'),
    import('../../../src/core/batch'),
    import('../../../src/core/candidates'),
    import('../../../src/core/normalize-relative'),
    import('../../../src/core/normalize-time'),
    import('../../../src/core/policy'),
    import('../../../src/core/punycode'),
    import('../../../src/core/reason-text'),
    import('../../../src/core/replay'),
    import('../../../src/core/schema'),
  ]);
const [golden, runner, ledger, demo] = await Promise.all([
  import('../../golden/load'),
  import('../../golden/runner'),
  import('../../tools/attest-ledger'),
  import('./demo-ledger'),
]);
/** Every impure use src/core made while its modules were evaluated. */
const LOAD_VIOLATIONS = [...poison.violations];

/** The unpoisoned baseline of every workload runs in one hook: a hook's own bound, not a test timeout. */
const BASELINE_HOOK_MS = 120_000;

const SCENARIOS: readonly (readonly [string, LoadedScenario])[] = golden
  .scenarioFiles()
  .map((file) => [file, golden.loadScenario(file)] as const);

/** A synthetic ledger small enough to grade twice in a few seconds: 4 batches, overrides between them. */
const LEDGER = { seed: 0x9015, claims: 200, observations: 2_000, batches: 4, overridesPerGap: 3 } as const;

/** The slice of the bench grading workload graded (the whole is the perf gate's, not this test's). */
const BENCH = { claims: 400, observations: 10_000 } as const;
const BENCH_WORKLOAD = bench.buildGradingWorkload();

/** What a golden scenario gave: everything the runner returns, or the error it threw. */
type Outcome =
  | {
      readonly receipts: readonly Receipt[];
      readonly passes: unknown;
      readonly sources: unknown;
      readonly problems: unknown;
    }
  | { readonly error: string };

const thrown = (error: unknown): { readonly error: string } => ({
  error: error instanceof Error ? `${error.name}: ${error.message}` : 'a non-Error throw',
});

/** A call's value, or the error it threw: a thrown error is part of the answer too. */
function settle(run: () => unknown): unknown {
  try {
    return { value: run() };
  } catch (error) {
    return thrown(error);
  }
}

/** Relative times as Muse and ChatGPT write them, read at three instants (one a DST change) in US Eastern. */
const PHRASES = [
  'Today, 9:15 AM',
  'Yesterday, 11:58 PM',
  'yesterday at 2:03 pm',
  '2 hours ago',
  'an hour ago',
].concat(
  ['5 min ago', '3 days ago', 'Mon 9:00 AM', 'Fri, Oct 1, 2026', 'Thu, Oct 1, 2026, 2:03 PM', 'Oct 1'],
  ['Dec 25, 2026', 'Feb 29', 'Sept 30', '14:03', '12:00 AM', '1:30 AM', '2:30 AM', 'Wednesday', 'tomorrow'],
  ['Oct 32', '24:00', '3000000 days ago', ''],
);
const REFERENCES = ['2026-10-01T15:00:00-04:00', '2026-11-01T01:30:00-04:00', '2026-03-08T03:30:00-04:00'];
const DST = { start: Date.UTC(2026, 2, 8, 7), end: Date.UTC(2026, 10, 1, 6) } as const;
/** US Eastern in 2026, from UTC instants only: the injected OffsetAt (the extension reads it from the browser). */
const offsetAt = (epochMs: number): number => (epochMs >= DST.start && epochMs < DST.end ? -240 : -300);
const DOMAINS = ['xn--bcher-kva.example', 'xn--80ak6aa92e.com', 'xn--.example', 'example.com'];
const BAD_POLICIES: readonly unknown[] = [{}, null, 'policy', { ...policy.DEFAULT_POLICY, weights: 'none' }];

/** The text and time API the batch workloads reach least: relative times, reason text, punycode, policy errors. */
function textOutcome(reasons: readonly Reason[]): unknown[] {
  return [
    ...REFERENCES.flatMap((referenceIso) =>
      PHRASES.map((text) => settle(() => relative.resolveRelative(text, { referenceIso, offsetAt }))),
    ),
    ...reasons.map((reason) => settle(() => reasonText.reasonText(reason))),
    ...DOMAINS.map((domain) => settle(() => punycode.toUnicodeDomain(domain))),
    ...BAD_POLICIES.map((raw) => settle(() => policy.loadPolicy(raw))),
    ...['2026-10-01T15:00:00.125+05:45', '2026-10-01T15:00:00Z', '2026-10-01', 'nonsense'].map((iso) =>
      settle(() => time.instantMs(iso)),
    ),
  ];
}

async function goldenOutcome(loaded: LoadedScenario): Promise<Outcome> {
  try {
    const { receipts, passes, sources, problems } = await runner.runScenario(loaded);
    return { receipts, passes, sources, problems };
  } catch (error) {
    return thrown(error);
  }
}

/** The §2 demo built through the core, graded at the four instants demo.spec.ts reads. */
async function demoOutcome(): Promise<unknown[]> {
  const opened = demo.buildDemo('opened');
  const never = demo.buildDemo('never-opened');
  return [
    opened,
    never,
    await demo.gradeDemo(opened, demo.AT.beforeGrace),
    await demo.gradeDemo(opened, demo.AT.evaluated),
    await demo.gradeDemo(never, demo.AT.evaluated),
    await demo.gradeDemo(never, demo.AT.nextDay),
  ];
}

async function replayOutcome() {
  const { snapshot } = await ledger.simulate(LEDGER);
  return { snapshot, report: await replay.replay(snapshot) };
}

async function benchOutcome(): Promise<BatchReceipt[]> {
  const { observations, grants, coverage, activity } = BENCH_WORKLOAD;
  const claims = BENCH_WORKLOAD.claims.slice(0, BENCH.claims);
  const index = candidates.createMemoryIndex(observations.slice(0, BENCH.observations), bench.BUCKET_MINUTES);
  return batch.gradeBatch(claims, index, grants, policy.DEFAULT_POLICY, coverage, { ...activity, claims });
}

interface Baseline {
  readonly golden: ReadonlyMap<string, Outcome>;
  readonly demo: unknown[];
  readonly replay: Awaited<ReturnType<typeof replayOutcome>>;
  readonly bench: readonly BatchReceipt[];
  readonly text: unknown[];
}

/** Every reason the baseline's golden and bench receipts give: reason-text's input. */
function baselineReasons({ golden: outcomes, bench: receipts }: Omit<Baseline, 'text'>): Reason[] {
  const all = [...outcomes.values()].flatMap((outcome) => ('receipts' in outcome ? outcome.receipts : []));
  return [...all, ...receipts.map(({ receipt }) => receipt)].flatMap(({ reasons }) => reasons);
}

let baseline: Baseline | undefined;

function base(): Baseline {
  if (baseline === undefined) throw new Error('core-poison: no unpoisoned baseline');
  return baseline;
}

/** No impure use recorded and no built-in changed, since the guard was installed. */
function expectClean(): void {
  expect(poison.violations).toEqual([]);
  expect(intrinsicChanges(BUILT_INS)).toEqual([]);
}

beforeAll(async () => {
  poison.disarm();
  try {
    const outcomes = new Map<string, Outcome>();
    for (const [file, loaded] of SCENARIOS) outcomes.set(file, await goldenOutcome(loaded));
    const batches = {
      golden: outcomes,
      demo: await demoOutcome(),
      replay: await replayOutcome(),
      bench: await benchOutcome(),
    };
    baseline = { ...batches, text: textOutcome(baselineReasons(batches)) };
  } finally {
    poison.arm();
  }
}, BASELINE_HOOK_MS);

describe('src/core under the poison: the same receipts, and no impure use (Hard Rule 4)', GATE, () => {
  it('src/core loaded under the armed guard (FR3-1), and nothing it did while loading was impure', () => {
    expect(LOAD_VIOLATIONS).toEqual([]);
    expect(schema.ObserverCoverage).toBeDefined();
    expectClean();
  });

  it.each(SCENARIOS.map(([file]) => file))('golden %s', async (file) => {
    const loaded = SCENARIOS.find(([name]) => name === file)?.[1];
    if (loaded === undefined) throw new Error(`no scenario ${file}`);
    expect(await goldenOutcome(loaded)).toEqual(base().golden.get(file));
    expectClean();
  });

  it('the §2 demo ledger, built and graded at four instants', async () => {
    expect(await demoOutcome()).toEqual(base().demo);
    expectClean();
  });

  it('a synthetic ledger graded batch by batch with overrides, then replayed', async () => {
    const poisoned = await replayOutcome();
    expect(poisoned).toEqual(base().replay);
    expect(poisoned.report.receipts).toBeGreaterThan(LEDGER.claims / 2);
    expect(poisoned.report.reproduced).toBe(poisoned.report.receipts);
    expectClean();
  });

  it('a slice of the gradeBatch bench workload', async () => {
    const poisoned = await benchOutcome();
    expect(poisoned).toEqual(base().bench);
    expect(poisoned.length).toBeGreaterThanOrEqual(BENCH.claims);
    expectClean();
  });

  it('relative times, the text of every reason, punycode domains, policy errors and ISO instants', () => {
    const reasons = baselineReasons(base());
    expect(reasons.length).toBeGreaterThan(BENCH.claims);
    const values = base().text.filter(
      (entry) => typeof entry === 'object' && entry !== null && 'value' in entry,
    );
    expect(values.filter(({ value }) => value !== null).length).toBeGreaterThan(PHRASES.length);
    expect(textOutcome(reasons)).toEqual(base().text);
    expectClean();
  });

  it('the poison was live: it saw src/core make its own pure calls, and nothing impure', () => {
    expect([...poison.witnessed].sort()).toEqual(['Date.UTC', 'new Date(value)']);
    expectClean();
  });
});

describe('the poison is gone afterwards', GATE, () => {
  it('every property it replaced is the original again, and the core runs unpoisoned', () => {
    poison.restore();
    expect(poison.saved.length).toBeGreaterThan(40);
    for (const [target, key, before] of [...poison.saved, ...PRISTINE])
      expect(Object.getOwnPropertyDescriptor(target, key), String(key)).toEqual(before);
    expect(Object.hasOwn(globalThis, 'Temporal')).toBe(false);
    expect(new Date(0).constructor).toBe(Date);
    expect(typeof Date.now()).toBe('number');
    expect(time.instantMs('2026-10-06T14:02:00-04:00')).toBe(Date.UTC(2026, 9, 6, 18, 2));
  });
});
