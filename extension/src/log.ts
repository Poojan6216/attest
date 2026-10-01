/**
 * The only logger in Attest (Hard Rule 10: never log secrets or PII).
 *
 * Structured and leveled. It is safe by construction: it never prints a free-form string, and it never
 * decides that a string is safe because of its shape (an identifier-shaped string can be a name, a
 * passphrase or a token).
 *  - `event` must be one of LOG_EVENTS (src/log-vocabulary.ts); anything else is printed as a shape.
 *  - A string field value prints only if it is in LOG_VALUES, or is a ULID, a lowercase SHA-256, an ISO
 *    timestamp with an offset, or a semver. Everything else becomes `[redacted len=N]`.
 *  - A number prints only if it has no run of 5 or more digits, or it is a non-negative integer below 10^8
 *    under a count key (`count`, `issues`, `…Count`, `…Ms`, …). Otherwise it becomes `[number]`.
 *  - Fields whose key names content (contains subject, counterparty, body, email, name, token, …) are
 *    always redacted, whatever the value.
 *  - A key prints only if it is a short lower-camel word (`/^[a-z][A-Za-z]{0,31}$/`); any other key is
 *    replaced by `field<N>`. The `attest/log-call` lint rule also requires every key to be a source literal.
 *  - Errors become `{name, code?, messageLength}`: the name only if it is in LOG_ERROR_NAMES, the code only if
 *    it is safe as above; error messages are never printed.
 *  - Objects and arrays are never serialised; only their shape is printed.
 *
 * `console` anywhere else in the codebase is a lint error.
 */
import { LOG_ERROR_NAMES, LOG_EVENTS, LOG_VALUES, type LogEvent } from './log-vocabulary';

export type { LogEvent } from './log-vocabulary';

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

const EVENTS: ReadonlySet<string> = new Set(LOG_EVENTS);
const VALUES: ReadonlySet<string> = new Set(LOG_VALUES);
const ERROR_NAMES: ReadonlySet<string> = new Set(LOG_ERROR_NAMES);

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const DIGIT_RUN = /\d{5,}/;
const SAFE_KEY = /^[a-z][A-Za-z]{0,31}$/;

/**
 * A key containing any of these words names user content: its value is redacted, whatever it looks like.
 * Matched as a substring of the lowercased key, so `senderEmail`, `subject_line` and `bodyText` all count.
 */
const CONTENT_KEY_WORDS = [
  'address',
  'body',
  'comment',
  'content',
  'cookie',
  'counterparty',
  'description',
  'email',
  'hint',
  'html',
  'merchant',
  'message',
  'name',
  'note',
  'passphrase',
  'password',
  'payload',
  'phone',
  'prompt',
  'raw',
  'recipient',
  'secret',
  'sender',
  'snippet',
  'subject',
  'summary',
  'text',
  'title',
  'token',
  'transcript',
  'url',
  'value',
] as const;

/**
 * Keys whose value is a count or a duration: a non-negative integer below COUNT_LIMIT prints even with a long
 * digit run. The limit keeps 9+ digit numbers (SSNs, phone numbers, card numbers) out under any key.
 */
const COUNT_KEYS: ReadonlySet<string> = new Set(['count', 'issues', 'total', 'version', 'bytes', 'ms']);
const COUNT_KEY_SUFFIX = /(?:Count|Ms|Bytes|Total)$/;
const COUNT_LIMIT = 100_000_000;

/** True when a string is plumbing (our vocabulary, ids, hashes, timestamps, versions), never user content. */
export function isSafeString(value: string): boolean {
  return (
    VALUES.has(value) ||
    ULID.test(value) ||
    SHA256_HEX.test(value) ||
    ISO_TIMESTAMP.test(value) ||
    SEMVER.test(value)
  );
}

/** True when the key names user content (matched on the key as the caller wrote it). */
export function isContentKey(key: string): boolean {
  const lower = key.toLowerCase();
  return CONTENT_KEY_WORDS.some((word) => lower.includes(word));
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
  const name = ERROR_NAMES.has(error.name) ? error.name : 'Error';
  const code: unknown = (error as { code?: unknown }).code;
  const codePart = typeof code === 'string' && isSafeString(code) ? ` code=${code}` : '';
  return `${name}${codePart} messageLength=${String(error.message.length)}`;
}

function sanitizeNumber(key: string, value: number): SafeValue {
  if (!Number.isFinite(value)) return String(value);
  if (!DIGIT_RUN.test(String(Math.abs(value)))) return value;
  const countKey = COUNT_KEYS.has(key) || COUNT_KEY_SUFFIX.test(key);
  return countKey && Number.isInteger(value) && value >= 0 && value < COUNT_LIMIT ? value : '[number]';
}

/** `key` is the key as the caller wrote it: content-key rules apply to it before it is renamed. */
function sanitizeValue(key: string, value: unknown): SafeValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Error) return describeError(value);
  if (typeof value === 'boolean') return value;
  if (isContentKey(key)) return shapeOf(value);
  if (typeof value === 'number') return sanitizeNumber(key, value);
  if (typeof value === 'string') return isSafeString(value) ? value : shapeOf(value);
  return shapeOf(value);
}

function sanitizeKey(key: string, index: number): string {
  return SAFE_KEY.test(key) ? key : `field${String(index)}`;
}

/** Pure: turns an event + arbitrary fields into a record that is safe to print. */
export function buildRecord(level: LogLevel, event: string, fields: LogFields = {}): LogRecord {
  const safeFields: Record<string, SafeValue> = {};
  Object.entries(fields).forEach(([key, value], index) => {
    safeFields[sanitizeKey(key, index)] = sanitizeValue(key, value);
  });
  return { level, event: EVENTS.has(event) ? event : shapeOf(event), fields: safeFields };
}

const consoleSink: LogSink = (record) => {
  const line = `[attest] ${JSON.stringify({ level: record.level, event: record.event, ...record.fields })}`;
  // The single sanctioned console call site in the codebase (no-console is off for this file only).
  console[record.level](line);
};

/** `info` in every build; there is no runtime switch (Decisions.md). Tests lower it with setLogLevel. */
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

function emit(level: LogLevel, event: LogEvent, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  currentSink(buildRecord(level, event, fields));
}

export const log = {
  debug: (event: LogEvent, fields?: LogFields): void => {
    emit('debug', event, fields);
  },
  info: (event: LogEvent, fields?: LogFields): void => {
    emit('info', event, fields);
  },
  warn: (event: LogEvent, fields?: LogFields): void => {
    emit('warn', event, fields);
  },
  error: (event: LogEvent, fields?: LogFields): void => {
    emit('error', event, fields);
  },
} as const;
