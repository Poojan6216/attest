/**
 * Scope and spend (docs/grading.md §6.1, §6.3; module contract §13; sprint task 1.8).
 *
 *  - `priorSpendCents(claim, claims, policy)`: what the same agent already claimed to spend in the claim's
 *    currency over the rolling `windows.spendWindowDays` before the claim (§6.3). `grade()` adds the claim's
 *    own amount and compares with the grant's ceiling (condition `cumulativeAboveCeiling`), so two $30
 *    purchases against a $50 ceiling make the second OVER_SCOPE.
 *  - `scopeSubjects(grant)`: the permissions the vendor's settings page shows the agent holds that the user
 *    did not declare. `gradeBatch` grades each one as a claim-less `over_scope_observed` receipt (§6.1).
 *
 * Integer arithmetic only (amounts are integer minor units, instants integer ms). PURE: no I/O, no clock, no
 * logging (Hard Rule 4).
 */
import { instantMs } from './normalize';
import type { Policy } from './policy';
import type { ActionType, AgentId } from './schema';
import { MS_PER_DAY } from './units';

/** The claim fields cumulative spend reads. A parsed `Claim` satisfies it. */
export interface SpendClaim {
  readonly id: string;
  readonly agent: AgentId;
  readonly type: ActionType;
  readonly amountCents?: number | undefined;
  readonly currency?: string | undefined;
  readonly claimedAt: string;
}

/** The policy fields cumulative spend reads. A loaded `Policy` satisfies it. */
export type SpendPolicy = Pick<Policy, 'spendTypes' | 'windows'>;

/** The grant fields the scope diff reads. A parsed `Grant` satisfies it. */
export interface ScopeGrant {
  readonly declaredScopes: readonly string[];
  readonly observedScopes?: readonly string[] | undefined;
}

export type ScopeErrorCode =
  /** An `amountCents` that is not a non-negative safe integer (the Claim schema never produces one). */
  | 'invalid_amount'
  /** The spend window's start left the safe-integer range, where milliseconds would be rounded. */
  | 'unsafe_window';

/** Spend input that cannot be summed exactly: fail loud rather than compare a wrong total (Hard Rule 6). */
export class ScopeError extends Error {
  constructor(readonly code: ScopeErrorCode) {
    super(`scope: ${code}`);
    this.name = 'ScopeError';
  }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

interface Parsed {
  readonly text: string;
  readonly ms: number;
}

/**
 * `instantMs(claim.claimedAt)`, parsed once per claim object and text. A batch asks for the prior spend of every
 * spend claim against the same history, and ISO parsing would dominate that loop (task 1.5 perf gate). The memo
 * is weakly held and used only while the field still holds the text it was parsed from, so a claim edited in
 * place is never read at its old instant (the same rule as candidates-time.ts). Pure: a memo never changes a
 * result.
 */
const CLAIMED_MS = new WeakMap<SpendClaim, Parsed>();

function claimedMs(claim: SpendClaim): number {
  const cached = CLAIMED_MS.get(claim);
  if (cached?.text === claim.claimedAt) return cached.ms;
  const ms = instantMs(claim.claimedAt);
  CLAIMED_MS.set(claim, { text: claim.claimedAt, ms });
  return ms;
}

/** `(claimedAt ms, id)` order: strictly earlier instant, or the same instant and a smaller id (§6.3). */
function strictlyBefore(ms: number, id: string, claimMs: number, claimId: string): boolean {
  return ms < claimMs || (ms === claimMs && id < claimId);
}

function amountOf(prior: SpendClaim): number {
  const amount = prior.amountCents ?? 0;
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ScopeError('invalid_amount');
  return amount;
}

/**
 * §6.3: the sum of `amountCents` over the same agent's claims whose type is in `policy.spendTypes`, in the
 * claim's currency (a claim without a currency counts only priors without one), with `claimedAt` in
 * `[t − spendWindowDays, t]` and strictly before the claim in `(claimedAt ms, id)` order. The claim itself
 * never counts. A claim id listed more than once counts once (at its largest qualifying amount), so passing
 * the batch claims together with the ledger's claims cannot double-count. Amounts are never negative, so
 * the result is ≥ 0 and a refund cannot lower it. A total beyond `Number.MAX_SAFE_INTEGER` is reported as
 * that value: it already exceeds every ceiling the schema allows (≤ 10^12), so the decision is unchanged.
 *
 * A claim whose own type is not a spend type has no cumulative spend (condition `cumulativeAboveCeiling`
 * never applies to it): 0, so its hashed context does not change whenever the agent buys something.
 */
export function priorSpendCents(
  claim: SpendClaim,
  claims: readonly SpendClaim[],
  policy: SpendPolicy,
): number {
  const spendTypes: ReadonlySet<ActionType> = new Set(policy.spendTypes);
  if (!spendTypes.has(claim.type)) return 0;
  const claimMs = claimedMs(claim);
  const fromMs = claimMs - policy.windows.spendWindowDays * MS_PER_DAY;
  if (!Number.isSafeInteger(fromMs)) throw new ScopeError('unsafe_window');
  const amounts = new Map<string, number>();
  for (const prior of claims) {
    if (prior.agent !== claim.agent || prior.currency !== claim.currency || !spendTypes.has(prior.type)) {
      continue;
    }
    const ms = claimedMs(prior);
    if (ms < fromMs || !strictlyBefore(ms, prior.id, claimMs, claim.id)) continue;
    amounts.set(prior.id, Math.max(amounts.get(prior.id) ?? 0, amountOf(prior)));
  }
  let total = 0n;
  for (const amount of amounts.values()) total += BigInt(amount);
  return total > MAX_SAFE ? Number.MAX_SAFE_INTEGER : Number(total);
}

/**
 * One agent's claims in one currency (or none) whose type is a spend type, in (`claimedAt` ms, id) order, with the
 * running sum of their amounts (`sums[i]` is the total of the first i). Regular when every `claimedAt` parses,
 * every amount is a non-negative safe integer, no id repeats and the whole total is a safe integer: then the
 * total over any run of entries is one exact subtraction. Anything else is answered by `priorSpendCents` itself.
 */
interface SpendRun {
  readonly ms: readonly number[];
  readonly ids: readonly string[];
  readonly sums: readonly number[];
}

/**
 * A repeated id makes a run irregular wherever its copies sit: `priorSpendCents` counts an id once (at its largest
 * qualifying amount), and copies of one id need not be neighbours in (ms, id) order (one claim read at 14:02:10
 * and again at 14:02:50 shares its id, §10, with another claim between them), so every id is checked, not only
 * adjacent ones.
 */
function buildRun(priors: readonly SpendClaim[]): SpendRun | null {
  const entries: { ms: number; id: string; amount: number }[] = [];
  const seen = new Set<string>();
  for (const prior of priors) {
    const amount = prior.amountCents ?? 0;
    if (!Number.isSafeInteger(amount) || amount < 0 || seen.has(prior.id)) return null;
    seen.add(prior.id);
    try {
      entries.push({ ms: claimedMs(prior), id: prior.id, amount });
    } catch {
      return null;
    }
  }
  entries.sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sums = [0];
  for (const [i, entry] of entries.entries()) sums.push((sums[i] ?? 0) + entry.amount);
  if ((sums[entries.length] ?? 0) > Number.MAX_SAFE_INTEGER) return null;
  return { ms: entries.map((entry) => entry.ms), ids: entries.map((entry) => entry.id), sums };
}

/** The number of leading entries of `run` before (`ms`, `id`) in (ms, id) order (`strictly` excludes ties). */
function countBefore(run: SpendRun, ms: number, id: string | null): number {
  let low = 0;
  let high = run.ms.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const at = run.ms[middle] ?? 0;
    const before = at < ms || (id !== null && at === ms && (run.ids[middle] ?? '') < id);
    if (before) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * `priorSpendCents(claim, claims, policy)` for any number of claims against one history (`claims`), the history
 * read once: per agent and currency, its spend claims sorted with running sums, so each claim's total is two binary
 * searches and a subtraction. A run that is not regular (`buildRun`) is answered by `priorSpendCents` over the
 * agent's history, so every result and every error is exactly `priorSpendCents`'s.
 */
export function spendIndex(
  claims: readonly SpendClaim[],
  policy: SpendPolicy,
): (claim: SpendClaim) => number {
  const spendTypes: ReadonlySet<ActionType> = new Set(policy.spendTypes);
  const byAgent = new Map<AgentId, SpendClaim[]>();
  for (const claim of claims) {
    const held = byAgent.get(claim.agent);
    if (held === undefined) byAgent.set(claim.agent, [claim]);
    else held.push(claim);
  }
  const runs = new Map<string, SpendRun | null>();
  const runOf = (agent: AgentId, currency: string | undefined): SpendRun | null => {
    const key = `${agent} ${currency ?? ''} ${String(currency === undefined)}`;
    if (!runs.has(key)) {
      const priors = (byAgent.get(agent) ?? []).filter(
        (prior) => prior.currency === currency && spendTypes.has(prior.type),
      );
      runs.set(key, buildRun(priors));
    }
    return runs.get(key) ?? null;
  };
  return (claim) => {
    if (!spendTypes.has(claim.type)) return 0;
    const run = runOf(claim.agent, claim.currency);
    if (run === null) return priorSpendCents(claim, byAgent.get(claim.agent) ?? [], policy);
    const claimMs = claimedMs(claim);
    const fromMs = claimMs - policy.windows.spendWindowDays * MS_PER_DAY;
    if (!Number.isSafeInteger(fromMs)) throw new ScopeError('unsafe_window');
    const from = countBefore(run, fromMs, null);
    const to = countBefore(run, claimMs, claim.id);
    return to > from ? (run.sums[to] ?? 0) - (run.sums[from] ?? 0) : 0;
  };
}

/**
 * §6.1: the scopes the vendor's settings page shows (`observedScopes`) that the user did not declare
 * (`declaredScopes`), compared exactly as stored, de-duplicated and sorted by UTF-16 code unit. Each one is
 * the subject of one claim-less `over_scope_observed` receipt (`{k: 'scope', agent, scope}`, §3). A grant
 * with no observed scopes yields none.
 */
export function scopeSubjects(grant: ScopeGrant): string[] {
  const declared: ReadonlySet<string> = new Set(grant.declaredScopes);
  const undeclared = new Set((grant.observedScopes ?? []).filter((scope) => !declared.has(scope)));
  return [...undeclared].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
