/**
 * The receipts and claims of the UI read gates' ledger (sprint_4 4.0, 4.2), as the rows the ledger stores (the repo's
 * own row builders): 5,000 receipts of the four agents, graded by batches five minutes apart, ten at each batch
 * instant, the newest at the instant given, and a claim for every receipt that names one. Grades: 70% VERIFIED, 10%
 * NOT_FOUND, 10% UNASKED (no claim), 4% UNVERIFIABLE, 4% PARTIAL, 2% OVER_SCOPE. Deterministic and storage-free:
 * tests/perf/ui-ledger.ts writes them into fake-indexeddb for the Node gates, and tests/e2e/support/popup-paint.ts
 * into the built extension's own ledger in Chromium.
 */
import { idFromHash } from '../../src/core/hash';
import { type ClaimRow, type ReceiptRow, toClaimRow, toReceiptRow } from '../../src/ledger/index-fields';
import { type AgentId, Claim, type Grade, Receipt } from '../../src/ledger/types';

export const UI_RECEIPTS = 5_000;
export const UI_AGENTS: readonly AgentId[] = ['muse', 'chatgpt', 'dots', 'claude'];
const PER_BATCH = 10;
const BATCH_MS = 5 * 60_000;

/** The grade of receipt `i`, cycling through a mix of 50: 35 VERIFIED, 5 NOT_FOUND, 5 UNASKED, 2, 2 and 1 others. */
function gradeOf(i: number): Grade {
  const slot = i % 50;
  if (slot < 35) return 'VERIFIED';
  if (slot < 40) return 'NOT_FOUND';
  if (slot < 45) return 'UNASKED';
  if (slot < 47) return 'UNVERIFIABLE';
  if (slot < 49) return 'PARTIAL';
  return 'OVER_SCOPE';
}

/** A valid SHA-256 hex string from `n` (both halves, so each `n` has its own id, §10). */
export const uiSha = (n: number): string => n.toString(16).padStart(32, '0').repeat(2);
const ulid = (n: number): string => `01JA${String(n).padStart(22, '0')}`;
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * The policy hash every receipt names. A fixed hash, not the shipped policy's: the reads never load a policy, and the
 * Playwright tests cannot import policy/default.json (Node needs an import attribute for JSON).
 */
const UI_POLICY_HASH = uiSha(9_000_004);

/** The request every claim names, and the one observation every receipt names. */
export const UI_REQUEST_ID = ulid(9_000_001);
const OBSERVATION_ID = idFromHash(uiSha(9_000_002));

/** The id of receipt `i` (0 the newest). */
export const uiReceiptId = (i: number): string => ulid(i + 1);

function claimOf(i: number, agent: AgentId, gradedMs: number): Claim {
  const rawHash = uiSha(i + 1);
  return Claim.parse({
    id: idFromHash(rawHash),
    agent,
    requestId: UI_REQUEST_ID,
    type: 'email.sent',
    counterparty: 'alice@example.com',
    subjectHint: 'Quarterly numbers',
    claimedAt: iso(gradedMs - 10 * 60_000),
    claimedAtPrecision: 'minute',
    observedAt: iso(gradedMs - 5 * 60_000),
    sourceKind: 'activity_view',
    extractor: { id: `import.${agent}`, version: '1.1.0', confidence: 0.9 },
    rawHash,
  });
}

function receiptOf(i: number, agent: AgentId, gradedMs: number, state: 'PENDING' | 'FINAL'): Receipt {
  const grade = gradeOf(i);
  const common = {
    id: uiReceiptId(i),
    agent,
    observationIds: [OBSERVATION_ID],
    grade,
    confidence: 0.92,
    ruleId: 'verified',
    reasons: [{ code: 'match.best', params: { observationId: OBSERVATION_ID } }],
    signals: { timeProximity: 0.9, counterpartyExact: 1 },
    state,
    policyHash: UI_POLICY_HASH,
    inputsHash: uiSha(1),
    computedAt: iso(gradedMs),
    ...(state === 'FINAL' ? { finalAt: iso(gradedMs) } : {}),
  };
  return Receipt.parse(
    grade === 'UNASKED'
      ? { ...common, attribution: 'likely' }
      : { ...common, claimId: idFromHash(uiSha(i + 1)), requestId: UI_REQUEST_ID },
  );
}

/** The rows (header), the newest graded at `newestMs`, every receipt in `state`. */
export function uiRows(
  newestMs: number,
  state: 'PENDING' | 'FINAL',
): { readonly receipts: ReceiptRow[]; readonly claims: ClaimRow[] } {
  const receipts: ReceiptRow[] = [];
  const claims: ClaimRow[] = [];
  for (let i = 0; i < UI_RECEIPTS; i += 1) {
    const agent = UI_AGENTS[i % UI_AGENTS.length] ?? 'muse';
    const gradedMs = newestMs - Math.floor(i / PER_BATCH) * BATCH_MS;
    receipts.push(toReceiptRow(receiptOf(i, agent, gradedMs, state)));
    if (gradeOf(i) !== 'UNASKED') claims.push(toClaimRow(claimOf(i, agent, gradedMs)));
  }
  return { receipts, claims };
}
