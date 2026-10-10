/**
 * The calendar's words as every surface writes them (sprint_4 close, tech review TECH-8: they had been written in three
 * places), and a date or time field in two digits. Pure: words and padding, no clock and no time zone.
 */
import { ISO_FIELD_DIGITS } from './units';

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Sunday first, as `Date#getDay` counts. */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** A date or time field in two digits, as ISO 8601 and the surfaces write it: 7 → "07". */
export const twoDigits = (value: number): string => String(value).padStart(ISO_FIELD_DIGITS, '0');
