/**
 * The grant each agent has until the user declares one (sprint_3 3.13, as 3.6 planned it; Sprint 4 makes grants
 * editable): every action type allowed, no counterparty allowlist (an empty one restricts nothing, core
 * conditions-scope.ts), no spending ceiling and no declared scopes. A grading batch needs one in force for every
 * agent it grades (`BatchError('missing_grant')` otherwise, docs/grading.md §3), so the service worker writes the
 * missing ones on install and update, and before it stores an import. A grant the user wrote is never replaced.
 */
import { ActionType, AgentId, type Grant, type IsoTs } from '../core/schema';
import type { LedgerDb } from '../ledger/db';
import { listGrants, putGrant } from '../ledger/repo';

/** The default grant of `agent`, written at `updatedAt`. */
export function defaultGrant(agent: AgentId, updatedAt: IsoTs): Grant {
  return {
    agent,
    allowedTypes: [...ActionType.options],
    counterpartyAllowlist: [],
    spendCeilingCents: null,
    declaredScopes: [],
    updatedAt,
  };
}

/** Writes the default grant of every agent that has none, at `updatedAt`; returns how many it wrote. */
export async function ensureDefaultGrants(db: LedgerDb, updatedAt: IsoTs): Promise<number> {
  const held = new Set((await listGrants(db)).map(({ agent }) => agent));
  const missing = AgentId.options.filter((agent) => !held.has(agent));
  for (const agent of missing) await putGrant(db, defaultGrant(agent, updatedAt));
  return missing.length;
}
