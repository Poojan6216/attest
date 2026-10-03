# Sprint 1 — QA

Role: agents/qa_tester.md. Range reviewed: `937c333..0067c80` (Sprint 0 close to the last Sprint 1 task). Each review was checked by an independent adversarial verifier that re-ran the evidence and tried to refute every gap; verdicts are inline (CONFIRMED, RESIZED with the new severity, or REFUTED).

## Part 1: results

I finished QA part 1 (RESULTS) for Sprint 1. None of my jobs are still running, and every background task I started has exited. I made no changes to the shared tree. `pnpm bench` rewrote RESULTS.md and bench/results/core-2026-10-02.json. Both were clean before the run, so I restored them with `git checkout`. The other uncommitted files in the tree (tests/golden/timezones.spec.ts, policy-hash.spec.ts and others) belong to QA part 2. To get clean counts, I measured the committed code (0067c80) from a `git archive` copy in my scratch directory.

Headline results at 0067c80:
- **Lint and typecheck:** both pass.
- **`pnpm test`:** 6,063 of 6,063 tests pass, plus 2 of 2 perf gates.
- **`test:tz`:** 4,954 of 4,954 pass in each of the two timezones on the committed tree.
- **E2E:** 27 of 27 pass, including all 5 `@mandatory` tests.
- **Core coverage:** 98.37% lines.
- **Perf, on a quieter machine:** gradeBatch median is 1,301–1,308 ms CPU against the 2,000 ms gate. Candidate lookup is 301–317 ms CPU.

Every Sprint 1 Gate item I own has passing evidence.

Under the heavy load from the other reviewers (load average 50–284), the suite was not reliably green:
- Tests still on Vitest's 5,000 ms default timeout failed in 5 of my runs. These were `hash.property.spec.ts:25`, `policy-hash.spec.ts:113`, `scope.property.spec.ts:53`, `log.property.spec.ts:38`, `normalize.property.spec.ts:288` and `fences-scopes.spec.ts:55`.
- The exact coverage command failed both times I ran it, and wrote no report.
- The grading perf gate failed once, at 2,377 ms CPU.

Other findings:
- The replay property tests run 5–60 examples each, not the 1,000 that qa_tester rule 4 asks for.
- Two gradeBatch fallback paths are never run by any test. One is batch-retrieve.ts at 83.5% lines; the other is the BigInt branch in batch-score.ts.
- The coverage gate has no script, no threshold and no CI step.

I confirmed four known items: two test files over the 400-line limit, a CHANGELOG with nothing for Sprint 1, and docs/grading.md §15 missing golden-scenario fields. I did not confirm the suspected graceElapsed drift: both versions call the same helpers. I found no failing evidence for the features-golden.spec.ts fragility.

Raw outputs are in scratchpad/review1/qa-results/: test.txt, perf-run2-fail.txt, perf-run3.txt, perf-run4.txt, tz.txt, tz3-committed.txt, coverage.txt, coverage-plain.txt, coverage3.txt, coverage-committed/coverage-summary.json, flaky1.json, flaky2.json, full-committed.json, bench-run1.json, bench-run2.json and e2e.txt.

### RESULTS

Measured on 2026-10-02, at commit 0067c80, with Node v22.14.0, on an 8-core machine. Other reviewers were running at the same time, so the 1-minute load average was between 20 and 284 during these runs. Every number below says which run it came from.

- **Lint (`pnpm lint`):** passed, exit 0, 1 min 48 s.
  - ESLint gave 0 warnings in both extension/ and the root.
  - Prettier found no formatting problems in either place.
  - check-docs: "OK (4 files, 123 relative links, 13 pnpm commands, 14 rule ids)".
- **Typecheck (`pnpm typecheck`):** passed, exit 0, 59.8 s. It checks five tsconfig files: four in extension/ and the root one.
- **`pnpm test`** (14:46, load 43–69, tree identical to 0067c80): exit 0.
  - Unit, property and golden: 153 files, 6,063 passed and 0 failed, in 70.4 s.
  - Perf pass: 2 files, 2 passed and 0 failed, in 14.6 s.
  - The default reporter does not print the perf medians. The PERF section below gives them from separate runs.
- **Test counts by suite** (committed tree, JSON reporter):

| Suite | Files | Tests |
|---|---|---|
| Unit, src/core | 76 | 3,628 |
| Unit, other | 51 | 1,109 |
| Property | 19 | 86 |
| Golden | 7 spec files over 94 scenario JSON files | 1,240 |

  - In that same run, at load 100–260, one test failed: `policy-hash.spec.ts:113` hit the 5,000 ms timeout (it took 5,287 ms).
- **Timezone suites (`pnpm --dir extension run test:tz`):**
  - Committed tree, load 27–116: Pacific/Kiritimati passed 102 files and 4,954 of 4,954 tests in 46.6 s. America/St_Johns passed 4,954 of 4,954 in 99.2 s.
  - An earlier run on the shared tree, load 59–92: Kiritimati passed 4,954. St_Johns failed one test: `hash.property.spec.ts:25` timed out at 5,000 ms (it took 5,492 ms).
- **Coverage, src/core:**
  - The exact command failed twice under load, and Vitest wrote no report either time.
    - Run A, load 93–151: 3 timeouts. `hash.property:25` took 10,476 ms, `scope.property:53` took 5,447 ms and `policy-hash:113` took 8,448 ms.
    - Run B, committed tree, load 82–108: 4 timeouts. `hash.property:25` took 11,995 ms, `log.property:38` 5,686 ms, `normalize.property:288` 5,765 ms and `policy-hash:113` 7,198 ms.
  - I then measured with the same command plus `--testTimeout=120000 --coverage.reportOnFailure=true` on the committed tree. All 6,063 tests passed.

| Metric | Covered | % |
|---|---|---|
| Lines | 3,094 / 3,145 | **98.37%** (98.44% without src/core/tsconfig.json, which v8 counts as 0/2) |
| Statements | 3,643 / 3,743 | 97.32% |
| Branches | 2,359 / 2,578 | 91.50% |
| Functions | 768 / 775 | 99.09% |

  - src/core files under 95% lines:

| File | Lines | Uncovered lines |
|---|---|---|
| batch-retrieve.ts | 83.52% (71/85) | 194–207, 235–236 |
| batch-score.ts | 92.30% (36/39) | 72–74 |
| window.ts | 92.68% (38/41) | 82, 84–85 |
| features-content.ts | 94.59% (35/37) | 162–163 |
| policy-errors.ts | 94.59% (35/37) | 56 and 71 |
| tsconfig.json | 0% (0/2) | an artefact of the include glob, not code |

  - policy-errors.ts measured 97.29% in another run. Line 56 is covered only when a random property input happens to reach it.
  - Adapters and UI: no coverage yet. They are out of scope for Sprint 1.
- **E2E (`pnpm e2e`)**, load 211 falling to 59: 27 passed and 0 failed, in 5.2 min on 2 workers. No Chromium start-up hung.
- **Mandatory tests:**
  - Network intercept: ✅ 3 of 3.
    - The allowlist asserted is the shipped one: 9 ms.
    - The 5-minute scripted session made no request outside the allowlist: 5.1 min.
    - Negative control: 2.1 s.
  - Secret seed (no-leak): ✅ 2 of 2.
    - Seeded pages leave no trace in the export, IndexedDB, storage, console or network: 14.4 s.
    - Negative control: 12.7 s.
- **Bench (`pnpm bench`):** exit 0 both times. I restored RESULTS.md and bench/results afterwards; both were clean before.
  - Run 1, load 230 to 221:
    - Lookup: wall median 2,295.1 ms, CPU 375.1 ms. gatePassed=false.
    - Grading: wall median 10,136.4 ms, CPU 1,471.3 ms. gradingGatePassed=false.
  - Run 2, load 29 to 23:
    - Lookup: 264.2 ms wall (min 258.9, max 289.0) and 267.3 ms CPU. Index build: 193.5 ms.
    - Grading: 972.8 ms wall (min 879.8, max 1,273.2) and 1,259.0 ms CPU.
    - Both gates passed.
    - Receipts: 5,845 in total, with 1,883 VERIFIED, 1,073 NOT_FOUND and 844 UNASKED. These match the committed RESULTS.md exactly.
- **Flaky check (qa_tester rule 10):** I ran `npx vitest run tests/property tests/unit/lint` twice.
  - Run 1, load 49–65: 24 files, 331 of 331 passed, 95.4 s.
  - Run 2, load 64–158: 331 of 331 passed, 120.5 s.
  - Tests on the 5,000 ms default that came closest to it:

| Test | Run 1 | Run 2 |
|---|---|---|
| `hash.property:25` | 3,278 ms | 4,521 ms |
| `log.property:38` | 3,123 ms | 3,592 ms |
| `scope.property:53` | 2,903 ms | 1,781 ms |
| `fences-scopes:55` | 1,740 ms | 2,987 ms |
| `ratio.property:188` | 2,308 ms | 1,729 ms |
| `hash.property:36` | 1,090 ms | 2,011 ms |

  - Across all my runs, 6 different tests timed out at the default at least once. QA-R1 lists them.

### PERF

| Gate (qa_tester rule 7) | Measured | Limit | Result |
|---|---|---|---|
| Popup paint at 5,000 receipts | not measured | < 100 ms | N/A: Sprint 4 UI |
| Gmail fixture, 10,000 rows | not measured | < 2 s | N/A: Sprint 2 adapters |
| Grading, 5,000 claims × 50,000 observations (tests/perf/grading.perf.spec.ts, median CPU of 3 runs) | Run 3 (load 31–49): **1,301.0 ms**. Runs: 1,907.5, 1,301.0 and 1,244.2 ms CPU; 1,219.4, 1,056.9 and 1,056.8 ms wall. Run 4: **1,308.0 ms**. Runs: 1,855.7, 1,308.0 and 1,236.9 ms CPU. Run 2 (load 50–60): **2,377.3 ms**. Runs: 2,819.9, 2,377.3 and 1,786.7 ms CPU; 6,773.7, 2,372.3 and 5,301.3 ms wall. | < 2,000 ms | Pass at low load. **Failed once under load (QA-R3).** |
| Candidate lookup, 5,000 claims × 50,000 observations (task 1.3) | Runs 3 and 4: **300.6 ms and 316.5 ms** CPU median. Run 2 (load 50–60): 422.6 ms. | < 2,000 ms | Pass in every run |
| Bench, same workloads | Run 2 (load ~25): lookup 264.2 ms wall and 267.3 ms CPU; grading 972.8 ms wall and 1,259.0 ms CPU. Run 1 (load ~225): lookup 2,295.1 ms wall; grading 10,136.4 ms wall. | 2,000 ms, applied to the wall median | Run 2 passed. Run 1 reported both gates failed, on wall time. |

### CHECKLIST

| Item | Status | Evidence |
|---|---|---|
| Sprint 1 Gate: src/core imports nothing impure (lint + grep test for Date.now\|Math.random\|crypto.getRandomValues\|fetch) | PASS | `pnpm lint` passes (exit 0). eslint.config.js lines 434–446 apply no-restricted-imports, no-restricted-globals, no-restricted-syntax and attest/core-determinism to src/core/**. tests/unit/lint/fences.spec.ts:77-90 lints probes using Date.now, Math.random, crypto.getRandomValues and fetch, and checks that each one fails. `grep -rn 'Date\.now\|Math\.random\|getRandomValues\|fetch(' src/core` finds 0 matches. CI runs `pnpm lint` (ci.yml:40). No test greps the real src/core files: see QA-R7. |
| Sprint 1 Gate: determinism property test green at 5,000 | PASS | tests/property/grade.property.spec.ts:50 sets RUNS = 5_000. Two properties use it (lines 285–317): graded twice gives identical receipts, and permuting or repeating set members changes nothing. Both passed in every run: 24.1 s and 30.3 s for one, 21.2 s and 22.6 s for the other. Each has a 300 s timeout. The test also requires at least 18 distinct (ruleId, state) outcomes. |
| Sprint 1 Gate: 40+ golden scenarios green | PASS | There are 94 scenario files, tests/golden/01-…json to 94-…json. golden.spec.ts:27 asserts FILES.length >= 94, and it.each runs every file through the runner. Golden suite: 7 spec files and 1,240 tests, 0 failures in every run. |
| Sprint 1 Gate: replay 100% on a synthetic ledger | PASS | tests/property/replay.property.spec.ts:94-121 replays 1,000 claims and 10,000 observations over 3–8 batches with overrides, with numRuns 5. Replay reproduced every receipt, and one mutated grade gave exactly 1 mismatch. Durations: 65.0 s and 86.9 s. The 1,000-example minimum is not met: see QA-R2. |
| Sprint 1 Gate: redaction property test green | PASS | tests/property/redact.property.spec.ts:372-385 runs 1,000 examples. It seeds every secret from tests/fixtures/secrets/seeded.json through 5+ channels and checks that no getter is ever invoked. Passed in 3.7 s and 6.3 s. |
| Sprint 1 Gate: §2 demo test green with VERIFIED / NOT_FOUND / UNASKED | PASS | tests/unit/core/demo.spec.ts asserts three receipts. Line 172: VERIFIED, rule verified, FINAL. Line 212: NOT_FOUND, rule not_found, FINAL, only after grace (line 135 shows PENDING before grace). Line 255: UNASKED, rule unasked, with 2 signals and every reason saying 'likely'. Lines 346 and 369 cover the variant with no Calendar coverage: UNVERIFIABLE, rule no_coverage, never NOT_FOUND. All pass. |
| Sprint 1 Gate: core coverage >= 95% | PASS | Committed tree: lines 98.37% (3,094/3,145), statements 97.32%, branches 91.50%, functions 99.09%. Five files are under 95% lines: batch-retrieve.ts 83.52%, batch-score.ts 92.30%, window.ts 92.68%, features-content.ts 94.59% and policy-errors.ts 94.59%. The exact command failed under load both times it ran: see QA-R4. |
| Mandatory tests green and tagged @mandatory | PASS | `pnpm e2e`: 27 passed. network-intercept.spec.ts (describe at line 113, tagged @mandatory): 3 of 3 passed, including the 5.1-minute session. no-leak.spec.ts (describe at line 171): 2 of 2 passed. |
| qa_tester rule 4: at least 1,000 examples per core property test in CI | GAP | Every fc.assert in tests/property and tests/unit/core uses 1,000 or more runs, except the two replay files. replay.property.spec.ts uses 5 at line 117, 60 at 148, 40 at 175 and 30 at 202. replay-tamper.property.spec.ts uses 60 at 107, 45 at 127, 40 at 147 and 40 at 177. See QA-R2. |
| qa_tester rule 7: perf gates are tests | GAP | Both gates exist as tests that fail when exceeded: tests/perf/grading.perf.spec.ts:157 and candidates.perf.spec.ts:84, run by `pnpm test` through test:perf. The grading gate failed once under load at 2,377.3 ms CPU (QA-R3). Bench gates on wall time while the tests gate on CPU time (QA-R8). Popup paint and Gmail extraction are N/A until Sprints 2 and 4. |
| qa_tester rule 8: coverage reported, not gamed | GAP | The numbers are reported above. No coverage script exists in package.json, vitest.config.ts sets no coverage thresholds, and ci.yml has no coverage step. The specified command does not finish under load (QA-R4). |
| qa_tester rule 9: no mocking inside src/core tests | PASS | `grep -rn 'vi\.mock\|vi\.spyOn\|vi\.fn\|vi\.stubGlobal\|vi\.useFakeTimers\|vi\.doMock'` over tests/unit/core, tests/property, tests/golden and tests/perf finds 0 matches. Two other files import src/core and use spies: tests/unit/bus/send.spec.ts and tests/unit/bus/harness.ts. Both spy only on fakeBrowser.runtime, never on core. |
| qa_tester rule 10: flaky = failing | GAP | The two dedicated runs of tests/property and tests/unit/lint passed 331 of 331 both times. Across all my runs, 6 tests on the 5,000 ms default timed out at least once under load, in test:tz, coverage, the full suite and the unit run. See QA-R1. |
| Lint and typecheck clean | PASS | `pnpm lint`: exit 0, 0 warnings, Prettier clean, check-docs OK. `pnpm typecheck`: exit 0. |
| Timezone independence (test:tz) | PASS | Committed tree: 4,954 of 4,954 passed under both Pacific/Kiritimati and America/St_Johns. One earlier St_Johns run failed only on the hash.property:25 timeout (QA-R1). |
| Known item: graceElapsed wrapper drift | PASS | Not confirmed. The exported graceElapsed (conditions-coverage.ts:302) calls everySourceSynced(eligibleCoverage(...), graceSyncMs(...)). The method Conditions.graceElapsed (conditions.ts:237) calls syncedSources(this.eligible(), graceSyncMs(...)). Both use the same helpers. The export has no production caller: only tests/unit/core/conditions.spec.ts:17, 212, 241 and 243 use it. Whether to keep it is a question for the tech review. |
| Known item: features-golden.spec.ts fragility for future regrade scenarios | N/A | Not substantiated by a failure. Its header (lines 8–12) says it re-derives candidates, including the first-seen rule and assigned observations. It passed 130 of 130 at commit 0067c80. QA part 2 is editing it right now (shown as uncommitted in git status). Deferred to tech and part 2. |
| Known items: file sizes, CHANGELOG, docs §15 | GAP | Confirmed as QA-R12, QA-R13 and QA-R14. |

### GAPS

Verified gaps first, by severity after verification; refuted gaps are listed last and are not carried to the closer.

1. **QA-R3** [HIGH (reviewer: MEDIUM)] The gradeBatch perf gate fails under load even though it measures CPU time → `extension/tests/perf/grading.perf.spec.ts:157`
   - Rule: qa_tester rule 7 (perf gates are tests) and rule 10 (flaky = failing)
   - Detail: The gate takes the median CPU time of 3 runs. On a quieter machine the median is about 1,300 ms, a 35% margin. At load 50–60 CPU time inflated by more than 80% and the gate failed. Decisions [1.perf] chose CPU time because wall time was flaky, but CPU time is not immune to contention (shared cores, cache, frequency). With only 3 runs the median is noisy. This is load-related; the code is not slower.
   - Evidence: `npx vitest run --config vitest.perf.config.ts --reporter=verbose --silent=false` at load 50.7–60.7: 'perf gate: gradeBatch for 5000 claims: median 2377.3 ms CPU (run 1 2819.9 ms CPU / 6773.7 ms wall; run 2 2377.3 ms CPU / 2372.3 ms wall; run 3 1786.7 ms CPU / 5301.3 ms wall)'. 'AssertionError: expected 2377.265 to be less than 2000 ❯ tests/perf/grading.perf.spec.ts:157:34'. Runs 3 and 4, at load 31–49: medians of 1,301.0 and 1,308.0 ms CPU; both passed.
   - Suggested fix: Do not loosen the 2,000 ms gate. Make the measurement robust instead:
     - Take the minimum or the median of 5+ warm runs. The minimum CPU time is the least load-sensitive estimate of intrinsic cost.
     - Or run the perf pass only when the 1-minute load average is below the core count, and fail loudly with the load figure if it is not. Never skip silently.
     Log the decision in Decisions.md.
   - Verification: **RESIZED** to HIGH. Reproduced and worse than reported. qa-results/perf-run2-fail.txt shows the failure: 'median 2377.3 ms CPU … expected 2377.265 to be less than 2000' at grading.perf.spec.ts:157. The CI evidence the reviewer did not check is more serious. CI run 37049242959, on this exact commit 0067c80 on a clean runner, logged 'gradeBatch for 5000 claims: median 1893.6 ms CPU (run 1 2513.3 ms CPU / 1706.5 ms wall; run 2 1893.6 ms CPU / 1385.4 ms wall; run 3 1340.8 ms CPU / 1147.3 ms wall)'. That is a 5.3% margin. The cold run is already over the gate. The previous CI run (37028030216) measured 1,468.5 ms. Between consecutive CI runs, the median moved by 29%. The gate can therefore turn CI red on unchanged code, which breaks rule 10 and the task 1.5 Done-when. The reviewer's '35% margin, load-related only' does not hold on CI.

2. **QA-R1** [MEDIUM (reviewer: HIGH)] Tests on Vitest's 5,000 ms default timeout fail under machine load → `extension/tests/property/hash.property.spec.ts:25`
   - Rule: qa_tester rule 10 (flaky = failing); Sprint 1 Gate (suite and coverage must be green)
   - Detail: Many heavy property and lint tests have no explicit timeout, and vitest.config.ts:11 sets no testTimeout. Under load they go over 5,000 ms and fail. That turns `pnpm test`, the pre-push hook, test:tz and the coverage gate red with no code defect. The failure is load-related: each test passes alone and both dedicated rule-10 runs passed 331 of 331. By rule 10 it still counts as a failure. These tests prove Hard Rule 4 (idFromHash, policyHash), but the product code is correct, so I rate this HIGH rather than CRITICAL. Affected tests:
     - hash.property.spec.ts:25 (timed out 3 times), and hash.property.spec.ts:36, 60, 69 and 83
     - policy-hash.spec.ts:113 (timed out 3 times at 0067c80; part 2 has an uncommitted edit adding 60_000)
     - scope.property.spec.ts:53, 65 and 77
     - log.property.spec.ts:38–101
     - normalize.property.spec.ts:288 and 329
     - ratio.property.spec.ts:55–229
     - tests/unit/lint/fences-scopes.spec.ts:55 and fences.spec.ts:32
     - no-policy-literals.spec.ts:170
     - batch-determinism.spec.ts:98, 102 and 130
   - Evidence: test:tz, St_Johns, load 59–92: 'FAIL tests/property/hash.property.spec.ts > idFromHash (property) > equals the BigInt definition … Error: Test timed out in 5000ms' (5,492 ms).
     Coverage run A, load 93–151: hash.property:25 took 10,476 ms, scope.property:53 took 5,447 ms and policy-hash:113 took 8,448 ms, all 'Test timed out in 5000ms'.
     Coverage run B, committed tree, load 82–108: hash:25 took 11,995 ms, log:38 5,686 ms, normalize:288 5,765 ms and policy-hash:113 7,198 ms.
     Full committed suite, load 100–260: policy-hash:113 took 5,287 ms.
     Unit run, load 96–284: fences-scopes:55 took 5,157 ms.
     Rule-10 runs, durations on the default timeout: hash:25 took 3,278 and 4,521 ms (90% of the budget); log:38 took 3,123 and 3,592 ms.
   - Suggested fix: Set `testTimeout: 60_000` in extension/vitest.config.ts. Every property and lint test then gets the same upper bound already chosen per test in Decisions [1.contract-v1.3-impl], and no new heavy test can silently fall back to 5 s. Alternatively, add the numeric 60_000 third argument to each test listed. Keep numRuns unchanged and add no retries. Re-run `npx vitest run tests/property tests/unit/lint` and the coverage command at load above 100 to confirm.
   - Verification: **RESIZED** to MEDIUM. Real, but the severity is too high. An AST scan of the committed tree lists every it() with no timeout argument, and it matches the reviewer's list exactly: hash.property 25/36/60/69/83, log.property 38-101, normalize.property 288/329, ratio.property 55-229, scope.property 53/65/77, fences-scopes 55-242, fences 32-127, policy-hash 98-135, batch-determinism 98/102/130. vitest.config.ts:11 sets no testTimeout. The raw logs confirm the failures: in qa-results/tz.txt, hash.property:25 hit 'Test timed out in 5000ms' at 5,492 ms; coverage.txt shows 10,476, 5,447 and 8,448 ms at load 141. My runs at load 4-6, on 0067c80: hash.property:25 took 1,317 ms (1,169 ms with v8 coverage), policy-hash:113 took 1,135 ms (1,337 ms with coverage), and scope.property:53 took 597 ms. In the CI run on 0067c80 (gh run 37049242959, ubuntu-24.04), whole files took 1,002 ms (hash.property), 603 ms (policy-hash), 507 ms (scope.property) and 711 ms (log.property). Every failure needed a load average of 50 or more on 8 cores. There is no product defect and no Hard Rule is weakened. It is still real under rule 10, and Decisions.md:428, 478 and 544 show it recurring during the sprint, so MEDIUM, not HIGH.

3. **QA-R2** [MEDIUM] Replay property tests run 5–60 examples, not 1,000 → `extension/tests/property/replay.property.spec.ts:117`
   - Rule: qa_tester rule 4 (property tests for src/core: replay … minimum 1,000 examples each in CI)
   - Detail: The replay properties are the CI proof of replay determinism, and they run far fewer examples than rule 4 requires. Decisions.md:723 logs the counts with a cost reason, but the logged choice still breaks the checklist minimum. Every other core property file uses 1,000 or more.
   - Evidence: `grep -n numRuns tests/property/replay*.ts`: replay.property.spec.ts uses 5 at line 117, 60 at 148, 40 at 175 and 30 at 202. replay-tamper.property.spec.ts uses 60 at 107, 45 at 127, 40 at 147 and 40 at 177. Durations: the 1,000×10,000 property took 65.0 s and 86.9 s; the small-ledger properties took 5.8–17 s each.
   - Suggested fix: Keep the 5-run test at full size: it proves the task 1.9 Done-when. Raise the small-ledger and tamper properties to numRuns 1,000 using smaller ledgers (for example 1–20 claims and 1–100 observations, 2–4 batches) so each example costs about 10 ms. Alternatively, record a qa_tester rule 4 exception in Decisions.md with the reviewer's sign-off and a nightly job at 1,000.
   - Verification: **CONFIRMED**. An AST scan of every fc.assert under tests/ found only two files below 1,000 runs. replay.property.spec.ts uses numRuns 5, 60, 40 and 30 (lines 117, 148, 175, 202). replay-tamper.property.spec.ts uses 60, 45, 40 and 40 (lines 107, 127, 147, 177). Every other call uses RUNS or PROPERTY_RUNS of 1,000 to 5,000, or a literal of 1,000 or more. Decisions.md:723 logs the counts, but the logged choice still breaks qa_tester rule 4.

4. **QA-R4** [LOW (reviewer: MEDIUM)] The coverage gate has no script, no threshold and no CI step, and the specified command fails under load → `extension/package.json:18`
   - Rule: Sprint 1 Gate (core coverage >= 95%); qa_tester rule 8
   - Detail: Gate item 'core coverage >= 95%' is checked by a command nobody has committed. extension/package.json has no coverage script, vitest.config.ts has no coverage.thresholds, and .github/workflows/ci.yml (steps at lines 40–69) never measures coverage. So a drop below 95% would pass CI. The ad-hoc command adds v8 instrumentation, which slows tests, so the QA-R1 timeouts fire. Vitest's default reportOnFailure=false then writes no report, and the gate number cannot be produced reproducibly.
   - Evidence: Exact command, run A (load 93–151): 'Test Files 3 failed | 150 passed', 'Tests 3 failed | 6060 passed', and the reports directory was missing ('No such file or directory'). Run B on the committed tree (load 82–108): 'Tests 4 failed | 6059 passed', no report. `grep -n coverage .github/workflows/ci.yml extension/vitest.config.ts` matches nothing. package.json mentions only the devDependency '@vitest/coverage-v8'.
   - Suggested fix: Add `"test:coverage": "vitest run --coverage"` to extension/package.json. Add a coverage block to vitest.config.ts: provider 'v8', include ['src/core/**/*.ts'] (which drops the tsconfig.json artefact), thresholds { lines: 95 } for src/core, and reportOnFailure: true. Add a CI step after `pnpm test`. Fix QA-R1 first so the instrumented run finishes under load.
   - Verification: **RESIZED** to LOW. The facts are right. `grep -n coverage .github/workflows/ci.yml extension/vitest.config.ts extension/package.json` matches only the devDependency at package.json:38, and package.json:18 is a plain 'vitest run'. But qa_tester rule 8 says 'Report the numbers'. It does not require a CI threshold, and the sprint gate is checked by QA at sprint end. The 'fails under load' part is QA-R1 again. At low load with v8 coverage, the heavy tests took 1.2-1.3 s, well under 5 s. What remains is a reproducibility nicety, so LOW.

5. **QA-R5** [LOW (reviewer: MEDIUM)] gradeBatch's claim-by-claim candidate fallback is never executed by any test → `extension/src/core/batch-retrieve.ts:188`
   - Rule: qa_tester rule 8 (core coverage) and priority 2 (grade() and gradeBatch determinism, Hard Rule 4 evidence)
   - Detail: When one contentHash appears with two occurredAt instants, groupsOf returns null (addRows at line 121). candidatesOfAll (line 234) then falls back to claimByClaim (lines 188–207). None of the 6,063 tests runs this path, so batch-retrieve.ts is at 83.52% lines. contentHash binds occurredAt (docs/grading.md §10), so a well-formed ledger never reaches it. A forged or imported ledger can: `pnpm attest replay` reads untrusted exports. If the fallback disagreed with candidates(), gradeBatch could differ from grade(), which is the Hard Rule 4 equality. I have no evidence that it does; the path is simply unproven.
   - Evidence: Coverage on the committed tree: 'batch-retrieve.ts | 78.84 | 80 | 86.66 | 83.52 | 194-207,235-236'. coverage-summary.json: lines 71/85 and functions 86.66%.
   - Suggested fix: Add a unit test in tests/unit/core/batch-*.spec.ts. Build two observations by hand, bypassing project(), with the same contentHash and different occurredAt, both inside one claim's window, plus a second claim of the same type. Assert that candidatesOfAll and gradeBatch return the same candidates and receipts as per-claim candidates() and grade() (the brute-force oracle in tests/perf/grading.perf.spec.ts:41). Also assert that replay reports the contentHash mismatch.
   - Verification: **RESIZED** to LOW. The coverage gap is real: 'batch-retrieve.ts … 83.52 | 194-207,235-236' in qa-results/coverage3.txt. My probe, tests/unit/probe/fallback.spec.ts in scratch, adds to the bench workload a copy of an observation that shares its contentHash but occurs 2 minutes later. It reached the fallback: batch-retrieve went to 98.82% lines, with only line 53 left uncovered. gradeBatch then equalled brute-force grade() (the perf-spec oracle) for every claim: 'email.sent … checked 2938 diffs 0' and 'calendar.created … checked 258 diffs 0'. A second probe used a schema-shaped corrupt row, with the same id and contentHash but another occurredAt. The schema requires id = idFromHash(contentHash), per Decisions.md:586. It gave byte-identical output across the memory index, a reversed index and a reordered input ('same? true true'). claimByClaim calls candidates() itself. The Hard Rule 4 risk is not borne out, and only a regression test is missing.

6. **QA-R6** [LOW (reviewer: MEDIUM)] gradeBatch's BigInt score fallback is never executed by any test → `extension/src/core/batch-score.ts:72`
   - Rule: qa_tester rule 8 (core coverage) and priority 2 (gradeBatch determinism, Hard Rule 4 evidence)
   - Detail: When scorer.fraction() cannot express a pair's score as a fraction of safe integers, batch-score.ts:72-74 stores a NaN denominator and a BigInt ratio in `big`. No test reaches this branch (60% branch coverage), so the code that reads `big` when choosing the best candidate has never run. A wrong comparison there would make gradeBatch pick a different best candidate from grade(). I have no evidence that it does.
   - Evidence: Coverage on the committed tree: 'batch-score.ts | 86.66 | 60 | 100 | 92.3 | 72-74'. src/core/features.ts:278-285: 'false when the score needs BigInt (then `score` gives it)'.
   - Suggested fix: Add a test with a loaded policy that has many applicable features and coprime basis-point weights, plus ms-scale time windows, so that weightedFractionOf returns false. Find a case with ratio.ts helpers, then assert that gradeBatch's receipts equal grade() called directly for those claims. Also add a property in tests/property that pins the batch best-candidate choice to grade() under random weights, with 1,000 runs.
   - Verification: **RESIZED** to LOW. The gap is real: batch-score.ts lines 72-74 are uncovered. My probe, tests/unit/probe/bigint.spec.ts, ran gradeBatch over the bench workload with a modified policy. With calendarDays = 3,650, lines 72-74 were still uncovered, so the default-like policies never reach the path. With calendarDays = 1,000,000 (the schema allows up to MAX_SAFE_INTEGER/MS_PER_DAY), coverage reached 72-74. gradeBatch then equalled brute-force grade() for all 527 calendar claims: 'checked 527 diffs 0 grades [["VERIFIED",253],["UNVERIFIABLE",274]]'. The path needs an extreme policy and behaves correctly when reached, so only a regression test is missing.

7. **QA-R7** [LOW] No test scans the real src/core sources for clock, randomness or network calls → `extension/tests/unit/lint/fences.spec.ts:77`
   - Rule: Sprint 1 Gate wording ('lint + grep test for Date.now|Math.random|crypto.getRandomValues|fetch'); sprint_1.md header ('a grep test enforces the clock and randomness')
   - Detail: Enforcement depends entirely on `pnpm lint` (CI and the pre-commit hook). fences.spec.ts lints synthetic probe files ('src/core/probe.ts'), not the real files. `pnpm test` alone would not catch a Date.now() added to src/core with lint skipped. no-policy-literals.spec.ts already walks the real AST, but only for numeric literals.
   - Evidence: `grep -rln getRandomValues tests` returns only tests/unit/lint/fences.spec.ts, which uses probe code at lines 77–90. `grep -rn 'lintFiles' tests/unit` finds nothing. `grep -rn 'Date\.now|Math\.random|getRandomValues|fetch(' src/core` returns 0 lines today.
   - Suggested fix: Add tests/unit/core/purity-scan.spec.ts. Either run `new ESLint().lintFiles(['src/core/**/*.ts'])` with the real config and assert zero messages from the core rules, or walk src/core sources with the TypeScript AST, as no-policy-literals.spec.ts does, and fail on Date.now, Math.random, crypto.getRandomValues, fetch, performance and setTimeout. Tag it so the gate can cite it.
   - Verification: **CONFIRMED**. `grep -rn -E 'Date\.now|Math\.random|getRandomValues'` over tests/unit and tests/property finds only lint probe strings: fences.spec.ts:79-82, fences-scopes.spec.ts:245/247 and rules.spec.ts:80-96. No test reads the real src/core files for these tokens; no-policy-literals.spec.ts walks them for numeric literals only. The sprint gate (sprint_1.md:44) and tech_reviewer.md:24 both say 'grep + lint'. Lint does enforce it on the real files, through the ci.yml Lint step and attest/core-determinism at eslint.config.js:444, so LOW is right.

8. **QA-R8** [LOW] Bench and the perf tests gate on different clocks, bench exits 0 on a failed gate, and `pnpm test` hides the perf medians → `bench/core.ts:352`
   - Rule: qa_tester rule 7; Hard Rule 12 (report only measured numbers, consistently defined)
   - Detail: bench/core.ts:352 and :385 set gatePassed from the wall-clock median. tests/perf gate on the CPU median (Decisions [1.perf]). The same workload can therefore show 'gatePassed false' in RESULTS.md while the gate test passes, or the reverse. `pnpm bench` exits 0 even when gatePassed is false. The perf config's default reporter also suppresses the console.log of passing tests, so the CI log from `pnpm test` holds no perf numbers.
   - Evidence: Bench run 1 (load ~225): lookupMedianMs 2,295.1 with lookupCpuMedianMs 375.1 and gatePassed false; gradingMedianMs 10,136.4 with gradingCpuMedianMs 1,471.3 and gradingGatePassed false; exit=0. The `pnpm test` perf section printed only 'Test Files 2 passed (2)'. The medians appeared only with `--reporter=verbose --silent=false`.
   - Suggested fix: Compute bench gatePassed from the same statistic as the gate test (the CPU median), and keep reporting both clocks. Make run_bench.ts set a non-zero exit code when a gate fails. Set `silent: false` (or the verbose reporter) in vitest.perf.config.ts so the medians appear in `pnpm test` and CI output.
   - Verification: **CONFIRMED**. bench/core.ts:352 has 'gatePassed: lookupMedianMs < GATE_MS' and :385 has 'gradingGatePassed: gradingMedianMs < GATE_MS', both on the wall median. qa-results/bench-run1.json shows gatePassed false and gradingGatePassed false while bench.txt ends with exit 0. run_bench.ts never sets an exit code. One sub-claim is wrong: 'the CI log from pnpm test holds no perf numbers'. CI run 37049242959 prints both medians ('perf gate: gradeBatch for 5000 claims: median 1893.6 ms CPU…' and 'candidate lookup … median 348.6 ms CPU'). Only the local run hid them. The other two points stand at LOW.

9. **QA-R9** [LOW] merchantMatchOf is dead code, and the property test its comment cites does not exist → `extension/src/core/features-content.ts:158`
   - Rule: qa_tester rule 8 (do not game coverage); test-claim accuracy
   - Detail: merchantMatchOf is exported but has no caller anywhere in src or tests. Its doc comment says 'a property test pins this to merchantMatchName', but no test references it. It is 2 of the 2 uncovered lines in features-content.ts (94.59%).
   - Evidence: `grep -rn merchantMatchOf src tests` returns only 'src/core/features-content.ts:158:export function merchantMatchOf('. Coverage: 'features-content.ts | 94 | 92 | 93.75 | 94.59 | 162-163'.
   - Suggested fix: Delete merchantMatchOf if the batch path no longer needs it. Otherwise add the property its comment promises: merchantMatchOf(prepare(a), prepare(b)) equals merchantMatchName(a, b) over 1,000 random merchant pairs.
   - Verification: **CONFIRMED**. `grep -rn merchantMatchOf extension/src extension/tests bench scripts docs` returns only 'extension/src/core/features-content.ts:158:export function merchantMatchOf('. The doc comment at lines 154-156 says 'a property test pins this to merchantMatchName'. No such test exists. Coverage leaves lines 162-163 uncovered.

10. **QA-R10** [LOW] window.ts has an unreachable offset fallback → `extension/src/core/window.ts:82`
   - Rule: qa_tester rule 8 (core coverage)
   - Detail: writtenOffsetMinutes falls back to a regex (lines 82–85) when trailingOffsetMinutes returns null. tests/property/normalize-time.property.spec.ts:137 already proves that trailingOffsetMinutes answers for every timestamp instantMs accepts, so the fallback never runs. That leaves window.ts at 92.68% lines.
   - Evidence: Coverage: 'window.ts | 91.48 | 80.95 | 100 | 92.68 | 82,84-85'. The property title reads 'is null or the pattern reading, and answers for every timestamp instantMs accepts'.
   - Suggested fix: Replace the fallback with a typed error, since it is unreachable by contract. Or test it directly with an input for which trailingOffsetMinutes returns null. Do not leave untestable code in src/core.
   - Verification: **CONFIRMED**. window.ts:78-86, writtenOffsetMinutes, falls back to the ISO_OFFSET regex only when trailingOffsetMinutes returns null. tests/property/normalize-time.property.spec.ts:137-145 asserts `if (outcome(instantMs, iso) !== 'NormalizeError:invalid_iso') expect(fast).not.toBeNull()` over 20,000 runs. So the fallback is unreachable by contract. Coverage shows 'window.ts … 92.68 | 82,84-85'.

11. **QA-R11** [LOW] The non-finite number error message is covered only when a random input happens to reach it → `extension/src/core/policy-errors.ts:56`
   - Rule: qa_tester rule 8 (coverage must be measured, not luck)
   - Detail: Line 56 ('must be a finite number') was covered in one coverage run and missed in the next. Only random fast-check inputs reach it, and no table test does. This made policy-errors.ts swing between 97.29% and 94.59% lines.
   - Evidence: Shared-tree coverage run: 'policy-errors.ts | 97.87 | 88.46 | 100 | 97.29 | 71'. Committed-tree run: 'policy-errors.ts | 95.74 | 86.53 | 100 | 94.59 | 56,71'.
   - Suggested fix: Add table rows to tests/unit/core/policy-errors.spec.ts: loadPolicy with a weight of NaN and one of Infinity must throw a PolicyError naming the path, with the message 'must be a finite number'.
   - Verification: **CONFIRMED**. policy-errors.ts:55-56 returns 'must be a finite number'. `grep -n 'finite number|NaN|Infinity' tests/unit/core/policy*.ts` finds no table case. Only noNaN doubles appear (policy-errors-lists.spec.ts:370, 383). The only generator that can reach the line is the unconstrained fc.double() at policy-shape.spec.ts:280. Two coverage runs disagree: coverage2.txt has 'policy-errors.ts … 97.29 | 71' and coverage3.txt has '94.59 | 56,71'.

12. **QA-R12** [LOW] Two Sprint 1 test files exceed the 400-line limit → `extension/tests/property/normalize.property.spec.ts:401`
   - Rule: tech_reviewer.md:20 (files <= 400 lines)
   - Detail: Confirmed. tests/property/normalize.property.spec.ts has 475 lines and tests/unit/core/receipt.spec.ts has 462. Decisions.md shows earlier splits made for exactly this rule; these two were missed.
   - Evidence: `wc -l` gives 475 for tests/property/normalize.property.spec.ts and 462 for tests/unit/core/receipt.spec.ts. These are the only files over 400 lines among the .ts files in src, tests, scripts and bench.
   - Suggested fix: Split normalize.property.spec.ts by function, for example normalize-address.property.spec.ts for email/address and normalize-text.property.spec.ts for name/subject tokens. Split receipt.spec.ts by concern. Keep every assertion and numRuns.
   - Verification: **CONFIRMED**. `wc -l` gives 475 for tests/property/normalize.property.spec.ts and 462 for tests/unit/core/receipt.spec.ts. These are the only files over 400 lines among the .ts/.js files in extension/src, tests, eslint-rules, entrypoints, scripts and bench; the next largest is schema.ts at 400. receipt.spec.ts did not exist at 937c333. The limit is tech_reviewer.md:20: 'files ≤ 400 lines'.

13. **QA-R13** [LOW] CHANGELOG [Unreleased] has no Sprint 1 entries → `CHANGELOG.md:5`
   - Rule: Conventions (SemVer, Keep a Changelog); docs_writer
   - Detail: Confirmed. Sprint 1 added the whole grading core: grade, gradeBatch, replay, the attest replay CLI, docs/grading.md and check-docs in lint. The [Unreleased] section lists only Sprint 0 work.
   - Evidence: `git log --oneline 937c333..0067c80 -- CHANGELOG.md` prints nothing. The 'Added' bullets cover the scaffold, fences, ledger, bus, policy loader, capture, options and CI.
   - Suggested fix: Add Sprint 1 bullets under [Unreleased] Added: the pure grading core (schemas, normalisation, redaction, candidates, features, grade/gradeBatch, state machine, attribution, scope), 94 golden scenarios, property and perf gates, replay and `pnpm attest replay`, the docs/grading.md v1 reference, and check-docs in `pnpm lint`.
   - Verification: **CONFIRMED**. `git log --oneline 937c333..0067c80 -- CHANGELOG.md` prints nothing. `git show 0067c80:CHANGELOG.md` has an [Unreleased] section with Sprint 0 items only, and no mention of grade, replay or golden. The precise rule is tech_reviewer.md:38, 'CHANGELOG updated under Unreleased'.

14. **QA-R14** [LOW] §15 does not document every golden scenario field that v1.4 added → `docs/grading.md:358`
   - Rule: docs/grading.md §15 ('Each scenario is … written from this document alone')
   - Detail: Confirmed. tests/golden/scenario-schema.ts accepts fields that §15 never mentions:
     - top-level `events` (override, supersede and regrade, with `rejected` and `deleted`)
     - `assertIds` (`equal`, `ascending`)
     - `notes`
     - `input.grade` for mode 'grade'
     - `input.activity.adapterSyncs`
     - the expect fields `inputs`, `override`, `previousState`, `supersededBy`, `attributionScore` and `scope`
     Only tests/golden/README.md:45-67 documents them. A new scenario cannot be written from the doc alone.
   - Evidence: In docs/grading.md lines 358–419, `grep -c` finds 0 matches each for events, assertIds, notes, supersededBy, previousState, attributionScore and adapterSyncs. scenario-schema.ts:366-367 has 'events: z.array(ScenarioEvent).optional(), assertIds: AssertIds.optional()', and lines 316–335 hold the expect fields.
   - Suggested fix: Extend the §15 JSONC example and its bullets to cover every field in scenario-schema.ts, using the README text. Then add a check to scripts/check-docs.ts that every key of the Scenario schema appears in §15.
   - Verification: **CONFIRMED**. I extracted §15 (docs/grading.md:358-419, 62 lines). `grep -c` finds 0 matches each for events, assertIds, notes, supersededBy, previousState, attributionScore, adapterSyncs and regrade. scenario-schema.ts:316-335 defines the expect fields scope, agent, attributionScore, override, previousState, supersededBy and inputs. Lines 362-371 define notes, events and assertIds, and input.grade at line 346.

### ADVERSARIAL VERIFICATION

I verified the QA part 1 (results) review of Sprint 1. To answer the user's question: I run no background jobs. Every probe ran in the foreground in my scratch copy of commit 0067c80 (scratchpad/review1/verify-qa-results/tree) and has finished. I did not touch the shared tree.

Results:
- **Confirmed (9):** QA-R2 and QA-R7 through QA-R14.
- **QA-R8 is confirmed, but one of its claims is wrong.** The CI log does print the perf medians.
- **Resized (5):**
  - QA-R1 goes from HIGH to MEDIUM. In CI, hash.property.spec.ts took 1,002 ms for the whole file. Locally at load 4–6 it took 1.2–1.3 s even with coverage on. The timeouts only fire at load averages of 50 or more.
  - QA-R3 goes from MEDIUM to HIGH. The CI run on 0067c80 measured the gradeBatch gate at 1,893.6 ms CPU against the 2,000 ms limit. That is a 5.3% margin on a clean runner, and its cold run was 2,513 ms. The previous CI run measured 1,468.5 ms. So the gate can fail in CI on unchanged code; it is not only a local load problem.
  - QA-R4 goes from MEDIUM to LOW. Rule 8 asks for coverage to be reported, not enforced in CI. The failure under load is a symptom of QA-R1.
  - QA-R5 and QA-R6 go from MEDIUM to LOW. My probes reached both untested fallbacks. gradeBatch matched brute-force grade() with 0 differences in every case:
    - the batch-retrieve fallback: 2,938 email claims and 258 calendar claims
    - the BigInt score path: 527 calendar claims, but only with calendarDays = 1,000,000; at 3,650 it is never reached
  - What remains for both is a missing regression test, not a proven defect.
- **Missed (1):** QA-VR1. The known item about features-golden.spec.ts is real. A valid regrade scenario passes golden.spec but fails features-golden.spec.ts:118. The cause is that this check reads candidates at the first evaluatedAt and ignores the regrade's.

Checklist corrections:
- The purity gate item should be partial, not PASS, because its grep test does not exist.
- The features-golden known item should be a GAP, not N/A.
- The rule 7 evidence should include the CI numbers.
- Rule 3 was never checked. My spot check passes.

Gaps the verifier found that the review missed:

1. **QA-VR1** [LOW] The features-golden cross-check fails a valid regrade scenario and tie-breaks differently from grade() → `extension/tests/unit/core/features-golden.spec.ts:118`
   - Rule: Known item: features-golden.spec.ts fragility for regrade scenarios; qa_tester rule 10 (a test must not fail on correct code); docs/grading.md:201 (best candidate ties broken by observation id)
   - Detail: ownCandidates (line 118) keeps observations by `instantMs(loaded.evaluatedAt)`, the first grading's instant, even when the expected receipt comes from a later accepted regrade (§8). A scenario where a row is first observed between the first grading and the regrade passes golden.spec.ts, so grading and the runner agree. features-golden.spec.ts still fails it. Separately, best() (lines 94-104) breaks equal scores by (occurredAt instant, id) and keeps the first maximum. grade-best.ts:135 breaks them by observation id only, as docs/grading.md:201 states. The comment at line 94 ('as grade() orders them') is wrong. Both problems turn correct new goldens into false failures, which blocks the golden suite from growing. The reviewer marked this known item N/A for lack of a failure; a probe produces one. QA part 2's uncommitted diff in the shared tree changes both spots, but it is not committed.
   - Evidence: In my scratch copy of 0067c80 I added tests/golden/95-probe-regrade-sees-later-row.json, which has the same shape as golden 93. It has one claim c1 and one row o1 with observedAt 14:40, a first grading at 14:30, one regrade at 14:45, and an expected VERIFIED / verified / FINAL / 1/1. `npx vitest run tests/golden/golden.spec.ts -t 95-probe --reporter=verbose` passed: '✓ … 95-probe-regrade-sees-later-row.json 43ms'. `npx vitest run tests/unit/core/features-golden.spec.ts` failed: '× 95-probe-regrade-sees-later-row.json c1: best over its own candidates … AssertionError: expected null to be '1/1' ❯ tests/unit/core/features-golden.spec.ts:169:32'. The tie-break mismatch is visible in the code: line 97 sorts with '(a, b) => instantMs(a.occurredAt) - instantMs(b.occurredAt) || (a.id < b.id ? -1 : 1)', while grade-best.ts:135 has 'return order > 0 || (order === 0 && id < best.observation.id);'.
   - Suggested fix: Read each receipt's candidates at the evaluatedAt of its last applied regrade event, else the scenario's evaluatedAt. Break score ties by observation id only. This is what part 2's uncommitted diff does; commit it. Then commit a regrade golden like the probe, so both rules are pinned.

Checklist corrections:

- 'Sprint 1 Gate: src/core imports nothing impure (lint + grep test …)' is marked PASS. It should be PARTIAL or GAP. The lint half passes (eslint.config.js:434-446, CI Lint step), but the gate asks for a grep test (sprint_1.md:44; tech_reviewer.md:24 'grep + lint rule'), and none exists. The reviewer's own QA-R7 says so, which contradicts the PASS.
- 'Known item: features-golden.spec.ts fragility' is marked N/A. It should be GAP (QA-VR1, LOW). A probe regrade scenario passes golden.spec.ts but fails features-golden.spec.ts:169 because line 118 reads at the first evaluatedAt. Line 97 also tie-breaks differently from grade-best.ts:135.
- 'qa_tester rule 7: perf gates are tests' is correctly marked GAP, but the evidence and the PERF table leave out CI. CI run 37049242959 on 0067c80 measured the grading gate at 1,893.6 ms CPU, a 5.3% margin, with a cold run of 2,513.3 ms. Run 37028030216 measured 1,468.5 ms. The table's 'pass at low load, ~35% margin' does not hold on the CI runner (see QA-R3, resized to HIGH).
- qa_tester rule 3 (two tests per bus message type; two per Dexie repo method) is missing from the checklist, although Sprint 1 changed src/bus/messages.ts (adapter.health now carries HealthReport) and src/ledger/repo.ts (putReceipt's signature and the *Input types). My spot check passes: messages.spec.ts:67 has the valid case and :86 the malformed case for adapter.health, and repo-requests-receipts.spec.ts:78-89 covers putReceipt. The row should be added as PASS with this evidence.
- 'Mandatory tests green and tagged @mandatory' rests only on local runs. Add the CI evidence that rule priority 1 asks for: CI run 37049242959 on 0067c80 shows 'E2E (@mandatory) 5 passed (5.2m)' and 'E2E (rest) 22 passed'. The status stays PASS.

### COMMANDS RUN

- `pnpm lint` → PASS: exit 0, 1 min 48 s. ESLint 0 warnings in extension and root, Prettier clean, check-docs OK (4 files, 123 links, 13 pnpm commands, 14 rule ids).
- `pnpm typecheck` → PASS: exit 0, 59.8 s, five tsconfig projects.
- `pnpm test` → PASS: Load 43–69. Unit, property and golden: 153 files, 6,063 passed, 70.4 s. Perf pass: 2 of 2 passed, 14.6 s. Medians were not printed.
- `npx vitest run --config vitest.perf.config.ts --reporter=verbose --silent=false (x3)` → FAIL once, PASS twice: Run 2 (load 51–61): grading 2,377.3 ms CPU median, failing the 2,000 ms gate; lookup 422.6 ms. Runs 3 and 4 (load 31–49): grading 1,301.0 and 1,308.0 ms; lookup 300.6 and 316.5 ms.
- `pnpm --dir extension run test:tz` → FAIL once (load), PASS on committed tree: Shared tree, load 59–92: Kiritimati 4,954 passed; St_Johns 1 failed (hash.property:25 timed out, 5,492 ms). Committed tree: 102 files, 4,954 of 4,954 passed in both timezones (46.6 s and 99.2 s).
- `npx vitest run --coverage --coverage.provider=v8 --coverage.include='src/core/**' --coverage.reporter=text-summary --coverage.reporter=json-summary --coverage.reportsDirectory=<scratch>/coverage` → FAIL (load) x2: Run A: 3 timeouts, no report. Run B (committed tree): 4 timeouts, no report.
- `same coverage command + --testTimeout=120000 --coverage.reportOnFailure=true (committed tree)` → PASS: 6,063 of 6,063 passed. Lines 98.37% (3,094/3,145), statements 97.32%, branches 91.50%, functions 99.09%. Under 95% lines: batch-retrieve 83.52, batch-score 92.30, window 92.68, features-content 94.59, policy-errors 94.59, and the tsconfig.json artefact at 0.
- `npx vitest run (committed tree in scratch, JSON reporter)` → FAIL once (load): Load 100–260: 6,062 passed, 1 failed (policy-hash.spec.ts:113 timed out, 5,287 ms). Counts: unit/core 76 files and 3,628 tests; other unit 51 and 1,109; property 19 and 86; golden 7 and 1,240.
- `npx vitest run tests/property tests/unit/lint (x2, JSON reporter)` → PASS x2: 24 files, 331 of 331 both times (95.4 s and 120.5 s). Nearest to the 5 s default: hash:25 at 4,521 ms and log:38 at 3,592 ms.
- `npx vitest run tests/unit tests/golden (shared tree, JSON reporter)` → FAIL once (load): Load 96–284: fences-scopes.spec.ts:55 timed out at 5,157 ms. This tree included part 2's uncommitted tests, so I used it only as timeout evidence.
- `pnpm bench (x2), then git checkout -- RESULTS.md bench/results` → run 1 gates false (load); run 2 PASS: Run 1 (load ~225): lookup 2,295.1 ms wall and 375.1 ms CPU, grading 10,136.4 ms wall and 1,471.3 ms CPU, gatePassed false, exit 0. Run 2 (load ~25): lookup 264.2 ms wall and 267.3 ms CPU, grading 972.8 ms wall and 1,259.0 ms CPU, gates pass; receipts 5,845/1,883/1,073/844 identical to the committed results. Both files were clean before each run and restored after.
- `pnpm e2e` → PASS: 27 of 27 passed in 5.2 min on 2 workers, 0 hung starts. @mandatory: network-intercept 3 of 3, no-leak 2 of 2.
- `grep and AST scans (numRuns, vi.mock/vi.spyOn, purity tokens, default timeouts, line counts, §15 fields)` → done: Static evidence for rules 4 and 9, the purity gate, QA-R1's list of default-timeout tests, and the known items.

## Part 2: untested rules and new tests

QA part 2 (GAPS) for Sprint 1. To answer the relayed question: yes, this job is the Sprint 1 review running in the background. This part found the untested parts and wrote tests for them. The Sprint 1 test suite is strong. I made 152 mutation probes across src/core, the replay CLI and check-docs, in scratch mirrors under scratchpad/review1/qa-gaps*. The existing suite caught 134 of them. 7 of the 18 that survived are equivalent or unreachable, so they are not gaps (M52, E05, E09, E19, B09, B15, T6). The other 11 are real untested rules or branches. Each of the 11 also survived the property suite. The tests I wrote now catch all 11. I found no product defect in src/core. One new red test marks a tooling defect: check-docs accepts a root-level `pnpm test:tz`, but that script exists only in extension/package.json (QA-G10). One existing test was flaky under load and is now fixed: policy-hash.spec.ts timed out at 5,000 ms twice. Two test-only defects were fixed in features-golden.spec.ts: it broke score ties a different way from grade(), and it read candidates at the wrong instant for regrades. I confirmed the known items: two test files are over 400 lines, CHANGELOG has nothing for Sprint 1, and §15 does not document the v1.4 golden fields. The graceElapsed wrapper has not drifted, and a property test now pins it to the evaluator. Grading is identical under 7 more host time zones. Last run, of the new tests and the folders next to them: 100 files and 5,266 tests. 5,265 passed. The 1 failure is the intended red test. Files added: extension/tests/golden/timezones.spec.ts, extension/tests/property/conditions-grace.property.spec.ts, extension/tests/unit/core/{scope-errors,grade-reasons-policy,conditions-eligibility}.spec.ts, extension/tests/unit/docs/check-docs-edges.spec.ts. Files changed: extension/tests/unit/core/{features-golden,policy-hash,replay,window}.spec.ts, extension/tests/unit/tools/attest-cli.spec.ts, extension/tests/golden/README.md. I wrote no product code and made no commit.

### RESULTS
- Targeted run after my changes, in the real tree: `npx vitest run tests/unit/core tests/golden tests/unit/tools tests/unit/docs tests/property/conditions-grace.property.spec.ts`. 100 files and 5,266 tests: 5,265 passed, 1 failed, in 22.2 s wall. The failure is the intended red test QA-G10, `check-docs-edges.spec.ts > a root-level command that only extension/package.json defines is reported`.
- Each new or changed file in that run (all green except the one red test):
  - timezones.spec 8/8
  - conditions-grace.property 2/2
  - scope-errors 8/8
  - grade-reasons-policy 5/5
  - conditions-eligibility 12/12
  - check-docs-edges 15/16
  - features-golden 130/130
  - window 53/53
  - attest-cli 21/21
  - policy-hash 5/5
  - replay 15/15
- Earlier runs on the unchanged tree, under load from my two mutation runs and the other reviewers:
  - unit + golden: 5,976 passed, 1 failed. `policy-hash.spec.ts > changes when any single value changes` timed out at 6,111 ms.
  - property + policy-hash + no-policy-literals + docs: 157 passed, 1 failed (the same test timed out at 5,033 ms).
  - property alone: 19 files, 86/86 passed in 62.9 s.
- Mutation probes: 152 mutants; 134 killed by the existing suite; 18 survived. 7 are equivalent or unreachable. The other 11 are real gaps: R08, E01, E02, E03, E04, E08, E11, E12, B08, B11, T4. Each of those 11 also survived the replay or property suites, and the new tests now kill all of them.
- Static checks on every new and changed test file: `tsc -p tests/tsconfig.json` clean, eslint clean, prettier clean.
- Coverage (core / adapters / ui): not measured by this part; QA part 1 owns it. No number is reported (Hard Rule 12).
- Mandatory tests (network-intercept, secret-seed): not run by this part. This role excludes `pnpm e2e`.
### PERF
- Popup paint, Gmail extract and grading gates: not run by this part, because this role excludes the perf pass. No numbers are reported (Hard Rule 12).

### CHECKLIST

| Item | Status | Evidence |
|---|---|---|
| Every ReasonCode is emitted with its params by a test | PASS | I counted codes across tests/golden/*.json. All 29 REASON_CODES appear in expect.reasonCodes, and each has reasonParams asserted in at least one scenario. Examples: match.best 108 appearances (43 with params), unasked.signature 1 (1), coverage.calendars_hidden 1 (1), superseded 2 (2). |
| Every policy rule id is reached by a golden scenario | PASS | ruleIds in the golden expectations: verified 54, partial 22, pending 7, not_found 30, no_coverage 9, partial_coverage 11, unasked 18, over_scope 3, over_ceiling 10, underspecified 7, no_target 1, over_ceiling_cumulative 3, over_allowlist 6, over_scope_observed 4, default_unverifiable 4. That is all 14 policy rules plus the terminal rule. |
| Replay detects tampering of each compared field | PASS | replay-report.spec.ts tampers each COMPARED_FIELDS entry and expects exactly one mismatch. replay-tamper.property.spec.ts covers the unread and timeline fields. Mutants that drop finalAt (RC01), compare state without previousState (B17), compare lifecycle reasons (B18), or drop rowKeyHash from contentHash (RC02) are all killed. One gap: the replay timeline boundary for UNASKED overrides (T4, QA-G7), now fixed. |
| attest CLI exit codes | GAP | Exits 0, 1 and 2 are tested. A fuzz of 400 one-field edits to the scenario export gave exits {0:5, 1:31, 2:364} and 0 uncaught throws. The five exit-0 cases changed override.reason or exportedAt, which replay does not compare. The `-h` and `help` arguments were untested (E08 survived): QA-G8, fixed. |
| check-docs edge cases | GAP | Correct today, now pinned by green tests: reference links, images, HTML href, angle-bracket destinations, %20, titles, nested parentheses, links in tables, blockquotes and lists, punctuated heading anchors, `-C extension`. Gaps: the `#` comment guard and the path lookbehind were untested (E11, E12; QA-G9, fixed); root-level extension-only scripts pass the check (QA-G10, red test); markdown false positives and negatives (QA-G11). |
| Time-zone independence beyond the two zones in test:tz (DST, +05:45, +14:00) | PASS | New tests/golden/timezones.spec.ts grades all 94 scenarios under the host zone, then under Asia/Kathmandu, Etc/GMT+12, Pacific/Chatham, Australia/Lord_Howe, America/New_York, Europe/London and Pacific/Kiritimati. Every receipt is identical as canonical JSON (8/8 green). A probe that injected a host-local getter into precisionStartMs was caught (the Lord_Howe case failed). |
| Unicode and duplicate inputs in normalize/redact | PASS | Mutants killed: D1 (observedAt hashed, so a row seen twice became two observations), D3 (duplicate subject tokens), D4 (clamp splits surrogate pairs), D5 (control characters in an address), D6 (combining marks split name tokens), N01–N07, E18 and E20–E23. The one normalisation gap (name() in the parser check, B11) is QA-G1, fixed. |
| Rules and boundaries (≤ vs <, instants vs strings, -0, ties) pinned, by mutation | PASS | I probed every closed bound in conditions, finality, scope, attribution, candidates, assignment, state, window, batch-orphans, grants and replay-timeline (M01–M54, b2–b5). The existing suite killed all of them except R08, B08, B11, E04 and T4. Each of those is now killed by a new test. R02 (a -0 param) was killed by grade-adversarial.spec.ts. |
| Error codes asserted (GradeError, BatchError, CandidatesError, IllegalTransitionError, WindowError, ScopeError, RedactError) | GAP | I grepped tests for each code string. Every BatchError, CandidatesError, GradeError, IllegalTransitionError and RedactError code is asserted. ScopeError was asserted by class only, so swapping or removing a code survived (E01–E03; QA-G4). WindowError unsafe_window for the window start was untested (E04; QA-G5). Both are fixed. |
| Known item: graceElapsed wrapper drift | PASS | There is no drift. The new conditions-grace.property.spec.ts (1,000 runs per property, green) proves graceElapsed() and coverageLevel() equal the evaluator's verdicts. It also proves that grade() reaches `pending` only while grace has not elapsed, reaches partial_coverage, not_found and the terminal rule only after it has, and that NOT_FOUND implies full coverage. |
| Known item: features-golden.spec.ts fragility | GAP | Confirmed and fixed in the test: QA-G12. A probe pair with equal scores showed grade() names cp reasons [] while the old cross-check expected [cp.plus_tag]. |
| Known item: test files over 400 lines | GAP | wc -l: extension/tests/unit/core/receipt.spec.ts has 462 lines; extension/tests/property/normalize.property.spec.ts has 475. grep finds no max-lines rule in eslint.config.js (QA-G13). |
| Known item: CHANGELOG [Unreleased] has nothing for Sprint 1 | GAP | CHANGELOG.md:5 [Unreleased] lists only Sprint 0 work. `git log 937c333..0067c80 -- CHANGELOG.md` is empty across the 28 Sprint 1 commits (QA-G14). |
| Known item: docs/grading.md §15 does not document the v1.4 golden fields | GAP | Counted against the §15 text (lines 358–419): events, rejected, deleted, inputs, supersededBy, override, attribution and scope have 0 mentions; rowKey and observerId 0. These fields are in scenario-schema.ts and tests/golden/README.md only (QA-G15). |
| Known item: heavy tests time out at Vitest's 5,000 ms default under load (rule 10) | GAP | policy-hash.spec.ts:113 failed twice under load with `Test timed out in 5000ms` (6,111 ms and 5,033 ms). It is now fixed with 60_000. Other Sprint 1 tests still rely on the default timeout: hash.property 3,333 ms, ratio.property 2,974, 2,777 and 1,970 ms, no-policy-literals 2,298 ms, scope.property 2,181 ms, batch-determinism 2,121 ms (QA-G2). |
| New tests follow the layout rules (≤400 lines, functions ≤60, *.spec.ts under unit/property/golden) | PASS | New files have 80 to 177 lines. test-layout.spec.ts is green. eslint, prettier and `tsc -p tests/tsconfig.json` are all clean. |

### GAPS

Verified gaps first, by severity after verification; refuted gaps are listed last and are not carried to the closer.

1. **QA-G2** [MEDIUM] Heavy tests rely on Vitest's 5,000 ms default and time out under load → `extension/tests/unit/core/policy-hash.spec.ts:113`
   - Rule: agents/qa_tester.md rule 10: flaky = failing (load-related)
   - Detail: 'changes when any single value changes' loads the policy once per leaf with no explicit timeout. It failed twice under machine load: two mutation runs of mine plus the other reviewers. I fixed this test with a 60_000 ms timeout. Other Sprint 1 tests still rely on the 5,000 ms default and use 40–67% of it under the same load: tests/property/hash.property.spec.ts, ratio.property.spec.ts, scope.property.spec.ts, tests/unit/core/no-policy-literals.spec.ts, and the second test of batch-determinism.spec.ts.
   - Evidence: Vitest JSON reporter: unit+golden run gave `policy-hash.spec.ts :: changes when any single value changes … Error: Test timed out in 5000ms` (6,111 ms); the property run gave the same at 5,033 ms. Durations under the default timeout: hash.property 3,333 ms; ratio.property 2,974, 2,777 and 1,970 ms; no-policy-literals 2,298 ms; scope.property 2,181 ms; batch-determinism 2,121 ms.
   - Suggested fix: Done for policy-hash (60_000 ms). For the rest, either set `testTimeout: 60_000` for tests/property in vitest.config.ts (a property project), or give each fast-check test a PROPERTY_TIMEOUT_MS constant, as grade.property.spec.ts already does. Do not add retries.
   - Verification: **CONFIRMED**. Line 113 is correct (`grep -n` at HEAD: 113: it('changes when any single value changes…'). It has no timeout at HEAD; the working tree adds `}, 60_000)`. A failure I did not cause: review1/qa-results/full-committed.json shows `policy-hash.spec.ts changes when any single value changes … 5287 Error: Test timed out in 5000ms`, and coverage.txt and coverage-plain.txt show the same. My solo HEAD run at load 23 took 2,787 ms, and the mirror property run at load 4–6 took 1,932 ms: load-related, as stated. hash.property, scope.property and ratio.property have no explicit timeout (`grep -c PROPERTY_TIMEOUT` = 0). The gap is real but understated: see QA-VG1.

2. **QA-G7** [MEDIUM] Replay timeline boundary for an UNASKED receipt overridden at its own computedAt was untested → `extension/src/core/replay-timeline.ts:122`
   - Rule: §9 replay (the proof of Hard Rule 4): nothing is fixed in the batch that graded it
   - Detail: An overridden UNASKED receipt's observation is taken only after its own batch (`atMs > one.computedMs`). If that boundary broke, an honest ledger whose UNASKED receipt was overridden at its own computedAt would replay as an 'orphan' mismatch: a false alarm against Hard Rule 4.
   - Evidence: Mutant T4 (dropped `atMs > one.computedMs &&`) survived tests/unit/core, tests/golden and tests/unit/tools. It also survived tests/property/replay.property.spec.ts and replay-tamper.property.spec.ts (`Tests 8 passed (8)`).
   - Suggested fix: Done: a new test in tests/unit/core/replay.spec.ts grades T1, overrides u9 at T1, grades T2, and replays with 0 mismatches (green; kills T4).
   - Verification: **CONFIRMED**. replay-timeline.ts:122 is `if (atMs > one.computedMs && atMs >= one.overrideMs) taken.add(...)`. Mutant T4 (drop `atMs > one.computedMs &&`) survived the full HEAD set, including replay.property and replay-tamper.property. The new replay.spec.ts test 'an UNASKED receipt overridden at its own computedAt is still graded in its own batch' kills it. The edge is legal under the contract: docs/grading.md:201 says `override.at ≥ computedAt`, and line 90 says an overridden UNASKED receipt fixes its observation as taken. The code is correct; the test was missing. MEDIUM is defensible because replay is the HR4 check.

3. **QA-G1** [LOW (reviewer: MEDIUM)] Receipt-parser check through name() was not pinned beyond plain lowercase → `extension/src/core/conditions-coverage.ts:131`
   - Rule: Hard Rule 5 (UNVERIFIABLE beats a guess); §6.1 coverage: purchase receipt parser read through name()
   - Detail: §6.1 caps a purchase's coverage at partial (coverage.no_parser) unless name() of its counterparty is in policy.receiptMerchants. That decides whether a purchase can ever be NOT_FOUND. Every test used 'ACME', where name() and toLowerCase() agree, so replacing name() went unnoticed. The code is correct; only the test was missing.
   - Evidence: Mutant B11 (`name(claim.counterparty)` → `claim.counterparty.toLowerCase()`) survived tests/unit/core, tests/golden and tests/unit/tools (all passed). It also survived tests/property plus no-policy-literals and policy-hash (`Tests 101 passed (101)`). Golden 76 counterparties: ['ACME', None, 'ACME'].
   - Suggested fix: Done: new tests/unit/core/conditions-eligibility.spec.ts (green; it kills B11). It covers fullwidth, diacritic, decomposed, spacing and zero-width variants as full coverage; RLO, other merchant and spaced letters as no_parser; and grade() not_found vs partial_coverage. Closer: verify. No product change.
   - Verification: **RESIZED** to LOW. Reproduced. Mutant B11 at extension/src/core/conditions-coverage.ts:131 (`name(claim.counterparty)` → `claim.counterparty.toLowerCase()`). It survived `npx vitest run --bail=1 tests/unit/core tests/golden tests/unit/tools tests/unit/docs tests/unit/bench tests/unit/ledger tests/property` on HEAD tests: `Test Files 126 passed (126) Tests 5462 passed (5462)`. With conditions-eligibility.spec.ts added it is killed (6+ tests fail, e.g. 'fullwidth letters: full coverage, no no_parser cap'). Resized from MEDIUM to LOW: policy/default.json:95 ships `"receiptMerchants": []`, so hasReceiptParser() is false whatever the normalisation. No receipt graded under the shipped policy can change, and nothing in Sprint 1 can edit the policy. Only scenarios that patch the policy (golden 76, 78) reach the branch. The code is correct. This is a missing test for a branch that the shipped policy never reaches.

4. **QA-G3** [LOW] grace.waiting emission for a pending rule without graceElapsed: false was untested → `extension/src/core/grade-reasons.ts:136`
   - Rule: docs/grading.md §15 Emission: grace.waiting accompanies graceElapsed: false while PENDING
   - Detail: With the shipped policy, `pending` always names graceElapsed: false. So a mutant that emits grace.waiting for any PENDING outcome survived. Under a policy whose pending rule names only coverage: partial, the receipt must carry coverage.partial (plus cap codes) and no grace.waiting.
   - Evidence: Mutant R08 (removed `if (when.graceElapsed !== false) return [];`) survived the unit, golden and tools suites (69 s, all passed) and the property suite (101 passed). Probe with the custom rule: reasons [coverage.partial{source:gmail.sent}, coverage.no_account{source:gmail.sent}, match.none].
   - Suggested fix: Done: new tests/unit/core/grade-reasons-policy.spec.ts (5 tests, green; it kills R08). Closer: verify.
   - Verification: **CONFIRMED**. extension/src/core/grade-reasons.ts:136 is `if (when.graceElapsed !== false) return [];`. Mutant R08 (that line removed) survived the full HEAD set (126 files, 5,462 passed). grade-reasons-policy.spec.ts kills it: 'a pending rule naming only coverage: partial gives coverage.partial, never grace.waiting' and 'cap codes accompany coverage: partial on a custom pending rule' fail. LOW is right: the shipped `pending` rule always names graceElapsed:false (docs/grading.md:303).

5. **QA-G4** [LOW] ScopeError codes (invalid_amount, unsafe_window) were never asserted → `extension/src/core/scope.ts:83`
   - Rule: Hard Rule 6 (fail loud); checklist: every error code asserted
   - Detail: scope.spec.ts checks only `toThrow(ScopeError)`. The unsafe_window checks in priorSpendCents and spendIndex (lines 108 and 209) were never reached by a test. A loadable policy (spendWindowDays = floor(MAX_SAFE/MS_PER_DAY)) with a year-0001 claim reaches them.
   - Evidence: These mutants survived the unit, golden and tools suites and the property suite: E01 (invalid_amount → unsafe_window), E02 (removed the priorSpendCents unsafe_window check), E03 (removed the spendIndex check). grep for 'invalid_amount' in tests found 0 files.
   - Suggested fix: Done: new tests/unit/core/scope-errors.spec.ts (8 tests, green; kills E01–E03). It also pins that spendIndex refuses exactly what priorSpendCents refuses. Closer: verify.
   - Verification: **CONFIRMED**. `git grep -l invalid_amount HEAD -- extension/tests` returns nothing. scope.spec.ts:172 asserts only `.toThrow(ScopeError)`. Mutants E01 (scope.ts:83 code swapped), E02 (scope.ts:108 check removed) and E03 (scope.ts:209 check removed) all survived the full HEAD set. scope-errors.spec.ts kills all three: E01 fails four invalid_amount tests; E02 and E03 fail 'the loader accepts the longest window, and a claim in year 0001 then has an unsafe window start'. The bound is reachable: the policy schema allows spendWindowDays up to floor(MAX_SAFE/MS_PER_DAY) (policy-schema.ts:116).

6. **QA-G5** [LOW] WindowError unsafe_window for a calendar window start was untested → `extension/src/core/window.ts:156`
   - Rule: Hard Rule 6 (fail loud); §5.3 windows safe in ms
   - Detail: The existing test overflows only the end (targetAt 2026). A year-0001 targetAt with the longest calendarDays overflows only the start, and nothing tested that.
   - Evidence: Mutant E04 (`fromMs: checkedSafe(targetMs - edgeMs)` → unchecked) survived the unit, golden and tools suites and the property suite (101 passed).
   - Suggested fix: Done: added a test to tests/unit/core/window.spec.ts (green; kills E04). Closer: verify.
   - Verification: **CONFIRMED**. extension/src/core/window.ts:156 is `fromMs: checkedSafe(targetMs - edgeMs)`. Mutant E04 (made unchecked) survived the full HEAD set. The new window.spec.ts test 'throws unsafe_window for a window start past −2^53 ms too' kills it. It is reachable: calendarDays may be up to floor(MAX_SAFE/MS_PER_DAY) (policy-schema.ts:116).

7. **QA-G6** [LOW] Account-hash count over only synced entries was untested for coverageLevel → `extension/src/core/conditions-coverage.ts:159`
   - Rule: §3 (entries synced after evaluatedAt are ignored); §6.1 account count; §13 exported coverageLevel
   - Detail: grade() filters coverage before eligibility, so counting a future entry's account was invisible to every grade() test. The exported coverageLevel() does no such filtering.
   - Evidence: Mutant B08 (hashes counted over every entry of the source) survived the unit, golden and tools suites and the property suite (101 passed).
   - Suggested fix: Done: tests in tests/unit/core/conditions-eligibility.spec.ts. A later second account does not cap; the same account synced by evaluatedAt gives multiple_accounts; grade() agrees (green; kills B08).
   - Verification: **CONFIRMED**. conditions-coverage.ts:159 is `const hashes = new Set(` over `seen` (entries with syncMs ≤ evaluatedMs, line 157). Mutant B08 (count hashes over every entry of the source) survived the full HEAD set. conditions-eligibility.spec.ts kills it ('a second account synced after evaluatedAt does not cap the first (no multiple_accounts)'). coverageLevel() is a §13 export (docs/grading.md:338) and has no production caller outside core, so LOW.

8. **QA-G8** [LOW] `attest -h` and `attest help` were untested → `extension/tests/tools/attest-cli.ts:117`
   - Rule: docs/grading.md §9 replay procedure (CLI arguments); checklist: attest CLI exit codes
   - Detail: Only --help was run, so removing the -h and help aliases went unnoticed.
   - Evidence: Mutant E08 (`command === '--help' || command === '-h' || command === 'help'` → `command === '--help'`) survived tests/unit/tools (286 passed).
   - Suggested fix: Done: attest-cli.spec.ts runs `it.each([['--help'], ['-h'], ['help']])` and expects exit 0 and HELP on stdout (green; kills E08).
   - Verification: **CONFIRMED**. attest-cli.ts:117 handles `--help`, `-h` and `help`. HEAD attest-cli.spec.ts has no '-h' or 'help' case (`git grep` is empty). Mutant E08 survived tests/unit/tools, tests/unit/docs and replay.spec (12 files, 357 passed). The new it.each kills it: '-h prints the usage and exits 0' and 'help prints the usage and exits 0' fail.

9. **QA-G9** [LOW] check-docs: the shell-comment guard and the path lookbehind were untested → `scripts/check-docs-commands.ts:90`
   - Rule: docs_writer rule 4 / Decisions [1.11] check-docs (no doc claims a command that does not exist)
   - Detail: check-docs.spec.ts never typed `pnpm # …` or `/usr/local/bin/pnpm …`. Removing either branch survived. The lookbehind is the INVOCATION regex at line 59.
   - Evidence: With the docs suite run correctly: E11 (removed `|| command.startsWith('#')`) → tests/unit/docs 57 passed; E12 (dropped the `(?<![\w./-])` lookbehind) → 57 passed.
   - Suggested fix: Done: tests/unit/docs/check-docs-edges.spec.ts pins both (green; kills E11 and E12).
   - Verification: **CONFIRMED**. check-docs-commands.ts:90 has `command.startsWith('#')`, and :59 has the `(?<![\w./-])` lookbehind. E11 and E12 each survived tests/unit/docs and tests/unit/tools (11 files, 343 passed). With check-docs-edges.spec.ts added, each mutant newly fails one test beyond the intended red one: E11 fails 'a `#` after pnpm starts a shell comment…' and E12 fails 'pnpm reached through a path or inside a longer word is not an invocation'.

10. **QA-G10** [LOW] check-docs accepts a root-level pnpm command that only extension/package.json defines → `scripts/check-docs.ts:202`
   - Rule: Decisions [1.11]: check-docs protects HR12 (no doc claims a command that does not exist); docs_writer rule 4
   - Detail: checkCommands tests a script name against the union of package.json and extension/package.json, whatever directory the command runs in. `pnpm test:tz` typed at the repo root fails with 'missing script' (root scripts: prepare dev build build:release lint check-docs format typecheck test e2e bench capture attest). Yet check-docs reports nothing. No current doc has this mistake. The defect is in the tool.
   - Evidence: Probe on a fixture repo: README with ```pnpm test:tz``` → problems []. Red test `check-docs-edges.spec.ts > a root-level command that only extension/package.json defines is reported` fails: `AssertionError: expected [] to have a length of 1 but got +0`.
   - Suggested fix: In check-docs-commands.ts, keep the value of `-C`, `--dir` and `--filter` (commandWords currently discards it) and return the target package with the script. In check-docs.ts, check plain commands against root package.json only, and commands that name the extension directory against extension/package.json. Update the BASE fixture in check-docs.spec.ts, whose grading.md says `pnpm test` while only extension/package.json defines `test`. The red test must turn green.
   - Verification: **CONFIRMED**. Probe on test repos copying the real package.json, extension/package.json and policy: README with ```pnpm test:tz``` gives problems []. `pnpm run test:tz` and `pnpm test:perf` also give []. The root package.json has no test:tz or test:perf. Cause: scripts/check-docs.ts:202 checks against the union of PACKAGE_FILES (:40). The red test fails as stated. No current doc has the mistake. A note for the closer: the suggested fix (plain commands checked against root only) would wrongly flag `cd extension && pnpm <extension-only script>`, a pattern docs/adapters.md:96 and :123 already use (with exec). The fix should also honour a preceding `cd extension`.

11. **QA-G11** [LOW] check-docs Markdown edge cases: some false positives and one false negative → `scripts/check-docs-markdown.ts:253`
   - Rule: docs_writer rule 4 (check-docs accuracy)
   - Detail: scanMarkdown treats these as links that must resolve: an escaped bracket `\[x](./missing.md)`, a link inside an HTML comment, and a link inside an indented code block. All three are false positives that fail loud. The reverse also happens: a `pnpm` command inside an indented code block is never checked (false negative). `pnpm recursive run test` is reported as an unknown script 'recursive', because PNPM_COMMANDS (check-docs-commands.ts:9) lacks pnpm's built-in `recursive`.
   - Evidence: Probe output: escaped bracket → ["broken link './missing.md'…"]; HTML comment → same; indented code link → same; indented `pnpm nosuch` → []; `pnpm recursive run test` → ["'pnpm recursive run test': no script 'recursive' …"].
   - Suggested fix: Treat 4-space indented code blocks as code (skip their links, check their pnpm commands). Honour backslash escapes and skip HTML comments in segments() and linkTargets(). Add 'recursive' (and pnpm's other pass-through built-ins) to PNPM_COMMANDS. Then add each case to check-docs-edges.spec.ts.
   - Verification: **CONFIRMED**. Same probe. `\[x](./missing.md)`, `<!-- [x](./missing.md) -->` and a 4-space-indented `[x](./missing.md)` each report "broken link './missing.md'". A 4-space-indented `pnpm nosuch` reports []. `pnpm recursive run test` reports "no script 'recursive'". PNPM_COMMANDS (check-docs-commands.ts:9) lacks 'recursive'. A note for the closer: under CommonMark, 4-space indentation inside a list item continues the item and is not code, so the suggested 'treat indented blocks as code' needs list awareness, or links in nested lists stop being checked.

12. **QA-G12** [LOW] features-golden cross-check disagreed with grade() on ties and read regrades at the wrong instant → `extension/tests/unit/core/features-golden.spec.ts:94`
   - Rule: §8 best candidate: ties broken by observation id; agents/qa_tester.md: tests must not be fragile
   - Detail: At HEAD, best() kept the first equal score in (occurredAt, id) order and claimed that this is how grade() orders them. In fact grade-best.ts `beats` keeps the lower observation id. ownCandidates() also read observations at the first pass's evaluatedAt (HEAD line 118), even for a receipt installed by a later regrade event. A valid future scenario (an equal-score pair, or an observation first seen between the pass and its regrade) would have failed the cross-check while grade() was right.
   - Evidence: Probe: claim priya@company.com; o1 priya+x@company.com at 14:02:10 (id 5SSETC…); o2 raj@company.com at 14:02:40 (id 3Y85PK…); equal scores. grade cp reasons [] vs old cross-check ["cp.plus_tag"].
   - Suggested fix: Done in the test: ties now go to the lower id, and candidates are read at the receipt's last applied regrade instant (`gradedAt`). 130/130 green. Closer: verify.
   - Verification: **CONFIRMED**. HEAD features-golden.spec.ts:94-98 sorts equal scores by (occurredAt, id), and its comment claims this is grade()'s order. grade-best.ts:135 `return order > 0 || (order === 0 && id < best.observation.id);` keeps the lowest id whatever the order. HEAD :118 reads `instantMs(loaded.evaluatedAt)` even for receipts a regrade installed. I checked the fix: receipt ids come from the subject (golden/load.ts:143 receiptIdFor), so gradedAt() matching `event.receiptId === receiptId` finds the regraded receipt. No current scenario hits either path (130/130 green before and after), so LOW: a test-only defect waiting for a future scenario.

13. **QA-G13** [LOW] Two Sprint 1 test files exceed 400 lines, and nothing enforces the limit → `extension/tests/unit/core/receipt.spec.ts:401`
   - Rule: agents/tech_reviewer.md: files ≤ 400 lines
   - Detail: extension/tests/unit/core/receipt.spec.ts has 462 lines and extension/tests/property/normalize.property.spec.ts has 475. No ESLint max-lines rule or layout test enforces the limit, so this will recur.
   - Evidence: `wc -l`: 462 and 475. `grep -n max-lines extension/eslint.config.js` finds nothing.
   - Suggested fix: Split each file by describe block. For example: receipt-reasons.spec.ts for the reason-order cases, and normalize-subject.property.spec.ts for the §11 subject properties. Add `max-lines: [error, 400]` (skipBlankLines false) for tests/** in ESLint, or a check in test-layout.spec.ts.
   - Verification: **CONFIRMED**. `wc -l`: 462 extension/tests/unit/core/receipt.spec.ts and 475 extension/tests/property/normalize.property.spec.ts. These are the only Sprint 1 code files over 400 lines (`git diff --name-only --diff-filter=AM 937c333..0067c80 | xargs wc -l | awk '$1>400'`). `grep max-lines` finds nothing in extension/eslint.config.js or eslint.config.js. The limit comes from agents/tech_reviewer.md:20.

14. **QA-G14** [LOW] CHANGELOG [Unreleased] lists nothing from Sprint 1 → `CHANGELOG.md:5`
   - Rule: Conventional Commits / SemVer process (CLAUDE.md: CHANGELOG kept)
   - Detail: Sprint 1 added the pure grading core, the golden suite (94 scenarios), replay and `pnpm attest replay`, docs/grading.md v1 and `pnpm check-docs` in lint. [Unreleased] still lists only Sprint 0 items.
   - Evidence: `git log --oneline 937c333..0067c80 -- CHANGELOG.md` is empty, across 28 Sprint 1 commits. CHANGELOG.md lines 5–40 contain only scaffold, ledger, bus and lint items.
   - Suggested fix: Add Sprint 1 entries under [Unreleased] → Added: the grading core (grade, gradeBatch, state machine, attribution, scope diff, replay), `pnpm attest replay <export.json>`, docs/grading.md v1, check-docs in `pnpm lint`, the golden, property and perf gates.
   - Verification: **CONFIRMED**. `git log --oneline 937c333..0067c80 -- CHANGELOG.md | wc -l` = 0, against 28 Sprint 1 commits. CHANGELOG.md:5 [Unreleased] lists only Sprint 0 items. Small mis-citation: CLAUDE.md does not say 'CHANGELOG kept'. The requirement is build_spec.md:135 ('CHANGELOG kept by hand') and agents/tech_reviewer.md:38 ('CHANGELOG updated under Unreleased').

15. **QA-G15** [LOW] §15 does not document the golden fields the v1.4 runner reads → `docs/grading.md:360`
   - Rule: docs/grading.md §15: scenarios are 'written from this document alone'
   - Detail: The golden format now includes: top-level `events` (override, supersede, regrade, with `rejected` and `deleted`), `input.grade` (the grade-mode call), `assertIds`, `expect[].inputs`, `override`, `previousState`, `supersededBy`, `attributionScore`, `agent` and `scope`, claim and observation `rowKey`, coverage `observerId`, and grant `ref` and `updatedAt`. These are defined only in scenario-schema.ts and tests/golden/README.md. So a scenario that uses them cannot be written from §15 alone.
   - Evidence: Counts of mentions in §15 (docs/grading.md lines 358–419): events 0, rejected 0, deleted 0, "inputs" 0, supersededBy 0, "override" 0, "scope" 0, rowKey 0, observerId 0. tests/golden/README.md mentions events 10 times and rowKey 8 times.
   - Suggested fix: Add a short '§15.1 Format extensions (v1.4)' to docs/grading.md listing each field and its meaning. Or state there that tests/golden/README.md 'File format' is part of the contract, and link it. check-docs keeps the link honest.
   - Verification: **CONFIRMED**. In docs/grading.md lines 358–419 (§15, which says scenarios are 'written from this document alone', :360), these counts are 0: events, rejected, deleted, rowKey, observerId, assertIds, previousState, attributionScore, regrade, supersededBy. Goldens use them: "events" in 5 files, "assertIds" 6, "attributionScore" 17, "previousState" 3, "inputs" 4, "supersededBy" 2, "rowKey" 1. They are documented only in tests/golden/README.md ('File format', line 36) and scenario-schema.ts. One detail: as plain words, 'override' (4) and 'scope' (12) do appear in §15, but only in the ReasonCode table, not as format fields.

### TESTS WRITTEN

- extension/tests/golden/timezones.spec.ts (new, GREEN 8/8): grades all 94 golden scenarios under the host zone and again under Asia/Kathmandu (+05:45), Etc/GMT+12, Pacific/Chatham (+13:45 with DST), Australia/Lord_Howe (30-minute DST), America/New_York, Europe/London and Pacific/Kiritimati (+14). It proves each zone took effect, then requires identical receipts as canonical JSON (Hard Rule 4).
- extension/tests/property/conditions-grace.property.spec.ts (new, GREEN 2/2, 1,000 runs each): graceElapsed() and coverageLevel() equal the evaluators grade() decides with. ruleId `pending` implies grace not elapsed; partial_coverage, not_found and the terminal rule imply it has; NOT_FOUND implies full coverage. This addresses the known wrapper-drift item.
- extension/tests/unit/core/scope-errors.spec.ts (new, GREEN 8/8): ScopeError('invalid_amount') for negative, fractional, NaN and unsafe amounts; ScopeError('unsafe_window') for a year-0001 claim under the longest loadable spend window; spendIndex refuses exactly what priorSpendCents refuses. Kills E01–E03 (QA-G4).
- extension/tests/unit/core/grade-reasons-policy.spec.ts (new, GREEN 5/5): under custom `pending` rules, grace.waiting is emitted only when the rule names graceElapsed: false; cap codes accompany coverage: partial; never_completed applies when the outcome finalises by time. Kills R08 (QA-G3).
- extension/tests/unit/core/conditions-eligibility.spec.ts (new, GREEN 12/12): the receipt parser is read through name() (fullwidth, diacritics, decomposed, spacing, zero-width count as parsed; RLO, other merchant and spaced letters get no_parser; grade() gives not_found vs partial_coverage). The account count ignores entries synced after evaluatedAt. Kills B11 and B08 (QA-G1, QA-G6).
- extension/tests/unit/docs/check-docs-edges.spec.ts (new, 15 GREEN + 1 RED): green tests pin reference links, images, HTML href, angle destinations, %20, titles, nested parentheses, links in tables, blockquotes and lists, punctuated anchors, the `pnpm #` comment, path invocations (kills E11 and E12, QA-G9) and `-C`/`--dir extension`. RED: a root-level `pnpm test:tz` (defined only in extension/package.json) must be reported. This is a product defect (QA-G10) for the closer.
- extension/tests/unit/core/window.spec.ts (changed, GREEN 53/53): adds unsafe_window for a calendar window start past −2^53 ms (year 0001), where the end is safe and the start is not. Kills E04 (QA-G5).
- extension/tests/unit/core/replay.spec.ts (changed, GREEN 15/15): adds a test where an UNASKED receipt is overridden at its own computedAt and the ledger still replays with 0 mismatches. Kills T4 (QA-G7).
- extension/tests/unit/tools/attest-cli.spec.ts (changed, GREEN 21/21): `--help`, `-h` and `help` all print the usage and exit 0. Kills E08 (QA-G8).
- extension/tests/unit/core/features-golden.spec.ts (changed, GREEN 130/130): a test fix. Ties now go to the lower observation id, as grade() breaks them, and candidates are read at the receipt's last applied regrade instant (QA-G12).
- extension/tests/unit/core/policy-hash.spec.ts (changed, GREEN 5/5): a test fix. 'changes when any single value changes' gets an explicit 60_000 ms timeout; it had timed out at 5,000 ms twice under load (QA-G2).
- extension/tests/golden/README.md (changed): adds the timezones.spec.ts row to the file table (prettier and check-docs OK).

### ADVERSARIAL VERIFICATION

To answer your question: yes. This job is the Sprint 1 review, running in the background. This step double-checks the QA "gaps" report. I changed nothing in your tree. All my experiments ran in a scratch copy at review1/verify-qa-gaps/m, with the test files reset to the last commit (HEAD).

Results: 14 of the 15 gaps hold up as written. I resized one (QA-G1, from MEDIUM to LOW). I found two things the reviewer missed. I re-made all 11 code changes the reviewer used to find untested rules ("mutants"). Every one passed a wider set of HEAD tests than the reviewer ran: unit/core, golden, tools, docs, bench, ledger and all property tests, 126 files and 5,462 tests. That means the gaps were real. Then I added the reviewer's new tests to the copy and re-ran each change: the new tests catch all 11. The deliberate red test for the check-docs bug (QA-G10) fails as intended. I also re-ran a check-docs probe on test repos and got the same results as the reviewer for QA-G10 and QA-G11. The reason-code and rule-id counts, file sizes, CHANGELOG history, §15 word counts, eslint, prettier and check-docs output all match the report.

Why QA-G1 is now LOW: the shipped policy has `receiptMerchants: []`, so the name() step it tests cannot change any receipt today.

The two misses:
1. QA-G2 understates the timeouts. Three more Sprint 1 tests did time out at 5,000 ms in the other QA reviewer's runs, including the plain `pnpm test:tz` run and both coverage runs. Only policy-hash was fixed, so the time-zone script and the Gate's coverage step can still fail under load. One of the three (normalize.property:288) is not in QA-G2's list at all.
2. The replay property tests run 30–60 examples each. qa_tester rule 4 asks for at least 1,000.

I also corrected four checklist statuses. Three were marked PASS even though the evidence names a gap. The fourth (time zones) is right for grading, but `pnpm test:tz` itself has failed under load.

Gaps the verifier found that the review missed:

1. **QA-VG1** [MEDIUM] More Sprint 1 tests actually timed out at 5,000 ms, not just policy-hash. They are still unfixed, so test:tz and the Gate's coverage run can still fail. → `extension/tests/property/hash.property.spec.ts:25`
   - Rule: agents/qa_tester.md rule 10: flaky = failing (load-related)
   - Detail: QA-G2 says the remaining default-timeout tests 'use 40–67%' of the 5,000 ms budget. In fact three Sprint 1 tests did time out in the other QA reviewer's runs today. hash.property.spec.ts:25 timed out in the `pnpm test:tz` Kiritimati pass (the script the time-zone checklist relies on) and in both coverage runs. scope.property.spec.ts:53 timed out in the coverage run. normalize.property.spec.ts:288 timed out in the plain coverage run, and QA-G2 does not list it at all. normalize.property:329 also uses the default timeout. None of them sets a timeout, and the QA pass fixed only policy-hash. The Sprint 1 Gate needs core coverage ≥ 95%, so the coverage run must be green, and it is red under load because of these timeouts. tests/unit/lint/fences-scopes.spec.ts (a Sprint 0 file) also timed out at 5,157 ms in qa-results/unit.json.
   - Evidence: review1/qa-results/tz.txt (output of `pnpm test:tz`): `FAIL tests/property/hash.property.spec.ts > idFromHash (property) > equals the BigInt definition… Error: Test timed out in 5000ms … ❯ tests/property/hash.property.spec.ts:25:3`, then `Tests 1 failed | 4953 passed (4954)`. coverage.txt: FAILs on hash.property, scope.property ('spendIndex is priorSpendCents (§6.3) > for every claim of the history') and policy-hash (`3 failed | 6060 passed`). coverage-plain.txt: hash.property, log.property, normalize.property:288 ('gives the reference result for ASCII and for any other text') and policy-hash (`4 failed | 6059 passed`). `grep -c PROPERTY_TIMEOUT` = 0 in hash/scope/ratio.property; normalize.property:297 closes the :288 test with a bare `});`. My own run at load 4–6 did not reproduce it: hash.property took 1,843 ms, 37% of the budget. It is load-related.
   - Suggested fix: Give tests/property a 60_000 ms testTimeout once: a vitest `projects` entry for tests/property, or a PROPERTY_TIMEOUT_MS on every fc.assert test, as grade.property.spec.ts:49 does. Cover hash.property (all 5 tests), scope.property:53/65/77, ratio.property and normalize.property:288/329 at least. Never add retries. Then re-run `pnpm test:tz` and the coverage run under load to show they are green.

2. **QA-VG2** [LOW] The replay property tests run 30–60 examples each, below the 1,000 minimum → `extension/tests/property/replay-tamper.property.spec.ts:107`
   - Rule: agents/qa_tester.md rule 4: property tests for src/core (… replay …), minimum 1,000 examples each in CI
   - Detail: replay-tamper.property.spec.ts runs 60, 45, 40 and 40 examples (lines 107, 127, 147, 177), and no Decisions.md entry covers that. replay.property.spec.ts runs 60, 40 and 30 on small ledgers (lines 148, 175, 202). Decisions.md:723 logs those counts with no reason; the 5-run Done-when ledger at :117 has a reason (each run builds a 1,000 × 10,000 ledger). The QA checklist marked 'Replay detects tampering' PASS without checking the example count. Replay is the HR4 check, and rule 4 names it. The cost is low: each test already has a 600_000 ms timeout.
   - Evidence: `grep -rn numRuns tests/property` → replay-tamper:107 `{ numRuns: 60 }`, :127 45, :147 40, :177 40; replay.property:148 60, :175 40, :202 30. Mirror timing at load 4–8: replay-tamper tests took 1,954, 1,218, 1,004 and 917 ms (about 23–33 ms per example). At 1,000 examples that is about 25–35 s each. `grep -n tamper Decisions.md` finds no run-count decision.
   - Suggested fix: Raise the small-ledger replay and replay-tamper properties to numRuns 1_000. They keep their 600 s timeouts. Or, if CI time matters, log a Decisions.md entry with the measured cost and the reason, so the closer can mark it ACCEPTED.

Checklist corrections:

- 'Replay detects tampering of each compared field' is marked PASS but should be GAP (fixed by a test). Its own evidence says mutant T4 survived the HEAD suite (QA-G7). I confirmed this: T4 passes all 126 HEAD files. Also, the replay property tests run only 30–60 examples (QA-VG2).
- 'Rules and boundaries (≤ vs <, instants vs strings, -0, ties) pinned, by mutation' is marked PASS but should be GAP (fixed by tests). Its evidence names five HEAD survivors: R08, B08, B11, E04 and T4. These are QA-G3, QA-G6, QA-G1, QA-G5 and QA-G7. I confirmed all five survive the wider HEAD set.
- 'Unicode and duplicate inputs in normalize/redact' is marked PASS but should be GAP (fixed by a test). Its evidence names B11 (QA-G1) as an untested normalisation path.
- 'Time-zone independence beyond the two zones in test:tz' is PASS for grading itself: timezones.spec.ts is green, and its zone check guards against a vacuous pass. But the zone script itself is not reliably green. `pnpm test:tz` failed under load in review1/qa-results/tz.txt (hash.property.spec.ts:25 timed out at 5,000 ms). See QA-VG1.
- 'Known item: heavy tests time out at Vitest's 5,000 ms default under load': the GAP status is right, but the evidence is wrong. It says the other tests 'use 40–67%' of the budget. In fact hash.property:25, scope.property:53 and normalize.property:288 did time out in today's QA runs (tz.txt, coverage.txt, coverage-plain.txt), and normalize.property:288 is missing from the list. See QA-VG1.

### COMMANDS RUN

- `node mut/run.mjs <batch>.json <out> (mutation harness in scratch mirrors review1/qa-gaps, qa-gaps2, qa-gaps3; each mutant: npx vitest run --bail=1 tests/unit/core tests/golden tests/unit/tools)` → 152 mutants: 134 killed, 18 survived: 7 survivors are equivalent or unreachable: M52 (dead offset fallback), E05, E09, E19, B09, B15, T6. 11 survivors are real: R08, E01–E04, E08, E11, E12, B08, B11, T4. I reran the core survivors against tests/property plus no-policy-literals and policy-hash; all still survived (`Tests 101 passed`), and T4 also survived the replay property suites. The first two contaminated runs (two harnesses on one mirror, and a missing-docs mirror artifact) were discarded and rerun cleanly.
- `npx vitest run tests/property tests/unit/core/policy-hash.spec.ts tests/unit/core/no-policy-literals.spec.ts tests/unit/docs --reporter=json (real tree, under load)` → 157 passed, 1 failed: policy-hash.spec.ts > changes when any single value changes: Test timed out in 5000ms (5,033 ms).
- `npx vitest run tests/unit tests/golden --reporter=json (real tree, under load)` → 5,976 passed, 1 failed: The same policy-hash test timed out again (6,111 ms). Durations of the other default-timeout tests are listed in QA-G2.
- `npx tsx probe/clifuzz.ts (400 one-field edits of the scenario replay export through main())` → exits {0:5, 1:31, 2:364}; 0 uncaught throws: The exit-0 cases changed only override.reason or exportedAt, which replay does not compare by contract.
- `npx tsx probe/docs.ts (checkDocs on fixture repos)` → Edge cases mapped: Root `pnpm test:tz` is accepted (false negative). Escaped bracket, HTML comment and indented-code links are reported (false positives). `pnpm` in indented code is unchecked. `pnpm recursive` is flagged as an unknown script.
- `npx tsx probe/tie.ts` → grade cp reasons [] vs old features-golden expectation [cp.plus_tag]: Proves the old cross-check broke ties differently from grade().
- `npx tsx probe/iso.ts, probe/hint.ts` → No defect: IsoTs, normalize.instantMs and schema-checks.instantMs agree on every schema-valid timestamp. subjectHint clamps to 80 code points and is never dropped.
- `npx vitest run tests/golden/timezones.spec.ts (plus a probe mirror with a host-local getter injected into precisionStartMs)` → 8/8 green; the probe mutant failed under Australia/Lord_Howe: The probe proves the new test can detect a dependence on the host zone.
- `npx vitest run tests/unit/core tests/golden tests/unit/tools tests/unit/docs tests/property/conditions-grace.property.spec.ts --reporter=json (final, real tree)` → 100 files, 5,266 tests: 5,265 passed, 1 failed: The only failure is the intended red test QA-G10 in check-docs-edges.spec.ts. Wall time 22.2 s.
- `npx tsc --noEmit -p tests/tsconfig.json; npx eslint <new/changed files>; npx prettier --check <new/changed files>; npx tsx scripts/check-docs.ts` → All clean: check-docs: OK (4 files, 123 relative links, 13 pnpm commands, 14 rule ids).

