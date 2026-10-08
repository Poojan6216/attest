/**
 * The Muse adapter (sprint_3 3.2): Meta's assistant's chat, activity view and connected apps, read by the skeleton in
 * ../base.ts. Its hosts are src/config.ts AGENT_HOSTS.muse, empty until the founder confirms Muse's web address
 * (MANUAL.md): until then `assertAdapter` refuses it, no content script runs it and no host is in the manifest (Hard
 * Rule 8). Its selectors are synthetic until the founder captures Muse (./selectors.ts).
 */
import { AGENT_HOSTS } from '../../config';
import type { AgentAdapter } from '../types';
import { museExtract } from './extract';
import { museHealth } from './health';
import { MUSE_ATTRIBUTES, SELECTORS } from './selectors';

export const MUSE_CHAT: AgentAdapter = Object.freeze({
  id: 'muse.chat',
  agent: 'muse',
  vendor: 'meta',
  version: SELECTORS.version,
  hosts: AGENT_HOSTS.muse,
  attributes: MUSE_ATTRIBUTES,
  health: museHealth,
  extract: museExtract,
});
