/**
 * Offset-preserving ISO time helpers for the golden loader. UTC arithmetic only: no local time zone, no
 * Intl, so `pnpm test:tz` (Kiritimati, St John's) builds byte-identical objects.
 */
const MS_PER_MINUTE = 60_000;
const UNIT_MS = { minute: MS_PER_MINUTE, hour: 60 * MS_PER_MINUTE, day: 24 * 60 * MS_PER_MINUTE } as const;
export const MS_PER_DAY = UNIT_MS.day;

export type Precision = keyof typeof UNIT_MS;

const OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

export class GoldenTimeError extends Error {
  constructor(
    readonly code: 'unparseable' | 'no_offset',
    readonly value: string,
  ) {
    super(`golden time ${code}: ${value}`);
    this.name = 'GoldenTimeError';
  }
}

/** Epoch milliseconds of an ISO timestamp with an explicit offset. */
export function instantMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new GoldenTimeError('unparseable', iso);
  return ms;
}

function offsetText(iso: string): string {
  const match = OFFSET.exec(iso);
  if (match?.[1] === undefined) throw new GoldenTimeError('no_offset', iso);
  return match[1];
}

function offsetMinutes(text: string): number {
  if (text === 'Z') return 0;
  const sign = text.startsWith('-') ? -1 : 1;
  const [hours = '0', minutes = '0'] = text.slice(1).split(':');
  return sign * (Number(hours) * 60 + Number(minutes));
}

/** `ms` written in the given offset, e.g. 2026-10-06T14:02:00-04:00 (milliseconds only when non-zero). */
export function formatInOffset(ms: number, offset: string): string {
  const local = new Date(ms + offsetMinutes(offset) * MS_PER_MINUTE).toISOString();
  const base = local.slice(0, 19);
  const millis = local.slice(19, 23);
  return `${base}${millis === '.000' ? '' : millis}${offset}`;
}

/** The same instant shifted by `deltaMs`, kept in the original's offset. */
export function shiftIso(iso: string, deltaMs: number): string {
  return formatInOffset(instantMs(iso) + deltaMs, offsetText(iso));
}

/** Start of the precision unit containing `iso`, in `iso`'s own UTC offset (§4.1, §10). */
export function truncateIso(iso: string, precision: Precision): string {
  const offset = offsetText(iso);
  const shift = offsetMinutes(offset) * MS_PER_MINUTE;
  const unit = UNIT_MS[precision];
  const local = instantMs(iso) + shift;
  const start = local - (((local % unit) + unit) % unit);
  return formatInOffset(start - shift, offset);
}
