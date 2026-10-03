/**
 * Policy v2, malformed documents (2/2): set-like lists, rules, unasked and allowlisted fields
 * (docs/grading.md §6.1, §7, §11, §12), plus the loader's properties. Every case lists the full expected
 * issues, each naming its path. Windows, weights and per-type maps: policy-errors.spec.ts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import policyJson from '../../../../policy/default.json';
import { loadPolicy, PolicyError } from '../../../src/core/policy';
import { ActionType } from '../../../src/core/schema';

type Segment = string | number;
type Edit = readonly [path: readonly Segment[], value: unknown];

const REMOVE = Symbol('remove');

/** A copy of the shipped policy with each edit applied (REMOVE deletes the key). */
function edited(...edits: readonly Edit[]): unknown {
  const doc: unknown = structuredClone(policyJson);
  for (const [path, value] of edits) {
    let parent = doc as Record<Segment, unknown>;
    for (const segment of path.slice(0, -1)) parent = parent[segment] as Record<Segment, unknown>;
    const last = path.at(-1);
    if (last === undefined) throw new Error('an edit needs a path');
    if (value === REMOVE) Reflect.deleteProperty(parent, last);
    else parent[last] = value;
  }
  return doc;
}

function issuesOf(raw: unknown): readonly string[] {
  try {
    loadPolicy(raw);
  } catch (error) {
    if (error instanceof PolicyError) return error.issues;
    throw error;
  }
  throw new Error('expected loadPolicy to throw a PolicyError');
}

const quoted = (values: readonly string[]): string => values.map((v) => JSON.stringify(v)).join(', ');
const MULTIPLE = 'must be a multiple of 0.0001';
const DOMAIN = 'must be a lowercase ASCII domain name';
const MERCHANT =
  'must be a normalised merchant name (its own name(): lowercase, trimmed, single-spaced, folded)';
const STOP_WORD = 'must be one lowercase token of letters, digits and marks (NFKC)';
const PENDING_ONLY = 'PENDING is allowed only on the rule with id "pending"';
const SIGNATURE = 'must contain a letter or digit';
const LONG_ID = `r${'_x'.repeat(32)}`;

type Case = readonly [name: string, edits: readonly Edit[], expected: readonly string[]];
const one = (name: string, path: readonly Segment[], value: unknown, ...expected: string[]): Case => [
  name,
  [[path, value]],
  expected,
];

const LIST_CASES: readonly Case[] = [
  one(
    'allowlist type not an ActionType',
    ['allowlistTypes', 0],
    'email.received',
    `allowlistTypes[0]: must be one of ${quoted(ActionType.options)}`,
  ),
  one(
    'spend type not an ActionType',
    ['spendTypes', 1],
    'refund',
    `spendTypes[1]: must be one of ${quoted(ActionType.options)}`,
  ),
  one(
    'duplicate spend type',
    ['spendTypes', 1],
    'purchase.made',
    'spendTypes[1]: duplicate "purchase.made" (first at [0])',
  ),
  one('uppercase common domain', ['commonDomains', 0], 'Gmail.com', `commonDomains[0]: ${DOMAIN}`),
  one('non-ASCII common domain', ['commonDomains', 1], 'googlem\u0430il.com', `commonDomains[1]: ${DOMAIN}`),
  one('single-label common domain', ['commonDomains', 2], 'localhost', `commonDomains[2]: ${DOMAIN}`),
  one('label starting with a hyphen', ['commonDomains', 3], '-hotmail.com', `commonDomains[3]: ${DOMAIN}`),
  one('IPv4 literal as a common domain', ['commonDomains', 5], '127.0.0.1', `commonDomains[5]: ${DOMAIN}`),
  one(
    'duplicate common domain',
    ['commonDomains', 4],
    'gmail.com',
    'commonDomains[4]: duplicate "gmail.com" (first at [0])',
  ),
  one('merchant not lowercase', ['receiptMerchants'], ['Amazon'], `receiptMerchants[0]: ${MERCHANT}`),
  one('merchant with padding', ['receiptMerchants'], ['acme', ' amazon'], `receiptMerchants[1]: ${MERCHANT}`),
  one(
    'merchant with a double space',
    ['receiptMerchants'],
    ['amazon  books'],
    `receiptMerchants[0]: ${MERCHANT}`,
  ),
  one(
    'merchant with a zero-width space',
    ['receiptMerchants'],
    ['ama\u200Bzon'],
    `receiptMerchants[0]: ${MERCHANT}`,
  ),
  // §6.1 v1.2: a purchase is covered only when name(counterparty) is listed, so an entry name() would change
  // could never match: a diacritic name() folds, a fullwidth name NFKC folds, a superscript name() does not read.
  one('merchant with a diacritic', ['receiptMerchants'], ['caf\u00E9'], `receiptMerchants[0]: ${MERCHANT}`),
  one('merchant in fullwidth', ['receiptMerchants'], ['\uFF41cme'], `receiptMerchants[0]: ${MERCHANT}`),
  one(
    'merchant with a superscript',
    ['receiptMerchants'],
    ['acme\u00B2'],
    `receiptMerchants[0]: ${MERCHANT}`,
  ),
  one(
    'duplicate merchant',
    ['receiptMerchants'],
    ['acme', 'acme'],
    'receiptMerchants[1]: duplicate "acme" (first at [0])',
  ),
  one(
    'stop word with a capital',
    ['normalize', 'stopWords', 2],
    'The',
    `normalize.stopWords[2]: ${STOP_WORD}`,
  ),
  one(
    'stop word of two tokens',
    ['normalize', 'stopWords', 0],
    'a b',
    `normalize.stopWords[0]: ${STOP_WORD}`,
  ),
  one(
    'stop word not NFKC (ligature)',
    ['normalize', 'stopWords', 3],
    '\uFB01',
    `normalize.stopWords[3]: ${STOP_WORD}`,
  ),
  one(
    'stop word not NFKC (fullwidth)',
    ['normalize', 'stopWords', 4],
    '\uFF4F\uFF46',
    `normalize.stopWords[4]: ${STOP_WORD}`,
  ),
  one(
    'duplicate stop word',
    ['normalize', 'stopWords', 1],
    'a',
    'normalize.stopWords[1]: duplicate "a" (first at [0])',
  ),
  one('missing stop words', ['normalize', 'stopWords'], REMOVE, 'normalize.stopWords: is required'),
  // §11 v1.2: subjects lose zero-width marks before they are split, so a stop word holding one never matches.
  one(
    'stop word holding a combining grapheme joiner',
    ['normalize', 'stopWords', 5],
    'o\u034Ff',
    `normalize.stopWords[5]: ${STOP_WORD}`,
  ),
];

const RULE_CASES: readonly Case[] = [
  one(
    'unknown coverage level',
    ['rules', 8, 'when', 'coverage'],
    'some',
    'rules[8].when.coverage: must be one of "none", "partial", "full"',
  ),
  one(
    'flag condition as a string',
    ['rules', 3, 'when', 'counterpartyNotAllowed'],
    'yes',
    'rules[3].when.counterpartyNotAllowed: expected boolean, got string',
  ),
  one(
    'unknown condition',
    ['rules', 0, 'when', 'unaskedMaybe'],
    true,
    'rules[0].when.unaskedMaybe: unknown key',
  ),
  one('empty when', ['rules', 11, 'when'], {}, 'rules[11].when: must name at least one condition'),
  one(
    'duplicate rule id',
    ['rules', 10, 'id'],
    'verified',
    'rules[10].id: duplicate rule id "verified" (first used at rules[9])',
  ),
  one(
    'terminal rule id in the policy',
    ['rules', 13, 'id'],
    'default_unverifiable',
    'rules[13].id: is reserved for the terminal rule',
  ),
  one(
    'rule id not snake_case',
    ['rules', 8, 'id'],
    'No Coverage',
    'rules[8].id: expected a snake_case rule id',
  ),
  one(
    'rule id longer than a receipt ruleId',
    ['rules', 0, 'id'],
    LONG_ID,
    'rules[0].id: must have at most 64 characters',
  ),
  one(
    'unknown outcome',
    ['rules', 9, 'then'],
    'MAYBE',
    'rules[9].then: must be one of "VERIFIED", "PARTIAL", "NOT_FOUND", "UNASKED", "OVER_SCOPE", "UNVERIFIABLE", "PENDING"',
  ),
  one(
    'unknown threshold name',
    ['rules', 9, 'when', 'bestScoreGte'],
    'certain',
    'rules[9].when.bestScoreGte: must be one of "verified", "partial"',
  ),
  one('no rules', ['rules'], [], 'rules: must not be empty'),
  // §5.3 v1.2: a rule may conclude PENDING only if its id is `pending`.
  one('PENDING on another rule', ['rules', 12, 'then'], 'PENDING', `rules[12].then: ${PENDING_ONLY}`),
  one('the pending rule renamed', ['rules', 11, 'id'], 'waiting', `rules[11].then: ${PENDING_ONLY}`),
];

const UNASKED_AND_FIELD_CASES: readonly Case[] = [
  one(
    'fractional unasked window',
    ['unasked', 'windows', 'sessionMin'],
    2.5,
    'unasked.windows.sessionMin: must be an integer',
  ),
  one(
    'unasked window past 2^53 ms',
    ['unasked', 'windows', 'adjacentMin'],
    150_119_987_580,
    'unasked.windows.adjacentMin: must be <= 150119987579',
  ),
  one(
    'missing unasked window',
    ['unasked', 'windows', 'idleMin'],
    REMOVE,
    'unasked.windows.idleMin: is required',
  ),
  one(
    'agent missing from signatures',
    ['unasked', 'signatures', 'dots'],
    REMOVE,
    'unasked.signatures.dots: is required',
  ),
  one(
    'unknown agent in signatures',
    ['unasked', 'signatures', 'gemini'],
    [],
    'unasked.signatures.gemini: unknown key',
  ),
  one('empty signature', ['unasked', 'signatures', 'muse'], [''], `unasked.signatures.muse[0]: ${SIGNATURE}`),
  one(
    'whitespace signature',
    ['unasked', 'signatures', 'claude'],
    ['via', ' \u2014 '],
    `unasked.signatures.claude[1]: ${SIGNATURE}`,
  ),
  one(
    'duplicate signature',
    ['unasked', 'signatures', 'chatgpt'],
    ['gpt', 'gpt'],
    'unasked.signatures.chatgpt[1]: duplicate "gpt" (first at [0])',
  ),
  one('unknown signal', ['unasked', 'signals', 'mouseMoved'], 0.1, 'unasked.signals.mouseMoved: unknown key'),
  one('missing signal', ['unasked', 'signals', 'userIdle'], REMOVE, 'unasked.signals.userIdle: is required'),
  one(
    'allowlisted field not an Observation field',
    ['allowlistedFields', 'gmail.sent', 1],
    'body',
    'allowlistedFields["gmail.sent"][1]: must be a content field, rowKeyHash or contentHash',
  ),
  one(
    'duplicate allowlisted field',
    ['allowlistedFields', 'gcal.event', 2],
    'rowKeyHash',
    'allowlistedFields["gcal.event"][3]: duplicate "rowKeyHash" (first at [2])',
  ),
  one(
    'empty allowlist',
    ['allowlistedFields', 'gmail.receipt'],
    [],
    'allowlistedFields["gmail.receipt"]: must list "occurredAt"',
  ),
  one(
    'unknown allowlist source',
    ['allowlistedFields', 'gmail.draft'],
    ['subjectHint'],
    'allowlistedFields["gmail.draft"]: unknown key',
  ),
  one('version 0', ['version'], 0, 'version: must be >= 1'),
  one('extra top-level key', ['extra'], true, 'extra: unknown key'),
];

const CASES = [...LIST_CASES, ...RULE_CASES, ...UNASKED_AND_FIELD_CASES];

describe('loadPolicy: malformed lists, rules, unasked and fields name their paths', () => {
  it.each(CASES)('%s', (_name, edits, expected) => {
    expect(issuesOf(edited(...edits))).toEqual(expected);
  });

  it('the table has distinct cases and touches every list/rule/unasked/field key', () => {
    expect(new Set(CASES.map(([name]) => name)).size).toBe(CASES.length);
    expect(new Set(CASES.flatMap(([, , expected]) => expected)).size).toBeGreaterThanOrEqual(15);
    const touched = new Set(CASES.flatMap(([, edits]) => edits.map(([path]) => path.slice(0, 2).join('.'))));
    for (const key of [
      'allowlistTypes.0',
      'spendTypes.1',
      'commonDomains.0',
      'receiptMerchants',
      'normalize.stopWords',
      'rules.8',
      'rules.3',
      'rules.11',
      'rules.12',
      'unasked.windows',
      'unasked.signatures',
      'allowlistedFields.gmail.sent',
    ]) {
      expect(
        [...touched].some((path) => path.startsWith(key)),
        key,
      ).toBe(true);
    }
  });

  it('a stop word with a combining mark loads (subject tokens keep marks), and pending may conclude otherwise', () => {
    // "İ" lowercases to i + U+0307, which NFKC cannot compose: one subject token, so one stop word.
    const stopWords = [...policyJson.normalize.stopWords, 'i\u0307stanbul'];
    expect(loadPolicy(edited([['normalize', 'stopWords'], stopWords])).normalize.stopWords).toEqual(
      stopWords,
    );
    expect(loadPolicy(edited([['rules', 11, 'then'], 'UNVERIFIABLE'])).rules[11]?.then).toBe('UNVERIFIABLE');
  });

  it('real domains with a numeric label or a punycode TLD still load', () => {
    const domains = [...policyJson.commonDomains, '163.com', '126.com', 'mail.example.xn--p1ai'];
    expect(loadPolicy(edited([['commonDomains'], domains])).commonDomains).toEqual(domains);
  });
});

describe('loadPolicy: properties', () => {
  const PROPERTY_RUNS = { numRuns: 1_000 };

  it('is total: any JSON value either loads or throws a PolicyError with issues', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (raw) => {
        try {
          loadPolicy(raw);
        } catch (error) {
          expect(error).toBeInstanceOf(PolicyError);
          expect(error instanceof PolicyError && error.issues.length > 0).toBe(true);
        }
      }),
      PROPERTY_RUNS,
    );
  });

  const WEIGHT_PATHS: readonly (readonly Segment[])[] = [
    ...Object.keys(policyJson.features).map((key) => ['features', key]),
    ...Object.keys(policyJson.unasked.signals).map((key) => ['unasked', 'signals', key]),
    ['unasked', 'threshold'],
    ['thresholds', 'verified'],
  ];

  it('any weight that is not a multiple of 0.0001 is rejected naming its path', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WEIGHT_PATHS),
        fc.double({ min: 0, max: 1, noNaN: true }).filter((v) => Math.round(v * 10_000) / 10_000 !== v),
        (path, value) => {
          expect(issuesOf(edited([path, value]))).toContain(`${path.join('.')}: ${MULTIPLE}`);
        },
      ),
      PROPERTY_RUNS,
    );
  });

  it('any weight or threshold above 1 is rejected naming its path', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WEIGHT_PATHS),
        fc.double({ min: 1, minExcluded: true, max: 1e9, noNaN: true }),
        (path, value) => {
          expect(issuesOf(edited([path, value]))).toContain(`${path.join('.')}: must be <= 1`);
        },
      ),
      PROPERTY_RUNS,
    );
  });
});
