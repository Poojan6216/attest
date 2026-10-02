/**
 * Cross-field invariants of the core schemas (docs/grading.md §3, §7, §8), kept apart so schema.ts stays one
 * readable page. A leaf module: it imports nothing from ./schema, so the two never form an import cycle.
 * Each check returns the problems it found as `[field, message]`; `refineWith` turns them into Zod issues
 * whose path names the offending field. PURE (Hard Rule 4).
 */
import type { z } from 'zod';

export type Problem = readonly [field: string, message: string];

/** A Zod `superRefine` callback that reports every problem `check` finds at its field's path. */
export function refineWith<T>(
  check: (value: T) => readonly Problem[],
): (value: T, ctx: z.RefinementCtx<T>) => void {
  return (value, ctx) => {
    for (const [field, message] of check(value)) ctx.addIssue({ code: 'custom', path: [field], message });
  };
}

/** Epoch ms of a parsed IsoTs. It always carries an offset, so this never reads the host time zone. */
export function instantMs(isoTs: string): number {
  return new Date(isoTs).getTime();
}

type State = 'PENDING' | 'FINAL' | 'USER_OVERRIDDEN';

/** The receipt fields the invariants read. */
export interface ReceiptFacts {
  readonly grade: string;
  readonly state: State;
  readonly claimId?: string | undefined;
  readonly attribution?: 'likely' | undefined;
  readonly override?: { readonly previousState: Exclude<State, 'USER_OVERRIDDEN'> } | undefined;
  readonly supersededBy?: string | undefined;
  readonly finalAt?: string | undefined;
}

/** `override` iff USER_OVERRIDDEN; `finalAt` iff the state before any override is FINAL (§3, §8). */
function stateProblems(receipt: ReceiptFacts): Problem[] {
  const problems: Problem[] = [];
  const overridden = receipt.state === 'USER_OVERRIDDEN';
  if (overridden && receipt.override === undefined) {
    problems.push(['override', 'required when state is USER_OVERRIDDEN']);
  }
  if (!overridden && receipt.override !== undefined) {
    problems.push(['override', 'allowed only when state is USER_OVERRIDDEN']);
  }
  const underlying = overridden ? receipt.override?.previousState : receipt.state;
  if (underlying === 'FINAL' && receipt.finalAt === undefined) {
    problems.push(['finalAt', 'required once the receipt is FINAL']);
  }
  if (underlying === 'PENDING' && receipt.finalAt !== undefined) {
    problems.push(['finalAt', 'a PENDING receipt has no finalAt']);
  }
  return problems;
}

/** grade UNASKED ⇔ attribution 'likely' and no claim; only UNASKED receipts are superseded (§2, §7, §8). */
function unaskedProblems(receipt: ReceiptFacts): Problem[] {
  const problems: Problem[] = [];
  if (receipt.grade === 'UNASKED') {
    if (receipt.attribution === undefined) problems.push(['attribution', "an UNASKED receipt says 'likely'"]);
    if (receipt.claimId !== undefined) problems.push(['claimId', 'an UNASKED receipt has no claim']);
    return problems;
  }
  if (receipt.attribution !== undefined) problems.push(['attribution', 'allowed only on an UNASKED receipt']);
  if (receipt.supersededBy !== undefined) {
    problems.push(['supersededBy', 'only an UNASKED receipt can be superseded']);
  }
  return problems;
}

export function receiptProblems(receipt: ReceiptFacts): Problem[] {
  return [...stateProblems(receipt), ...unaskedProblems(receipt)];
}

/** An observer's window is a real interval, and `allCalendars` is a calendar fact only (§3). */
export function coverageProblems(entry: {
  readonly source: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly allCalendars?: boolean | undefined;
}): Problem[] {
  const problems: Problem[] = [];
  if (instantMs(entry.windowEnd) < instantMs(entry.windowStart)) {
    problems.push(['windowEnd', 'must not be before windowStart']);
  }
  if (entry.allCalendars !== undefined && entry.source !== 'gcal.event') {
    problems.push(['allCalendars', 'applies to gcal.event only']);
  }
  return problems;
}

/** Fired signals are distinct, and at least one is agent-specific: userIdle alone attributes nothing (§7). */
export function attributionProblems(attribution: { readonly signals: readonly string[] }): Problem[] {
  const { signals } = attribution;
  const problems: Problem[] = [];
  if (new Set(signals).size !== signals.length) problems.push(['signals', 'each signal at most once']);
  if (signals.every((signal) => signal === 'userIdle')) {
    problems.push(['signals', 'needs an agent-specific signal']);
  }
  return problems;
}

/** An idle interval is a real interval. */
export function intervalProblems(interval: { readonly from: string; readonly to: string }): Problem[] {
  return instantMs(interval.to) < instantMs(interval.from) ? [['to', 'must not be before from']] : [];
}
