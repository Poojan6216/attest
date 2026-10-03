/**
 * The policy document's shape (docs/grading.md §12, policy version 2), field by field. Internal to the
 * policy module: import from `./policy`, which adds the cross-field checks and the loader.
 *
 * Strict at every level: an unknown key is an error, so a typo can never be silently ignored. The
 * vocabularies (action types, sources, agents, grades, Observation fields) come from `./schema`, so the
 * policy can never name a type, source, agent or field the ledger does not have.
 *
 * PURE: no I/O, no clock, no logging.
 */
import { z } from 'zod';

import { name, stopWordKey } from './normalize';
import {
  ActionType,
  AgentId,
  Grade,
  type Observation,
  ObservationSource,
  RuleId,
  UnaskedSignal,
} from './schema';
import { BASELINE_CLASS } from './unicode-baseline';
import { BASIS_POINTS, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from './units';

/**
 * §12 (v1.3): the Observation fields an `allowlistedFields` entry may name. The content fields a raw row may
 * supply, plus the derived markers `rowKeyHash` and `contentHash`; never `id`, `source`, `type` or
 * `observedAt`, which redact.ts computes (Hard Rule 2).
 */
export const ALLOWLISTABLE_FIELDS = [
  'counterparty',
  'merchant',
  'amountCents',
  'currency',
  'subjectHint',
  'occurredAt',
  'rowKeyHash',
  'contentHash',
] as const satisfies readonly (keyof z.input<typeof Observation>)[];

/** A field an `allowlistedFields` entry may name (see ALLOWLISTABLE_FIELDS). */
export const ObservationFieldName = z.enum(ALLOWLISTABLE_FIELDS, {
  error: 'must be a content field, rowKeyHash or contentHash',
});

/** Every observation has an `occurredAt` (§10), so every source's allowlist must name it. */
const REQUIRED_FIELD = 'occurredAt';

/** A rule compares the best candidate score against a threshold by name, never by number. */
export const ThresholdName = z.enum(['verified', 'partial']);

/** What the `coverage` condition can ask for (§6.1). */
export const CoverageLevel = z.enum(['none', 'partial', 'full']);

/** What a rule concludes: every Grade, plus PENDING (provisional until the grace window elapses). */
export const RuleOutcome = z.enum([...Grade.options, 'PENDING']);

/**
 * The `ruleId` of a receipt when no policy rule matched (§6: first match wins, terminal rule
 * `default_unverifiable`, grade UNVERIFIABLE). It is implicit, never written in the policy, and reserved:
 * a policy rule with this id could grade VERIFIED while its receipt read as "no rule matched" (Hard Rule 5).
 */
export const TERMINAL_RULE_ID = 'default_unverifiable';

/**
 * The only rule that may conclude PENDING (§5.3). A receipt whose rule outcome is PENDING carries this ruleId
 * and the UNVERIFIABLE placeholder grade (§2), and finalises by time as `pending` (§8), so another id with a
 * PENDING outcome would be a "checking" receipt no finality rule knows.
 */
export const PENDING_RULE_ID = 'pending';

/**
 * Lowercase ASCII host name with at least two labels; no label starts or ends with a hyphen, and the
 * top-level label starts with a letter (RFC 3696 §2), so an IPv4 literal such as 127.0.0.1 is not a domain.
 */
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;

/** One subject token (§11: subjects split on every run of characters that are not letters, digits or marks). */
const TOKEN_PATTERN = new RegExp(`^[${BASELINE_CLASS.token}]+$`, 'u');
/** Removed from a subject before it is split (§11), so a stop word holding one could never match. */
const INVISIBLE = new RegExp(`[${BASELINE_CLASS.invisible}]`, 'u');

/** Tokens separated by single spaces, no other whitespace and no invisible format characters (§11 names). */
const NAME_CHARACTER = `[^${BASELINE_CLASS.space}${BASELINE_CLASS.format}]`;
const NAME_PATTERN = new RegExp(`^${NAME_CHARACTER}+(?: ${NAME_CHARACTER}+)*$`, 'u');

const LETTER_OR_DIGIT = new RegExp(`[${BASELINE_CLASS.letterOrDigit}]`, 'u');

/**
 * True iff `value` is exactly a multiple of 1/BASIS_POINTS (§5.3), i.e. the double nearest to a decimal
 * with at most four places. `value * BASIS_POINTS` is within far less than 0.5 of that integer, so the
 * rounding finds it, and the division reproduces `value` only for such doubles: 0.85 passes,
 * 0.1 + 0.2 (0.30000000000000004) and 0.00005 do not.
 */
export function isBasisPointMultiple(value: number): boolean {
  return Math.round(value * BASIS_POINTS) / BASIS_POINTS === value;
}

/** A weight, threshold or signal weight: a decimal in [0, 1] with at most four places (§5.3). */
const Weight = z
  .number()
  .min(0)
  .max(1)
  .refine(isBasisPointMultiple, `must be a multiple of ${1 / BASIS_POINTS}`);

/**
 * A whole number of units `msPerUnit` long whose length in milliseconds is a safe integer. Windows become
 * integer milliseconds, so time proximity is an exact BigInt rational (§5.1, §5.3): a fractional minute
 * (0.1 × 60,000 = 6000.000000000001 ms) cannot be one, and neither can a window past 2^53 ms, where
 * `days × MS_PER_DAY` is rounded (MAX_SAFE_INTEGER days would be 7.8e23 ms).
 */
function wholeUnits(msPerUnit: number) {
  return z
    .number()
    .int()
    .min(0)
    .max(Math.floor(Number.MAX_SAFE_INTEGER / msPerUnit));
}

const Minutes = wholeUnits(MS_PER_MINUTE);
const Hours = wholeUnits(MS_PER_HOUR);
const Days = wholeUnits(MS_PER_DAY);

/**
 * A list whose order is kept as written but whose entries are unique (a duplicate is always a typo and
 * would double-count in a weight sum).
 */
function uniqueList<Item extends z.ZodType>(item: Item) {
  return z.array(item).superRefine((items, ctx) => {
    items.forEach((value, index) => {
      const first = items.indexOf(value);
      if (first !== index) {
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: `duplicate ${JSON.stringify(value)} (first at [${first}])`,
        });
      }
    });
  });
}

const Windows = z.strictObject({
  beforeClaimMin: Minutes,
  afterClaimMin: Minutes,
  graceMin: Minutes,
  calendarDays: Days,
  toleranceMin: Minutes,
  spendWindowDays: Days,
  finalizeUnverifiableHours: Hours,
});

const Thresholds = z.strictObject({ verified: Weight, partial: Weight });

const Features = z.strictObject({
  timeProximity: Weight,
  counterpartyExact: Weight,
  counterpartyDomain: Weight,
  counterpartyName: Weight,
  subjectOverlap: Weight,
  amountExact: Weight,
  merchantMatch: Weight,
  modelScore: Weight,
});

/** A feature listed by type must be a key of `features` (so it has a weight). */
export const FeatureName = z.enum(Features.keyof().options, { error: 'must be a key of features' });

/** The attribution signals a receipt can name (§7), each with its weight: exactly one key per signal. */
export const SignalName = UnaskedSignal;

/** Exactly one key per ActionType: a missing type is "is required", an unknown one "unknown key". */
const PerActionType = <Item extends z.ZodType>(item: Item) => z.record(ActionType, uniqueList(item));

const Domain = z.string().regex(DOMAIN_PATTERN, 'must be a lowercase ASCII domain name');

/**
 * A §11 normalised name: exactly what `name()` makes of itself (lowercase, single-spaced, trimmed, no invisible
 * character, diacritics folded, NFKC). A purchase claim is covered only when `name(counterparty)` is in this
 * list (§6.1, v1.2), so an entry that is not its own `name()` ("café", "ａｃｍｅ") could never match: it is
 * rejected at load instead of silently covering nothing (Hard Rule 6).
 */
const MerchantName = z
  .string()
  .refine(
    (value) => NAME_PATTERN.test(value) && name(value) === value,
    'must be a normalised merchant name (its own name(): lowercase, trimmed, single-spaced, folded)',
  );

/**
 * A stop word must be something `subjectTokens` can produce: one NFKC, lowercase token of letters, digits and
 * marks, with no invisible character (subjects lose those before they are split).
 */
const StopWord = z
  .string()
  .refine(
    (value) => TOKEN_PATTERN.test(value) && !INVISIBLE.test(value) && stopWordKey(value) === value,
    'must be one lowercase token of letters, digits and marks (NFKC)',
  );

/** A signature matches subjects case-insensitively; one without a letter or digit would match noise. */
const Signature = z.string().regex(LETTER_OR_DIGIT, 'must contain a letter or digit');

const Flag = z.boolean().optional();

/** Every condition a rule may name (§6.1). All named conditions must hold for the rule to match. */
const RuleCondition = z
  .strictObject({
    unaskedLikely: Flag,
    observedScopeExceedsDeclared: Flag,
    typeNotInGrant: Flag,
    counterpartyNotAllowed: Flag,
    amountAboveCeiling: Flag,
    cumulativeAboveCeiling: Flag,
    targetMissing: Flag,
    underspecified: Flag,
    coverage: CoverageLevel.optional(),
    bestScoreGte: ThresholdName.optional(),
    bestScoreLt: ThresholdName.optional(),
    graceElapsed: Flag,
  })
  .superRefine((when, ctx) => {
    if (Object.values(when).every((condition) => condition === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'must name at least one condition' });
    }
  });

export const ConditionName = RuleCondition.keyof();

/** A rule id is a receipt's `ruleId`, so it is exactly what the Receipt schema accepts. */
const Rule = z
  .strictObject({
    id: RuleId,
    when: RuleCondition,
    then: RuleOutcome,
  })
  .superRefine((rule, ctx) => {
    if (rule.then === 'PENDING' && rule.id !== PENDING_RULE_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['then'],
        message: `PENDING is allowed only on the rule with id "${PENDING_RULE_ID}"`,
      });
    }
  });

/** First match wins, so order matters and every id must be unique (a receipt names its rule). */
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
  signals: z.record(SignalName, Weight),
  threshold: Weight,
  windows: z.strictObject({ sessionMin: Minutes, idleMin: Minutes, adjacentMin: Minutes }),
  /** One key per AgentId; empty until captured fixtures show real signatures (never invented). */
  signatures: z.record(AgentId, uniqueList(Signature)),
});

/**
 * The whole policy document, field by field. The cross-field checks (`./policy-checks`) are attached in
 * `./policy`; use `PolicyDocument` from there, never this shape alone.
 */
export const PolicyShape = z.strictObject({
  version: z.number().int().min(1),
  windows: Windows,
  thresholds: Thresholds,
  features: Features,
  sourcesByType: PerActionType(ObservationSource),
  featuresByType: PerActionType(FeatureName),
  identityFeatures: PerActionType(FeatureName),
  allowlistTypes: uniqueList(ActionType),
  spendTypes: uniqueList(ActionType),
  commonDomains: uniqueList(Domain),
  receiptMerchants: uniqueList(MerchantName),
  normalize: z.strictObject({ stopWords: uniqueList(StopWord) }),
  rules: Rules,
  unasked: Unasked,
  /** Hard Rule 2: the only Observation fields each observer source may ever store; `occurredAt` required. */
  allowlistedFields: z.record(
    ObservationSource,
    uniqueList(ObservationFieldName).refine(
      (fields) => fields.includes(REQUIRED_FIELD),
      `must list "${REQUIRED_FIELD}"`,
    ),
  ),
});

/** A validated policy document, exactly as written (decimal weights; no basis points, no hash). */
export type PolicyDocument = z.output<typeof PolicyShape>;
export type FeatureName = z.infer<typeof FeatureName>;
export type SignalName = z.infer<typeof SignalName>;
export type ThresholdName = z.infer<typeof ThresholdName>;
export type CoverageLevel = z.infer<typeof CoverageLevel>;
export type RuleOutcome = z.infer<typeof RuleOutcome>;
export type ConditionName = z.infer<typeof ConditionName>;
export type ObservationFieldName = z.infer<typeof ObservationFieldName>;
