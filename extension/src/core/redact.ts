/**
 * Redaction (docs/grading.md §10, §12, §13; build_spec Hard Rule 2): the only way an observer's raw row becomes
 * an `Observation`. Derived facts, never raw content.
 *
 * `project` keeps exactly the content fields that `policy.allowlistedFields[source]` names, and computes every
 * other field itself. An allowlisted value must already satisfy the Observation schema: a value that does not
 * (a multi-line counterparty, a number as text, an over-long merchant) is never coerced, cut or dropped. The
 * row is refused with `RedactError('invalid_field')`, so the observer reports DEGRADED (Hard Rule 6) instead of
 * storing a row that silently lacks a fact, which could lower a match toward NOT_FOUND (Hard Rule 5).
 *
 * `project` never copies `id`, `source`, `type`, `observedAt`, `rowKeyHash` or `contentHash` from the raw row,
 * so a row cannot choose its own identity:
 *  - `source`, `type`, `observedAt` come from the arguments;
 *  - `rowKeyHash` = `sha256Hex(canonicalJson(ctx.rowKey))` when the observer has the vendor's own row id;
 *    canonical JSON escapes a lone surrogate, which plain UTF-8 turns into U+FFFD, so two distinct row ids
 *    never share a hash (§10 v1.3);
 *  - `contentHash` = `contentHashOf({source, type, ...kept content fields, rowKeyHash?})`, the SHA-256 of its
 *    canonical JSON, where the content fields are only `counterparty`, `merchant`, `amountCents`, `currency`,
 *    `subjectHint` and `occurredAt` (§10 v1.3): no derived field ever enters it;
 *  - `id` = `idFromHash(contentHash)`.
 * So the same row seen twice is one observation (observedAt is not hashed), a created and a deleted event
 * differ (type is hashed), and two identical sends with different row ids stay two (rowKeyHash is hashed).
 *
 * Only own data properties of `raw` are read. An allowlisted field held anywhere else (a getter, or a property
 * inherited from a prototype) is never invoked and never read, and it is never silently left out either: the
 * row is refused with `invalid_field` (OBS-3), because a row stored without a fact its source carried could fall
 * to NOT_FOUND with no DEGRADED in sight (Hard Rules 5, 6). Fields the allowlist does not name are never looked
 * at, however they are held.
 * `subjectHint` is cut to SCHEMA_LIMITS.SUBJECT_HINT code points (a surrogate pair is one code point and is
 * never split, matching how the schema counts); every other string must already fit its cap or the row is
 * refused, because a cut address or merchant would name someone else.
 *
 * `observationIntegrityProblems(observation, policy)` is the same rule seen from the other side: whether an
 * observation that arrives already built (over the bus, into the ledger) is one `project` could have returned.
 * Only its source's allowlisted content fields, and a `contentHash` that is `contentHashOf` its content. The
 * ledger refuses any other before it writes (Hard Rule 2; SEC-V1). `contentHashOf` is the one definition of the
 * §10 content hash: `project`, this check and replay all call it.
 *
 * PURE: no clock, no I/O, no logging (Hard Rule 4). Errors carry a code only, never a value (Hard Rule 10).
 */
import { z } from 'zod';

import { canonicalJson, idFromHash, sha256Hex } from './hash';
import type { Policy } from './policy';
import type { Problem } from './schema-checks';
import {
  ActionType,
  IsoTs,
  Observation,
  type ObservationInput,
  ObservationSource,
  SCHEMA_LIMITS,
  Sha256,
} from './schema';

export type RedactErrorCode = 'invalid_argument' | 'invalid_field' | 'missing_occurred_at';

/**
 * `invalid_argument`: bad source or context. `invalid_field`: an allowlisted content field other than
 * `occurredAt` holds a value the Observation schema refuses, or any allowlisted field (`occurredAt` included) is
 * held by a getter or inherited rather than an own data property. `missing_occurred_at`: absent, invalid or not
 * allowlisted.
 */
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

/**
 * §10 (v1.3): `rowKeyHash = sha256Hex(canonicalJson(rowKey))`. Hashed through canonical JSON, not as plain
 * UTF-8, so row ids that differ only in a lone surrogate (which UTF-8 encodes as U+FFFD) stay distinct.
 */
export function hashRowKey(rowKey: string): Sha256 {
  return Sha256.parse(sha256Hex(canonicalJson(rowKey)));
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

/**
 * The own data property `key` of `raw`, or undefined when `raw` has no such property at all. A getter is never
 * invoked and an inherited property never read: either refuses the row (`invalid_field`), so a fact held that
 * way is never dropped in silence (OBS-3, Hard Rules 5, 6). Neither `in` nor a descriptor runs a getter.
 */
function ownValue(raw: unknown, key: string): unknown {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(raw, key);
  if (descriptor === undefined) {
    if (key in raw) throw new RedactError('invalid_field');
    return undefined;
  }
  if (!('value' in descriptor)) throw new RedactError('invalid_field');
  const value: unknown = descriptor.value;
  return value;
}

/** The value to keep for `field`, or undefined when it fails the Observation schema. */
function keptValue(field: ContentField, value: unknown): unknown {
  const prepared = field === 'subjectHint' && typeof value === 'string' ? clampSubjectHint(value) : value;
  const schema: z.ZodType = Observation.shape[field];
  return schema.safeParse(prepared).success ? prepared : undefined;
}

/**
 * The allowlisted own content of `raw`. Only `undefined` means absent. Any other value that fails its field's
 * schema, and any allowlisted field held by a getter or inherited, refuses the whole row (`invalid_field`): a row
 * is never stored without a fact it carried (Hard Rule 5). An invalid own `occurredAt` is left out here and
 * reported as `missing_occurred_at` by `project`.
 */
function allowlistedContent(
  raw: unknown,
  allowlist: readonly string[],
): Partial<Record<ContentField, unknown>> {
  const content: Partial<Record<ContentField, unknown>> = {};
  for (const field of CONTENT_FIELDS) {
    if (!allowlist.includes(field)) continue;
    const own = ownValue(raw, field);
    if (own === undefined) continue;
    const value = keptValue(field, own);
    if (value !== undefined) content[field] = value;
    else if (field !== 'occurredAt') throw new RedactError('invalid_field');
  }
  return content;
}

/**
 * The §10 content hash: SHA-256 of the canonical JSON of every field of `observation` but `id`, `observedAt`
 * and `contentHash`. For what `project` hashes, `{source, type, ...content, rowKeyHash?}`, that is all of it.
 * The one definition: `project`, `observationIntegrityProblems` and replay (replay-compare.ts) all call it.
 */
export function contentHashOf(observation: Readonly<Record<string, unknown>>): Sha256 {
  const hashed = { ...observation, id: undefined, observedAt: undefined, contentHash: undefined };
  return Sha256.parse(sha256Hex(canonicalJson(hashed)));
}

/**
 * Why `observation` is not one `project` could have returned under `policy` (SEC-V1, Hard Rule 2): each content
 * field its source's allowlist does not name, and a `contentHash` that is not `contentHashOf` its content (so a
 * row cannot choose its own identity, §10). Empty when it is. `rowKeyHash` is not checked against the allowlist,
 * because `project` keeps it whenever the observer has a row id. Problems name fields only, never values (Hard
 * Rule 10). The schema has already checked every field's shape (`Observation`).
 */
export function observationIntegrityProblems(
  observation: Observation,
  policy: Pick<Policy, 'allowlistedFields'>,
): Problem[] {
  const allowlist: readonly string[] = policy.allowlistedFields[observation.source];
  const problems: Problem[] = CONTENT_FIELDS.filter(
    (field) => observation[field] !== undefined && !allowlist.includes(field),
  ).map((field): Problem => [field, `not allowlisted for ${observation.source}`]);
  if (contentHashOf(observation) !== observation.contentHash) {
    problems.push(['contentHash', 'is not the §10 hash of the content']);
  }
  return problems;
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
 * (Hard Rule 2). Throws `RedactError('invalid_field')` when an allowlisted own value other than `occurredAt`
 * fails its schema or an allowlisted field is held by a getter or inherited (never invoked, never read),
 * `RedactError('missing_occurred_at')` when the row has no valid, allowlisted `occurredAt`,
 * and `RedactError('invalid_argument')` for a bad source or context. The result always parses with the
 * Observation schema and has no `observationIntegrityProblems`.
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
    ...(rowKey === undefined ? {} : { rowKeyHash: hashRowKey(rowKey) }),
  };
  const contentHash = contentHashOf(hashed);
  return Observation.parse(
    { ...hashed, id: idFromHash(contentHash), observedAt, contentHash },
    { jitless: true },
  );
}
