/**
 * What the advisory model sees (sprint_5 5.1; agents/intel_engineer.md rules 2 and 3; Hard Rule 2): one claim and its
 * candidates, each projected onto its allowlisted structured fields, and nothing else. The claim: its type, its
 * normalised counterparty, its subject hint, its amount in minor units and the instant it is about (a calendar
 * claim's event start, else when the agent says it acted). Each candidate: its id, type, normalised counterparty,
 * normalised merchant, subject hint, amount and instant. Never page text, never what the person asked an agent (a
 * Request's `textHint`: no request reaches this module), never a field a row carries beyond these (a stored row's index
 * fields among them): the projection names each field it keeps, and a strict schema refuses anything more. A field
 * the row lacks is left out, never filled in.
 */
import { z } from 'zod';

import { asciiLower, counterparty as readCounterparty, name } from '../core/normalize';
import {
  ActionType,
  AmountCents,
  type Claim,
  IsoTs,
  type Observation,
  SCHEMA_LIMITS,
  Ulid,
} from '../core/schema';

const L = SCHEMA_LIMITS;
const text = (max: number) => z.string().min(1).max(max);

export const IntelClaim = z.strictObject({
  type: ActionType,
  counterparty: text(L.COUNTERPARTY).optional(),
  subjectHint: text(L.SUBJECT_HINT).optional(),
  amountCents: AmountCents.optional(),
  occurredAt: IsoTs,
});

export const IntelCandidate = z.strictObject({
  id: Ulid,
  type: ActionType,
  counterparty: text(L.COUNTERPARTY).optional(),
  merchant: text(L.MERCHANT).optional(),
  subjectHint: text(L.SUBJECT_HINT).optional(),
  amountCents: AmountCents.optional(),
  occurredAt: IsoTs,
});

/** One model call's data: a claim and its candidates (at most `SCHEMA_LIMITS.BATCH`). */
export const IntelInput = z.strictObject({
  claim: IntelClaim,
  candidates: z.array(IntelCandidate).min(1).max(L.BATCH),
});

export type IntelClaim = z.infer<typeof IntelClaim>;
export type IntelCandidate = z.infer<typeof IntelCandidate>;
export type IntelInput = z.infer<typeof IntelInput>;

/** A counterparty as the model reads it: an address in ASCII lower case, or a name's tokens; nothing when neither. */
function normalised(raw: string | undefined): string | undefined {
  const read = readCounterparty(raw);
  if (read === null) return undefined;
  const value = read.kind === 'address' ? asciiLower(read.address) : read.tokens.join(' ');
  return value === '' ? undefined : value;
}

/** Each key whose value is defined, so a field the row lacks is left out (`exactOptionalPropertyTypes`). */
const kept = <T extends Record<string, unknown>>(fields: T): T =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;

/** The claim's projection (header): five fields, the instant a calendar claim's event start. */
export function claimInput(claim: Claim): IntelClaim {
  return kept({
    type: claim.type,
    counterparty: normalised(claim.counterparty),
    subjectHint: claim.subjectHint,
    amountCents: claim.amountCents,
    occurredAt: claim.targetAt ?? claim.claimedAt,
  });
}

/** A candidate's projection (header): seven fields, its merchant as `name()` reads it. */
export function candidateInput(observation: Observation): IntelCandidate {
  const merchant = observation.merchant === undefined ? undefined : name(observation.merchant);
  return kept({
    id: observation.id,
    type: observation.type,
    counterparty: normalised(observation.counterparty),
    merchant: merchant === '' ? undefined : merchant,
    subjectHint: observation.subjectHint,
    amountCents: observation.amountCents,
    occurredAt: observation.occurredAt,
  });
}

/** The model's data for `claim` and `candidates` (header), parsed by its strict schema before it goes anywhere. */
export function buildInput(claim: Claim, candidates: readonly Observation[]): IntelInput {
  return IntelInput.parse({ claim: claimInput(claim), candidates: candidates.map(candidateInput) });
}
