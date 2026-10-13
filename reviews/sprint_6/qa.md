# Sprint 6 — QA

Role: agents/qa_tester.md. Range: `3091d86..8065826`, tasks 6.0 to 6.9. Every suite ran on 2026-10-12 against `8065826` plus the tests this review wrote (below), logs in the session's scratchpad (`qa6/`). Product code was not changed; one test was fixed (QA-1).

## RESULTS

- **Lint and typecheck:** clean (`pnpm lint`, which includes `check-docs`; `pnpm typecheck`).
- **Unit, property and golden:** 534 files, 11,182 passed, 7 skipped, 0 failed (`pnpm test`); the perf pass, 6 files, 9 passed.
- **Runtime guard over `src/core`:** 180 files, 6,371 passed (`pnpm test:poison`).
- **Other time zones** (Pacific/Kiritimati, America/St_Johns): 192 files, 6,598 passed, 7 skipped, each zone.
- **Telemetry API:** 114 passed (`uv run pytest`; `telemetry-api/` is unchanged this sprint).
- **End-to-end:** 99 passed, 1 failed (`pnpm e2e`, 16.6 min). The failure, `perf-gmail.spec.ts` "reads the 10,000-row page twice", was a test that waited on the wrong signal (QA-1); fixed, it passes (1.8 min), and its failing case was reproduced and proven fixed with a 300-row page.
- **Coverage:**

| Scope | Lines | Branches | Functions | Gate |
|---|---|---|---|---|
| `src/core` | 99.38% | 93.15% | 99.78% | ≥ 95% lines: pass |
| observers | 99.03% | 93.22% | 99.41% | ≥ 85%: pass |
| UI | 95.94% | 89.43% | 92.65% | ≥ 70%: pass |

- **Mandatory tests:** network intercept ✅ (all three, the negative control included), secret seed ✅ (both, the negative control included).
- **Bench** (`pnpm bench` on `7d32572`, committed in `8065826`): 11 benches, every gate passed; the red team unchanged in every number (13 strategies, 131 cases, 6 that work, none CRITICAL).

## Tests this review wrote

| File | What it proves |
|---|---|
| `tests/property/seal.property.spec.ts` | 1,000 runs each: any JSON value opens back to itself; never under another key or other additional data; never with one byte of nonce or ciphertext changed; two seals never share a nonce. |
| `tests/unit/crypto/job.spec.ts` | The job over 450 requests (more than two pages of 200): one page per step with its place beside it; resumes from that place; runs in as many steps as its pages and clears the job; a place that does not parse starts its table again, never skipping a row; a row that does not open fails its step whole and leaves the place unchanged. |
| `tests/unit/ledger/crypto-writes.spec.ts` | Each state change writes exactly its `meta` keys; a new start clears a stale place; finishing a job clears only that job, or every `crypto.` key once off, and nothing else. |
| `tests/unit/background/keep-awake.spec.ts` | Pings under 30 s, one timer however often asked, none once asleep, a failed ping logged and pinging on. |
| `tests/unit/ui/locked-pages.spec.ts` | The side panel's timeline, the digest page and the grants say the records are locked and offer the unlock, never "could not read", logging no error. |
| `tests/e2e/support/perf-gmail.ts` (fixed) | QA-1. |

## GAPS

1. **[MEDIUM, fixed in tests] QA-1: a perf test failed whenever the first store took under a minute.** `tests/e2e/support/perf-gmail.ts` `readTwice` waited, after the reload, for a newer `gmail.sent` health report. The worker writes a report that repeats the stored one only once that one is a minute old (`OBSERVER_HEALTH_REFRESH_MS`, by design), so when the first pass stored its 10,000 rows in under a minute the wait could never end. It passed at 6.4 and in the bench (stores of 89 to 135 s) and failed on 2026-10-12 (reproduced with 300 and 2,000 rows: the second pass's health reached the worker and was rightly not written). → The wait is now on the Sent window's sync, which the second pass's coverage moves and which comes after its rows; proven on a 300-row page, where health stayed at the first pass and the window moved. → `tests/e2e/support/perf-gmail.ts`.
2. **[MEDIUM] QA-2: the perf pass builds the extension under Vitest's `NODE_ENV=test`.** `tests/perf/popup-paint.perf.spec.ts:30` runs `pnpm build` from inside Vitest, which sets `NODE_ENV=test`, so the build has Preact's development JSX (with this machine's absolute source paths) and Dexie's unminified build. That build is the one the popup's paint gate measures in `pnpm test`, and it stays in `extension/.output/` until the next build (the tech review saw it at 16:51). Nothing would catch such a build shipping: `tests/e2e/built-bundle.spec.ts` checks for no development JSX and no absolute path. → Build with `NODE_ENV=production` wherever a test or bench builds, and add both checks to `built-bundle.spec.ts`. → `tests/perf/popup-paint.perf.spec.ts`, `tests/e2e/built-bundle.spec.ts`.
3. **[MEDIUM] QA-3: four sealed tables never round-trip in a test** (with the tech review, TECH-5): `calendarSnapshots`, `receiptInputs`, `digests` and `modelAnswers` are refused while locked, but never sealed and read back, and `calendarSnapshots`' compound key (its additional data and the job's place as an array) runs in no test. → Seed one row of every table in `SEALED_TABLES`, derived from the list; page the job over more than 200 Calendar snapshots. → `tests/unit/crypto/middleware.spec.ts`, `tests/unit/crypto/job.spec.ts`.
4. **[LOW] QA-4: encryption's cost at a month of use is unmeasured** (TECH-12): the perf gates run with encryption off. → Seal the month and measure the popup's paint, the storage and the job's time. → `bench/perf.ts`, `tests/e2e/perf-ledger.spec.ts`.
5. **[LOW] QA-5: three tests cannot fail as their titles say** (TECH-13): three malformed encryption commands carry no `SECRET`; the near-miss loop of strategy 13 can pass on the previous attempt's message; the e2e at-rest read keeps its own list of sealed tables. → `tests/unit/bus/harness.ts`, `tests/e2e/redteam-encryption.spec.ts`, `tests/e2e/support/encryption.ts`.
6. **[LOW] QA-6: no worker test searches the logs for a passphrase** over turning on, a wrong unlock, a change and turning off (Hard Rule 10; TECH-13). → `tests/unit/background/crypto-commands.spec.ts`.

Checked and clean: two tests per new bus message type (valid and malformed, `tests/unit/bus/`); two per new Dexie writer (above); property tests at 1,000 runs; zero input events on vendor pages (`no-input-events.spec.ts`; no content script changed this sprint); a worker restart mid-grace (`worker-lifecycle.spec.ts`) and mid-encryption-change (`crypto-commands.spec.ts`); no retry anywhere.

## PERF

| Measure | Value | Gate |
|---|---|---|
| One pass of the Gmail Sent reader over 10,000 rows (median of 3) | 686 ms (e2e, 2026-10-12); 739 ms (bench) | < 2 s |
| The 30-day ledger's storage | 40,225,376 B | < 50 MB |
| The popup's first paint over the 30-day ledger | 72 ms (e2e); 60 ms (bench) | < 100 ms |
| The popup's start load | 123,363 B gzipped | < 125,000 B (TECH-1) |
| Grading 5,000 claims against 50,000 observations (bench median) | 1,159 ms | < 2 s |
| JSON export of the 30-day ledger | 3,188 ms, 40.1 MB, heap peak +57 MB | measured |
| CSV export | 1,119 ms, 1.2 MB, heap peak +34 MB | measured |
| The worker's idle heap | 3.4 MB | measured |
