/**
 * The Gmail Sent observer (sprint_2 2.2): source `gmail.sent`, run by the skeleton in ../base.ts as
 * `health()` → `extract()` → `redact.project()` → bus. Its version is ./selectors.json's: a selector change bumps
 * it, and every health report and observation message names it (agents/adapter_engineer.md rule 3).
 *
 * Read-only and pure over the DOM (Hard Rule 3): the content script (Sprint 2.7) only calls
 * `startObserver(gmailSentObserver)`.
 */
import { OBSERVER_HOSTS } from '../../config';
import type { Observer } from '../types';
import { gmailAccount } from './account';
import { extractSent, sentWindow } from './extract';
import { sentHealth } from './health';
import { SENT_SELECTORS } from './selectors';

export const gmailSentObserver: Observer = Object.freeze({
  id: 'gmail.sent',
  vendor: 'gmail',
  version: SENT_SELECTORS.version,
  hosts: OBSERVER_HOSTS.gmail,
  source: 'gmail.sent',
  health: sentHealth,
  extract: extractSent,
  account: gmailAccount,
  visibleWindow: sentWindow,
});
