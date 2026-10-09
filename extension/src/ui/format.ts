/**
 * How the surfaces write a time and an amount (sprint_4 4.1). Pure: the caller passes the instant it calls now. A time
 * is written on the page's own clock and zone, 24-hour, as the person reads their own clock ("14:10", "09:12"), with
 * the day when it is not today and the year when it is not this year. An amount is written in its currency with the
 * currency's own minor units.
 */
import { CURRENCY_MINOR_UNITS } from '../core/units';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const two = (value: number): string => String(value).padStart(2, '0');

/** "14:10" today; "8 Oct, 14:10" another day this year; "8 Oct 2025, 14:10" another year. Invalid text as given. */
export function clockTime(iso: string, nowMs: number): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const now = new Date(nowMs);
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
  const sameYear = at.getFullYear() === now.getFullYear();
  if (sameYear && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()) return time;
  const day = `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''}`;
  return sameYear ? `${day}, ${time}` : `${day} ${String(at.getFullYear())}, ${time}`;
}

/** An amount in minor units, in its currency: "$12.50", "¥1,200". */
export function formatMoney(minor: number, currency: string): string {
  const digits = Object.hasOwn(CURRENCY_MINOR_UNITS, currency)
    ? CURRENCY_MINOR_UNITS[currency as keyof typeof CURRENCY_MINOR_UNITS]
    : 2;
  const format = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return format.format(minor / 10 ** digits);
}
