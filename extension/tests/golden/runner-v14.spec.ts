/**
 * The v1.4 parts of the golden runner are themselves tested (docs/grading.md §3, §8 v1.4): the inputs gradeBatch
 * returns are checked on every receipt (policy hash, grant in force, context shape, replay through `grade`), the
 * inputs a scenario states are compared, `regrade` events install a later grading and move computedAt, and a
 * `rejected` event must be refused. Each check is shown to report a broken run or a broken expectation.
 */
import { describe, expect, it } from 'vitest';

import { IsoTs, type Receipt } from '../../src/core/schema';
import {
  type BuiltEvent,
  type LoadedScenario,
  loadScenario,
  type ResolvedExpect,
  type ResolvedInputs,
} from './load';
import { runScenario, type ScenarioRun } from './runner';
import { diffScenario } from './runner-diff';
import { type Graded, type Pass, passProblems } from './runner-inputs';

const load = (prefix: string): LoadedScenario => {
  const files: Record<string, string> = {
    '87': '87-scope-diff-inputs.json',
    '88': '88-claim-after-evaluated-ignored.json',
    '89': '89-grant-latest-updated-at.json',
    '93': '93-regrade-and-override-events.json',
    '94': '94-unasked-regrade-supersede.json',
  };
  return loadScenario(files[prefix] ?? '');
};

async function loadAndRun(prefix: string): Promise<readonly [LoadedScenario, ScenarioRun]> {
  const loaded = load(prefix);
  return [loaded, await runScenario(loaded)] as const;
}

/** The scenario with its expectation for `ref` (or scope) stating other inputs. */
function withInputs(loaded: LoadedScenario, ref: string, inputs: ResolvedInputs): LoadedScenario {
  const expected = loaded.expected.map((entry): ResolvedExpect =>
    entry.expected.ref === ref || entry.expected.scope?.scope === ref ? { ...entry, inputs } : entry,
  );
  return { ...loaded, expected };
}

/** The scenario with event `index` changed. */
function withEvent(loaded: LoadedScenario, index: number, change: (event: BuiltEvent) => BuiltEvent) {
  return { ...loaded, events: loaded.events.map((event, i) => (i === index ? change(event) : event)) };
}

/** The first pass with the entries `which` selects changed (a broken gradeBatch's output). */
function tampered(
  run: ScenarioRun,
  which: (entry: Graded) => boolean,
  change: (entry: Graded) => Graded,
): Pass {
  const [first] = run.passes;
  if (first === undefined) throw new Error('a run has a first pass');
  return { ...first, entries: first.entries.map((entry) => (which(entry) ? change(entry) : entry)) };
}

const isClaim = (entry: Graded): boolean => entry.receipt.claimId !== undefined;
const isUnasked = (entry: Graded): boolean => entry.receipt.grade === 'UNASKED';

const name = (id: string): string => id;

describe('the runner checks the inputs gradeBatch returns (§3 v1.4)', () => {
  it('passes the unmodified runs', async () => {
    for (const prefix of ['87', '88', '89', '93', '94']) {
      const [loaded, run] = await loadAndRun(prefix);
      expect(diffScenario(loaded, run), prefix).toEqual([]);
    }
  });

  it('reports a wrong policy hash, a grant not in force, a wrong context and a receipt replay does not give', async () => {
    const [loaded, run] = await loadAndRun('89');
    const problems = async (pass: Pass) => (await passProblems(loaded, run.policy, pass, name)).join('\n');
    const policyHash = tampered(run, isClaim, (e) => ({
      ...e,
      inputs: { ...e.inputs, policyHash: e.receipt.inputsHash },
    }));
    expect(await problems(policyHash)).toContain('policyHash');
    const stale = loaded.grantRefs.get('g3');
    if (stale === undefined) throw new Error('89 has g3');
    const oldGrant = tampered(run, isClaim, (e) => ({ ...e, inputs: { ...e.inputs, grant: stale } }));
    expect(await problems(oldGrant)).toContain("muse's grant in force");
    const spend = tampered(run, isClaim, (e) => ({
      ...e,
      inputs: { ...e.inputs, context: { ...e.inputs.context, priorSpendCents: 1 } },
    }));
    expect(await problems(spend)).toContain('does not give back the receipt');
    const scoped = tampered(run, isClaim, (e) => ({
      ...e,
      inputs: { ...e.inputs, context: { priorSpendCents: 0, scope: { observed: 'gmail.read' } } },
    }));
    expect(await problems(scoped)).toContain('context.scope');
  });

  it('reports an UNASKED context without the attributed agent', async () => {
    const [loaded, run] = await loadAndRun('88');
    const bare = tampered(run, isUnasked, (e) => ({
      ...e,
      inputs: { ...e.inputs, context: { priorSpendCents: 0 } },
    }));
    const lines = (await passProblems(loaded, run.policy, bare, name)).join('\n');
    expect(lines).toContain("attributed agent's attribution");
  });

  it('compares the stated inputs: the grant, priorSpendCents and the observed scope', async () => {
    const [scope, scopeRun] = await loadAndRun('87');
    const g2 = scope.grantRefs.get('g2');
    if (g2 === undefined) throw new Error('87 has g2');
    expect(
      diffScenario(withInputs(scope, 'gmail.send', { grant: g2, scope: 'gmail.send' }), scopeRun).join(),
    ).toContain('inputs.grant: expected "chatgpt grant of');
    expect(diffScenario(withInputs(scope, 'gmail.send', { scope: 'gmail.read' }), scopeRun).join()).toContain(
      'inputs.scope: expected "gmail.read", got "gmail.send"',
    );
    const [spend, spendRun] = await loadAndRun('88');
    expect(diffScenario(withInputs(spend, 'c2', { priorSpendCents: 4000 }), spendRun).join()).toContain(
      'inputs.priorSpendCents: expected 4000, got 0',
    );
  });
});

describe('the runner applies v1.4 events (§8)', () => {
  it('reports a rejected event that applies and an applied event that throws', async () => {
    const loaded = load('93');
    const stale = withEvent(loaded, 0, (event) => ({ ...event, rejected: false }));
    expect((await runScenario(stale)).problems.join()).toContain(
      'event 1 (regrade c1): IllegalTransitionError',
    );
    const refused = withEvent(loaded, 4, (event) => ({ ...event, rejected: true }));
    expect((await runScenario(refused)).problems.join()).toContain(
      'event 5 (override c1): expected IllegalTransitionError, but the event was applied',
    );
  });

  it('reports a regrade with no receipt unless the PENDING UNASKED is deleted', async () => {
    const loaded = load('94');
    const kept = withEvent(loaded, 1, (event) =>
      event.event === 'regrade' ? { ...event, deleted: false } : event,
    );
    expect((await runScenario(kept)).problems.join()).toContain(
      'the grading returns no receipt for this subject',
    );
    const claimDeleted = withEvent(load('93'), 1, (event) =>
      event.event === 'regrade' ? { ...event, deleted: true } : event,
    );
    expect((await runScenario(claimDeleted)).problems.join()).toContain(
      'expected no receipt for this subject',
    );
  });

  it('expects computedAt and finalAt from the regrade that produced the receipt', async () => {
    const [loaded, run] = await loadAndRun('93');
    const id = loaded.expected[0]?.receiptId;
    const first = IsoTs.parse('2026-10-06T14:25:00-04:00');
    const receipts = run.receipts.map((r): Receipt => (r.id === id ? { ...r, computedAt: first } : r));
    expect(diffScenario(loaded, { ...run, receipts }).join()).toContain(
      'c1 computedAt: expected "2026-10-06T14:45:00-04:00", got "2026-10-06T14:25:00-04:00"',
    );
    const noFinal = run.receipts.map((r): Receipt => (r.id === id ? { ...r, finalAt: undefined } : r));
    expect(diffScenario(loaded, { ...run, receipts: noFinal }).join()).toContain('c1 finalAt: expected');
  });
});
