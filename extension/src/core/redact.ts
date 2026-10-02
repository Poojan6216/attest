/**
 * Redaction (docs/grading.md §10, §12, §13; build_spec Hard Rule 2): the only way an observer's raw row becomes
 * an `Observation`. Derived facts, never raw content.
 *
 * `project` keeps exactly the content fields that `policy.allowlistedFields[source]` names, each only if its
 * value already satisfies the Observation schema (an invalid value is dropped, never coerced), and computes
 * every other field itself. It never copies `id`, `source`, `type`, `observedAt`, `rowKeyHash` or
 * `contentHash` from the raw row, so a row cannot choose its own identity:
 *  - `source`, `type`, `observedAt` come from the arguments;
 *  - `rowKeyHash` = SHA-256 of `ctx.rowKey` (the vendor's own row id) when the observer has one;
 *  - `contentHash` = SHA-256 of the canonical JSON of `{source, type, ...kept content fields, rowKeyHash?}`;
 *  - `id` = `idFromHash(contentHash)`.
 * So the same row seen twice is one observation (observedAt is not hashed), a created and a deleted event
 * differ (type is hashed), and two identical sends with different row ids stay two (rowKeyHash is hashed).
 *
 * Only own data properties of `raw` are read: inherited properties and getters never become content.
 * `subjectHint` is cut to SCHEMA_LIMITS.SUBJECT_HINT code points (a surrogate pair is one code point and is
 * never split, matching how the schema counts); every other string must already fit its cap or is dropped,
 * because a cut address or merchant would name someone else.
 *
 * PURE: no clock, no I/O, no logging (Hard Rule 4). Errors carry a code only, never a value (Hard Rule 10).
 */
import { z } from 'zod';

import { canonicalJson, idFromHash, sha256Hex } from './hash';
import type { Policy } from './policy';
import {
  ActionType,
  IsoTs,
  Observation,
  type ObservationInput,
  ObservationSource,
  SCHEMA_LIMITS,
  Sha256,
} from './schema';

export type RedactErrorCode = 'invalid_argument' | 'missing_occurred_at';

/** `invalid_argument`: bad source or context. `missing_occurred_at`: absent, invalid or not allowlisted. */
export class RedactError extends Error {
  constructor(readonly code: RedactErrorCode) {
    super(`redact: ${code}`);
    this.name = 'RedactError';
  }
}

/** What the observer knows about a row besides its content. */
export interface ProjectContext {
  readonly type: ActionType;
  /** When Attest read the row (ISO 8601 with offset). Not hashed: a row seen twice is one observation. */
  readonly observedAt: string;
  /** The vendor's own row id; only its SHA-256 is kept. */
  readonly rowKey?: string | undefined;
}

type ObservationField = keyof ObservationInput;

/** Fields `project` computes itself and never reads from a raw row (§10). */
export const DERIVED_FIELDS = Object.freeze([
  'id',
  'source',
  'type',
  'observedAt',
  'rowKeyHash',
  'contentHash',
] as const satisfies readonly ObservationField[]);

export type DerivedField = (typeof DERIVED_FIELDS)[number];
/** Observation fields a raw row may supply, if the source's allowlist names them. */
export type ContentField = Exclude<ObservationField, DerivedField>;

const DERIVED: ReadonlySet<string> = new Set(DERIVED_FIELDS);

function isContentField(field: ObservationField): field is ContentField {
  return !DERIVED.has(field);
}

/** Every content field, in schema order: the Observation fields minus the derived ones. */
export const CONTENT_FIELDS: readonly ContentField[] = Object.freeze(
  Observation.keyof().options.filter(isContentField),
);

/** Strict, so a misspelt `rowKey` fails loud instead of silently merging two sends into one. */
const Context = z.strictObject({ type: ActionType, observedAt: IsoTs, rowKey: z.string().optional() });

/** Lowercase hex SHA-256 of the UTF-8 encoding of `text` (§10). */
export function hashText(text: string): Sha256 {
  return Sha256.parse(sha256Hex(text));
}

/** The first SUBJECT_HINT code points of `text`; a surrogate pair counts once and is never split. */
export function clampSubjectHint(text: string): string {
  if (text.length <= SCHEMA_LIMITS.SUBJECT_HINT) return text;
  let kept = '';
  let count = 0;
  for (const codePoint of text) {
    if (count === SCHEMA_LIMITS.SUBJECT_HINT) break;
    kept += codePoint;
    count += 1;
  }
  return kept;
}

/** An own data property of `raw`, or undefined: never an inherited property, never a getter's result. */
function ownValue(raw: unknown, key: string): unknown {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(raw, key);
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  const value: unknown = descriptor.value;
  return value;
}

/** The value to keep for `field`, or undefined when it is absent or fails the Observation schema. */
function keptValue(field: ContentField, value: unknown): unknown {
  const prepared = field === 'subjectHint' && typeof value === 'string' ? clampSubjectHint(value) : value;
  const schema: z.ZodType = Observation.shape[field];
  return schema.safeParse(prepared).success ? prepared : undefined;
}

function allowlistedContent(
  raw: unknown,
  allowlist: readonly string[],
): Partial<Record<ContentField, unknown>> {
  const content: Partial<Record<ContentField, unknown>> = {};
  for (const field of CONTENT_FIELDS) {
    if (!allowlist.includes(field)) continue;
    const value = keptValue(field, ownValue(raw, field));
    if (value !== undefined) content[field] = value;
  }
  return content;
}

function parseArguments(source: ObservationSource, ctx: ProjectContext): z.output<typeof Context> {
  const context = Context.safeParse(ctx, { jitless: true });
  if (!ObservationSource.safeParse(source).success || !context.success) {
    throw new RedactError('invalid_argument');
  }
  return context.data;
}

/**
 * Projects one raw observer row onto an `Observation` holding only `policy.allowlistedFields[source]`
 * (Hard Rule 2). Throws `RedactError('missing_occurred_at')` when the row has no valid, allowlisted
 * `occurredAt`, and `RedactError('invalid_argument')` for a bad source or context. The result always
 * parses with the Observation schema.
 */
export function project(
  source: ObservationSource,
  raw: unknown,
  ctx: ProjectContext,
  policy: Pick<Policy, 'allowlistedFields'>,
): Observation {
  const { type, observedAt, rowKey } = parseArguments(source, ctx);
  const content = allowlistedContent(raw, policy.allowlistedFields[source]);
  if (content.occurredAt === undefined) throw new RedactError('missing_occurred_at');
  const hashed = {
    source,
    type,
    ...content,
    ...(rowKey === undefined ? {} : { rowKeyHash: hashText(rowKey) }),
  };
  const contentHash = sha256Hex(canonicalJson(hashed));
  return Observation.parse(
    { ...hashed, id: idFromHash(contentHash), observedAt, contentHash },
    { jitless: true },
  );
}
