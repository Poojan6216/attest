# Sprint 0 QA review

Role: `agents/qa_tester.md`. Date: 2026-10-01. Reviewed: every Sprint 0 task (0.1 to 0.12) at local `HEAD` `89e7cc1`, plus the latest CI run.

All commands ran on the founder's Mac (8 cores, Node 22.14.0, Playwright Chromium). QA changed only tests and test configuration; no product code was touched. The QA changes are uncommitted. The closer should commit them with the fixes (see "Tests QA added or fixed").

---

### RESULTS

- **Unit + property (`pnpm test`):** 835 tests in 42 files. 832 passed and 3 failed. All 3 failures are new QA tests that are meant to stay red until the product code is fixed: 2 for QA-2 and 1 for QA-3.
  - Before QA: 727 tests in 37 files, all passing.
  - Failing now:
    - `tests/unit/log.spec.ts > … > api_key_aws_shape: as a field key` (QA-2)
    - `tests/unit/log.spec.ts > … > url_with_token: as a field key` (QA-2)
    - `tests/unit/background/background-entry.spec.ts > … > an install-id storage failure is logged loudly and does not stop the alarms being scheduled` (QA-3)
  - The suite ran 10 times in a row with the same result each time, so nothing in it is flaky.
- **Property:** 11 properties. Every one now runs at least 1,000 examples:
  - Fixture-server path containment: 2,000
  - New logger properties: 6 × 2,000
  - Policy loader: 3 × 1,000 (was 100, the fast-check default)
  - Index-field round trip: 1,000 (was 300)
- **E2E (`pnpm e2e`, final run):** 25 passed, 0 failed, 5.1 min. This includes 6 new QA tests.
  - Before QA: 19 passed in 5.1 min.
  - A middle run had 1 failure from a hung browser launch under load. See QA-4.
- **Bench (`pnpm bench`):** `RESULTS.md regenerated (0 benches registered)`. No numbers yet. That is correct for Sprint 0 (Hard Rule 12).
- **Build:** `wxt build` (the first step of `pnpm e2e`) finished in 900 ms. Total size 1.18 MB.
- **Lint and typecheck:** `pnpm lint` exit 0 and `pnpm typecheck` exit 0, including all QA files.
- **Coverage** (`vitest run --coverage`, V8, lines / branches):

  | Area | Lines | Branches | Gate |
  |---|---|---|---|
  | core (`src/core/policy.ts`, the only core file) | 97.47% (77/79) | 88.24% | ≥ 95% lines: met |
  | adapters / observers | none exist yet | | Sprint 2 and 3 |
  | UI (`entrypoints/options`, `popup`, `sidepanel`) | 100% (85/85) | 90.24% | ≥ 70%: met. It was **0%** before QA (no unit test rendered any component) |
  | ledger | 99.59% | 95.24% | |
  | bus | 100% | 98.04% | |
  | `src/background` | 97.37% | 100% | |
  | `entrypoints/background.ts` | 90.91% | 100% | |
  | `src/log.ts` | 100% | 100% | Was 87.5% / 74.5%, reached only indirectly |
  | `src/config.ts`, `src/setup.ts` | 100% | 100% | |
  | All product code | 99.18% (606/611) | | |
  | Dev tooling `tests/tools/**` | 87.07% | 79.51% | No gate. `capture-fixture.ts` (14.5%) and `capture-page.ts` (5.7%) run through the CLI in `capture-tool.spec.ts`, which V8 does not instrument |

  The lines still uncovered in core are `policy.ts:218` (the "at least / at most N items" wording) and `:246` (the `default` branch of `describeIssue`).
- **Mandatory tests:** network-intercept ✅, secret-seed ✅.
  - Locally, all 3 full runs were green:
    - 5-minute session: `violations: []`, `unknown browser-initiated hosts: []`.
    - The negative control caught the service-worker, options-page, fixture-page and WebSocket canaries.
    - The no-leak negative control caught a seed in every channel.
  - On CI, run `36923944944` (commit `b816bd4`, Linux), step `E2E (@mandatory)`: 5 passed in 5.2 min. Step `E2E (rest)`: 14 passed.
  - **The job is still red.** It fails at `Upload build` (QA-1).

### GAPS

1. **[HIGH] QA-1: CI is red on `main`, and the newest commit has never run in CI.**
   - What: run `36923944944` passed every check, then failed at `Upload build` with `##[error]No files were found with the provided path: extension/.output/. No artifacts will be uploaded.` The step log shows `include-hidden-files: false`. `upload-artifact@v4` skips hidden paths, and `.output` is hidden.
   - Also: local `HEAD` `89e7cc1` (docs) is not on `origin/main`, which is `b816bd4`. `gh run list` shows that one run only.
   - Where: `.github/workflows/ci.yml:58-64`
   - Rule: Sprint 0 Gate "CI green"; task 0.11 Done-when "CI green on main". Same finding as TECH-1.
   - Fix: add `include-hidden-files: true` to the `Upload build` step. Push, then confirm `gh run list --limit 1` shows `success` for the pushed `HEAD`. The run now also includes the 6 new E2E tests in `E2E (rest)` (about 40 s more).
2. **[MEDIUM] QA-2: the logger prints secret-shaped field keys verbatim.**
   - What: `sanitizeKey` keeps a key whenever its lowercase form is an identifier. Two seeded secrets used as a key come out unchanged: the AWS-shaped key `AKXQ…` and the URL token `ZXq9…`. Red tests: `tests/unit/log.spec.ts` "%s: as a field key" (2 failures). Every call site uses literal keys today, so nothing leaks now. The logger promises to be "safe by construction" and it is not for keys.
   - Where: `extension/src/log.ts:109-113`
   - Rule: Hard Rule 10. Same finding as SECURITY-1.
   - Fix: keep a key only if it matches a digit-free lower-camel pattern, for example `/^[a-z][A-Za-z]{0,31}$/`; otherwise print `field<N>`. Both red tests must then pass, along with the 6 new logger properties.
3. **[MEDIUM] QA-3: a failed install-id write means no alarms get scheduled.**
   - What: `background.ts` chains `handleInstalled(details).then(() => resetAlarms())`. If the install-id write fails, `install.failed` is logged but the purge alarm is never created, and only the next browser start (`onStartup`) repairs it. From Sprint 3 the grace alarm sits on the same path, so PENDING receipts would never finalise. Red test: `tests/unit/background/background-entry.spec.ts` "an install-id storage failure is logged loudly and does not stop the alarms being scheduled".
   - Where: `extension/entrypoints/background.ts:19-25`
   - Rule: Hard Rule 6 (fail loud, keep working), qa_tester priority 7. Same finding as TECH-8.
   - Fix: run `ensureInstallId` and `resetAlarms` independently (for example `Promise.allSettled`) and log each failure under its own event. The red test then passes.
4. **[MEDIUM] QA-4: E2E tests fail when the machine is busy (flaky = failing, rule 10).**
   - What: this happened twice without any QA-made load, while the other reviewers were also running:
     - Full run 2: `options.spec.ts:319` failed with `Test timeout of 60000ms exceeded while setting up "attest"`. The trace shows `Launch persistent context` never returned.
     - A repeat run (`--repeat-each=5`, 80 tests): 5 failed. Four were the 5 s `expect.poll` on the install id (`options.spec.ts:41` and the new lifecycle tests). One was another launch hang.
   - Already fixed by QA: `expect.timeout` set to 15 s in `playwright.config.ts`. That is a bound on how long an assertion waits, not a retry. The two-launch restart test gets `test.setTimeout(120 s)`.
     - Under extreme synthetic load (12 busy loops on 8 cores), failures dropped from 21/48 to 3/48. The remaining 3 are browser launches and 10-second CDP round trips.
     - Without the synthetic load, 160/160 passed, and the final full run was 25/25.
   - Still open: why the launch hangs, and that `workers` has no cap. The default is half the cores, and every test starts its own Chromium.
   - Where: `extension/playwright.config.ts` (`workers` not set); `extension/tests/e2e/support/extension.ts:42` (no launch `timeout`)
   - Rule: qa_tester rule 10.
   - Fix:
     - Set `workers: process.env.CI ? 1 : 2`.
     - Pass `timeout: 30_000` to `launchPersistentContext` so a hang fails fast with a clear message.
     - Re-measure with `pnpm exec playwright test tests/e2e/options.spec.ts tests/e2e/worker-lifecycle.spec.ts --repeat-each=5` while `pnpm test` runs alongside. Record the result in `Decisions.md`.
5. **[MEDIUM] QA-5: no proof that a PR breaking a mandatory test turns CI red.**
   - What: `gh run list` shows one push run and no PR runs. The mutant proofs in `Decisions.md` [0.4] and [0.5] ran only on this Mac.
   - Where: task 0.11; `.github/workflows/ci.yml`
   - Rule: task 0.11 Done-when "a PR that breaks a mandatory test is red".
   - Fix: after QA-1 is fixed, open a throwaway PR that adds `void fetch('https://example.com/')` to `main()` in `entrypoints/background.ts`. Confirm step `E2E (@mandatory)` goes red, log the run URL in `Decisions.md`, then close the PR and delete the branch. This needs a push. If the agent may not push, it goes in `MANUAL.md`.
6. **[MEDIUM] QA-6: the secret-seed corpus has no secret shaped like an identifier, so the leak test cannot see the logger's blind spot.**
   - What: `isSafeString` lets lowercase dotted, slashed or hyphenated strings print verbatim under any key that is not a content key. Measured with `buildRecord('info','probe',{reason})`, all of these came out unchanged:
     - `zxq9vl2mp8rt4wy7nb5c` (a lowercase token)
     - `ottoline.vasquez`
     - `glacier-minnow-trumpet-velvet`
     - `files.example.net/share/q3-deck`

     All 15 seeds contain uppercase letters, spaces, `+` or `@`, so the @mandatory no-leak test would never catch a leak of this shape. The seed file is pinned to exactly 15 entries.
   - Where:
     - `extension/tests/fixtures/secrets/seeded.json`
     - `extension/tests/e2e/support/leaks.ts:32` (`.length(15)`)
     - `extension/tests/unit/harness/leaks.spec.ts:13` (the "exactly 15" test)
     - `extension/src/log.ts:61-81`
   - Rule: Hard Rules 2 and 10; qa_tester priority 1. Related to SECURITY-1.
   - Fix:
     - Add identifier-shaped seeds: a lowercase 20-character token, a `first.last` local part, and a hyphenated lowercase passphrase.
     - Relax `.length(15)` to `.min(15)`, and make the count test require at least the 15 formats task 0.5 names.
     - Check that the capture tool's seed picker (`Decisions.md` [0.9], "rank by SHA-256 … take the first 3") still passes its tests.
     - Narrow `isSafeString` so these seeds come out redacted.
7. **[LOW] QA-7: nothing schedules the input-event check for the vendor fixtures that later sprints add.**
   - What: Sprint 0 has no content scripts. Hard Rule 3 is covered statically by `attest/no-act` (`tests/unit/lint/no-act.spec.ts`). QA added the runtime rail `tests/e2e/no-input-events.spec.ts`. It records 24 input-event types in every page before any page code runs, and has a negative control.
   - The rail only covers the `_harness` pages. No sprint task says to extend it: build_spec §10 mentions "E2E asserts no input events", but no Done-when in Sprints 2 or 3 does.
   - `.value =` writes and `.focus()` cannot be seen as events, so they stay lint-only.
   - Where: `extension/tests/e2e/no-input-events.spec.ts` (`FIXTURE_PAGES`); `sprints/sprint_2.md` 2.7; `sprints/sprint_3.md` 3.6
   - Rule: qa_tester rule 5; Hard Rule 3.
   - Fix: add to the Done-when of 2.7 and 3.6: "`no-input-events.spec.ts` covers every new vendor fixture with its content script running; zero events".

### PERF

No perf gate applies in Sprint 0, and nothing was measured, so no number is reported (Hard Rule 12). The gates are scheduled:

- Popup paint under 100 ms at 5,000 receipts: Sprint 4 Gate.
- Gmail fixture with 10,000 rows extracted in under 2 s: Sprint 6, task 6.4.
- Grading 5,000 claims against 50,000 observations in under 2 s in Node: Sprint 1, task 1.3 (written to `bench/results/core-<date>.json`).
- Measured for information only (no gate): the 5-minute network session ran in 5.0 to 5.1 min locally and 5.0 min on CI. A full `pnpm e2e` takes 5.1 min with 4 workers.

---

## The qa_tester checklist, in priority order

1. **The two mandatory tests:** green, tagged `@mandatory`, and run in CI as their own step. Both carry a negative control.
   - Before QA, nothing stopped a later sprint from skipping them: Playwright does not fail on a skipped test. QA added `tests/unit/harness/mandatory-guard.spec.ts`. It fails if any of the following happens:
     - a skip, fixme, fail or only marker, or retries, appears in either file;
     - a mandatory test title disappears;
     - the session drops below 5 minutes, or the allowlist, the page lists or the final assertions change;
     - a leak channel is removed;
     - Playwright retries become non-zero, or CI loses its own `--grep @mandatory` step or gains `continue-on-error`.
2. **`grade()` determinism and golden scenarios:** none exist yet. Sprint 1 builds them (1.5 and 1.8).
3. **Adapter and observer accuracy on labelled fixtures:** none exist yet (Sprints 2 and 3). The capture tool that feeds them is covered by unit tests and two E2E tests.
4. **E2E of the §2 demo through real content scripts:** Sprint 3, task 3.6.
5. **Redaction and export:** export is covered: deterministic, strict, and corrupt rows are skipped (`tests/unit/ledger/export.spec.ts`). `redact.ts` arrives in Sprint 1. The logger's redaction had no direct test; QA added one (see QA-2 and QA-6).
6. **UI states and a11y:** the options shell is covered by E2E (keyboard, focus contrast, dark mode, the reset flow). Before QA, the failure states were untested, because E2E cannot reach them. QA added `tests/unit/options/options-ui.spec.ts` for:
   - a storage read that fails, which shows an error;
   - a reset that fails or rejects, which keeps the old id and announces the failure;
   - a double confirm, which resets only once;
   - Cancel, which returns focus;
   - the popup and side-panel shells, and the three `main.tsx` mounts, including `options.root_missing`.

   The coverage, degraded and pending states arrive in Sprint 4.
7. **Edge cases:**
   - Time offsets: property-tested.
   - Unicode: leak matching is NFKC-normalised.
   - Duplicates: covered by the repo tests.
   - **Service-worker restart:** had no test. QA added `tests/e2e/worker-lifecycle.spec.ts`:
     - **Install:** the id exists and the purge alarm is scheduled with its period.
     - **Console:** popup, options and side panel open with zero console errors, warnings or exceptions. That is the Gate's "zero console errors", which was previously only checked by hand in 0.1.
     - **Worker restart:** a CDP `ServiceWorker.stopAllWorkers`, then a bus query, wakes the worker. The test checks that `background.started` is logged again, with no error or warning and no uncaught error reported over CDP. The ledger, the install id and the alarm schedule must be unchanged.
     - **Browser restart:** on the same profile, after the alarm was cleared, the alarm exists again and the id is kept.
     - Proof the restart check works: a mutant build with `console.error("qa mutant: startup error")` appended to `background.js` fails it (`+ "error qa mutant: startup error"`).
     - What it does not cover: the very first worker start (install) runs before any test can attach, so the test checks its effects instead.
     - The "kill mid-grace, the receipt still finalises" test is scheduled in Sprint 3, task 3.6.

Rule checks:

- **Rule 3, two tests per bus message type and per repo method:** met before QA.
  - Bus: `round-trip.spec.ts` sends a valid message and drops a malformed one for each of the 7 types.
  - Ledger: every exported repo method has a happy-path test and a duplicate, conflict or replace test (`repo-*.spec.ts`).
- **Rule 4, at least 1,000 examples:** was not met. Three `src/core` policy properties ran the default 100 examples, and the index-field property ran 300. Fixed by QA (see RESULTS).
- **Rule 9, no mocking inside `src/core`:** met. The policy tests call `loadPolicy` directly.
- **Rule 10, flaky = failing:** QA-4.

## Tests QA added or fixed (uncommitted; the closer commits them)

| File | What it adds | State |
|---|---|---|
| `extension/tests/unit/log.spec.ts` (new) | Levels, sink, console line format, every redaction rule, and every seed in every input position | 2 red: QA-2 |
| `extension/tests/property/log.property.spec.ts` (new) | 6 logger properties, 2,000 runs each | green |
| `extension/tests/unit/options/options-ui.spec.ts` (new, happy-dom) | Options failure states, popup and side-panel shells, `main.tsx` mounts | green |
| `extension/tests/unit/background/background-entry.spec.ts` (new) | `background.ts` wiring: install, startup, alarm, and install failure | 1 red: QA-3 |
| `extension/tests/unit/harness/mandatory-guard.spec.ts` (new) | Makes skipping or weakening a @mandatory test red | green |
| `extension/tests/e2e/worker-lifecycle.spec.ts` (new) | Install effects, zero console errors, worker restart, browser restart | green (repeated 4×, plus the mutant proof) |
| `extension/tests/e2e/no-input-events.spec.ts` (new) | Runtime Hard Rule 3 rail, with a negative control | green (repeated 4×) |
| `extension/tests/unit/background/alarms.spec.ts` | Adds "never rejects when a handler throws" | green |
| `extension/tests/unit/core/policy.spec.ts`, `policy-shape.spec.ts` | `numRuns: 1_000` (was 100) | green |
| `extension/tests/unit/ledger/index-fields.spec.ts` | `numRuns: 1_000` (was 300) | green |
| `extension/playwright.config.ts` | `expect: { timeout: 15_000 }` (QA-4) | green |

## Scheduled, not Sprint 0 gaps

- Receipt finalises after a worker kill mid-grace: 3.6.
- §2 demo E2E: 3.6.
- Golden and determinism tests: 1.5 and 1.8.
- Perf gates: 1.3, 4 Gate, 6.4.
- Adapter accuracy numbers: 2.2, 2.5 and Sprint 3.
- `pnpm attest replay`: the script points at `tests/tools/attest-cli.ts`, which does not exist yet, so `pnpm attest` exits with a module-not-found error. 1.9 says "later exposed as `pnpm attest replay`". Same note as tech.md.
- `tests/golden/` is in the Vitest include list but empty until Sprint 1.

## Verification (adversarial)

- **Verifier:** adversarial pass over QA-1 to QA-7, 2026-10-01. Read-only on code; this section is the only change.
- **Ran:**
  - `pnpm test`: 3 failed, 832 passed (835). The same 3 QA red tests.
  - `pnpm lint` and `pnpm typecheck`: exit 0.
  - `vitest run --coverage --coverage.reportOnFailure`: `src/core/policy.ts` 97.46% lines / 88.23% branches, 606 product lines covered. This matches the review.
  - `gh run list`, `gh run view 36923944944 --log`, `playwright test --list` (lists tests, launches no browser), and scratch probes against `src/log.ts`.
  - `pnpm build` and `pnpm e2e` were not run. E2E evidence comes from QA's own run logs in the session scratchpad (`e2e-run2.log`, `flaky*.log`, `pw-mutant-log/`).
- **Severity rule** (`agents/sprint_closer.md`; same reading as the verifier in `security.md`): a gap touches Hard Rules 1–4 when it changes whether an HR1–4 violation would be caught or blocked. That covers the logger and the no-leak corpus (HR2 names logs as a channel), and the mandatory tests and their CI gate (HR1, HR2). None of these gaps is a live violation today.
- **Result:** 7 of 7 confirmed, one of them as scheduled work; 0 refuted. 2 new gaps (QA-V1, QA-V2).

| Gap | Verdict | Severity (review → verified) | Kind | One-line reason |
|---|---|---|---|---|
| QA-1 | CONFIRMED | HIGH → **CRITICAL** | CODE | Run `36923944944` failed only at `Upload build`, with `include-hidden-files: false`. While every run ends red, a red `E2E (@mandatory)` step does not change the job result. |
| QA-2 | CONFIRMED | MEDIUM → **CRITICAL** | CODE | Both red tests reproduce. `log.ts:110` keeps a key when its lowercased form is an identifier. Same finding as SECURITY-1 (verified CRITICAL). |
| QA-3 | CONFIRMED | MEDIUM → LOW | CODE | The red test reproduces. The trigger is rare, and `onStartup` repairs it at the next browser start, so "never finalise" overstates it. Same as TECH-8 (LOW). |
| QA-4 | CONFIRMED | MEDIUM | CODE | `e2e-run2.log` shows the setup timeout and a worker-teardown timeout. `workers` is unset, and the launch has no timeout. Local only: CI already runs 1 worker. |
| QA-5 | CONFIRMED | MEDIUM | CODE | `gh run list` shows one push run and no PR run, yet 0.11 is ticked. Proof is missing, but the gate itself is not broken. |
| QA-6 | CONFIRMED | MEDIUM → **CRITICAL** | CODE | No seed is identifier-shaped, and the logger prints identifier-shaped content verbatim. HR2's mandatory test cannot see this class of leak. |
| QA-7 | CONFIRMED (scheduled) | LOW | SCHEDULED_LATER_SPRINT | True that no 2.x/3.x Done-when names it. But §10 DoD plus the Sprint 7 Gate, and qa_tester rule 5 at every sprint-end QA, already require it. |
| QA-V1 (new) | CONFIRMED | **CRITICAL** | CODE | The @mandatory guard checks source text. A `testIgnore` in the Playwright config silently drops no-leak, and the guard stays green. |
| QA-V2 (new) | CONFIRMED | LOW | CODE | `launchExtension` leaks the browser and temp profile if anything fails after launch. |

### Evidence per gap

**QA-1.**
- `gh run view 36923944944` shows every step `✓` except `X Upload build`. The step log has `include-hidden-files: false` and `##[error]No files were found with the provided path: extension/.output/. No artifacts will be uploaded.`
- `git log origin/main -1` is `b816bd4`, and `HEAD` is `89e7cc1`.
- The fix is correct: `actions/upload-artifact@v4` skips dot-paths unless `include-hidden-files: true`.
- Kind CODE: the closer edits `ci.yml` and pushes, as was done for `b816bd4`.
- Also seen in the log: `E2E (@mandatory)` printed `Running 5 tests using 1 worker` and `E2E (rest)` printed `Running 14 tests using 1 worker`. A private repo gets a 2-vCPU runner, so CI is already serial (see QA-4).

**QA-2.**
- `pnpm test`: `expected '…' not to contain 'akxqz7qw3rt5yu8iop2x'` and `… 'zxq9vl2mp8rt4wy7nb5c'` (`tests/unit/log.spec.ts:242`).
- Code: `log.ts:110` `return isIdentifier(key.toLowerCase()) || /^[a-z][A-Za-z0-9]{0,40}$/.test(key) ? key : …`.
- `Decisions.md` [0.1] covers values, not keys. No sprint 1–7 task touches `src/log.ts`.
- `grep` over `src` and `entrypoints` found 30 `log.*` call sites and no computed key or spread, so nothing leaks today.
- **Fix note:** the suggested `/^[a-z][A-Za-z]{0,31}$/` turns the two tests green, but it still prints content-shaped keys. Probe: `{ ottolineVasquez: 1 }` → `{"ottolineVasquez":1}`, and `{ glacierMinnowTrumpet: 1 }` printed the same way.
- **Better fix:** also add a `no-restricted-syntax` fence that bans computed keys and spreads in the fields argument of `log.*`. Every key is then a source literal, and the regex remains as a runtime backstop.

**QA-3.**
- `background.ts:20-24`: `handleInstalled(details).then(() => resetAlarms()).catch(… 'install.failed' …)`.
- Red test: `expected undefined to be defined` at `background-entry.spec.ts:84`.
- `Decisions.md` [0.10] records the order ("onInstalled ensures the install id then resets alarms"), but not that a failed id write cancels the alarms. No later task changes this, and 3.6 adds the grace alarm to the same path.
- **Two corrections:**
  - HR6 is about adapter health. The right anchors are extension_engineer rules 3 and 9 and qa_tester priority 7.
  - `onStartup` → `ensureAlarms()` recreates missing alarms at the next browser start, so receipts are delayed, not lost.
- The trigger is a `chrome.storage.local` write failure during install or update, which is rare. Hence LOW.

**QA-4.**
- `e2e-run2.log`:
  - `✘ 21 tests/e2e/options.spec.ts:319:3 … (1.0m)` with `Test timeout of 60000ms exceeded while setting up "attest".`
  - Then `Worker teardown timeout of 60000ms exceeded.` and `1 error was not a part of any test`. The review leaves out this teardown error.
- `flaky-load2.log`, run after the 15 s fix under synthetic load: `Running 48 tests using 4 workers` … `3 failed`.
- `playwright.config.ts` has no `workers` key.
- `support/extension.ts:42` calls `launchPersistentContext` with no `timeout`. Playwright's default launch timeout (180 s) is longer than the 60 s test timeout, so a hang shows up as an unexplained fixture timeout.
- **Not verifiable:** the claim of "an 80-test repeat run had 5 failures". `flaky.log`, `flaky1.log` and `flaky2.log` each end with `80 passed`. The core claim still stands on `e2e-run2.log`.
- **Narrowing:** CI already uses 1 worker, so `workers: process.env.CI ? 1 : 2` changes only local runs. Local runs still matter: the continue protocol runs `pnpm e2e` locally at every gate, so rule 10 applies.

**QA-5.**
- `gh run list --limit 5` returns one row: `completed failure … main push 36923944944`.
- The mutant proofs (`Decisions.md` [0.4], [0.5]) ran locally only. Task 0.11 is ticked `[x]`, yet neither half of its Done-when is met.
- `ci.yml` shows how the gate works: the step has no `continue-on-error`, and Playwright exits non-zero on failure. So this is missing evidence, not a broken gate, and it stays MEDIUM.
- Kind CODE: the agent can do it with `git` and `gh` after QA-1 is fixed. It goes to `MANUAL.md` only if the closer may not push.
- Cost: each extra run takes about 7.5 runner-minutes from the private repo's budget (`Decisions.md` [0.1] (c)).

**QA-6.**
- Probe: `buildRecord('info','probe',{reason:v})` printed all four strings verbatim (`zxq9vl2mp8rt4wy7nb5c`, `ottoline.vasquez`, `glacier-minnow-trumpet-velvet`, `files.example.net/share/q3-deck`).
- Each of the 15 seed values contains an uppercase letter, a space, `+`, or a leading digit (`912-44-7031`), so none is identifier-shaped.
- `leaks.ts:32` has `.length(15)`.
- **Correction to the fix:** narrowing `isSafeString` by shape alone cannot work. The same probe prints `bus.dropped`, `untrusted_context` and `adapter_health`, which have exactly the shape of `ottoline.vasquez` and `glacier-minnow-trumpet-velvet`.
  - The logger needs SECURITY-1 fix 3: free identifiers print only under a closed set of plumbing keys, or only from a closed vocabulary of values.
  - Pair it with SECURITY-V3 (canaries and the compact-form matcher).
- Moving from exactly 15 seeds to at least 15 strengthens the test. It still needs a `Decisions.md` line, because task 0.5 says 15 formats.

**QA-7.**
- Searching `sprints/` for `input event`, `no-input` and `zero events` finds nothing outside `sprint_0.md`, so no 2.x or 3.x Done-when names the check.
- The work is scheduled, though:
  - build_spec §10 DoD: "Zero actions on vendor pages (lint rule green; E2E asserts no input events dispatched)".
  - Sprint 7 Gate: "`build_spec.md` Definition of done fully ticked".
  - qa_tester rule 5 applies at every sprint-end QA, including Sprints 2 and 3, where the vendor fixtures land.
- So the gap is scheduled work. Adding the line to the Done-when of 2.7 and 3.6 is cheap, optional hardening.
- The lint half of HR3 has its own holes (SECURITY-3, SECURITY-V1, SECURITY-V2).

### New gaps the review missed

#### QA-V1: the @mandatory guard checks source text, not what Playwright actually runs

- **Severity:** CRITICAL (enforcement of the HR1 and HR2 tests). **Kind:** CODE.
- **Where:**
  - `extension/tests/unit/harness/mandatory-guard.spec.ts:28-33` (`SKIP_PATTERNS`) and `:61-66` (config and CI checks)
  - `extension/playwright.config.ts`
  - `.github/workflows/ci.yml:48-51`
- **Evidence:**
  - `playwright test --list --grep @mandatory` on the real config gives `Total: 5 tests in 2 files`.
  - The same command with a scratch config (the real config plus `testIgnore: ['**/no-leak.spec.ts']`) gives `Total: 3 tests in 1 file`, with exit 0. The guard's only check of `playwright.config.ts` is `/retries:\s*0,/`, which still matches.
  - `SKIP_PATTERNS` misses `test.info().skip(true, 'flaky')`, `testInfo.skip()` and `test.info().fixme()`. The probe reported MISSED for each. A runtime skip still exits 0 in Playwright.
  - The CI check is `toContain('run: pnpm --dir extension exec playwright test --grep @mandatory')`. Appending `--retries=3` or `--pass-with-no-tests`, or adding `if:` to the step, still passes it.
- **Fix:**
  1. In CI, add `--reporter=list,json` (or a JSON reporter) to the mandatory step, then fail unless exactly the 5 pinned titles ran, all passed, and none was skipped. Alternatively, add a unit test that runs `playwright test --list --grep @mandatory --reporter=json` and asserts the 5 titles. Either one catches config-level exclusion.
  2. In the two spec files and their `support/` imports, forbid `.skip(`, `.fixme(` and `.fail(` on any receiver.
  3. Pin the CI step's `run:` line exactly. Forbid `if:` on that step. Forbid `testIgnore`, `grep`, `grepInvert` and `testMatch` changes in `playwright.config.ts`, or pin their values.

#### QA-V2: `launchExtension` leaks the browser and the temp profile when a step after launch fails

- **Severity:** LOW (qa_tester rule 10; this makes QA-4's hangs worse). **Kind:** CODE.
- **Where:**
  - `extension/tests/e2e/support/extension.ts:42-56`
  - The same pattern in `tests/e2e/network-intercept.spec.ts` (`startGuardedSession`) and `tests/e2e/no-leak.spec.ts` (`collectAfter`), where `installRouteGuard` and `serviceWorker()` run between launch and any `try`
- **Evidence:**
  - `const context = await chromium.launchPersistentContext(…)` is followed by `const extensionId = new URL((await serviceWorker()).url()).host;` with no `try`/`finally`.
  - If that throws, the fixture's `launched.close()` never runs, because `launched` was never returned. The Chromium process and the `attest-e2e-*` profile directory stay behind.
  - `e2e-run2.log` shows `Worker teardown timeout of 60000ms exceeded` right after the setup timeout.
- **Fix:**
  1. Wrap everything after launch in `try`/`catch`. On failure, close the context and remove the owned profile, then rethrow.
  2. Give the `serviceworker` wait an explicit timeout (30 s) with a clear error message.
  3. Do the same around `installRouteGuard` in the two mandatory files.

### Checked and clean

- Every `fc.assert` (11 sites) runs at least 1,000 examples (`numRuns` 1,000 or 2,000).
- Every repo method has a happy test plus a duplicate, conflict or edge test. The list methods (`listGrants`, `listAdapterHealth`, `coverageByObserver`) are tested both populated and empty.
- The console channel does capture the worker's startup output. In QA's mutant run (`pw-mutant-log/…/error-context.md`), the seed logged at the end of `main()` was caught at `$[1]`, right after `background.started`.
- The built manifest has `"host_permissions":[]`. No test pins that yet; it is scheduled in 2.0, 3.0 and 6.6.
