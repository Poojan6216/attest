/**
 * The Gmail auto-check's record (sprint_4 4.9; ./auto-check.ts, src/background/auto-check.ts): the last time it opened
 * the Gmail Sent folder, as four meta keys written together by the service worker:
 *  - `autoCheckAt`: when, with the service worker's local offset;
 *  - `autoCheckUntil`: the end of that open's window, `graceMin` after it: no other tab opens before it, and until then
 *    the popup says why the tab opened;
 *  - `autoCheckClaims`: how many claims it opened the tab for;
 *  - `autoCheckAgents`: whose claims they were, agent ids joined by commas.
 * Instants, a count and agent ids only, never content (Hard Rule 2). A record that does not read whole reads as none.
 * The popup reads it (./views.ts), so this module imports nothing of the grading core nor any writer of the repo.
 */
import { z } from 'zod';

import { readRow, type LedgerDb } from './db';
import { AgentId, IsoTs } from './types';

export const AUTO_CHECK_AT = 'autoCheckAt';
export const AUTO_CHECK_UNTIL = 'autoCheckUntil';
export const AUTO_CHECK_CLAIMS = 'autoCheckClaims';
export const AUTO_CHECK_AGENTS = 'autoCheckAgents';

/** The last time the auto-check opened the Gmail Sent folder (header). */
export interface AutoCheckRecord {
  readonly at: IsoTs;
  readonly until: IsoTs;
  readonly claims: number;
  readonly agents: readonly AgentId[];
}

const entry = <K extends string, V extends z.ZodType>(key: K, value: V) =>
  z.strictObject({ key: z.literal(key), value });

const AtEntry = entry(AUTO_CHECK_AT, IsoTs);
const UntilEntry = entry(AUTO_CHECK_UNTIL, IsoTs);
const ClaimsEntry = entry(AUTO_CHECK_CLAIMS, z.int().positive());
const AgentsEntry = entry(
  AUTO_CHECK_AGENTS,
  z
    .string()
    .regex(new RegExp(`^(?:${AgentId.options.join('|')})(?:,(?:${AgentId.options.join('|')}))*$`, 'u')),
);

/** The last open (header), or null when none is recorded whole. */
export async function readAutoCheck(db: LedgerDb): Promise<AutoCheckRecord | null> {
  const [at, until, claims, agents] = await db.meta.bulkGet([
    AUTO_CHECK_AT,
    AUTO_CHECK_UNTIL,
    AUTO_CHECK_CLAIMS,
    AUTO_CHECK_AGENTS,
  ]);
  const record = {
    at: readRow('meta', AtEntry, at)?.value,
    until: readRow('meta', UntilEntry, until)?.value,
    claims: readRow('meta', ClaimsEntry, claims)?.value,
    agents: readRow('meta', AgentsEntry, agents)?.value,
  };
  if (record.at === undefined || record.until === undefined) return null;
  if (record.claims === undefined || record.agents === undefined) return null;
  return {
    at: record.at,
    until: record.until,
    claims: record.claims,
    agents: AgentId.array().parse(record.agents.split(',')),
  };
}

/** Records an open (header), its four keys in one transaction; a record its reader would refuse throws, unwritten. */
export async function recordAutoCheck(db: LedgerDb, record: AutoCheckRecord): Promise<void> {
  const rows = [
    AtEntry.parse({ key: AUTO_CHECK_AT, value: record.at }),
    UntilEntry.parse({ key: AUTO_CHECK_UNTIL, value: record.until }),
    ClaimsEntry.parse({ key: AUTO_CHECK_CLAIMS, value: record.claims }),
    AgentsEntry.parse({ key: AUTO_CHECK_AGENTS, value: record.agents.join(',') }),
  ];
  await db.transaction('rw', db.meta, () => db.meta.bulkPut(rows));
}
