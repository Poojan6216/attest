/**
 * The last day the opt-in telemetry sent (sprint_5 5.7; src/telemetry/send.ts): meta `telemetrySentDay`, a day as
 * `YYYY-MM-DD` on the browser's clock, written only once the API took that day's payload. So each day is sent at most
 * once, whatever sends it (the hourly alarm, the options page's button), and a day the API did not take is tried again.
 * A day, never content (Hard Rule 2).
 */
import { z } from 'zod';

import { readRow, type LedgerDb } from './db';
import { parseWrite } from './errors';
import { MetaEntry } from './types';

export const TELEMETRY_SENT_DAY = 'telemetrySentDay';

const SentDay = z.strictObject({
  key: z.literal(TELEMETRY_SENT_DAY),
  value: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u),
});

/** The last day sent, or null when none was (or what is stored is not a day). */
export async function telemetrySentDay(db: LedgerDb): Promise<string | null> {
  const entry = readRow('meta', MetaEntry, await db.meta.get(TELEMETRY_SENT_DAY));
  const parsed = SentDay.safeParse(entry);
  return parsed.success ? parsed.data.value : null;
}

/** Records `day` as sent (header). */
export async function recordTelemetrySent(db: LedgerDb, day: string): Promise<void> {
  const entry = parseWrite(SentDay, { key: TELEMETRY_SENT_DAY, value: day }, 'Invalid sent day', {
    table: 'meta',
  });
  await db.meta.put(entry);
}
