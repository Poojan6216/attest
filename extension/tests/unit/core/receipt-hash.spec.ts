/**
 * Task 1.5: the input hashes are remembered per object but never stale, and `inputsHash` reads every set-like array
 * as a set (docs/grading.md §3). Split from receipt.spec.ts (file and function size limits, TECH-R6).
 */
import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256Hex } from '../../../src/core/hash';
import {
  candidatesHash,
  coverageHash,
  type GradeInputs,
  grantHash,
  inputsHash,
} from '../../../src/core/receipt';
import { Attribution, IsoTs, type Observation, Sha256 } from '../../../src/core/schema';
import { buildGrant } from '../../golden/build';
import { definedCandidatesHash, EVAL, inputs, type Mutable, O1, O2 } from './receipt-fixtures';

type MutableGrant = Mutable<GradeInputs['grant']>;
type MutableEntry = Mutable<GradeInputs['coverage']['observers'][number]>;

describe('candidatesHash is remembered per observation, never stale (§3: once per batch)', () => {
  it('refHash is remembered per observation, never stale: an observation edited in place is hashed again', () => {
    const edited: Mutable<Observation> = { ...O1 };
    const before = candidatesHash([edited, O2]);
    expect(before).toBe(definedCandidatesHash([O1, O2]));
    edited.observedAt = IsoTs.parse('2026-10-06T14:59:00-04:00');
    expect(candidatesHash([edited, O2])).toBe(definedCandidatesHash([edited, O2]));
    expect(candidatesHash([edited, O2])).not.toBe(before);
    edited.contentHash = Sha256.parse(sha256Hex('another row'));
    expect(candidatesHash([edited, O2])).toBe(definedCandidatesHash([edited, O2]));
  });
});

describe('grantHash and coverageHash are remembered per object, never stale (§3: once per batch)', () => {
  it('a grant edited in place hashes exactly like a fresh copy, edit after edit', () => {
    const grant: MutableGrant = structuredClone(inputs().grant);
    // [edit, whether it changes the grant as a set]: reordering a set-like array never changes the hash.
    const edits: (readonly [(g: MutableGrant) => void, boolean])[] = [
      [(g) => g.counterpartyAllowlist.push('raj@company.com'), true],
      [(g) => (g.declaredScopes = ['gmail.send']), true],
      [(g) => g.accounts?.['gmail.sent']?.reverse(), false],
      [(g) => g.accounts?.['gmail.sent']?.pop(), true],
      [(g) => (g.observedScopes = undefined), true],
      [(g) => (g.spendCeilingCents = 500), true],
      [(g) => (g.spendCurrency = 'USD'), true],
    ];
    let previous = grantHash(grant);
    for (const [edit, changes] of edits) {
      edit(grant);
      const hash = grantHash(grant);
      expect(hash).toBe(grantHash(structuredClone(grant)));
      expect(hash).toBe(sha256Hex(canonicalJson({ ...grant, ...sortedSets(grant) })));
      expect(hash !== previous).toBe(changes);
      previous = hash;
    }
  });

  it('a coverage whose entries are edited, added or removed in place hashes like a fresh copy', () => {
    const coverage: Mutable<GradeInputs['coverage']> = structuredClone(inputs().coverage);
    const entries: MutableEntry[] = coverage.observers;
    const [first, second] = entries;
    if (first === undefined || second === undefined) throw new Error('two entries expected');
    const edits: (() => void)[] = [
      () => (first.windowStart = IsoTs.parse('2026-10-06T11:00:00-04:00')),
      () => (second.allCalendars = true),
      () => entries.push({ ...first, observerId: 'second' }),
      () => entries.pop(),
      () => (coverage.evaluatedAt = IsoTs.parse('2026-10-06T15:30:00-04:00')),
    ];
    let previous = coverageHash(coverage);
    for (const edit of edits) {
      edit();
      const hash = coverageHash(coverage);
      expect(hash).toBe(coverageHash(structuredClone(coverage)));
      expect(hash).not.toBe(previous);
      previous = hash;
    }
  });
});

function sortedSets(grant: GradeInputs['grant']) {
  return {
    allowedTypes: [...new Set(grant.allowedTypes)].sort(),
    counterpartyAllowlist: [...new Set(grant.counterpartyAllowlist)].sort(),
    declaredScopes: [...new Set(grant.declaredScopes)].sort(),
    observedScopes:
      grant.observedScopes === undefined ? undefined : [...new Set(grant.observedScopes)].sort(),
    accounts:
      grant.accounts === undefined
        ? undefined
        : Object.fromEntries(Object.entries(grant.accounts).map(([k, v]) => [k, [...new Set(v)].sort()])),
  };
}

describe('inputsHash: set-like arrays and sensitivity (§3)', () => {
  const base = inputsHash(inputs());

  it('ignores the order and repetition of every set-like array', () => {
    const { grant, coverage, context } = inputs();
    const reversed = <T>(values: readonly T[] | undefined): T[] => [...(values ?? [])].reverse();
    const shuffled = inputs({
      candidates: [O2, O1, O2],
      grant: {
        ...grant,
        allowedTypes: reversed(grant.allowedTypes),
        counterpartyAllowlist: [...reversed(grant.counterpartyAllowlist), 'company.com'],
        declaredScopes: reversed(grant.declaredScopes),
        observedScopes: reversed(grant.observedScopes),
        accounts: { 'gmail.sent': reversed(grant.accounts?.['gmail.sent']) },
      },
      coverage: { ...coverage, observers: [...reversed(coverage.observers), ...coverage.observers] },
      context: {
        ...context,
        attribution: Attribution.parse({
          agent: 'muse',
          scoreBp: 7000,
          signals: ['agentSessionActive', 'userIdle'],
        }),
      },
    });
    expect(inputsHash(shuffled)).toBe(base);
  });

  it('changes when any input changes', () => {
    const { coverage, context } = inputs();
    const changed = [
      inputs({ claim: null }),
      inputs({ candidates: [O1] }),
      inputs({ grant: buildGrant({ agent: 'muse' }, EVAL) }),
      inputs({ policyHash: sha256Hex('another policy') }),
      inputs({ coverage: { ...coverage, evaluatedAt: IsoTs.parse('2026-10-06T15:00:01-04:00') } }),
      inputs({ coverage: { ...coverage, observers: coverage.observers.slice(1) } }),
      inputs({ context: { ...context, priorSpendCents: 1 } }),
      inputs({ context: { priorSpendCents: 0, scope: { observed: 'gmail.read' } } }),
    ];
    const hashes = new Set([base, ...changed.map(inputsHash)]);
    expect(hashes.size).toBe(changed.length + 1);
  });
});
