/**
 * src/core run with every impure global poisoned (Hard Rule 4: grade() is pure and deterministic; PI-1 to PI-4,
 * PI-6). The third check on core purity, after lint (eslint-rules/core-fences.js, attest/core-determinism) and the
 * grep test (core-purity.spec.ts). Those read src/core's text, so a spelling they do not know gets past them; this
 * one catches any impure call src/core actually makes, whatever its syntax. ./core-poison.ts says what is poisoned
 * and how a call from src/core is told apart from one by the harness.
 *
 * For the duration of the file the poison is installed while the real src/core runs: every golden scenario through
 * the golden runner, the build_spec §2 demo ledger built and graded at four instants, a synthetic ledger graded
 * batch by batch with overrides and then replayed (tests/tools/attest-ledger.ts), a slice of the gradeBatch bench
 * workload (bench/core.ts), and the text and time API those reach least (relative times read in US Eastern, the
 * text of every reason the other workloads gave, punycode domains, policy errors). Together they run about 87% of
 * src/core's lines (measured with v8 coverage on this file alone). Each must give exactly what it gave unpoisoned, no
 * impure use may be recorded, and the poison must have seen src/core's own pure calls (`Date.UTC`, `new Date(ms)`),
 * so it was live while src/core ran. Afterwards every property it replaced is the original again.
 *
 * Negative controls: every poisoned use is caught when made from a file counted as src/core and passes through from
 * the harness; a real src/core call path, called directly or through zod, is caught once a use it makes is declared
 * impure; and the caller is read from the stack as the file comment of ./core-poison.ts says.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUCKET_MINUTES, buildGradingWorkload } from '../../../../bench/core';
import { type BatchReceipt, gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { resolveRelative } from '../../../src/core/normalize-relative';
import { civilDateAt, instantMs } from '../../../src/core/normalize-time';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { toUnicodeDomain } from '../../../src/core/punycode';
import { reasonText } from '../../../src/core/reason-text';
import { replay } from '../../../src/core/replay';
import { ObserverCoverage, type Reason, type Receipt } from '../../../src/core/schema';
import { type LoadedScenario, loadScenario, scenarioFiles } from '../../golden/load';
import { runScenario } from '../../golden/runner';
import { simulate } from '../../tools/attest-ledger';
import { CORE_DIR, installPoison, originOf, type Poison, PoisonError, POISONED_GLOBALS } from './core-poison';
import { AT, buildDemo, gradeDemo } from './demo-ledger';

const SPEC_FILE = fileURLToPath(import.meta.url);

/** A Sprint 1 Gate check on Hard Rule 4, with the grep test: `vitest run --tags-filter gate` runs it too. */
const GATE = { tags: ['gate'] };

/** The unpoisoned baseline of every workload runs in one hook: a hook's own bound, not a test timeout. */
const BASELINE_HOOK_MS = 120_000;

const SCENARIOS: readonly (readonly [string, LoadedScenario])[] = scenarioFiles().map(
  (file) => [file, loadScenario(file)] as const,
);

/** A synthetic ledger small enough to grade twice in a few seconds: 4 batches, overrides between them. */
const LEDGER = { seed: 0x9015, claims: 200, observations: 2_000, batches: 4, overridesPerGap: 3 } as const;

/** The slice of the bench grading workload graded (the whole is the perf gate's, not this test's). */
const BENCH = { claims: 400, observations: 10_000 } as const;
const BENCH_WORKLOAD = buildGradingWorkload();

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
  ['5 min ago', '3 days ago', 'Mon 9:00 AM', 'Fri, Oct 1, 2026', 'Thu, Oct 1, 2026, 2:03\u202FPM', 'Oct 1'],
  ['Dec 25, 2026', 'Feb 29', 'Sept 30', '14:03', '12:00 AM', '1:30 AM', '2:30 AM', 'Wednesday', 'tomorrow'],
  ['Oct 32', '24:00', '3000000 days ago', ''],
);
const REFERENCES = ['2026-10-01T15:00:00-04:00', '2026-11-01T01:30:00-04:00', '2026-03-08T03:30:00-04:00'];
const DST = { start: Date.UTC(2026, 2, 8, 7), end: Date.UTC(2026, 10, 1, 6) } as const;
/** US Eastern in 2026, from UTC instants only: the injected OffsetAt (the extension reads it from the browser). */
const offsetAt = (epochMs: number): number => (epochMs >= DST.start && epochMs < DST.end ? -240 : -300);
const DOMAINS = ['xn--bcher-kva.example', 'xn--80ak6aa92e.com', 'xn--.example', 'example.com'];
const BAD_POLICIES: readonly unknown[] = [{}, null, 'policy', { ...DEFAULT_POLICY, weights: 'none' }];

/** The text and time API the batch workloads reach least: relative times, reason text, punycode, policy errors. */
function textOutcome(reasons: readonly Reason[]): unknown[] {
  return [
    ...REFERENCES.flatMap((referenceIso) =>
      PHRASES.map((text) => settle(() => resolveRelative(text, { referenceIso, offsetAt }))),
    ),
    ...reasons.map((reason) => settle(() => reasonText(reason))),
    ...DOMAINS.map((domain) => settle(() => toUnicodeDomain(domain))),
    ...BAD_POLICIES.map((raw) => settle(() => loadPolicy(raw))),
  ];
}

async function goldenOutcome(loaded: LoadedScenario): Promise<Outcome> {
  try {
    const { receipts, passes, sources, problems } = await runScenario(loaded);
    return { receipts, passes, sources, problems };
  } catch (error) {
    return thrown(error);
  }
}

/** The §2 demo built through the core, graded at the four instants demo.spec.ts reads. */
async function demoOutcome(): Promise<unknown[]> {
  const opened = buildDemo('opened');
  const never = buildDemo('never-opened');
  return [
    opened,
    never,
    await gradeDemo(opened, AT.beforeGrace),
    await gradeDemo(opened, AT.evaluated),
    await gradeDemo(never, AT.evaluated),
    await gradeDemo(never, AT.nextDay),
  ];
}

async function replayOutcome() {
  const { snapshot } = await simulate(LEDGER);
  return { snapshot, report: await replay(snapshot) };
}

async function benchOutcome(): Promise<BatchReceipt[]> {
  const { observations, grants, coverage, activity } = BENCH_WORKLOAD;
  const claims = BENCH_WORKLOAD.claims.slice(0, BENCH.claims);
  const index = createMemoryIndex(observations.slice(0, BENCH.observations), BUCKET_MINUTES);
  return gradeBatch(claims, index, grants, DEFAULT_POLICY, coverage, { ...activity, claims });
}

interface Baseline {
  readonly golden: ReadonlyMap<string, Outcome>;
  readonly demo: unknown[];
  readonly replay: Awaited<ReturnType<typeof replayOutcome>>;
  readonly bench: readonly BatchReceipt[];
  readonly text: unknown[];
}

/** Every reason the baseline's golden and bench receipts give: reason-text's input. */
function baselineReasons({ golden, bench }: Omit<Baseline, 'text'>): Reason[] {
  const receipts = [...golden.values()].flatMap((outcome) => ('receipts' in outcome ? outcome.receipts : []));
  return [...receipts, ...bench.map(({ receipt }) => receipt)].flatMap(({ reasons }) => reasons);
}

let baseline: Baseline | undefined;
let installed: Poison | undefined;

function base(): Baseline {
  if (baseline === undefined) throw new Error('core-poison: no unpoisoned baseline');
  return baseline;
}

function live(): Poison {
  if (installed === undefined) throw new Error('core-poison: the poison is not installed');
  return installed;
}

beforeAll(async () => {
  const golden = new Map<string, Outcome>();
  for (const [file, loaded] of SCENARIOS) golden.set(file, await goldenOutcome(loaded));
  const batches = {
    golden,
    demo: await demoOutcome(),
    replay: await replayOutcome(),
    bench: await benchOutcome(),
  };
  baseline = { ...batches, text: textOutcome(baselineReasons(batches)) };
}, BASELINE_HOOK_MS);

describe('src/core under the poison: the same receipts, and no impure use (Hard Rule 4)', GATE, () => {
  beforeAll(() => {
    installed = installPoison();
  });
  afterAll(() => {
    installed?.restore();
  });

  it.each(SCENARIOS.map(([file]) => file))('golden %s', async (file) => {
    const loaded = SCENARIOS.find(([name]) => name === file)?.[1];
    if (loaded === undefined) throw new Error(`no scenario ${file}`);
    expect(await goldenOutcome(loaded)).toEqual(base().golden.get(file));
    expect(live().violations).toEqual([]);
  });

  it('the §2 demo ledger, built and graded at four instants', async () => {
    expect(await demoOutcome()).toEqual(base().demo);
    expect(live().violations).toEqual([]);
  });

  it('a synthetic ledger graded batch by batch with overrides, then replayed', async () => {
    const poisoned = await replayOutcome();
    expect(poisoned).toEqual(base().replay);
    expect(poisoned.report.receipts).toBeGreaterThan(LEDGER.claims / 2);
    expect(poisoned.report.reproduced).toBe(poisoned.report.receipts);
    expect(live().violations).toEqual([]);
  });

  it('a slice of the gradeBatch bench workload', async () => {
    const poisoned = await benchOutcome();
    expect(poisoned).toEqual(base().bench);
    expect(poisoned.length).toBeGreaterThanOrEqual(BENCH.claims);
    expect(live().violations).toEqual([]);
  });

  it('relative times, the text of every reason, punycode domains and policy errors', () => {
    const reasons = baselineReasons(base());
    expect(reasons.length).toBeGreaterThan(BENCH.claims);
    const values = base().text.filter(
      (entry) => typeof entry === 'object' && entry !== null && 'value' in entry,
    );
    expect(values.filter(({ value }) => value !== null).length).toBeGreaterThan(PHRASES.length);
    expect(textOutcome(reasons)).toEqual(base().text);
    expect(live().violations).toEqual([]);
  });

  it('the poison was live: it saw src/core make its own pure calls, and nothing impure', () => {
    expect([...live().witnessed].sort()).toEqual(['Date.UTC', 'new Date(value)']);
    expect(live().violations).toEqual([]);
  });
});

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

describe('the poison is gone afterwards', GATE, () => {
  it('every property it replaced is the original again, and the core runs unpoisoned', () => {
    // The file's poison, restored by its afterAll; when that block was filtered out, one installed and restored here.
    const poison = installed ?? installPoison();
    if (installed === undefined) poison.restore();
    expect(poison.saved.length).toBeGreaterThan(40);
    for (const [target, key, before] of [...poison.saved, ...PRISTINE])
      expect(Object.getOwnPropertyDescriptor(target, key), String(key)).toEqual(before);
    expect(Object.hasOwn(globalThis, 'Temporal')).toBe(false);
    expect(new Date(0).constructor).toBe(Date);
    expect(typeof Date.now()).toBe('number');
  });
});

const NONE: [] = [];

/** One impure use each, made from this file, and the name the poison records it by. */
const IMPURE: readonly (readonly [string, () => unknown])[] = [
  ['Date.now', () => Date.now()],
  ['Date.parse', () => Date.parse('2026-01-01T00:00:00Z')],
  ['Date() called as a function', () => Date()],
  ['new Date with 0 arguments', () => new Date()],
  ['new Date with 0 arguments', () => new Date(...NONE)],
  ['new Date with 3 arguments', () => new Date(2026, 0, 1)],
  ['new Date(text without an offset)', () => new Date('2026-01-01T00:00:00')],
  ['Date.now', () => (new Date(0).constructor as DateConstructor).now()],
  ['new Date with 0 arguments', () => new (new Date(0).constructor as DateConstructor)()],
  ['Date.prototype.getHours', () => new Date(0).getHours()],
  ['Date.prototype.getTimezoneOffset', () => new Date(0).getTimezoneOffset()],
  ['Date.prototype.setDate', () => new Date(0).setDate(2)],
  ['Date.prototype.toString', () => new Date(0).toString()],
  ['Date.prototype[Symbol.toPrimitive]("string")', () => [new Date(0)].join()],
  ['Date.prototype[Symbol.toPrimitive]("string")', () => String(new Date(0))],
  ['Date.prototype[Symbol.toPrimitive]("default")', () => new Date(0)[Symbol.toPrimitive]('default')],
  ['Date.prototype.toLocaleDateString', () => new Date(0).toLocaleDateString()],
  ['Math.random', () => Math.random()],
  ['String.localeCompare', () => 'a'.localeCompare('b')],
  ['String.toLocaleUpperCase', () => 'i'.toLocaleUpperCase('tr')],
  ['Number.toLocaleString', () => (1234.5).toLocaleString()],
  ['Array.toLocaleString', () => [1].toLocaleString()],
  ['TypedArray.toLocaleString', () => new Uint8Array(1).toLocaleString()],
  ['Intl', () => Intl.DateTimeFormat],
  [
    'Temporal',
    (): unknown => {
      const temporal: unknown = Reflect.get(globalThis, 'Temporal');
      return temporal;
    },
  ],
  ['performance', () => performance.now()],
  ['crypto', () => crypto.randomUUID()],
  ['fetch', () => fetch],
  ['WebSocket', () => WebSocket],
  ['setTimeout', () => setTimeout],
  ['WeakRef', () => new WeakRef({})],
];

/** Runs every IMPURE use under a poison made with `isCore`; the names of the uses that threw a PoisonError. */
function caughtUses(isCore: (file: string) => boolean): { caught: string[]; violations: readonly string[] } {
  const caught: string[] = [];
  const poison = installPoison({ isCore });
  try {
    for (const [, use] of IMPURE) {
      try {
        use();
      } catch (error) {
        if (!(error instanceof PoisonError)) throw error;
        caught.push(error.use);
      }
    }
  } finally {
    poison.restore();
  }
  return { caught, violations: poison.violations };
}

describe('negative controls: the poison catches what it claims', GATE, () => {
  it('every impure use is caught and recorded when made from a file counted as src/core', () => {
    const { caught, violations } = caughtUses((file) => file === SPEC_FILE);
    expect(caught).toEqual(IMPURE.map(([name]) => name));
    expect(violations).toEqual(caught);
  });

  it('the same uses made by the harness get the real thing', () => {
    expect(caughtUses((file) => file.startsWith(CORE_DIR))).toEqual({ caught: [], violations: [] });
  });

  it('a real src/core call path is caught once a use it makes is declared impure, directly or through zod', () => {
    const observer = buildDemo().observers[0];
    const runs: readonly (readonly [string, () => unknown])[] = [
      ['Date.UTC', () => instantMs('2026-10-06T14:02:00-04:00')],
      ['new Date(value)', () => civilDateAt(0, 0)],
      ['Date.UTC|new Date(value)', () => ObserverCoverage.parse(observer)],
    ];
    for (const [uses, run] of runs) {
      const poison = installPoison({ forbid: uses.split('|') });
      let thrown: unknown;
      try {
        run();
      } catch (error) {
        thrown = error;
      } finally {
        poison.restore();
      }
      expect(thrown, uses).toBeInstanceOf(PoisonError);
      expect(poison.violations.length, uses).toBe(1);
      expect(uses.split('|'), uses).toContain(poison.violations[0]);
    }
  });

  it('the caller is the innermost frame outside the poison and the dependencies', () => {
    const core = path.join(CORE_DIR, 'batch.ts');
    const zod = '/repo/node_modules/zod/v4/core/parse.js';
    expect(originOf([core, SPEC_FILE])).toBe('core');
    expect(originOf(['', 'node:internal/timers', zod, core, SPEC_FILE])).toBe('core');
    expect(originOf([`file://${core}`])).toBe('core');
    expect(originOf([SPEC_FILE, core])).toBe('harness');
    expect(originOf([zod, SPEC_FILE, core])).toBe('harness');
    expect(originOf([zod, ''])).toBe('harness');
    expect(originOf([path.join(CORE_DIR, '..', 'core-extra', 'x.ts')])).toBe('harness');
    expect(originOf([])).toBe('harness');
  });
});
