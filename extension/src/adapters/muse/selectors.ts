/**
 * The Muse adapter's selectors (sprint_3 3.2; agents/adapter_engineer.md rule 3): ./selectors.json, checked when the
 * content script loads (a file that fails its schema throws `AdapterError('invalid_selectors')`). Synthetic until the
 * founder captures Muse (MANUAL.md): every selector reads the hand-built pages of tests/fixtures/pages/muse/, and a
 * capture replaces them with a new version. Anchored on role, aria-* and data-* attributes and structure, never a class.
 *
 * `MUSE_ATTRIBUTES` are the attributes a read of the page depends on (../types.ts `AgentAdapter.attributes`): the ones
 * the selectors match on and the ones the extractor reads.
 */
import { z } from 'zod';

import { ComponentId } from '../../core/schema';
import { selectorAttributes } from '../../observers/batch';
import { AdapterError } from '../errors';
import selectorsJson from './selectors.json';

const Selector = z.string().min(1);
/** An attribute's name: lowercase letters, digits and hyphens. */
const Attribute = z.string().regex(/^[a-z][a-z0-9-]*$/);

const MuseSelectors = z.strictObject({
  version: ComponentId,
  note: z.string(),
  /** The conversation shown, carrying its vendor id in `conversationId`. */
  conversation: Selector,
  conversationId: Attribute,
  /** One message of the conversation, its author in `author` (`userAuthor` for the user), its id in `messageKey`. */
  message: Selector,
  author: Attribute,
  userAuthor: z.string().min(1),
  messageKey: Attribute,
  /** The message's own text: never a preview, card or attachment beside it. */
  messageText: Selector,
  /** A message's or an entry's time: its `datetime`, else the text it shows. */
  time: Selector,
  activity: Selector,
  activityEntry: Selector,
  entrySummary: Selector,
  settings: Selector,
  /** A connected app: its name, and its switch (`aria-checked` true when connected). */
  app: Selector,
  appName: Selector,
  appSwitch: Selector,
});

export type MuseSelectors = z.infer<typeof MuseSelectors>;

function load(): MuseSelectors {
  const parsed = MuseSelectors.safeParse(selectorsJson);
  if (!parsed.success) throw new AdapterError('invalid_selectors');
  return parsed.data;
}

export const SELECTORS: Readonly<MuseSelectors> = Object.freeze(load());

const SELECTOR_KEYS = [
  'conversation',
  'message',
  'messageText',
  'time',
  'activity',
  'activityEntry',
  'entrySummary',
  'settings',
  'app',
  'appName',
  'appSwitch',
] as const satisfies readonly (keyof MuseSelectors)[];

export const MUSE_ATTRIBUTES: readonly string[] = Object.freeze([
  ...new Set([
    ...selectorAttributes(SELECTOR_KEYS.map((key) => SELECTORS[key])),
    SELECTORS.conversationId,
    SELECTORS.author,
    SELECTORS.messageKey,
    'datetime',
    'aria-checked',
  ]),
]);
