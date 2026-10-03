/**
 * Policy errors. A load error has one "path: problem" line per issue, e.g. `thresholds.verified: must be <= 1` or
 * `featuresByType["email.sent"][2]: must be a key of features`; `policy_not_loaded` has none. Internal to the
 * policy module; import `PolicyError` from `./policy`.
 *
 * PURE: no I/O, no clock, no logging. The caller logs the error (Hard Rule 6: fail loud).
 */
import type { z } from 'zod';

export type PolicyErrorCode =
  /** `loadPolicy` was given a document that is not a valid policy; `issues` names every problem. */
  | 'invalid_policy'
  /**
   * A grading entry was given a policy object `loadPolicy` did not return: a copy, a spread, a hand-built or an
   * edited object. Its memos and its `policyHash` could belong to another document (Hard Rules 4 and 6).
   */
  | 'policy_not_loaded';

/**
 * Thrown by `loadPolicy` for any document that is not a valid policy (never partially applied), and by every
 * grading entry for a policy object the loader did not return (`assertLoadedPolicy`).
 */
export class PolicyError extends Error {
  readonly code: PolicyErrorCode;
  /** One "path: problem" line per issue, e.g. `thresholds.verified: must be <= 1`; none for `policy_not_loaded`. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[], code: PolicyErrorCode = 'invalid_policy') {
    super(code === 'invalid_policy' ? `invalid policy: ${issues.join('; ')}` : `policy: ${code}`);
    this.name = 'PolicyError';
    this.code = code;
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
export function describeIssue(issue: z.core.$ZodRawIssue): string | undefined {
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
export function formatPath(path: readonly PropertyKey[]): string {
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

/** One line per issue; an unknown-keys issue becomes one line per key, each at the key's own path. */
export function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => `${formatPath([...issue.path, key])}: unknown key`)
      : [`${formatPath(issue.path)}: ${issue.message}`],
  );
}
