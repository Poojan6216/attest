/**
 * The contract v1.3 text rules (docs/grading.md v1.3 §5.1, §11): a bidi embedding is unread like an override,
 * subjects fold compatibility digits with NFKC on purpose, and merchant text that counterparty() rejects scores 0
 * on the observation side and is not applicable on the claim side. Each proof says whether a tagged scenario
 * really exercises its rule (a reader that only strips the controls, or never folds the digits, would grade it
 * differently); v13-rules.ts collects them with the other v1.3 rules.
 */
import { receiptOnlyType } from './checks-claims';
import { bestOf, claimOf, type Proof } from './proof-helpers';
import {
  type ExpectedReceipt,
  type Scenario,
  type ScenarioClaim,
  type ScenarioObservation,
} from './scenario-schema';

/** §11 v1.3: the embeddings and overrides that make a string unread (marks and isolates are only stripped). */
const UNREAD_BIDI = /[\u202A\u202B\u202D\u202E]/u;
const EMBEDDING = /[\u202A\u202B]/u;
/** Every bidi control, mark and isolate: what a reader that only strips them would remove. */
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
/** A `\p{No}` digit (superscripts, subscripts, circled digits, fractions). */
const OTHER_NUMBER = /\p{No}/u;

const stripped = (text: string): string => text.replace(BIDI_CONTROLS, '');
const lower = (text: string): string => text.toLowerCase();

/** An address claim with an embedding in the evidence's subject only: not VERIFIED (stripping would verify). */
const subjectEmbedding = (s: Scenario, e: ExpectedReceipt): boolean => {
  const claim = claimOf(s, e);
  const seen = bestOf(s, e);
  const subject = seen?.subjectHint ?? '';
  return (
    claim?.subjectHint !== undefined &&
    !UNREAD_BIDI.test(claim.subjectHint) &&
    EMBEDDING.test(subject) &&
    stripped(subject) === claim.subjectHint &&
    claim.counterparty === seen?.counterparty &&
    e.observationRefs.length === 1 &&
    e.grade !== 'VERIFIED'
  );
};

/** A name claim with an embedding whose stripped text is an observation's local part: underspecified. */
const nameEmbedding = (s: Scenario, e: ExpectedReceipt): boolean => {
  const name = claimOf(s, e)?.counterparty ?? '';
  const readable = lower(stripped(name));
  const lookalike = s.input.observations.some(
    (o) => o.type === claimOf(s, e)?.type && o.counterparty?.split('@')[0] === readable,
  );
  return !name.includes('@') && EMBEDDING.test(name) && lookalike && e.ruleId === 'underspecified';
};

/** §11 v1.3: an embedding (U+202A, U+202B) makes a subject and a name unread, exactly like an override. */
const bidiEmbeddingUnread: Proof = (s) =>
  s.expect.some((e) => subjectEmbedding(s, e)) && s.expect.some((e) => nameEmbedding(s, e));

/** §11 v1.3: subjects fold compatibility digits with NFKC (Q³ → q3), so the pair verifies at 1/1. */
const subjectCompatDigits: Proof = (s) =>
  s.expect.some((e) => {
    const claimed = claimOf(s, e)?.subjectHint ?? '';
    const subject = bestOf(s, e)?.subjectHint ?? '';
    return (
      !OTHER_NUMBER.test(claimed) &&
      OTHER_NUMBER.test(subject) &&
      subject.normalize('NFKC') === claimed &&
      e.grade === 'VERIFIED' &&
      e.score === '1/1'
    );
  });

const sameAmount = (claim: ScenarioClaim, o: ScenarioObservation): boolean =>
  claim.amountCents !== undefined && claim.amountCents === o.amountCents && claim.currency === o.currency;

/** Observation side: a receipt whose merchant reads as the claim's only once stripped is not VERIFIED. */
const rejectedOnObservation = (s: Scenario, e: ExpectedReceipt): boolean => {
  const claim = claimOf(s, e);
  const seen = bestOf(s, e);
  if (claim?.counterparty === undefined || seen?.merchant === undefined) return false;
  return (
    !UNREAD_BIDI.test(claim.counterparty) &&
    UNREAD_BIDI.test(seen.merchant) &&
    lower(stripped(seen.merchant)) === lower(claim.counterparty) &&
    sameAmount(claim, seen) &&
    e.observationRefs.length === 1 &&
    e.grade !== 'VERIFIED'
  );
};

/** Claim side: merchantMatch is not applicable, so an exact amount against another merchant is 1/1. */
const rejectedOnClaim = (s: Scenario, e: ExpectedReceipt): boolean => {
  const claim = claimOf(s, e);
  const seen = bestOf(s, e);
  if (claim?.counterparty === undefined || seen?.merchant === undefined) return false;
  return (
    UNREAD_BIDI.test(claim.counterparty) &&
    lower(seen.merchant) !== lower(stripped(claim.counterparty)) &&
    sameAmount(claim, seen) &&
    e.grade === 'VERIFIED' &&
    e.score === '1/1'
  );
};

/** §5.1 v1.3: merchant text counterparty() rejects has no name tokens (claim: not applicable; observation: 0). */
const merchantRejectedText: Proof = (s, policy) => {
  const purchases = s.expect.filter((e) => receiptOnlyType(claimOf(s, e)?.type ?? '', policy));
  return purchases.some((e) => rejectedOnObservation(s, e)) && purchases.some((e) => rejectedOnClaim(s, e));
};

export const TEXT_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['bidi_embedding_unread', bidiEmbeddingUnread],
  ['subject_compat_digits', subjectCompatDigits],
  ['merchant_rejected_text', merchantRejectedText],
];
