/**
 * The grading policy (build_spec §7; ledger_engineer rule 2: policy is data).
 *
 * Every threshold, window, feature weight, rule, and allowlisted field lives in `policy/default.json`
 * and nowhere in code (a unit test walks the source AST to prove it). This module validates a policy
 * document strictly (an unknown key is an error at every level, so a typo can never be ignored) and
 * returns a deep-frozen copy, so nothing downstream can retune a threshold at runtime (Hard Rule 4).
 *
 * PURE: no I/O, no clock, no logging. The JSON import is resolved at build time, not read at runtime.
 * A failure throws `PolicyError` with one specific "path: problem" line per issue; the caller logs it.
 */
import { z } from 'zod';

import defaultPolicyJson from '../../../policy/default.json';

/**
 * Field names of the Observation schema (build_spec §7). src/core may not import src/ledger, so the
 * list lives here for now; Sprint 1 (task 1.0) moves the canonical schemas into `src/core/schema.ts`
 * and this enum is then derived from the Observation schema itself. Until then a unit test pins this
 * list to the keys of the ledger's Observation schema, so the two cannot drift.
 */
export const ObservationFieldName = z.enum(
  [
    'id',
    'source',
    'type',
    'counterparty',
    'merchant',
    'amountCents',
    'currency',
    'subjectHint',
    'occurredAt',
    'observedAt',
    'contentHash',
  ],
  { error: 'must be an Observation field name' },
);

/** A rule compares the best candidate score against a threshold by name, never by number. */
export const ThresholdName = z.enum(['verified', 'partial']);

/** What a rule concludes: every Grade, plus PENDING (provisional until the grace window elapses). */
export const RuleOutcome = z.enum([
  'VERIFIED',
  'PARTIAL',
  'NOT_FOUND',
  'UNASKED',
  'OVER_SCOPE',
  'UNVERIFIABLE',
  'PENDING',
]);

/** Rule ids end up in receipts and logs, so they are plain identifiers (safe for `log.ts` to print). */
const RULE_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * The `ruleId` of a receipt when no policy rule matched (build_spec §7: first-match-wins, terminal
 * rule `default_unverifiable`, grade UNVERIFIABLE). It is implicit, never written in the policy, and
 * reserved: a policy rule with this id could grade VERIFIED while its receipt read as "no rule
 * matched" (Hard Rule 5). `grade()` imports it from here.
 */
export const TERMINAL_RULE_ID = 'default_unverifiable';

const UnitInterval = z.number().min(0).max(1);
const NonNegative = z.number().min(0);

const Windows = z.strictObject({
  beforeClaimMin: NonNegative,
  afterClaimMin: NonNegative,
  graceMin: NonNegative,
  calendarDays: NonNegative,
});

const Thresholds = z.strictObject({ verified: UnitInterval, partial: UnitInterval }).superRefine((t, ctx) => {
  if (t.partial >= t.verified) {
    ctx.addIssue({ code: 'custom', path: ['partial'], message: 'must be < thresholds.verified' });
  }
});

const Features = z.strictObject({
  timeProximity: UnitInterval,
  counterpartyExact: UnitInterval,
  counterpartyDomain: UnitInterval,
  subjectOverlap: UnitInterval,
  amountExact: UnitInterval,
  merchantMatch: UnitInterval,
});

const RuleCondition = z
  .strictObject({
    coverage: z.literal('none').optional(),
    typeNotInGrant: z.boolean().optional(),
    amountAboveCeiling: z.boolean().optional(),
    bestScoreGte: ThresholdName.optional(),
    bestScoreLt: ThresholdName.optional(),
    graceElapsed: z.boolean().optional(),
  })
  .superRefine((when, ctx) => {
    if (Object.values(when).every((condition) => condition === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'must name at least one condition' });
    }
  });

const Rule = z.strictObject({
  id: z.string().regex(RULE_ID_PATTERN, 'must be a non-empty lowercase snake_case identifier'),
  when: RuleCondition,
  then: RuleOutcome,
});

/** First-match-wins, so order matters and every id must be unique (a receipt names its rule). */
const Rules = z
  .array(Rule)
  .min(1)
  .superRefine((rules, ctx) => {
    const firstIndexById = new Map<string, number>();
    rules.forEach((rule, index) => {
      if (rule.id === TERMINAL_RULE_ID) {
        ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'is reserved for the terminal rule' });
      }
      const firstIndex = firstIndexById.get(rule.id);
      if (firstIndex === undefined) {
        firstIndexById.set(rule.id, index);
        return;
      }
      ctx.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `duplicate rule id "${rule.id}" (first used at rules[${firstIndex}])`,
      });
    });
  });

const Unasked = z.strictObject({
  signals: z.strictObject({
    agentSessionActive: UnitInterval,
    userIdle: UnitInterval,
    agentSignature: UnitInterval,
    activityLogAdjacent: UnitInterval,
  }),
  threshold: UnitInterval,
});

/** Hard Rule 2: the only Observation fields an observer source may ever store. */
const FieldList = z
  .array(ObservationFieldName)
  .min(1)
  .superRefine((fields, ctx) => {
    fields.forEach((field, index) => {
      if (fields.indexOf(field) !== index) {
        ctx.addIssue({ code: 'custom', path: [index], message: `duplicate field "${field}"` });
      }
    });
  });

const AllowlistedFields = z.strictObject({
  'gmail.sent': FieldList,
  'gmail.receipt': FieldList,
  'gcal.event': FieldList,
});

/** The whole policy document. Strict at every level: unknown keys are errors, never ignored. */
export const Policy = z.strictObject({
  version: z.number().int().min(1),
  windows: Windows,
  thresholds: Thresholds,
  features: Features,
  rules: Rules,
  unasked: Unasked,
  allowlistedFields: AllowlistedFields,
});

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

/** A loaded policy. Deep-readonly in the type system and deep-frozen at runtime. */
export type Policy = DeepReadonly<z.output<typeof Policy>>;
export type PolicyRule = Policy['rules'][number];
export type ThresholdName = z.infer<typeof ThresholdName>;
export type RuleOutcome = z.infer<typeof RuleOutcome>;
export type ObservationFieldName = z.infer<typeof ObservationFieldName>;

/** Thrown by `loadPolicy` for any document that is not a valid policy. Never partially applied. */
export class PolicyError extends Error {
  readonly code = 'invalid_policy';
  /** One "path: problem" line per issue, e.g. `thresholds.verified: must be <= 1`. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`invalid policy: ${issues.join('; ')}`);
    this.name = 'PolicyError';
    this.issues = Object.freeze([...issues]);
  }
}

function kindOf(input: unknown): string {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  return typeof input;
}

function quoteAll(values: readonly unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join(', ');
}

function describeBound(
  origin: string,
  bound: number | bigint,
  inclusive: boolean | undefined,
  side: 'min' | 'max',
): string {
  const limit = String(bound);
  if (origin === 'array' || origin === 'string') {
    const unit = origin === 'array' ? 'items' : 'characters';
    if (side === 'min' && bound === 1) return 'must not be empty';
    return `must have ${side === 'min' ? 'at least' : 'at most'} ${limit} ${unit}`;
  }
  const strict = inclusive === false;
  if (side === 'min') return `must be ${strict ? '>' : '>='} ${limit}`;
  return `must be ${strict ? '<' : '<='} ${limit}`;
}

/** Per-parse error map: turns each raw Zod issue into the "problem" half of a "path: problem" line. */
function describeIssue(issue: z.core.$ZodRawIssue): string | undefined {
  if (issue.input === undefined && issue.code !== 'custom') return 'is required';
  switch (issue.code) {
    case 'invalid_type':
      if (typeof issue.input === 'number' && !Number.isFinite(issue.input)) {
        return 'must be a finite number';
      }
      if (issue.expected === 'int') return 'must be an integer';
      return `expected ${issue.expected}, got ${kindOf(issue.input)}`;
    case 'too_big':
      return describeBound(issue.origin, issue.maximum, issue.inclusive, 'max');
    case 'too_small':
      return describeBound(issue.origin, issue.minimum, issue.inclusive, 'min');
    case 'invalid_value':
      return issue.values.length === 1
        ? `must be ${quoteAll(issue.values)}`
        : `must be one of ${quoteAll(issue.values)}`;
    case 'unrecognized_keys':
      return 'unknown key';
    default:
      return undefined;
  }
}

const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `rules[3].when.bestScoreGte`, `allowlistedFields["gmail.sent"][1]`; the document itself is `(root)`. */
function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`;
      const key = typeof segment === 'symbol' ? segment.toString() : segment;
      if (!PLAIN_KEY.test(key)) return `[${JSON.stringify(key)}]`;
      return index === 0 ? key : `.${key}`;
    })
    .join('');
}

function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => `${formatPath([...issue.path, key])}: unknown key`)
      : [`${formatPath(issue.path)}: ${issue.message}`],
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((child: unknown) => {
      deepFreeze(child);
    });
    Object.freeze(value);
  }
  return value;
}

/**
 * Validates `raw` as a policy document and returns a deep-frozen copy (the input is never frozen or
 * retained). Throws `PolicyError` listing every problem found, each naming its path.
 *
 * `jitless` keeps Zod off its `new Function` fast path, so the policy parses the same way in Node
 * tests as under the extension's CSP (Hard Rule 9).
 */
export function loadPolicy(raw: unknown): Policy {
  const result = Policy.safeParse(raw, { error: describeIssue, jitless: true });
  if (!result.success) throw new PolicyError(formatIssues(result.error.issues));
  return deepFreeze(result.data);
}

/**
 * The shipped policy. Loaded at module evaluation, so a broken `policy/default.json` fails loudly at
 * startup instead of grading with a half-valid policy (Hard Rule 6).
 */
export const DEFAULT_POLICY: Policy = loadPolicy(defaultPolicyJson);
