/**
 * The page global the test-only Gmail perf entry (./gmail-perf-entry.ts) sets. tests/e2e/gmail-sent-perf.spec.ts
 * also checks that no shipped file holds it: the entry never ships.
 */
export const GMAIL_PERF_GLOBAL = '__attestGmailSentPerf_qa_s2';
