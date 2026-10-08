/**
 * Whether the account itself made a Calendar change (docs/grading.md §3, §7 v1.12; Hard Rule 7). PURE.
 *
 * A Calendar change may accuse an agent only when the account made it, and other people change the account's calendar
 * too: Google adds an invitation from anyone (its default), an organiser moves or cancels an event the user was
 * invited to, a colleague edits an event on a shared or subscribed calendar the grid shows. Nothing a snapshot holds
 * tells those apart from the account's own changes yet (src/observers/gcal/snapshot.ts: no organiser, no response
 * status, no calendar ownership). So, since v1.12, no change is known to be the account's own:
 * ./calendar-step.ts then stores every creation, update and confirmed deletion as a first sighting, with its
 * first-look marker. It is still evidence for a claim (§4.1); it is never an orphan, so never UNASKED: a missed
 * UNASKED, never a false one.
 *
 * Carry-forward (sprint_6 6.4; the live smoke of 2026-10-07, sprint_2 2.8, could not read them): confirm on real
 * pages which facts say that the account organises an event and owns the calendar it is on (read-only, best
 * knowledge), add them to the snapshot as derived facts, and answer from them here. The rest of the rule (a change noticed late, a change another range held first) is already
 * in place for that day (./calendar-step.ts, ./calendar-seen.ts).
 */
import type { CalendarEvent } from '../observers/gcal/diff';

/** Whether the account made the change a row reports, from the event's state that row describes. */
export type OwnChange = (event: CalendarEvent) => boolean;

/** v1.12: never known (see the module comment), so no Calendar change accuses an agent. */
export const accountMadeChange: OwnChange = () => false;
