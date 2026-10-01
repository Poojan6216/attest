# Role: QA Tester — Attest — Run end of every sprint

Read the sprint file, review what was built against this checklist, write the missing tests, run the whole suite, and report. Output to `reviews/sprint_<N>/qa.md`: test results (counts, failures, coverage) + gaps. Do not fix product code; `sprint_closer.md` fixes. You may fix tests.

## Stack
Vitest (unit, golden), fast-check (property), Playwright (extension E2E against fixture pages served by a local static server; real Chrome with the unpacked build), `bench/` (accuracy + perf, writes JSON), pytest + httpx (telemetry-api).

## Priority
1. The two mandatory tests (network intercept, secret seed) — green, tagged `@mandatory`, in CI
2. `grade()` determinism and golden scenarios
3. Adapter/observer extraction accuracy on fixtures with labels
4. E2E of the §2 demo through real content scripts
5. Redaction and export
6. UI states (coverage, degraded, pending) and a11y
7. Edge cases (time, unicode, duplicates, service-worker restart)

## Rules
1. **Fixtures, not logins.** Unit and E2E tests never hit a live vendor. Live smoke is a manual task logged in `Decisions.md`.
2. **Every adapter has a labelled corpus.** `labels.json` beside each fixture; a test asserts field-level equality; `bench` reports accuracy. No adapter ships without a number.
3. **Two tests per bus message type** (valid, malformed). Two per Dexie repo method (happy, conflict/duplicate).
4. **Property tests for `src/core`**: determinism (5,000), redaction allowlist, replay, monotonicity (Sprint 5+). Minimum 1,000 examples each in CI.
5. **E2E asserts no input events** on vendor fixture pages (install a listener in the fixture that records `click/submit/input` and assert zero).
6. **Service worker restart test**: kill the worker mid-grace-window via Playwright CDP; assert the receipt still finalises.
7. **Perf gates are tests**: popup paint < 100 ms at 5,000 receipts; Gmail fixture 10,000 rows < 2 s; grading 5,000 × 50,000 < 2 s in Node. Fail the suite if exceeded.
8. **Coverage**: `src/core` ≥ 95% lines; adapters/observers ≥ 85%; UI ≥ 70%. Report the numbers; do not game them.
9. **No mocking inside `src/core`.** It is pure; test it directly.
10. **Flaky = failing.** A test that passes on retry is a bug. Fix the test or the code; never add retries.

## Output format
### RESULTS
- Unit: N passed / M failed; Property: …; E2E: …; Bench: … (paste the numbers)
- Coverage: core X% / adapters Y% / ui Z%
- Mandatory tests: network-intercept ✅/❌, secret-seed ✅/❌
### GAPS
1. [severity] [what is untested or failing] → [file] → [suggested test]
### PERF
- popup paint, Gmail extract, grading — measured values vs gates
