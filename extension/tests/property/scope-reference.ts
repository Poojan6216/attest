/**
 * docs/grading.md §6.3 written out from the contract, independently of scope.ts (no run, no index, no shared
 * helper): the reference `priorSpendCents` and `spendIndex` are held to, and the batch oracle's prior spend. A
 * rule the two share (the claim never counts its own id, whatever copy holds it) is so checked against the
 * contract, not only one against the other.
 *
 * Not a test file: scope.property.spec.ts and the batch oracle (tests/unit/core/batch-oracle.ts) share it.
 */
import { instantMs } from '../../src/core/normalize';
import type { SpendClaim, SpendPolicy } from '../../src/core/scope';
import { MS_PER_DAY } from '../../src/core/units';

/**
 * The largest `amountCents` per id over the same agent's claims of a `policy.spendTypes` type counted in the
 * claim's currency (a missing currency, on either side, read as `spendCurrency`), with `claimedAt` in
 * `[t − spendWindowDays, t]` and strictly before the claim in (instant, id) order, never the claim's own id; summed
 * exactly and reported as at most `Number.MAX_SAFE_INTEGER`. 0 for a claim whose type is not a spend type.
 */
export function referencePriorSpend(
  claim: SpendClaim,
  claims: readonly SpendClaim[],
  policy: SpendPolicy,
  spendCurrency: string | undefined,
): number {
  const spendTypes: readonly string[] = policy.spendTypes;
  if (!spendTypes.includes(claim.type)) return 0;
  const counted = (currency: string | undefined) => currency ?? spendCurrency;
  const t = instantMs(claim.claimedAt);
  const from = t - policy.windows.spendWindowDays * MS_PER_DAY;
  const largest = new Map<string, number>();
  for (const prior of claims) {
    const ms = instantMs(prior.claimedAt);
    const before = ms < t || (ms === t && prior.id < claim.id);
    const same = prior.agent === claim.agent && counted(prior.currency) === counted(claim.currency);
    if (prior.id === claim.id || !same || !spendTypes.includes(prior.type) || !before || ms < from) continue;
    largest.set(prior.id, Math.max(largest.get(prior.id) ?? 0, prior.amountCents ?? 0));
  }
  const total = [...largest.values()].reduce((sum, amount) => sum + BigInt(amount), 0n);
  return total > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(total);
}
