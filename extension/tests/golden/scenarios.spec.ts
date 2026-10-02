/**
 * The golden scenario files (docs/grading.md v1.5 §15): every file parses strictly, every ref resolves, every
 * expectation obeys the contract's emission, ordering, params, grant and event rules, together they cover the
 * mandatory list, the §2 demo, every policy rule, every ReasonCode, the hardened edge cases and the v1.2 rules
 * (the v1.3 rules: v13-rules.spec.ts; the v1.4 rules: v14-rules.spec.ts), and the loader turns each into
 * schema-valid core inputs with stable ids. checks.spec.ts proves the checks bite.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { canonicalJson, idFromHash, sha256Hex } from '../../src/core/hash';
import { loadPolicy } from '../../src/core/policy';
import * as core from '../../src/core/schema';
import { accountBindingProblems, expectationProblems, inputProblems, refProblems } from './checks';
import { claimProblems, noParserProblems } from './checks-claims';
import { eventProblems } from './checks-events';
import { allowlistUncheckedProblems, reasonParamProblems, scenarioParamProblems } from './checks-reasons';
import { formatIds, IDS_SNAPSHOT, scenarioIds } from './ids';
import {
  GOLDEN_DIR,
  loadScenario,
  PolicyView,
  readScenario,
  receiptIdFor,
  SCENARIO_FILE,
  scenarioFiles,
} from './load';
import {
  ACTION_TYPES,
  AGENT_IDS,
  GRADES,
  OBSERVATION_SOURCES,
  type ParamKind,
  REASON_CODES,
  REASON_PARAMS,
  RECEIPT_STATES,
  type Scenario,
} from './scenario-schema';
import { paramCodesAsserted, V12_RULES } from './v12-rules';

const FILES = scenarioFiles();
const SCENARIOS: readonly (readonly [string, Scenario])[] = FILES.map((file) => [file, readScenario(file)]);
const BASE_POLICY = PolicyView.parse(defaultPolicyJson);
const ROLE_FILE = path.resolve(import.meta.dirname, '../../../agents/ledger_engineer.md');
const policyOf = (file: string): PolicyView => PolicyView.parse(loadScenario(file).policyJson);

/** agents/ledger_engineer.md "Golden scenarios that must exist", in order, with the tag that proves each. */
const MANDATORY: readonly (readonly [tag: string, bullet: string])[] = [
  ['exact_match', 'Exact match, same minute → VERIFIED'],
  ['domain_partial', 'Recipient domain match, subject partial → PARTIAL'],
  ['pending_no_observation', 'No observation, grace not elapsed → PENDING'],
  ['not_found_after_grace', 'No observation, grace elapsed → NOT_FOUND'],
  ['gmail_never_synced', 'Gmail observer never synced in window → UNVERIFIABLE'],
  ['purchase_no_parser', 'Claim type `purchase.made`, no receipt parser coverage → UNVERIFIABLE'],
  ['unasked_attribution', 'Observation with no request, attribution 0.7 → UNASKED'],
  ['type_not_in_grant', 'Claim type not in Grant → OVER_SCOPE'],
  ['amount_above_ceiling', 'Amount above ceiling → OVER_SCOPE'],
  [
    'two_claims_one_observation',
    'Two claims, one observation → one VERIFIED, one NOT_FOUND (never both VERIFIED)',
  ],
  ['duplicate_observation', 'Duplicate observation (same contentHash) → counted once'],
  ['timezone_edge', 'Timezone edge: claim 23:58, observation 00:01 next day → VERIFIED'],
];

/** The edge cases the contract was hardened for (Sprint 1 golden task lists, v1.1 and v1.2). */
const REQUIRED_EDGES = [
  'free_mail_exact',
  'free_mail_domain_alone',
  'plus_tag_partial',
  'display_name_spoof',
  'confusable_dotless_i',
  'confusable_cyrillic',
  'confusable_kelvin',
  'identical_non_ascii',
  'vague_claim_orphan',
  'no_target',
  'day_precision',
  'tolerance_boundary',
  'verified_threshold_exact',
  'partial_threshold_exact',
  'assignment_tie_break',
  'fixed_pre_assignment',
  'cumulative_ceiling',
  'currency_mismatch',
  'allowlist_domain',
  'allowlist_subdomain',
  'allowlist_name_unchecked',
  'account_binding',
  'account_unbound',
  'multiple_accounts_cap',
  'calendars_hidden_cap',
  'grace_pending_partial_not_found',
  'finalize_never_completed',
  'no_source_type',
  'unasked_idle_positive_evidence',
  'per_agent_attribution',
  'scope_diff',
  'default_unverifiable',
  'identity_per_type',
  'purchase_features',
  'allowlist_from_evidence',
  'cumulative_spend_window',
  'unasked_finalised_by_time',
  'ceiling_amount_from_evidence_only',
] as const;

const tagged = (tag: string): (readonly [string, Scenario])[] =>
  SCENARIOS.filter(([, scenario]) => scenario.covers.includes(tag));

const allExpectations = SCENARIOS.flatMap(([, scenario]) => scenario.expect);

describe('golden scenario files', () => {
  it('there are at least 40, each named NN-slug.json with a unique number', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(40);
    for (const file of FILES) expect(file).toMatch(SCENARIO_FILE);
    const numbers = FILES.map((file) => file.slice(0, 2));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it.each(FILES)('%s parses with the strict scenario schema', (file) => {
    expect(() => readScenario(file)).not.toThrow();
  });

  it.each(FILES)('%s writes invisible characters as \\u escapes, never raw (README)', (file) => {
    const raw = readFileSync(path.join(GOLDEN_DIR, file), 'utf8');
    expect(raw.match(/\p{Cf}/gu) ?? []).toEqual([]);
  });

  it.each(SCENARIOS)('%s: refs resolve, one expectation per graded subject, one-to-one evidence', (_, s) => {
    expect(refProblems(s)).toEqual([]);
  });

  it.each(SCENARIOS)(
    '%s: every expectation obeys §15 emission and order and the §5.3 thresholds',
    (file, s) => {
      const policy = policyOf(file);
      expect(s.expect.flatMap((e) => expectationProblems(e, policy))).toEqual([]);
      expect(accountBindingProblems(s, policy)).toEqual([]);
      expect(allowlistUncheckedProblems(s, policy)).toEqual([]);
      expect(claimProblems(s, policy)).toEqual([]);
      expect(noParserProblems(s, policy)).toEqual([]);
      expect(eventProblems(s)).toEqual([]);
    },
  );

  it.each(SCENARIOS)('%s: asserted reason params follow the closed §15 table', (file, s) => {
    expect(s.expect.flatMap((e) => reasonParamProblems(e))).toEqual([]);
    expect(scenarioParamProblems(s, policyOf(file))).toEqual([]);
  });

  it.each(SCENARIOS)('%s: observations carry only allowlisted fields from a source of their type', (_, s) => {
    expect(inputProblems(s, BASE_POLICY)).toEqual([]);
  });

  it.each(FILES)('%s: the patched policy passes loadPolicy', (file) => {
    expect(() => loadPolicy(loadScenario(file).policyJson)).not.toThrow();
  });
});

describe('golden coverage: the mandatory list and the §2 demo', () => {
  it('agents/ledger_engineer.md still lists exactly the 12 mandatory scenarios named here', () => {
    const role = readFileSync(ROLE_FILE, 'utf8');
    const section = role.split('## Golden scenarios that must exist')[1] ?? '';
    const bullets = section.split('\n').filter((line) => line.startsWith('- '));
    expect(bullets.map((line) => line.slice(2).trim())).toEqual(MANDATORY.map(([, bullet]) => bullet));
  });

  it.each(MANDATORY)('mandatory %s has a scenario', (tag) => {
    expect(tagged(`ledger_engineer:${tag}`).length).toBeGreaterThan(0);
  });

  it('each mandatory scenario expects the outcome its bullet names', () => {
    const outcome = (tag: string): string[] =>
      tagged(`ledger_engineer:${tag}`).flatMap(([, s]) => s.expect.map((e) => `${e.grade}/${e.state}`));
    const plain: Record<string, string> = {
      exact_match: 'VERIFIED/',
      domain_partial: 'PARTIAL/',
      pending_no_observation: 'UNVERIFIABLE/PENDING',
      not_found_after_grace: 'NOT_FOUND/FINAL',
      gmail_never_synced: 'UNVERIFIABLE/',
      purchase_no_parser: 'UNVERIFIABLE/',
      unasked_attribution: 'UNASKED/',
      type_not_in_grant: 'OVER_SCOPE/',
      amount_above_ceiling: 'OVER_SCOPE/',
      timezone_edge: 'VERIFIED/',
    };
    for (const [tag, prefix] of Object.entries(plain)) {
      expect(
        outcome(tag).some((o) => o.startsWith(prefix)),
        tag,
      ).toBe(true);
    }
    const [, two] = tagged('ledger_engineer:two_claims_one_observation')[0] ?? [];
    expect(two?.expect.map((e) => e.grade).sort()).toEqual(['NOT_FOUND', 'VERIFIED']);
    const [, dup] = tagged('ledger_engineer:duplicate_observation')[0] ?? [];
    expect(dup?.assertIds?.equal?.length).toBeGreaterThan(0);
    expect(dup?.expect).toHaveLength(1);
  });

  it('the §2 demo: email VERIFIED, calendar NOT_FOUND after grace, UNASKED with two or more signals', () => {
    const [, demo] = tagged('contract:demo')[0] ?? [];
    const rules = demo?.expect.map((e) => `${e.grade}:${e.ruleId}:${e.state}`).sort();
    expect(rules).toEqual(['NOT_FOUND:not_found:FINAL', 'UNASKED:unasked:FINAL', 'VERIFIED:verified:FINAL']);
    const unasked = demo?.expect.find((e) => e.grade === 'UNASKED');
    expect(unasked?.reasonCodes.filter((c) => c.startsWith('unasked.')).length).toBeGreaterThanOrEqual(2);
    const [, variant] = tagged('contract:demo_unverifiable')[0] ?? [];
    const calendar = variant?.expect.find((e) => e.ref === 'c2');
    expect(calendar).toMatchObject({ grade: 'UNVERIFIABLE', ruleId: 'no_coverage' });
  });
});

describe('golden coverage: edge cases, rules and reason codes', () => {
  it.each(REQUIRED_EDGES)('edge case %s has a scenario', (edge) => {
    expect(tagged(`edge:${edge}`).length).toBeGreaterThan(0);
  });

  it('spoofs and confusable lookalikes are never VERIFIED', () => {
    const tags = ['display_name_spoof', 'confusable_dotless_i', 'confusable_cyrillic', 'confusable_kelvin'];
    const graded = tags.flatMap((tag) => tagged(`edge:${tag}`)).flatMap(([, s]) => s.expect);
    expect(graded.length).toBeGreaterThan(0);
    for (const e of graded) expect(e.grade).not.toBe('VERIFIED');
  });

  it('a vague claim is UNVERIFIABLE and its observation comes back as an orphan', () => {
    const [, vague] = tagged('edge:vague_claim_orphan')[0] ?? [];
    expect(vague?.expect.map((e) => e.ruleId).sort()).toEqual(['unasked', 'underspecified']);
  });

  it('policy/default.json is v2 and every rule in it, plus default_unverifiable, fires somewhere', () => {
    expect(BASE_POLICY.version).toBe(2);
    const fired = new Set(allExpectations.map((e) => e.ruleId));
    for (const rule of [...BASE_POLICY.rules.map((r) => r.id), 'default_unverifiable']) {
      expect(fired.has(rule), rule).toBe(true);
    }
    expect(BASE_POLICY.rules).toHaveLength(14);
  });

  it('every ReasonCode is emitted by some scenario', () => {
    const emitted = new Set(allExpectations.flatMap((e) => e.reasonCodes));
    for (const code of REASON_CODES) expect(emitted.has(code), code).toBe(true);
  });

  it('every grade, every state and both modes appear', () => {
    expect(new Set(allExpectations.map((e) => e.grade))).toEqual(new Set(GRADES));
    expect(new Set(allExpectations.map((e) => e.state))).toEqual(new Set(RECEIPT_STATES));
    expect(new Set(SCENARIOS.map(([, s]) => s.mode))).toEqual(new Set(['batch', 'grade']));
  });

  it('the scenario enums are the contract enums in src/core/schema.ts, in the same order', () => {
    expect(core.ReasonCode.options).toEqual([...REASON_CODES]);
    expect(core.ActionType.options).toEqual([...ACTION_TYPES]);
    expect(core.AgentId.options).toEqual([...AGENT_IDS]);
    expect(core.ObservationSource.options).toEqual([...OBSERVATION_SOURCES]);
    expect(core.Grade.options).toEqual([...GRADES]);
    expect(core.ReceiptState.options).toEqual([...RECEIPT_STATES]);
  });
});

describe('golden coverage: the contract v1.2 rules', () => {
  it.each(V12_RULES)('contract:%s has a scenario that exercises it', (tag, proves) => {
    const files = tagged(`contract:${tag}`);
    expect(files.length, tag).toBeGreaterThan(0);
    expect(files.some(([file, s]) => proves(s, policyOf(file)))).toBe(true);
  });

  it('every reason code that carries params has them asserted (scopeHash included, v1.3)', () => {
    expect(paramCodesAsserted(SCENARIOS.map(([, s]) => s))).toEqual([]);
  });

  it('the golden §15 params table is the one src/core/schema.ts enforces, code by code', () => {
    const sample: Readonly<Record<ParamKind, string | number>> = {
      observationRef: idFromHash(sha256Hex('o')),
      claimRef: idFromHash(sha256Hex('c')),
      source: 'gmail.sent',
      actionType: 'email.sent',
      cents: 1,
      currency: 'USD',
      scopeHash: sha256Hex('gmail.read'),
      agent: 'muse',
      grade: 'VERIFIED',
    };
    for (const code of REASON_CODES) {
      const params = Object.fromEntries(
        Object.entries(REASON_PARAMS[code]).map(([name, kind]) => [name, sample[kind]]),
      );
      expect(core.Reason.safeParse({ code, params }).success, code).toBe(true);
      expect(core.Reason.safeParse({ code, params: { ...params, extra: 1 } }).success, code).toBe(false);
    }
  });
});

describe('golden loader', () => {
  it.each(FILES)('%s builds schema-valid core inputs and reasons', (file) => {
    const s = loadScenario(file);
    for (const claim of s.claims.values()) expect(core.Claim.safeParse(claim).success).toBe(true);
    for (const obs of s.observations.values()) expect(core.Observation.safeParse(obs).success).toBe(true);
    for (const grant of s.grants) expect(core.Grant.safeParse(grant).success).toBe(true);
    expect(core.Coverage.safeParse(s.coverage).success).toBe(true);
    expect(core.Activity.safeParse(s.activity).success).toBe(true);
    if (s.gradeCall !== undefined)
      expect(core.GradeContext.safeParse(s.gradeCall.context).success).toBe(true);
    for (const e of s.expected) {
      expect(core.Ulid.safeParse(e.receiptId).success).toBe(true);
      expect(e.reasons?.map((reason) => reason.code) ?? e.expected.reasonCodes).toEqual(
        e.expected.reasonCodes,
      );
      for (const reason of e.reasons ?? []) expect(core.Reason.safeParse(reason).success).toBe(true);
    }
  });

  it.each(SCENARIOS)(
    '%s: distinct refs get distinct ids except where assertIds says otherwise',
    (file, s) => {
      const loaded = loadScenario(file);
      const id = (ref: string): string =>
        (ref.startsWith('c') ? loaded.claims.get(ref)?.id : loaded.observations.get(ref)?.id) ?? '';
      for (const [a, b] of s.assertIds?.equal ?? []) expect(id(a)).toBe(id(b));
      for (const [a, b] of s.assertIds?.ascending ?? []) expect(id(a) < id(b), `${a} < ${b}`).toBe(true);
      const same = new Set((s.assertIds?.equal ?? []).map(([a, b]) => `${a}|${b}`));
      const refs = [...loaded.claims.keys(), ...loaded.observations.keys()];
      for (const a of refs) {
        for (const b of refs)
          if (a < b && !same.has(`${a}|${b}`)) expect(id(a), `${a} vs ${b}`).not.toBe(id(b));
      }
    },
  );

  it('receipt ids derive from the subject exactly as §3 says', () => {
    const subject = { k: 'claim', claimId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } as const;
    expect(receiptIdFor(subject)).toBe(idFromHash(sha256Hex(canonicalJson(subject))));
  });

  it('loading is deterministic and __snapshots__/ids.json is exactly what write-ids.ts writes', () => {
    const ids = scenarioIds();
    expect(scenarioIds()).toEqual(ids);
    // On a mismatch: run `pnpm exec tsx tests/golden/write-ids.ts` and review the diff (README, step 5).
    expect(readFileSync(IDS_SNAPSHOT, 'utf8')).toBe(formatIds(ids));
  });
});
