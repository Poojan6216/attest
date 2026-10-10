/**
 * The closed sets the canonical schemas name: agents, actions, sources, grades, states, reasons and signals
 * (docs/grading.md §3, §7, §8, §15). ./schema.ts re-exports every one, so every caller imports them from there; they
 * live apart so schema.ts stays one readable page (sprint_4 close, tech review TECH-13). Like ./schema-checks, this
 * module imports nothing from ./schema. PURE (Hard Rule 4).
 */
import { z } from 'zod';

import { MATCH_FEATURES, REASON_CODES, RECEIPT_SIGNALS } from './schema-checks';

export const AgentId = z.enum(['muse', 'chatgpt', 'dots', 'claude']);

export const ActionType = z.enum([
  'email.sent',
  'calendar.created',
  'calendar.updated',
  'calendar.deleted',
  'purchase.made',
  'subscription.changed',
  'listing.posted',
  'message.sent',
  'other',
]);

export const ObservationSource = z.enum(['gmail.sent', 'gmail.receipt', 'gcal.event']);
/** The unit containing `claimedAt`, in its own UTC offset (§4.1). */
export const ClaimPrecision = z.enum(['minute', 'hour', 'day']);
export const SourceKind = z.enum(['activity_view', 'chat', 'notification', 'settings']);
export const Grade = z.enum(['VERIFIED', 'PARTIAL', 'NOT_FOUND', 'UNASKED', 'OVER_SCOPE', 'UNVERIFIABLE']);
/** The grades a user may override a receipt to (§8). */
export const OverrideGrade = z.enum(['VERIFIED', 'NOT_FOUND']);
export const ReceiptState = z.enum(['PENDING', 'FINAL', 'USER_OVERRIDDEN']);
export const UnaskedSignal = z.enum([
  'agentSessionActive',
  'userIdle',
  'agentSignature',
  'activityLogAdjacent',
]);

/** Closed, in docs/grading.md §15 table order (reasons are emitted in this order within each group). */
export const ReasonCode = z.enum(REASON_CODES);
/** The §5.1 match features; a receipt's `signals` keys are these plus `score` (§8). */
export const MatchFeature = z.enum(MATCH_FEATURES);
export const ReceiptSignal = z.enum(RECEIPT_SIGNALS);

export type AgentId = z.infer<typeof AgentId>;
export type ActionType = z.infer<typeof ActionType>;
export type ObservationSource = z.infer<typeof ObservationSource>;
export type ClaimPrecision = z.infer<typeof ClaimPrecision>;
export type SourceKind = z.infer<typeof SourceKind>;
export type Grade = z.infer<typeof Grade>;
export type OverrideGrade = z.infer<typeof OverrideGrade>;
export type MatchFeature = z.infer<typeof MatchFeature>;
export type ReceiptSignal = z.infer<typeof ReceiptSignal>;
export type ReceiptState = z.infer<typeof ReceiptState>;
export type UnaskedSignal = z.infer<typeof UnaskedSignal>;
export type ReasonCode = z.infer<typeof ReasonCode>;
