/**
 * The token that marks the test-only observer harness (tests/e2e/support/observer-harness.ts). It is the harness
 * observer's `vendor`, so it is in every bundle of the harness. tests/e2e/built-bundle.spec.ts fails if any shipped
 * file holds it: the harness never ships (sprint_2 2.0).
 */
export const OBSERVER_HARNESS_MARKER = 'attest-observer-harness-2-0';

/**
 * The token that marks the test-only Sent pass timer (tests/e2e/support/sent-pass-harness.ts, sprint_6 6.4), which it
 * returns with every pass, so it is in every bundle of it. tests/e2e/built-bundle.spec.ts fails if any shipped file
 * holds it.
 */
export const SENT_PASS_HARNESS_MARKER = 'attest-sent-pass-harness-6-4';
