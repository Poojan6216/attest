/**
 * The canonical schemas' length caps and branded primitives (docs/grading.md §3, §13; build_spec §7): every free-text
 * string and every array is capped (SCHEMA_LIMITS, SECURITY-4, Hard Rule 2), and ids, hashes and timestamps are
 * branded, so a plain string cannot pass for a `Ulid` without a parse. ./schema.ts re-exports what callers use; these
 * live apart so schema.ts stays one readable page and modules it re-exports can build on them without an import cycle
 * (sprint_5 5.0). PURE: no I/O, no clock, no locale (Hard Rule 4).
 * This file is exempt from the core no-literal rule for SCHEMA_LIMITS only: a length cap is schema, not policy.
 */
import { z } from 'zod';

import { componentId } from './schema-text';

/** Length caps on every free-text string and every array (SECURITY-4, Hard Rule 2; Decisions [0.close]). */
export const SCHEMA_LIMITS = Object.freeze({
  /** RFC 5321: 64-char local part + '@' + 255-char domain. */
  COUNTERPARTY: 320,
  MERCHANT: 120,
  CONVERSATION_ID: 128,
  /** Adapter, observer, extractor and rule ids; versions; signal names; health reason codes. */
  ID: 64,
  /** One scope, allowlist entry, or override reason. */
  ITEM: 120,
  /** Reasons on one receipt or health report (receipt signals are a closed set of names, §8). */
  REASONS: 32,
  /** Entries in one grant list (allowlist, declared or observed scopes). */
  LIST: 200,
  /** Items in one bus batch, observation ids on one receipt. */
  BATCH: 500,
  META_VALUE: 256,
  /** build_spec §7: the first 200 characters of a request, for display only. */
  TEXT_HINT: 200,
  /** Hard Rule 2: a subject hint is at most 80 characters. */
  SUBJECT_HINT: 80,
  /** Characters in one timestamp: `YYYY-MM-DDThh:mm:ss.fffffffff+hh:mm` (nanoseconds, numeric offset; a `Z` one of
   *  that length carries up to 14 fraction digits). Bounds storage, not precision. */
  ISO_TS: 35,
  /** docs/grading.md §13: every amountCents is an integer in [0, 10^12]. */
  AMOUNT_CENTS: 1_000_000_000_000,
  /** Account hashes bound to one source in a grant. */
  ACCOUNTS: 32,
  /** Coverage entries in one grading input; items in each Activity list. */
  GRADING_INPUT: 10_000,
});

const L = SCHEMA_LIMITS;

const ULID_UPPER = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const RULE_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Uppercase Crockford only, the form `idFromHash` emits: one id has exactly one spelling (Hard Rule 4). */
export const Ulid = z.ulid().regex(ULID_UPPER, 'expected an uppercase ULID').brand<'Ulid'>();
export const Sha256 = z.string().regex(SHA256_HEX, 'expected lowercase hex SHA-256').brand<'Sha256'>();
/** ISO 8601 with an explicit offset (`Z` or `±hh:mm`). */
export const IsoTs = z.iso.datetime({ offset: true }).max(L.ISO_TS).brand<'IsoTs'>();
/** Integer minor units, never negative (a refund cannot lower cumulative spend, §6.3). */
export const AmountCents = z.number().int().min(0).max(L.AMOUNT_CENTS);
/** ISO 4217 alphabetic code, uppercase (the form normalize.amount emits), so equal currencies compare equal. */
export const Currency = z.string().regex(/^[A-Z]{3}$/, 'expected an uppercase ISO 4217 code');

/**
 * A local calendar day, `YYYY-MM-DD`, in ASCII digits (Decisions [5.6]): the one pattern of the telemetry payload's day,
 * its sent day, the `telemetry.send` answer and the digest's weeks (Sprint 5 close, tech review TECH-7).
 */
export const DAY_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
/** Rule ids end up in receipts and logs, so they are plain snake_case identifiers. */
export const RuleId = z.string().max(L.ID).regex(RULE_ID, 'expected a snake_case rule id');

/** An adapter, observer or extractor id, or a version: one short token, never content (Hard Rule 2). */
export const ComponentId = componentId(L.ID);
/** A developer-chosen name (feature, signal, param): never content (Hard Rule 10). */
export const Key = z.string().max(L.ID).regex(IDENTIFIER, 'expected an identifier');
export const UnitInterval = z.number().min(0).max(1);

export type Ulid = z.infer<typeof Ulid>;
export type Sha256 = z.infer<typeof Sha256>;
export type IsoTs = z.infer<typeof IsoTs>;
export type Currency = z.infer<typeof Currency>;
export type RuleId = z.infer<typeof RuleId>;
