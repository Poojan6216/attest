/**
 * The §8 v1.4 event rules, checked on the scenario files themselves (no core code runs here; the runner checks
 * the core). Walking the events in order, with each subject's `computedAt` starting at `evaluatedAt`:
 *
 *  - a `regrade` computed before the stored receipt (`next.computedAt < computedAt`), or of an overridden one, is
 *    refused; an applied regrade moves `computedAt` to its instant; only an UNASKED orphan is ever `deleted`;
 *  - an `override` is refused iff the receipt is already overridden or `at < computedAt`;
 *  - a `supersede` applies only to an UNASKED receipt, and `supersededBy` is the last applied supersede's claim
 *    (a later claim replaces an earlier one);
 *  - the expectation of an overridden subject is USER_OVERRIDDEN with the last applied override's grade.
 */
import { subjectKind } from './checks';
import { type Scenario, type ScenarioEvent } from './scenario-schema';
import { instantMs } from './time';

interface Track {
  computedMs: number;
  overridden: boolean;
  override?: 'VERIFIED' | 'NOT_FOUND';
  supersededBy?: string;
}

/** Whether the event is legal as far as the file can tell, updating the subject's track when it applies. */
function legal(event: ScenarioEvent, track: Track): boolean | null {
  if (event.event === 'regrade') {
    if (instantMs(event.evaluatedAt) < track.computedMs || track.overridden) return false;
    if (!event.rejected) track.computedMs = instantMs(event.evaluatedAt);
    return null; // a FINAL receipt is refused too, which only the grading can tell
  }
  if (event.event === 'override') {
    const ok = !track.overridden && instantMs(event.at) >= track.computedMs;
    if (ok) Object.assign(track, { overridden: true, override: event.grade });
    return ok;
  }
  if (!event.rejected) track.supersededBy = event.claim;
  return null;
}

function eventLine(index: number, event: ScenarioEvent): string {
  return `event ${String(index + 1)} (${event.event} ${event.ref})`;
}

export function eventProblems(scenario: Scenario): string[] {
  const tracks = new Map<string, Track>();
  const problems: string[] = [];
  const start = instantMs(scenario.input.evaluatedAt);
  for (const [index, event] of (scenario.events ?? []).entries()) {
    const track = tracks.get(event.ref) ?? { computedMs: start, overridden: false };
    tracks.set(event.ref, track);
    const ok = legal(event, track);
    if (ok !== null && ok === (event.rejected === true))
      problems.push(`${eventLine(index, event)}: must be ${ok ? 'applied' : 'rejected'}`);
    if (event.event === 'regrade' && event.deleted === true && !event.ref.startsWith('o'))
      problems.push(`${eventLine(index, event)}: only a PENDING UNASKED orphan is deleted`);
  }
  for (const e of scenario.expect) {
    const track = tracks.get(e.ref ?? '');
    if (track === undefined) continue;
    if (track.overridden !== (e.state === 'USER_OVERRIDDEN') || track.override !== e.override)
      problems.push(`${e.ref ?? ''}: the expectation must reflect the last applied override`);
    if (track.supersededBy !== e.supersededBy)
      problems.push(`${e.ref ?? ''}: supersededBy is the last applied supersede's claim`);
    if (track.supersededBy !== undefined && (subjectKind(e) !== 'unasked' || e.grade !== 'UNASKED'))
      problems.push(`${e.ref ?? ''}: only an UNASKED receipt is superseded`);
  }
  return problems;
}
