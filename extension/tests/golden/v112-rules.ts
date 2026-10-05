/**
 * The contract v1.12 rule the golden suite must prove (docs/grading.md v1.12 §3, §7; SEC-1): a snapshot cannot tell
 * the account's own Calendar changes from other people's, so the ledger stores every Calendar row as a first sighting
 * with its first-look marker, a change a followed view saw included. No Calendar row is then ever UNASKED, and the
 * rows stay evidence a claim is graded against. The tag is a `contract:<tag>` some scenario must carry, with a
 * predicate that the tagged scenario really exercises the rule; the proof is false on a plain exact match, and
 * v112-rules.spec.ts shows it fails on a broken copy of its file and, by grading that copy, what the markers decide.
 */
import { type PolicyView } from './build';
import { type Proof } from './proof-helpers';
import { type Scenario, type ScenarioObservation } from './scenario-schema';
import { calendarRows, firstSeen, followedOver, isMarkerOf, sessionNear } from './v110-rules';

const CHANGE_TYPES = ['calendar.created', 'calendar.updated', 'calendar.deleted'] as const;

/** Whether some expected receipt names `o`, as its subject or as its evidence. */
const named = (s: Scenario, o: ScenarioObservation): boolean =>
  s.expect.some((e) => e.ref === o.ref || e.observationRefs.includes(o.ref));

/** Whether `o` carries its first-look marker in the file's coverage. */
const marked = (s: Scenario, o: ScenarioObservation): boolean =>
  s.input.coverage.some((e) => isMarkerOf(e, o));

/** A change a followed view saw, next to an agent's session, that no receipt names: what v1.11 made UNASKED. */
function spared(s: Scenario, o: ScenarioObservation, policy: PolicyView): boolean {
  return !named(s, o) && followedOver(s, o) && sessionNear(s, firstSeen(o), policy);
}

/**
 * §3, §7 v1.12: every gcal.event row of the file carries its marker; a created, an updated and a deleted row a
 * followed view saw, each next to an agent's session, get no receipt; a claim is still VERIFIED or PARTIAL on a
 * marked change row; and no gcal.event row is UNASKED.
 */
const calendarChangesMarked: Proof = (s, policy) => {
  const rows = calendarRows(s);
  if (rows.length === 0 || !rows.every((o) => marked(s, o))) return false;
  const eachKind = CHANGE_TYPES.every((type) => rows.some((o) => o.type === type && spared(s, o, policy)));
  const evidence = s.expect.some(
    (e) =>
      (e.grade === 'VERIFIED' || e.grade === 'PARTIAL') &&
      rows.some(
        (o) => e.observationRefs.includes(o.ref) && o.type !== 'calendar.created' && followedOver(s, o),
      ),
  );
  const accused = s.expect.some((e) => e.grade === 'UNASKED' && rows.some((o) => o.ref === e.ref));
  return eachKind && evidence && !accused;
};

export const V112_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['calendar_changes_marked', calendarChangesMarked],
];
