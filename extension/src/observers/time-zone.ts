/**
 * The browser's time zone, as the observers read vendor-relative times with it (sprint_2 2.0; docs/grading.md §10).
 * Kept out of ./base.ts (TECH-10): an extractor may need the offset, and must never import the skeleton, which
 * reaches the bus (eslint-rules/fences.js EXTRACTOR_RESTRICTED_IMPORTS). Not a clock read: it only converts an
 * instant the caller already holds.
 */
import type { OffsetAt } from '../core/normalize';

/** The user's UTC offset in minutes at an instant, as this browser's time zone gives it. Not a clock read. */
export const browserOffsetAt: OffsetAt = (epochMs: number): number => -new Date(epochMs).getTimezoneOffset();
