/**
 * The `claims.import` schema (src/bus/messages.ts; sprint_3 3.13; docs/claims-import.md §4): only claims the paste
 * parser read for the named agent may be imported. Added by the Sprint 3 QA review: the round-trip and send specs
 * refuse one way a claim can fail this (another extractor); each other condition, and each bound of the message and
 * of its answer, is held here on its own, one field changed at a time, so dropping any one check fails a test.
 * Every log here is invented.
 */
import { describe, expect, it } from 'vitest';

import { ClaimsImportMessage, ClaimsImportResult } from '../../../src/bus/messages';
import { idFromHash } from '../../../src/core/base32';
import { sha256Hex } from '../../../src/core/hash';
import { Claim, IsoTs, SCHEMA_LIMITS } from '../../../src/core/schema';
import { IMPORTED_CLAIM } from './harness';

const message = (fields: Record<string, unknown> = {}): unknown => ({
  type: 'claims.import',
  agent: 'muse',
  claims: [IMPORTED_CLAIM],
  activeAt: [IMPORTED_CLAIM.claimedAt],
  ...fields,
});

const accepts = (raw: unknown): boolean => ClaimsImportMessage.safeParse(raw).success;

/** The claim with one field changed, still a valid Claim on its own. */
const changed = (fields: Record<string, unknown>): Claim => Claim.parse({ ...IMPORTED_CLAIM, ...fields });

describe('claims.import: only the parser’s claims, for the agent named', () => {
  it('accepts the parser’s claim as it is (the control)', () => {
    expect(IMPORTED_CLAIM).toMatchObject({ agent: 'muse', sourceKind: 'activity_view' });
    expect(IMPORTED_CLAIM.extractor.id).toBe('import.muse');
    expect(accepts(message())).toBe(true);
  });

  it('refuses a claim of another agent, though its extractor names the import', () => {
    expect(accepts(message({ claims: [changed({ agent: 'claude' })] }))).toBe(false);
    expect(accepts(message({ agent: 'claude' }))).toBe(false);
  });

  it('refuses a claim read from a chat, or linked to a request: an activity log carries neither', () => {
    expect(accepts(message({ claims: [changed({ sourceKind: 'chat' })] }))).toBe(false);
    const requestId = idFromHash(sha256Hex('an invented request'));
    expect(accepts(message({ claims: [changed({ requestId })] }))).toBe(false);
  });

  it('refuses the whole import when any one of its claims is not the parser’s, and names that one', () => {
    const parsed = ClaimsImportMessage.safeParse(
      message({ claims: [IMPORTED_CLAIM, changed({ sourceKind: 'chat' })] }),
    );
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['claims', 1]]);
  });
});

describe('claims.import: its bounds', () => {
  it('carries at least one claim and at most an import’s worth', () => {
    expect(accepts(message({ claims: [] }))).toBe(false);
    const full = Array.from({ length: SCHEMA_LIMITS.BATCH }, () => IMPORTED_CLAIM);
    expect(accepts(message({ claims: full }))).toBe(true);
    expect(accepts(message({ claims: [...full, IMPORTED_CLAIM] }))).toBe(false);
  });

  it('carries instants only as activeAt, at most a grading input’s worth, and may carry none', () => {
    expect(accepts(message({ activeAt: [] }))).toBe(true);
    expect(accepts(message({ activeAt: ['4:33 pm'] }))).toBe(false);
    expect(accepts(message({ activeAt: ['2026-10-08T16:33:00'] }))).toBe(false);
    const minute = IsoTs.parse('2026-10-08T16:33:00-04:00');
    const full = Array.from({ length: SCHEMA_LIMITS.GRADING_INPUT }, () => minute);
    expect(accepts(message({ activeAt: full }))).toBe(true);
    expect(accepts(message({ activeAt: [...full, minute] }))).toBe(false);
  });
});

describe('ClaimsImportResult', () => {
  it('counts at least the one claim an import carries, and never more than an import’s worth', () => {
    const ok = (received: number, added: number) =>
      ClaimsImportResult.safeParse({ ok: true, received, added }).success;
    expect([ok(1, 0), ok(1, 1), ok(SCHEMA_LIMITS.BATCH, SCHEMA_LIMITS.BATCH)]).toEqual([true, true, true]);
    expect([ok(0, 0), ok(SCHEMA_LIMITS.BATCH + 1, 0), ok(1, -1), ok(1.5, 1)]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('says a refusal with one of the bus’s codes and nothing else', () => {
    expect(ClaimsImportResult.safeParse({ ok: false, code: 'id_conflict' }).success).toBe(true);
    expect(ClaimsImportResult.safeParse({ ok: false, code: 'not_a_code' }).success).toBe(false);
    expect(ClaimsImportResult.safeParse({ ok: false, code: 'failed', detail: 'x' }).success).toBe(false);
    expect(ClaimsImportResult.safeParse({ ok: true, received: 1 }).success).toBe(false);
  });
});
