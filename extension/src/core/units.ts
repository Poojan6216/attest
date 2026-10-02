/**
 * Named units for src/core (docs/grading.md §13). Every other core file imports these instead of writing
 * a number; this file is exempt from the core no-literal rule because unit conversions are not policy.
 * Thresholds, windows and weights never live here: they live in policy/default.json.
 */

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
export const MINUTES_PER_HOUR = 60;
export const CENTS_PER_UNIT = 100;

/** Policy weights and thresholds are converted to integer basis points at load (§5.3). */
export const BASIS_POINTS = 10_000;
