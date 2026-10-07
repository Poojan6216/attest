/**
 * The Gmail Sent observer's selectors (sprint_2 2.2; agents/adapter_engineer.md rule 3): ./selectors.json, parsed
 * once at load with a strict schema so a malformed or misspelt file fails loud when the content script starts,
 * never as a silent zero (Hard Rule 6).
 *
 * Every selector anchors on `role`, `aria-*`, `data-*` and structure, never on a class name: Gmail's class names
 * are randomised and rotate (sprint_2 🔥). `version` is the observer's version: bump it on any change. The Gmail host
 * is not here: it is src/config.ts OBSERVER_HOSTS.gmail, the host permission itself (./route.ts).
 */
import { z } from 'zod';

import { ComponentId } from '../../core/schema';
import { ObserverError } from '../errors';
import raw from './selectors.json' with { type: 'json' };

const Selector = z.string().min(1);
const Attribute = z.string().regex(/^[a-z][a-z0-9-]*$/u, 'expected an attribute name');

const SentSelectorsFile = z.strictObject({
  $comment: z.string(),
  observer: z.literal('gmail.sent'),
  version: ComponentId,
  fixtures: z.array(z.string().min(1)).min(1),
  route: z.strictObject({
    folder: z.string().regex(/^[a-z]+$/u),
    pageSegment: z.string().min(1),
  }),
  /** The form of Gmail's legacy thread and message ids: a row with another is refused (./sent-time.ts). */
  patterns: z.strictObject({ legacyId: z.string().min(1) }),
  selectors: z.strictObject({
    navLink: Selector,
    main: Selector,
    grid: Selector,
    row: Selector,
    cell: Selector,
    subject: Selector,
    recipient: Selector,
    time: Selector,
    newer: Selector,
    older: Selector,
    account: Selector,
  }),
  attributes: z.strictObject({
    navSelected: Attribute,
    navSelectedValue: z.string(),
    navTitle: Attribute,
    recipient: z.array(Attribute).min(1),
    threadId: Attribute,
    lastMessageId: Attribute,
    lastNonDraftId: Attribute,
    time: z.array(Attribute).min(1),
    disabled: Attribute,
    accountLabel: Attribute,
  }),
  text: z.strictObject({ noSubject: z.array(z.string()), titleSeparator: z.string().min(1) }),
});

export type SentSelectorsFile = z.infer<typeof SentSelectorsFile>;

/**
 * Parses a selectors document. A malformed one throws ObserverError('invalid_selectors'), which the logger prints by
 * name and code (TECH-3), and never half-loads. Exported for tests.
 */
export function loadSentSelectors(value: unknown): Readonly<SentSelectorsFile> {
  const parsed = SentSelectorsFile.safeParse(value);
  if (!parsed.success) throw new ObserverError('invalid_selectors');
  return Object.freeze(parsed.data);
}

/** The parsed selectors.json. */
export const SENT_SELECTORS: Readonly<SentSelectorsFile> = loadSentSelectors(raw);

/** The second segment of a Sent list page's route (`#sent/p2`), compiled once. */
export const PAGE_SEGMENT = new RegExp(SENT_SELECTORS.route.pageSegment, 'u');

/** Gmail's legacy id form (every id of the captures of 2026-10-03 and 2026-10-06 is 16 lowercase hex digits). */
export const LEGACY_ID = new RegExp(SENT_SELECTORS.patterns.legacyId, 'u');
