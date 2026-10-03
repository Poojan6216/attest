/**
 * Negative controls for the runtime guard (./core-poison.ts; Hard Rule 4; PI-1 to PI-4, FR3-1, FR3-3): every
 * poisoned use is caught when made from a file counted as src/core and passes through from the harness; a real
 * src/core call path, called directly or through zod, is caught once a use it makes is declared impure; the caller is
 * read from the stack as the file comment of ./core-poison.ts says; a module counted as src/core that captures a
 * built-in when it loads is still caught when it calls it, and a use it makes while loading is recorded even when it
 * swallows the error (FR3-1); and a module counted as src/core cannot blind the guard by replacing the stack API or
 * the string methods it compares file names with, while every built-in it changed is reported (FR3-3).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { civilDateAt, instantMs } from '../../../src/core/normalize-time';
import { ObserverCoverage } from '../../../src/core/schema';
import { CORE_DIR, installPoison, originOf, PoisonError, POISONED_GLOBALS } from './core-poison';
import { intrinsicChanges, snapshotIntrinsics, standingOf } from './core-poison-intrinsics';
import { buildDemo } from './demo-ledger';

const SPEC_FILE = fileURLToPath(import.meta.url);
const FIXTURE_FILE = path.join(import.meta.dirname, 'core-poison-fixture.ts');
const GATE = { tags: ['gate'] };

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

/** What `run` threw, or undefined. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
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

  it('nothing is checked while the guard is disarmed, and everything again once it is armed', () => {
    const poison = installPoison({ isCore: (file) => file === SPEC_FILE });
    try {
      poison.disarm();
      expect(typeof Date.now()).toBe('number');
      poison.arm();
      expect(thrownBy(() => Date.now())).toBeInstanceOf(PoisonError);
    } finally {
      poison.restore();
    }
    expect(poison.violations).toEqual(['Date.now']);
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
        thrown = thrownBy(run);
      } finally {
        poison.restore();
      }
      expect(thrown, uses).toBeInstanceOf(PoisonError);
      expect(poison.violations.length, uses).toBe(1);
      expect(uses.split('|'), uses).toContain(poison.violations[0]);
    }
  });
});

describe('negative controls: the switches and the caller', GATE, () => {
  it('without noting pure uses (the poisoned run), a forbidden one is still caught and nothing is noted', () => {
    const poison = installPoison({ witness: false, forbid: ['Date.UTC'] });
    let thrown: unknown;
    try {
      expect(civilDateAt(0, 0)).toBeDefined();
      thrown = thrownBy(() => instantMs('2026-10-06T14:02:00-04:00'));
    } finally {
      poison.restore();
    }
    expect(thrown).toBeInstanceOf(PoisonError);
    expect([...poison.witnessed]).toEqual([]);
    expect(poison.violations).toEqual(['Date.UTC']);
  });

  it('with offsetParse (the poisoned run), Date.parse of an ISO timestamp with an offset passes and any other is caught', () => {
    const poison = installPoison({ isCore: (file) => file === SPEC_FILE, offsetParse: true });
    const caught: unknown[] = [];
    try {
      expect(Date.parse('2026-01-01T00:00:00.000Z')).toBe(Date.UTC(2026, 0, 1));
      expect(Date.parse('2026-01-01T05:30:00+05:30')).toBe(Date.UTC(2026, 0, 1));
      for (const text of ['2026-01-01T00:00:00', '2026-01-01', '2026-01-01T00:00:00.1234Z', 'Jan 1 2026'])
        caught.push(thrownBy(() => Date.parse(text)));
    } finally {
      poison.restore();
    }
    for (const error of caught) expect(error).toBeInstanceOf(PoisonError);
    expect(poison.violations).toEqual(['Date.parse', 'Date.parse', 'Date.parse', 'Date.parse']);
  });

  it('the caller is the innermost frame outside the poison and the dependencies; a runner frame is the harness', () => {
    const core = path.join(CORE_DIR, 'batch.ts');
    const zod = '/repo/node_modules/zod/v4/core/parse.js';
    const runner = '/repo/node_modules/.pnpm/vitest@5/node_modules/vitest/dist/chunks/index.js';
    expect(originOf([core, SPEC_FILE])).toBe('core');
    expect(originOf(['', 'node:internal/timers', zod, core, SPEC_FILE])).toBe('core');
    expect(originOf([`file://${core}`])).toBe('core');
    expect(originOf([SPEC_FILE, core])).toBe('harness');
    expect(originOf([zod, SPEC_FILE, core])).toBe('harness');
    expect(originOf([zod, ''])).toBe('harness');
    expect(originOf([runner, core])).toBe('harness');
    expect(originOf([path.join(CORE_DIR, '..', 'core-extra', 'x.ts')])).toBe('harness');
    expect(originOf([])).toBe('harness');
  });
});

describe(
  'negative controls: a module counted as src/core, loaded under the guard (FR3-1, FR3-3)',
  GATE,
  () => {
    it('built-ins it captured when it loaded are still caught when it calls them, and its load-time use is recorded', async () => {
      const poison = installPoison({ isCore: (file) => file === FIXTURE_FILE });
      try {
        const fixture = await import('./core-poison-fixture');
        expect(fixture.LOADED_AT).toBe(-1);
        expect(poison.violations).toEqual(['Date.now']);
        expect(thrownBy(() => fixture.capturedClock())).toBeInstanceOf(PoisonError);
        expect(thrownBy(() => fixture.capturedOffset(0))).toBeInstanceOf(PoisonError);
      } finally {
        poison.restore();
      }
      expect(poison.violations).toEqual(['Date.now', 'Date.now', 'Date.prototype.getTimezoneOffset']);
    });

    it('it cannot blind the guard, and every built-in it changed is reported', async () => {
      const fixture = await import('./core-poison-fixture');
      const blinded = [
        [Error, 'captureStackTrace'],
        [Error, 'prepareStackTrace'],
        [Error, 'stackTraceLimit'],
        [String.prototype, 'startsWith'],
        [String.prototype, 'includes'],
        [Array.prototype, 'probe'],
      ] as const;
      const saved = blinded.map(
        ([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)] as const,
      );
      const poison = installPoison({ isCore: (file) => file === FIXTURE_FILE });
      const before = snapshotIntrinsics(POISONED_GLOBALS);
      const seen: { thrown?: unknown } = {};
      const changes: string[] = [];
      try {
        fixture.blindTheGuard();
        seen.thrown = thrownBy(() => fixture.liveClock());
        changes.push(...intrinsicChanges(before));
      } finally {
        for (const [target, key, descriptor] of saved) {
          if (descriptor === undefined) Reflect.deleteProperty(target, key);
          else Object.defineProperty(target, key, descriptor);
        }
        poison.restore();
      }
      expect(seen.thrown).toBeInstanceOf(PoisonError);
      expect(poison.violations).toEqual(['Date.now']);
      expect(changes.sort()).toEqual(
        [
          'Error.captureStackTrace changed',
          'Error.prepareStackTrace changed',
          'Error.stackTraceLimit changed',
          'String.prototype.startsWith changed',
          'String.prototype.includes changed',
          'Array.prototype.probe added',
        ].sort(),
      );
    });
  },
);

/** Wraps a function in one more frame of code compiled as a Node internal (`node:…`, a frame the guard skips). */
const wrapDeep = vm.runInThisContext(
  '(function wrap(inner) { return function deep() { return inner(); }; })',
  { filename: 'node:attest-deep-chain' },
) as (inner: () => number) => () => number;

describe('negative controls: the caller deep under frames that decide nothing', GATE, () => {
  it('a call src/core makes through a chain deeper than the first frames read is still caught', async () => {
    const fixture = await import('./core-poison-fixture');
    const poison = installPoison({ isCore: (file) => file === FIXTURE_FILE });
    let thrown: unknown;
    try {
      thrown = thrownBy(() => fixture.clockThrough(wrapDeep, 40));
    } finally {
      poison.restore();
    }
    expect(thrown).toBeInstanceOf(PoisonError);
    expect(poison.violations).toEqual(['Date.now']);
  });
});

describe('negative controls: the snapshot of the built-ins (FR3-3)', GATE, () => {
  it('control: the snapshot sees no change when nothing changed, and each kind of change when one is made', () => {
    const before = snapshotIntrinsics(POISONED_GLOBALS);
    expect(intrinsicChanges(before)).toEqual([]);
    const prototype: unknown = Object.getPrototypeOf(Uint8Array.prototype);
    try {
      Object.setPrototypeOf(Uint8Array.prototype, null);
      expect(intrinsicChanges(before)).toEqual(['Uint8Array.prototype re-parented']);
    } finally {
      Object.setPrototypeOf(Uint8Array.prototype, prototype as object);
    }
    const probe = { kept: 1, gone: 2, changed: 3 };
    const standing = [standingOf('probe', probe)];
    Reflect.deleteProperty(probe, 'gone');
    probe.changed = 4;
    Object.preventExtensions(probe);
    expect(intrinsicChanges(standing)).toEqual([
      'probe.changed changed',
      'probe.gone removed',
      'probe made non-extensible',
    ]);
    const globals = snapshotIntrinsics(['probeGlobal']);
    Reflect.set(globalThis, 'probeGlobal', 1);
    try {
      expect(intrinsicChanges(globals)).toEqual(['globalThis.probeGlobal added']);
    } finally {
      Reflect.deleteProperty(globalThis, 'probeGlobal');
    }
  });
});
