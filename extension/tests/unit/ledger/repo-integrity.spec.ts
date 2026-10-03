/**
 * SEC-V1 (Hard Rule 2): the ledger stores an observation only if `redact.project()` could have returned it under
 * the caller's policy. The bus schema cannot tell (it has no policy), so `upsertObservation` is the one choke
 * point: a field its source never stores, a contentHash of the sender's choosing, content edited after
 * projection, or text that is not one line (SEC-3) is refused with `invalid_input` before anything is written,
 * and the error names fields, never values (Hard Rule 10). The allowlist comes only from a policy `loadPolicy`
 * returned: a copy, widened or not, is refused with `PolicyError('policy_not_loaded')`.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import defaultPolicyJson from '../../../../policy/default.json';
import { idFromHash, sha256Hex } from '../../../src/core/hash';
import { DEFAULT_POLICY, loadPolicy, type Policy, PolicyError } from '../../../src/core/policy';
import {
  CONTENT_FIELDS,
  contentHashOf,
  observationIntegrityProblems,
  project,
} from '../../../src/core/redact';
import { Observation } from '../../../src/core/schema';
import { BusMessage } from '../../../src/bus/messages';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getObservation, upsertObservation } from '../../../src/ledger/repo';
import type { ObservationInput } from '../../../src/ledger/types';
import { expectLedgerError, pinClock, releaseClock, uniqueDbName } from './fixtures';

const OCCURRED = '2026-10-01T10:15:00-04:00';
const OBSERVED = '2026-10-01T10:20:00-04:00';
const SECRETS = ['4417', '078-05-1120', 'Priya'];

/** The security review's probe: a gcal.event row carrying receipt fields and a contentHash of its choosing. */
const FORGED_HASH = sha256Hex('anything at all');
const FORGED: ObservationInput = {
  id: idFromHash(FORGED_HASH),
  source: 'gcal.event',
  type: 'calendar.created',
  merchant: 'door code 4417 SSN 078-05-1120',
  amountCents: 7805,
  currency: 'USD',
  subjectHint: 'Q3 sync',
  occurredAt: OCCURRED,
  observedAt: OBSERVED,
  contentHash: FORGED_HASH,
};

/** What an honest observer sends: project() of a raw row, under the loaded policy. */
const honest = (raw: Record<string, unknown>, rowKey = 'row-1'): ObservationInput =>
  project(
    'gmail.sent',
    { occurredAt: OCCURRED, ...raw },
    { type: 'email.sent', observedAt: OBSERVED, rowKey },
    DEFAULT_POLICY,
  );

/**
 * `fields` with an honest contentHash and id, so only the allowlist or the schema can object. z.custom accepts
 * anything: it hands the repo a value the type system would refuse, as an untyped sender could.
 */
function sealed(fields: Record<string, unknown>): ObservationInput {
  const contentHash = contentHashOf(fields);
  return z.custom<ObservationInput>().parse({ ...fields, contentHash, id: idFromHash(contentHash) });
}

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('integrity'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

async function expectRefused(input: ObservationInput, paths: string): Promise<void> {
  const error = await expectLedgerError(upsertObservation(db, input, DEFAULT_POLICY), 'invalid_input');
  expect(error.context).toStrictEqual({ table: 'observations', paths });
  const shown = `${error.message} ${JSON.stringify(error.context)}`;
  for (const secret of SECRETS) expect(shown).not.toContain(secret);
  expect(await db.observations.count()).toBe(0);
}

describe('upsertObservation stores what project() returns', () => {
  it('stores every honest projection and reads it back exactly', async () => {
    const sent = honest({ counterparty: 'priya@company.com', subjectHint: 'Q3 deck' });
    const receipt = project(
      'gmail.receipt',
      { merchant: 'Acme Books', amountCents: 1250, currency: 'USD', occurredAt: OCCURRED },
      { type: 'purchase.made', observedAt: OBSERVED },
      DEFAULT_POLICY,
    );
    const event = project(
      'gcal.event',
      { counterparty: 'priya@company.com', subjectHint: 'Q3 sync', occurredAt: OCCURRED },
      { type: 'calendar.created', observedAt: OBSERVED, rowKey: 'evt-1' },
      DEFAULT_POLICY,
    );
    for (const observation of [sent, receipt, event]) {
      expect(await upsertObservation(db, observation, DEFAULT_POLICY)).toEqual({
        id: observation.id,
        inserted: true,
      });
      expect(await getObservation(db, observation.id)).toEqual(observation);
    }
  });
});

describe('upsertObservation refuses what project() could not have returned', () => {
  it('refuses the forged gcal.event row that the bus schema accepts, writing nothing', async () => {
    const message = {
      type: 'observer.observations',
      observerId: 'gcal',
      version: '1.0.0',
      observations: [FORGED],
    };
    expect(BusMessage.safeParse(message).success).toBe(true); // the bus has no policy: the ledger is the gate
    await expectRefused(FORGED, 'merchant|amountCents|currency|contentHash');
  });

  it('refuses a field the source never stores even under an honest hash', async () => {
    const fields = Object.fromEntries(
      Object.entries(FORGED).filter(([key]) => key !== 'id' && key !== 'contentHash'),
    );
    await expectRefused(sealed(fields), 'merchant|amountCents|currency');
  });

  it('refuses a self-chosen contentHash (with its matching id) on an otherwise honest row', async () => {
    const chosen = sha256Hex('a hash of my choosing');
    const row = {
      ...honest({ counterparty: 'priya@company.com' }),
      contentHash: chosen,
      id: idFromHash(chosen),
    };
    await expectRefused(row, 'contentHash');
  });

  it('refuses content edited after projection, so a stored row cannot be shadowed', async () => {
    const original = honest({ counterparty: 'priya@company.com', subjectHint: 'Q3 deck' });
    await upsertObservation(db, original, DEFAULT_POLICY);
    const shadow = { ...original, subjectHint: 'Priya: the door code is 4417' };
    await expectLedgerError(upsertObservation(db, shadow, DEFAULT_POLICY), 'invalid_input');
    expect(await getObservation(db, original.id)).toEqual(original);
    expect(await db.observations.count()).toBe(1);
  });
});

describe('upsertObservation: one-line text and the caller policy', () => {
  it('refuses a multi-line counterparty (SEC-3) at the schema, before the integrity check', async () => {
    const body = 'Hi Priya,\nthe door code is 4417 and my SSN is 078-05-1120. Thanks';
    const row = sealed({
      source: 'gmail.sent',
      type: 'email.sent',
      counterparty: body,
      occurredAt: OCCURRED,
      observedAt: OBSERVED,
    });
    await expectRefused(row, 'counterparty');
  });

  it('checks against the policy it is given', async () => {
    const policy = loadPolicy({
      ...defaultPolicyJson,
      allowlistedFields: {
        ...defaultPolicyJson.allowlistedFields,
        'gcal.event': [...defaultPolicyJson.allowlistedFields['gcal.event'], 'merchant'],
      },
    });
    const row = sealed({
      source: 'gcal.event',
      type: 'calendar.created',
      merchant: 'Acme',
      occurredAt: OCCURRED,
      observedAt: OBSERVED,
    });
    await expectLedgerError(upsertObservation(db, row, DEFAULT_POLICY), 'invalid_input');
    expect(await upsertObservation(db, row, policy)).toEqual({ id: row.id, inserted: true });
  });

  it('refuses a policy loadPolicy did not return, so a widened copy cannot widen the allowlist', async () => {
    const widened = z.custom<Policy>().parse({
      ...DEFAULT_POLICY,
      allowlistedFields: { ...DEFAULT_POLICY.allowlistedFields, 'gcal.event': [...CONTENT_FIELDS] },
    });
    const row = sealed(
      Object.fromEntries(Object.entries(FORGED).filter(([key]) => key !== 'id' && key !== 'contentHash')),
    );
    expect(observationIntegrityProblems(Observation.parse(row), widened)).toStrictEqual([]);
    for (const policy of [widened, { ...DEFAULT_POLICY }]) {
      await expect(upsertObservation(db, row, policy)).rejects.toMatchObject({
        name: 'PolicyError',
        code: 'policy_not_loaded',
      });
      await expect(upsertObservation(db, honest({}), policy)).rejects.toBeInstanceOf(PolicyError);
    }
    expect(await db.observations.count()).toBe(0);
  });
});
