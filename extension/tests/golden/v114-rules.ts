/**
 * The contract v1.14 rule the golden suite must prove (docs/grading.md v1.14 §6.1; tech re-review TECH-R2): a
 * `gmail.sent` entry synced before an email claim's grace sync, max(end(p,t) + graceMin, end(p,t) + afterClaimMin),
 * counts at most as `partial` (`coverage.list_unsettled`). A Sent list read before it shows a reply sent elsewhere
 * then never makes the claim NOT_FOUND, while a view synced after the grace sync still can, and a row an early view
 * saw still verifies. The tag is a `contract:<tag>` some scenario must carry, with a predicate that the tagged
 * scenario really exercises the rule; v114-rules.spec.ts shows it fails on broken copies of its file.
 */
import { type PolicyView } from './build';
import { claimOf, minutes, minuteWindow, type Proof } from './proof-helpers';
import { type Scenario, type ScenarioClaim, type ScenarioCoverage } from './scenario-schema';
import { instantMs } from './time';

const sentEntries = (s: Scenario): ScenarioCoverage[] =>
  s.input.coverage.filter((e) => e.source === 'gmail.sent');

/** The claim's grace sync (§6.1), in epoch ms. */
function graceSync(claim: ScenarioClaim, policy: PolicyView): number {
  const { end } = minuteWindow(claim, policy);
  return end + minutes(Math.max(policy.windows.graceMin, policy.windows.afterClaimMin));
}

/** Whether the union of `entries` contains [from, to] (closed intervals, no gap). */
function contains(entries: readonly ScenarioCoverage[], from: number, to: number): boolean {
  let reached = from;
  for (const e of [...entries].sort((a, b) => instantMs(a.windowStart) - instantMs(b.windowStart))) {
    if (instantMs(e.windowStart) > reached) return false;
    // A window that ends before the point reached adds nothing: a point span is held only by a window over it.
    if (instantMs(e.windowEnd) < reached) continue;
    reached = instantMs(e.windowEnd);
    if (reached >= to) return true;
  }
  return false;
}

/**
 * §6.1 v1.14: an email claim whose window every Sent entry together contains, but only with an entry synced before
 * its grace sync, is UNVERIFIABLE with `coverage.list_unsettled` (v1.13 made it NOT_FOUND); another, contained by
 * entries synced after its grace sync, is NOT_FOUND; and a claim is VERIFIED by a row seen before its grace sync.
 */
const sentListUnsettled: Proof = (s, policy) => {
  const entries = sentEntries(s);
  const capped = s.expect.some((e) => {
    const claim = claimOf(s, e);
    if (claim?.type !== 'email.sent' || e.grade !== 'UNVERIFIABLE') return false;
    const { from, to } = minuteWindow(claim, policy);
    const settled = entries.filter((x) => instantMs(x.lastSyncAt) >= graceSync(claim, policy));
    return (
      e.reasonCodes.includes('coverage.list_unsettled') &&
      contains(entries, from, to) &&
      !contains(settled, from, to)
    );
  });
  const found = s.expect.some((e) => {
    const claim = claimOf(s, e);
    if (claim?.type !== 'email.sent' || e.grade !== 'NOT_FOUND') return false;
    const { from, to } = minuteWindow(claim, policy);
    return contains(
      entries.filter((x) => instantMs(x.lastSyncAt) >= graceSync(claim, policy)),
      from,
      to,
    );
  });
  const verifiedEarly = s.expect.some((e) => {
    const claim = claimOf(s, e);
    const row = s.input.observations.find((o) => o.ref === e.observationRefs[0]);
    return (
      claim?.type === 'email.sent' &&
      e.grade === 'VERIFIED' &&
      row?.observedAt !== undefined &&
      instantMs(row.observedAt) < graceSync(claim, policy)
    );
  });
  return capped && found && verifiedEarly;
};

export const V114_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['sent_list_unsettled_capped', sentListUnsettled],
];
