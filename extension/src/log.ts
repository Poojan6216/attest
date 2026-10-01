/**
 * The only logger in Attest (Hard Rule 10: never log secrets or PII).
 *
 * Structured and leveled. It is safe by construction: it never prints a free-form string.
 *  - `event` must be a dotted lowercase identifier (`bus.dropped`); anything else is printed as a shape.
 *  - String field values survive only if they look like plumbing, not content: lowercase identifiers,
 *    UPPER_SNAKE enum values without digits, ULIDs, SHA-256 hex, ISO timestamps. Everything else
 *    becomes `[redacted len=N]`.
 *  - Fields whose key names content (subject, counterparty, body, …) are always redacted.
 *  - Errors become `{name, code?, messageLength}`; error messages are never printed.
 *  - Objects and arrays are never serialised; only their shape is printed.
 *
 * `console.*` anywhere else in the codebase is a lint error.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;
export type SafeValue = string | number | boolean | null;

export interface LogRecord {
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: Readonly<Record<string, SafeValue>>;
}

export type LogSink = (record: LogRecord) => void;

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/;
const IDENTIFIER_MAX_LENGTH = 64;
const IDENTIFIER_MAX_SEGMENT = 20;
const ENUM_VALUE = /^[A-Z]+(?:_[A-Z]+)*$/;
const ENUM_MAX_LENGTH = 24;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const DIGIT_RUN = /\d{5,}/;

/** Keys that name user content. Their values are redacted no matter what they look like. */
const CONTENT_KEYS = new Set([
  'address',
  'body',
  'content',
  'counterparty',
  'email',
  'html',
  'merchant',
  'message',
  'name',
  'phone',
  'subject',
  'subjecthint',
  'text',
  'texthint',
  'title',
  'url',
  'value',
]);

function isIdentifier(value: string): boolean {
  if (value.length > IDENTIFIER_MAX_LENGTH || !IDENTIFIER.test(value) || DIGIT_RUN.test(value)) {
    return false;
  }
  return value.split(/[._:/-]/).every((segment) => segment.length <= IDENTIFIER_MAX_SEGMENT);
}

/** True when a string is plumbing (ids, enums, hashes, timestamps), never user content. */
export function isSafeString(value: string): boolean {
  return (
    isIdentifier(value) ||
    (value.length <= ENUM_MAX_LENGTH && ENUM_VALUE.test(value)) ||
    ULID.test(value) ||
    SHA256_HEX.test(value) ||
    ISO_TIMESTAMP.test(value) ||
    SEMVER.test(value)
  );
}

function shapeOf(value: unknown): string {
  if (Array.isArray(value)) return `[array len=${String(value.length)}]`;
  if (typeof value === 'string') return `[redacted len=${String(value.length)}]`;
  if (typeof value === 'object' && value !== null) {
    return `[object keys=${String(Object.keys(value).length)}]`;
  }
  return `[${typeof value}]`;
}

function describeError(error: Error): string {
  const name = isSafeString(error.name) || /^[A-Z][A-Za-z]{0,40}$/.test(error.name) ? error.name : 'Error';
  const code: unknown = (error as { code?: unknown }).code;
  const codePart = typeof code === 'string' && isSafeString(code) ? ` code=${code}` : '';
  return `${name}${codePart} messageLength=${String(error.message.length)}`;
}

function sanitizeValue(key: string, value: unknown): SafeValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (value instanceof Error) return describeError(value);
  if (typeof value === 'string') {
    if (CONTENT_KEYS.has(key.toLowerCase())) return shapeOf(value);
    return isSafeString(value) ? value : shapeOf(value);
  }
  return shapeOf(value);
}

function sanitizeKey(key: string, index: number): string {
  return isIdentifier(key.toLowerCase()) || /^[a-z][A-Za-z0-9]{0,40}$/.test(key)
    ? key
    : `field${String(index)}`;
}

/** Pure: turns an event + arbitrary fields into a record that is safe to print. */
export function buildRecord(level: LogLevel, event: string, fields: LogFields = {}): LogRecord {
  const safeFields: Record<string, SafeValue> = {};
  Object.entries(fields).forEach(([key, value], index) => {
    const safeKey = sanitizeKey(key, index);
    safeFields[safeKey] = sanitizeValue(safeKey, value);
  });
  return { level, event: isIdentifier(event) ? event : shapeOf(event), fields: safeFields };
}

const consoleSink: LogSink = (record) => {
  const line = `[attest] ${JSON.stringify({ level: record.level, event: record.event, ...record.fields })}`;
  // The single sanctioned console call site in the codebase (no-console is off for this file only).
  console[record.level](line);
};

let currentLevel: LogLevel = 'info';
let currentSink: LogSink = consoleSink;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Test hook: route records somewhere other than the console. Returns a restore function. */
export function setLogSink(sink: LogSink): () => void {
  const previous = currentSink;
  currentSink = sink;
  return () => {
    currentSink = previous;
  };
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  currentSink(buildRecord(level, event, fields));
}

export const log = {
  debug: (event: string, fields?: LogFields): void => {
    emit('debug', event, fields);
  },
  info: (event: string, fields?: LogFields): void => {
    emit('info', event, fields);
  },
  warn: (event: string, fields?: LogFields): void => {
    emit('warn', event, fields);
  },
  error: (event: string, fields?: LogFields): void => {
    emit('error', event, fields);
  },
} as const;
