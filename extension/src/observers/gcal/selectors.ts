/**
 * The Calendar observer's selectors and label words (sprint_2 2.5; agents/adapter_engineer.md rule 3): ./selectors.json,
 * parsed once at load with a strict schema so a malformed or misspelt file fails loud when the content script starts,
 * never as a silent zero (Hard Rule 6).
 *
 * Every selector anchors on `role`, `aria-*`, `data-*` and structure, never on a class name (sprint_2 🔥). `version`
 * is the observer's version and every stored snapshot's (./snapshot.ts): bump it on any change, so a snapshot read
 * under other selectors is never diffed as if nothing had changed. The label words are English, as the page writes
 * them: another display language reads as unreadable chips and a DEGRADED pass, never as a guess (Hard Rule 5).
 */
import { z } from 'zod';

import { ComponentId } from '../../core/schema';
import { ObserverError } from '../errors';
import raw from './selectors.json' with { type: 'json' };

const Selector = z.string().min(1);
const Attribute = z.string().regex(/^[a-z][a-z0-9-]*$/u, 'expected an attribute name');
/** A pattern source that compiles. */
const Pattern = z.string().refine((source) => {
  try {
    return new RegExp(source, 'u').source.length > 0;
  } catch {
    return false;
  }
}, 'expected a regular expression');
const Word = z.string().min(1);

const CalendarSelectorsFile = z.strictObject({
  $comment: z.string(),
  observer: z.literal('gcal.event'),
  version: ComponentId,
  fixtures: z.array(z.string().min(1)).min(1),
  selectors: z.strictObject({
    main: Selector,
    grid: Selector,
    day: Selector,
    chip: Selector,
    dayButton: Selector,
    calendar: Selector,
    account: Selector,
    busy: Selector,
    progress: Selector,
  }),
  attributes: z.strictObject({
    eventId: Attribute,
    dayKey: Attribute,
    hidden: Attribute,
    checked: Attribute,
    label: Attribute,
  }),
  text: z.strictObject({
    accountPrefix: Word,
    allDay: Word,
    to: Word,
    at: Word,
    guests: Word,
    noTitle: z.array(Word),
    more: Pattern,
    zone: Pattern,
    months: z.array(Word).length(12),
  }),
});

export type CalendarSelectorsFile = z.infer<typeof CalendarSelectorsFile>;

/**
 * Parses a selectors document. A malformed one throws ObserverError('invalid_selectors'), which the logger prints by
 * name and code (TECH-3), and never half-loads. Exported for tests.
 */
export function loadCalendarSelectors(value: unknown): Readonly<CalendarSelectorsFile> {
  const parsed = CalendarSelectorsFile.safeParse(value);
  if (!parsed.success) throw new ObserverError('invalid_selectors');
  return Object.freeze(parsed.data);
}

/** The parsed selectors.json. */
export const GCAL_SELECTORS: Readonly<CalendarSelectorsFile> = loadCalendarSelectors(raw);

/** The observer's version: selectors.json's. */
export const GCAL_VERSION = GCAL_SELECTORS.version;

/** A day button that hides events ("2 more"), compiled once. */
export const MORE_PATTERN = new RegExp(GCAL_SELECTORS.text.more, 'u');

/** The page's own time-zone hint ("GMT-04", "GMT+05:30", "GMT"), compiled once. */
export const ZONE_PATTERN = new RegExp(GCAL_SELECTORS.text.zone, 'u');
