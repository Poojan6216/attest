/**
 * The Gmail Sent observer (sprint_2 2.2): source `gmail.sent`, run by the skeleton in ../base.ts as
 * `health()` → `extract()` → `redact.project()` → bus. Its version is ./selectors.json's: a selector change bumps
 * it, and every health report and observation message names it (agents/adapter_engineer.md rule 3).
 *
 * Coverage only at the head of the list (`#sent`, `Newer` off): any other Sent page posts its rows and no
 * coverage, OK by design (./extract.ts `sentWindows`; Hard Rule 5).
 *
 * Read-only and pure over the DOM (Hard Rule 3): the content script (Sprint 2.7) only calls
 * `startObserver(gmailSentObserver)`.
 */
import { OBSERVER_HOSTS } from '../../config';
import { selectorAttributes } from '../batch';
import type { Observer } from '../types';
import { gmailAccount } from './account';
import { extractSent, sentWindows } from './extract';
import { sentHealth } from './health';
import { SENT_SELECTORS } from './selectors';

/**
 * Every attribute a read of the Sent page depends on (TECH-2; ../types.ts `attributes`): the ones the selectors match
 * on and the ones the reader reads off elements (`navSelectedValue` is a value, not a name). The content script's one
 * watcher starts a pass on a change to one of these, to the tree or the text, or to `class`, `hidden` or `style`
 * (../batch.ts VIEW_ATTRIBUTES), not on a hover or focus change that touches only other attributes.
 */
export const SENT_ATTRIBUTES: readonly string[] = Object.freeze(
  [
    ...new Set([
      ...selectorAttributes(Object.values(SENT_SELECTORS.selectors)),
      ...Object.entries(SENT_SELECTORS.attributes)
        .filter(([key]) => key !== 'navSelectedValue')
        .flatMap(([, names]) => names),
    ]),
  ].sort(),
);

export const gmailSentObserver: Observer = Object.freeze({
  id: 'gmail.sent',
  vendor: 'gmail',
  version: SENT_SELECTORS.version,
  hosts: OBSERVER_HOSTS.gmail,
  source: 'gmail.sent',
  health: sentHealth,
  extract: extractSent,
  account: gmailAccount,
  visibleWindows: sentWindows,
  attributes: SENT_ATTRIBUTES,
});
