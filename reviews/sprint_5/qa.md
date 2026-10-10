# Sprint 5: QA

Role: agents/qa_tester.md. Range: `a82916e..5f32641` (11 commits, tasks 5.0 to 5.9).

**Scope.** The two opt-ins, and the one server:

- the rule that the model never grades: `features.modelScore`, src/core/model-raise.ts, and the two monotonicity properties (5.0);
- the advisory model: its allowlisted input, prompt and answer (5.1); Chrome's on-device provider (5.2); the person's own key (5.3); the wiring into grading, with the `modelAnswers` table and ledger schema v11 (5.4);
- the intel bench and its labelled corpus (5.5);
- the telemetry payload, held equal in Zod and Pydantic (5.6); its builder, sender, daily alarm and options switch (5.7);
- telemetry-api, with its tests, image, compose file and scripts (5.8);
- the docs (5.9), and the CI jobs these added.

**Where the numbers come from.**

- QA ran everything here itself, on 5f32641, between 06:42 and 07:50 on 2026-10-10.
- The ordered runs were one script, each step logged with its exit code, wall time and load average:
  - `pnpm test`;
  - the three coverage runs;
  - `pnpm e2e`;
  - the mandatory tests, on their own, with the JSON report and its check. The report was then deleted;
  - `pnpm bench`;
  - telemetry-api: ruff, ruff format, mypy (app, tests and scripts), pytest and pip-audit.
- Then QA ran `pnpm lint`, `pnpm typecheck`, a last unit run with every QA file in the tree, and its own files in two more time zones.
- Before writing any test, QA ran a baseline `pnpm test` on the clean tree: 495 files, 10,858 passed, 7 skipped, 0 failed (362.5 s); perf 9 of 9.
- The machine was not quiet throughout:
  - VS Code, Chrome and the Claude app were open;
  - the security and tech reviewers were reading code at the same time;
  - the unit and coverage runs drove the load average up to about 35 on 8 cores.
- The perf gates ran when the load was falling:
  - `test:perf` right after the unit run (load 9 after it);
  - the Gmail gate inside the e2e run, on 2 workers;
  - the bench alone (load 2.6 at its start).
- QA wrote only in `extension/tests/`, `telemetry-api/tests/` and this file, and changed no existing file there.
- The bench rewrote RESULTS.md, `bench/results/*-2026-10-10.json` and `bench/traces/popup-paint.zip`. That change is left in the working tree, uncommitted.

## RESULTS

**Static checks, with QA's tests in the tree**

- `pnpm lint`: exit 0. ESLint and Prettier are clean, for the extension and the root. check-docs: OK (7 files, 537 relative links).
- `pnpm typecheck`: exit 0.

**Unit, property and golden (`pnpm test`)**

- The ordered run (step 1): 502 files: 10,906 passed, 7 skipped, 0 failed, in 315.7 s.
  - It held 7 of QA's 9 spec files. QA wrote the other two (`model-section-failures`, `settings-data-byo`) during the run.
- The last run, with all of QA's files: **504 files: 10,917 passed, 7 skipped, 0 failed**, in 344.8 s.
  - That is the baseline plus QA's 9 files and 59 tests, exactly.
  - The 7 skips are by design (Decisions [2.6]).
- Perf (`test:perf`, in step 1): 6 files, 9 passed. See PERF.

**QA's tests**

- In the tree, all green:
  - extension: 9 spec files, 59 tests, and one helper module;
  - telemetry-api: 1 file, 5 tests.
- QA changed no existing test.
- Each ran green in every run that held it:
  - alone;
  - in the ordered unit run and the coverage runs;
  - in the last unit run;
  - in Pacific/Kiritimati and in America/St_Johns.
- The property files' checks that they were not proved over nothing see about 90 raises a run (the grade property) and about 55 (the batch property), in three runs each. At those rates a run that sees none is vanishingly unlikely, so the checks do not flake.
- QA checked that the new properties catch a defect. In the scratchpad, with `vi.mock`, `raisedBest` was made to lift a best candidate below the partial floor. Both properties failed at once: a NOT_FOUND took an observation. Nothing of this is in the tree, and src/core was never mocked there (rule 9).
- **Red tests:** 5, under GAPS 1, 3, 4 and 11. They are not in the tree. QA ran each in the scratchpad (`s5qa/red/`, `s5qa/redpy/`, the SEC-3 one as two tests there) and saw each fail at 5f32641. GAP 1's has a control beside it, which passes.

**Coverage**

- **src/core (`pnpm test:coverage`): 99.38% of lines** (3,848 of 3,872). The gate is 95%: pass.
  - Statements 98.83%, branches 93.14%, functions 99.78%. 503 files: 10,911 passed, 7 skipped.
  - model-raise.ts, grade.ts and policy-checks.ts, which Sprint 5 changed, are at 100% on every measure.
  - Under 98% of lines, as at Sprint 4: receipt-hash.ts 92.85%, sha256.ts 96.03%, conditions-finality.ts 97.29% and policy-errors.ts 97.29%.
- **src/observers and src/adapters (`test:coverage:observers`): 99.03% of lines** (1,739 of 1,756). The gate is 85%: pass.
  - 88 files, 1,652 passed. Sprint 5 changed no reader.
- **UI (`test:coverage:ui`): 95.77% of lines in the ordered run** (1,223 of 1,277; 36 files, 216 passed). The gate is 70%: pass.
  - With QA's second UI file, which the ordered run predates: **96.00%** (1,226 of 1,277; 37 files, 222 passed).
  - Without QA's two UI files: 95.06% (1,214 of 1,277).
  - The Sprint 5 files:

    | File | Lines |
    |---|---|
    | BuiltinModelToggle.tsx, ModelSection.tsx | 100% |
    | ByoModel.tsx | 100% (86.2% before QA's tests: its failures, lines 96-97 and 134-135) |
    | TelemetryToggle.tsx | 92.85% (lines 87-88: a preview that fails to read) |
    | use-builtin-model.ts, telemetry-preview.ts | 100% |
    | src/ui/settings-data.ts | 75% (37.5% before QA's tests: `loadByoVendor`, Sprint 5's, ran only end to end; lines 31 and 47 are Sprint 4's) |

- **telemetry-api:** no coverage tool is in its dev dependencies, and QA adds none. Its 90 tests are below.

**E2E (`pnpm e2e`)**

- **77 passed in 6.0 minutes on 2 workers: 0 failed, 0 flaky.** Playwright's config has `retries: 0`.
- Sprint 5's tests all passed:
  - intel.spec.ts: PARTIAL to VERIFIED through a stand-in for Anthropic, and Anthropic's host alone (9.6 s);
  - telemetry.spec.ts: once a day, and to its one host (7.9 s);
  - the Model section in options.spec.ts;
  - built-bundle.spec.ts: the two allowed calls, each once, in `background.js`.
- The content scripts are inside their budget: gmail.js 70,760 B gzipped of 75,000, and gcal.js 65,667 B. The popup's start is 115,079 B of 125,000.

**Mandatory tests** (their own run, `--grep @mandatory`: 5 passed in 5.3 minutes; `check-mandatory-report`: "all pinned @mandatory tests ran once and passed")

- **Network intercept ✅, 3 of 3:**
  - The asserted allowlist (empty) is the one the extension ships, and `allowedHosts` with everything off.
  - The 5-minute scripted session (5.2 min) made 0 attributed requests and 0 violations, and met no unknown host.
  - The negative control caught all 4 canaries.
  - The session runs none of Sprint 5's surfaces: GAP 2.
- **Secret seed ✅, 2 of 2:**
  - The seeded session (20.6 s) left no seed in any channel, the telemetry channel included: what was sent, and what the options page showed. The invented key sat in its own storage slot and nowhere else.
  - The negative control (4.0 s) caught every plant. Among them: `telemetry:token_lowercase`, `chrome-storage:byo_key` and `console:byo_key`.
  - The session saves a key and turns it on, but never makes the key's call: GAP 5.
- Both were green in the full e2e run too: 0 attributed requests; 19.0 s and 4.1 s.

**Bench (`pnpm bench`)**

- The ordered step stopped at once: "the tree differs from its commit". The tree held QA's untracked tests, and the other reviewers' untracked `reviews/sprint_5/`, which QA does not touch.
- QA then ran `pnpm bench --dirty`, the bench's own mode for this, in 44 s with the machine otherwise idle (load 2.6 at its start).
  - Every gate of all 9 benches passed.
  - Every section of RESULTS.md is now measured at 5f32641. Before, all were at b29275a (task 5.5).
  - Each says `commitDirty: true`, though no product file differs from 5f32641. The bench's own rule is that dirty results are not committed. So the close step decides: commit them as they are, or run `pnpm bench` again on a clean tree.
- Accuracy is unchanged:
  - gmail-sent: 324 of 324 fields;
  - gcal: 335 of 335;
  - paste field accuracy: 1.
- **Intel:**
  - 24 cases, 14 labelled, 17 asked;
  - by the rules alone: 5 true verifications and 0 false (precision 1, recall 0.3571);
  - the on-device model, Anthropic and OpenAI: "not measured", since no recording exists (GAP 8);
  - `intelModelHelps`: false.

**telemetry-api** (step logs, with QA's file in the tree)

- `uv run ruff check .`: all checks passed. `uv run ruff format --check .`: 20 files already formatted.
- `uv run mypy app tests scripts` (strict): no issues in 19 source files.
- `uv run pytest`: **90 passed** (85 of 5.8 and QA's 5), with 1 warning: httpx under Starlette's test client (MANUAL.md, Sprint 5).
- `uv run pip-audit`: no known vulnerabilities found.
- Not run: `scripts/prove_flow.py`. It needs the compose stack, and this machine has no Docker. QA starts no MongoDB here. CI's `telemetry-api-flow` job runs it; the Progress Log says it passed here once, against a local Mongo.

### Sprint 5 Gate: the items QA can speak to

| Gate item | Status |
|---|---|
| Monotonicity property green at 5,000 | PASS. monotonicity.spec.ts runs 20,000 inputs (Decisions [5.7] raised it from 5,000), and monotonicity-batch.property.spec.ts 5,000 batches. Both score every candidate alike, which cannot show a score that moves an observation (GAP 12). QA's two properties close that. |
| Model input proven allowlisted-only (double) | PASS. input.spec.ts: 20 claims against an oracle written apart from the code; a Request's "ignore previous instructions" and a stray field's are absent. intel.spec.ts: a double records exactly the claim and its one candidate. intel.spec.ts end to end: the one POST's body is exactly the request around that data block. |
| Built-in and BYO providers fail silent on timeout | Built-in: PASS (builtin.spec.ts, model-scores.spec.ts). BYO: no test held it (GAP 13). QA's byo-timeout.spec.ts now does: no score at 2 s and not a moment before, the request aborted, the key in no log. |
| Intel bench numbers in RESULTS.md, the default decided | The rules' numbers are in, and Decisions [5.5] keeps the model off by default. Neither model has a number: no recording exists (GAP 8, MANUAL). |
| Telemetry schema parity green | PASS: schema-parity.spec.ts and test_schema_parity.py, against one committed JSON Schema. 25 invalid payloads are refused by both. |
| Intercept: no host with everything off, one with telemetry on, the vendor's only with BYO on | PASS. The mandatory test with everything off; telemetry.spec.ts (`allowedHosts({telemetry: true})`); intel.spec.ts (Anthropic's host). But the mandatory session exercises no Sprint 5 surface (GAP 2), and no end-to-end test saves a key and leaves it off (GAP 6). |
| telemetry-api tests green, and deployed or docker-proven | Tests: 90 passed. Deploy: BLOCKED(MANUAL). Docker: CI's job, not run here. |
| Secret-seed test covers telemetry and the BYO key | PASS: both channels, with planted controls caught. The key is checked at rest and in every channel; its call never runs in the session (GAP 5). |
| closed.md says VERIFIED CLEAN | For the close step. |

### QA rules

| Rule | Status |
|---|---|
| 1: fixtures, not logins | PASS. Every vendor page, model vendor and the telemetry API is a stand-in; no test reached a network. |
| 2: labelled corpus and a bench number | The intel corpus has 24 labelled cases and a bench number for the rules. The models have none (GAP 8). |
| 3: two tests per bus message type | Each of `byo.save`, `byo.forget` and `telemetry.send` was tested valid and malformed at its schema only. None went through `listen()`, so no test held their refusal from a content script: QA wrote them (GAP 14). |
| 3: two tests per repo method | `telemetrySentDay` and `recordTelemetrySent` ran only inside send.spec.ts. No test ran two `claimAsk`s at once, or a corrupt row under `answerAsk` or `modelScoresOf`: QA wrote them (GAP 16). |
| 4: property tests for `src/core` | Monotonicity at 20,000 (grade) and 5,000 (batch), plus QA's at 5,000 and 3,000, over every weight the loader allows. No golden pins a model-raised receipt (GAP 9). |
| 5: no input events on vendor pages | PASS, unchanged. Sprint 5 opens no vendor page. |
| 6: service-worker restart | PASS. worker-lifecycle.spec.ts expects the telemetry alarm among the worker's alarms. A claim whose call a stop cuts short keeps its row and is never asked again: intel.spec.ts holds that state with a timeout. |
| 7: perf gates | PASS, all of them (see PERF). |
| 8: coverage | core 99.38%, readers 99.03%, UI 96.00%. |
| 9: no mocking inside `src/core` | PASS. QA's properties grade with the real core. |
| 10: flaky = failing | 0 flaky in both e2e runs. The 5.0 property failed its own check once, never its rule, and was raised to 20,000 (Decisions [5.7]). telemetry.spec.ts still waits a fixed 1.5 s (GAP 7). |

## GAPS

20 gaps: 1 HIGH, 6 MEDIUM and 13 LOW.

- **Open (11):** Gaps 1 to 11.
  - Gaps 1, 3, 4 and 11 are product defects, each pinned by red tests. Their code is below, not in the tree.
  - Gaps 1, 3 and 4 meet the tech review: TECH-2, TECH-3 and TECH-12. Gap 11 is the security review's SEC-2 and SEC-3, with tests for their fixes.
- **Written by QA (9):** Gaps 12 to 20. They are in the tree, and green.

In the red tests:

- `db` is a ledger from `openLedger(uniqueDbName(...))`;
- `FACTS` is `{ installId: '4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b', extVersion: '0.1.0', chromeMajor: 154 }`;
- `NOW` is `new Date(2026, 9, 10, 9, 30).getTime()`.

**Open: red tests and gaps for the close step**

**1. [MEDIUM] Telemetry: the day the clocks go back can never be sent (tech review TECH-2).**

- **What happens.**
  - `reportedDay` runs from local midnight to local midnight, so in a zone with daylight saving its fall-back day lasts 25 hours.
  - `hoursOf` clips each reader's windows to that day (`extension/src/telemetry/aggregate.ts:90-105`). One Gmail Sent read spans days, so a whole day covered is common, and gives 25.
  - The schema takes at most 24 (`extension/src/telemetry/schema.ts:29`, `telemetry-api/app/schema.py:27`). `buildTelemetry` then returns null.
  - The send logs `telemetry.not_built` every hour of the next day, and the day is never sent: only yesterday is ever sent. The options page says "Attest cannot build the numbers on this browser" all that day.
- **Red test:** fails at 5f32641. The control, the same on a 24-hour day, passes with 24.

```ts
it('builds the payload of the day the clocks go back, 25 hours, fully covered', async () => {
  // beforeAll: process.env.TZ = 'America/New_York'; the test proves the zone took effect.
  const day = reportedDay(new Date(2026, 10, 2, 9, 30).getTime());
  expect([day.bucket, day.toMs - day.fromMs]).toEqual(['2026-11-01', 25 * MS_PER_HOUR]);
  const at = (ms: number) => isoWithLocalOffset(new Date(ms));
  await recordCoverage(db, {
    observerId: 'gmail.sent',
    source: 'gmail.sent',
    accountHash: sha(1),
    windowStart: at(day.fromMs - MS_PER_HOUR),
    windowEnd: at(day.toMs + MS_PER_HOUR),
    lastSyncAt: at(day.toMs + MS_PER_HOUR),
  });
  expect(await buildTelemetry(db, FACTS, day)).not.toBeNull(); // null at 5f32641: coverageHours.gmail is 25
});
```

- **To decide with the fix:** clamp to 24, or let both schemas take 25. A test with a 23-hour day belongs beside it.

**2. [MEDIUM] Hard Rule 1: the mandatory network-intercept session runs none of Sprint 5's surfaces (as Sprint 4's GAP 7).**

- **What exists.** `extension/tests/e2e/network-intercept.spec.ts` changed only its allowlist's comment and one assertion (`allowedHosts` with both off, `:225`).
  - Its session opens the options page, so the Model and Privacy sections render.
  - Nothing in them is clicked: no "Check Chrome's on-device model", no key saved, no telemetry switch.
  - With every option off, the model is never asked and telemetry never sends, so the session cannot show that they stay silent when a person uses those controls.
- **Suggested:** a `support/sprint5-surfaces.ts` that `openAll` runs with everything off:
  - click "Check Chrome's on-device model";
  - save an invented key and leave it off (then on and off again);
  - paste a claim that lands PARTIAL in its grace, as intel.spec.ts does, and let a grace batch run;
  - open `model-check.html` and score its claims (Chromium has no model);
  - read the telemetry preview.
- **Expect:** no violation and no unknown host, as now.

**3. [LOW] Telemetry: one day can be posted, and stored, twice (tech review TECH-3).**

- **What happens.**
  - The day is recorded only after the API's 204 (`extension/src/telemetry/send.ts:62-71`). When that write fails, or the worker stops between the 204 and the write, the next hourly alarm posts the same day again.
  - The API stores every payload it takes, with no check on install id and day.
  - Decisions [5.7] ("sent at most once per day") and docs/privacy-architecture.md:471 ("so no day is sent twice") say otherwise.
- **Red test:** fails at 5f32641: 2 posts.

```ts
it('never posts one day twice, even when recording it fails after the API took it', async () => {
  await saveFlag(db, 'ATTEST_TELEMETRY', true);
  const post = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.spyOn(db.meta, 'put').mockImplementationOnce(() => Promise.reject(new Error('QuotaExceededError')));
  const deps = { db, nowMs: NOW, facts: () => Promise.resolve(FACTS), post };
  await sendTelemetry(deps).catch(() => undefined);
  await sendTelemetry({ ...deps, nowMs: NOW + 3_600_000 }).catch(() => undefined); // the next hourly alarm
  expect(post).toHaveBeenCalledTimes(1);
});
```

- **To decide with the fix:** the tech review's way is a server that stores one document per install and day, answering a repeat 204. Then this red test becomes "posted twice, stored once", in telemetry-api's tests, and the docs say at-least-once.

**4. [LOW] telemetry-api: an unplanned error is re-raised to the server's log (tech review TECH-12).**

- **What happens.**
  - The API answers a 500 in its one shape, and its own log has one line: `{"event": "request.failed", "status": 500}`. QA's test_api_edges.py holds that.
  - But Starlette then re-raises the error for the server (`telemetry-api/app/main.py:82-85`). uvicorn prints "Exception in ASGI application" with the traceback and the message. A message may hold values.
- **Red test** (pytest): fails at 5f32641. The `RuntimeError` reaches the test client as it would reach uvicorn, here with the install id in its message.

```python
class BrokenStore(MemoryStore):
    async def insert(self, payload: dict[str, object], received_at: datetime) -> None:
        raise RuntimeError(f"unexpected: {json.dumps(payload)}")


def test_an_unplanned_error_is_answered_and_never_re_raised_to_the_server() -> None:
    api = TestClient(create_app(Settings(mongo_url="mongodb://unused"), BrokenStore()), raise_server_exceptions=True)
    answer = api.post("/v1/aggregate", content=json.dumps(VALID), headers={"content-type": "application/json"})
    assert answer.status_code == 500
```

**5. [LOW] Hard Rule 10: the secret-seed test's key channel never runs the key's call.**

- **What exists.** `extension/tests/e2e/no-leak.spec.ts` saves an invented key and turns it on (`support/byo-key.ts`). It then searches every channel for the key, its own slot taken out.
  - No stand-in answers the vendor's endpoint in that session.
  - Nothing asserts that a model call was made.
  - So the key's path in flight is held only by unit tests with `fetch` stubbed: provider, request, answer or error, and the log lines after them.
- **Suggested:**
  1. Route Anthropic's endpoint to `stubAnthropic` in `seededSession`.
  2. Add one seeded claim that lands PARTIAL inside its grace.
  3. Assert exactly one POST.
  4. Search its body, and its headers but `x-api-key`, for every seed.

**6. [LOW] 5.3: no end-to-end test saves a key, leaves it off, and shows the vendor is never contacted while a claim is due.**

- **What exists.**
  - The mandatory test checks the allowlist as a constant.
  - intel.spec.ts turns the key off only after its one PARTIAL claim was asked; its allowlist includes Anthropic's host for the whole session.
  - QA's unit test (GAP 17) holds `askTheModel` with both models off.
- **Suggested:** in intel.spec.ts, a second session:
  1. save the key and leave it off;
  2. paste the paraphrased Priya claim;
  3. fire the grace alarm, and wait for a line the worker logs once the run's ask is done, on every path (the same change GAP 7 asks for the telemetry's send);
  4. expect `stubAnthropic` recorded no request, the allowlist empty with no violation, and `modelAnswers` empty.

**7. [LOW] Rule 10: telemetry.spec.ts waits a fixed 1.5 s after the alarm fires.**

- **What happens.** `fireTelemetryAlarm` waits for the alarm's log line, then sleeps 1.5 s (`extension/tests/e2e/support/telemetry.ts:50`). The "off" assertion follows: no body was sent. A send later than 1.5 s would go unseen.
  - A send while off logs nothing, so there is no line to wait for.
- **Suggested:** the alarm's send logs its outcome on every path, `off` and `already_sent` included, at debug. The test waits for that line, as auto-check.spec.ts waits for its own.

**8. [LOW] 5.5: neither model is measured (MANUAL).**

- **What exists.** `bench/fixtures/intel/` holds only its README. RESULTS.md says "not measured" for the on-device model and both vendors (Hard Rule 12).
  - The sprint asked for the BYO arm "stubbed with recorded responses committed". Recording them needs a real model or a real key: MANUAL.md, Sprint 5, its first two items.
  - Decisions [5.5] keeps the model off on the rules' numbers alone, and says so.
- **Suggested:** none in code. The close step marks it MANUAL. Once a recording exists, the bench reads it with no change (intel-bench.spec.ts holds that).

**9. [LOW] Rule 4: no golden scenario pins a model-raised receipt.**

- **What exists.** `extension/tests/golden/scenario-schema.ts` has no field for model scores. So contract v1.19 (docs/grading.md §5.4) is pinned only by:
  - unit values (model-raise.spec.ts);
  - the properties;
  - intel.spec.ts.
  - The determinism property's tuples carry no model scores either; QA's property now grades with them twice.
- **Suggested:** a `modelScores` field in a scenario's input (by claim ref and observation ref), and goldens for:
  - a raise at the bottom of the band: a floor at or just above 14/17 (about 0.8235), where m = 1 under λ = 0.15 reaches 0.85, VERIFIED;
  - a raise short of VERIFIED;
  - a NOT_FOUND untouched;
  - a score on a candidate the claim did not take, ignored.

**10. [LOW] CI's mypy step does not check `scripts/`.**

- **What exists.** `.github/workflows/ci.yml:150` runs `uv run mypy app tests`. `scripts/prove_flow.py` and `scripts/check_client_address.py` are type-checked nowhere in CI.
  - They are clean today: QA's `uv run mypy app tests scripts` found no issue in 19 files.
- **Suggested:** `uv run mypy app tests scripts` in the `telemetry-api` job.

**11. [HIGH] The security review's SEC-2 and SEC-3 have no test. Red tests for their fixes:**

- **SEC-2:** turning the key off does not stop a run in progress.
- **SEC-3:** both outbound calls follow redirects.
- Both fail at 5f32641:
  - SEC-2: two claims are sent;
  - SEC-3: `redirect` is `undefined`, so the call follows.
- `partialClaim(n, minutes)` stores claim `n`, PENDING by rule `partial` with observation `n`, as `store()` in intel-ask.spec.ts does.

```ts
it('SEC-2: sends no claim after the person turned their own key off mid-run', async () => {
  await saveFlag(db, 'ATTEST_MODEL_BYO', true);
  await partialClaim(1, 1);
  await partialClaim(2, 2);
  const inputs: IntelInput[] = [];
  const provider: IntelProvider = {
    id: 'byo',
    score: async (input) => {
      inputs.push(input);
      await saveFlag(db, 'ATTEST_MODEL_BYO', false); // "Turn off my own key", during the first call
      return { scores: [] };
    },
  };
  await askTheModel(db, { grading: DEPS, notify: vi.fn(), provider: () => Promise.resolve(provider) });
  expect(inputs).toHaveLength(1);
});

it('SEC-3: neither outbound call follows a redirect', async () => {
  const inits: RequestInit[] = [];
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    inits.push(init);
    return Promise.resolve(new Response('{"content":[{"type":"text","text":"{\\"scores\\":[]}"}]}'));
  });
  const input = CHECK_INPUTS[0];
  if (input === undefined) throw new Error('no check input');
  await byoProvider('anthropic', 'sk-ant-qa-invented-redirect-0123456789').score(input, new AbortController().signal);
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    inits.push(init);
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  await saveFlag(db, 'ATTEST_TELEMETRY', true);
  await sendTelemetry({ db, nowMs: NOW, facts: () => Promise.resolve(FACTS) }); // no `post`: the real fetch
  expect(inits.map(({ redirect }) => redirect)).toEqual(['error', 'error']);
});
```

**Written by QA: in the tree, green**

**12. [MEDIUM] Rule 4 and Hard Rule 4: the monotonicity properties could not see a model score that moves an observation.**

- **What was missing.**
  - Both properties give every candidate the same score. That keeps every ranking as it was, so a model score that leaked into choosing the best candidate, or into the batch's assignment, would pass both.
  - Both weigh the model at 0.15 alone.
  - Neither checks monotonicity in the score itself.
  - The determinism property's tuples never carry model scores.
- **Written:**
  - `extension/tests/property/monotonicity-scores.property.spec.ts`, 2 tests, over 5,000 runs. Each candidate gets its own score, or none, under 5 weights per policy, from 0 to just under the loader's cap (6,999 basis points at the shipped thresholds, 5,714 at 0.7 and 0.3). It checks:
    - the observation taken never changes, and the rule changes only PARTIAL to VERIFIED;
    - NOT_FOUND and UNVERIFIABLE never change;
    - scores that rise candidate by candidate never lower the rule or the score;
    - a candidate other than the one taken may be scored anything with nothing changing, signals included;
    - grading with scores is deterministic, the scores hashed into `inputsHash`;
    - the loader refuses the cap itself.
  - Half the inputs aim at the band the model can lift. The general tuples reach it about 2 times in 5,000.
  - `extension/tests/property/monotonicity-scores-batch.property.spec.ts`, 1 test, over 3,000 batches through `gradeBatch`, each claim's candidates scored one by one. No observation moves between claims, and each receipt carries exactly its own claim's scores.
  - `extension/tests/property/monotonicity-worlds.ts`: the generators both share.
- **Checked:** the vacuity counts are about 90 raises a run (grade) and 55 (batch). A mocked mutant fails both properties (RESULTS).

**13. [MEDIUM] Gate: the person's own key's provider was never held to the time limit.**

- **Written:** `extension/tests/unit/intel/byo-timeout.spec.ts`, 7 tests, `fetch` stubbed:
  - for Anthropic and for OpenAI: a vendor that does not answer gives no score at `INTEL_TIMEOUT_MS` and not one millisecond before (a fake clock); the call's signal reached `fetch` and is aborted; the log says `intel.timeout` for `byo`, never the key;
  - the limit is the sprint's 2 s;
  - a vendor that ignores the abort cannot hold the call, and its late answer counts for nothing;
  - a failing network, a reply that is not JSON, and an answer naming a candidate it was not given each give no score, logged by provider.

**14. [MEDIUM] Rule 3: `byo.save`, `byo.forget` and `telemetry.send` never went through `listen()`.**

- **What was missing.** round-trip.spec.ts names their senders but runs none of them, and page-commands.spec.ts runs only Sprint 4's four settings. So nothing held that a Gmail tab's script cannot:
  - save its own key over the person's (their claims' facts would then go to that key's account);
  - forget the person's key;
  - make Attest post telemetry.
- **Written:** `extension/tests/unit/bus/page-commands-sprint5.spec.ts`, 22 tests:
  - valid from the options page;
  - dropped from a content script (`untrusted_context`) and from another extension (`foreign_sender`);
  - malformed, with nothing of it logged;
  - a key refused for its vendor, for a field no schema names or for its shape, never logged;
  - an invalid key never sent (`invalid_outgoing`);
  - a handler that answers badly, throws, or says an outcome or day outside its schema: answered failed;
  - no answer: failed, logged with the type.

**15. [MEDIUM] Hard Rule 10: nothing held that the key's storage is closed to content scripts before the key is written.**

- **What was missing.** byo.spec.ts checks the access level after a save. A save that wrote first and closed after would pass, and so would one that wrote although the close failed.
- **Written:** `extension/tests/unit/background/byo-edges.spec.ts`, 6 tests:
  - the close comes before the write;
  - when Chrome does not close the area, no key is written, and the failure is logged without the key;
  - a second key replaces the first, its vendor with it;
  - a forget that cannot delete says so, without the key;
  - a forget with no key saved still turns the key off;
  - Delete all data takes the key, the model's answers, the sent day, and all three Sprint 5 switches back to off.

**16. [LOW] Rule 3: the Sprint 5 repo methods' repeats, conflicts and corrupt rows.**

- **Written:** `extension/tests/unit/ledger/sprint5-repo-edges.spec.ts`, 8 tests:
  - the sent day: none, recorded, recorded twice (one row), replaced by a later day;
  - a stored value that is not a day reads as null, so the day goes again rather than never;
  - a value that is not a day is refused, and the day stays;
  - two and five `claimAsk`s at once ask about each claim exactly once;
  - `answerAsk` on a row that no longer parses stores nothing and leaves it, logged by table and id alone;
  - `modelScoresOf` skips that row and reads the rest.

**17. [LOW] 5.4: the wiring with both models off, and two runs at once.**

- **Written:** `extension/tests/unit/background/intel-edges.spec.ts`, 2 tests, over the paraphrased §2 demo:
  - with both models off and a claim due, no provider is chosen and nothing is stored;
  - an import's run and the grace alarm's, at once, make one call between them, store one answer, and raise the receipt once.

**18. [LOW] Hard Rule 6: the Model section's failures were never shown.**

- **Written:** `extension/tests/unit/options/model-section-failures.spec.ts`, 5 tests. Each failure is said in a `role="alert"` line:
  - Chrome refusing the download: the section asks Chrome again what it has;
  - the on-device switch not changed, answered failed or refused;
  - a key not saved: it stays typed in its field, and is never logged;
  - a forget or a switch not done;
  - settings that cannot be read: no switch is offered.

**19. [LOW] Hard Rules 2 and 10: `loadByoVendor` ran only end to end.**

- **Written:** `extension/tests/unit/ui/settings-data-byo.spec.ts`, 6 tests:
  - none with no key saved, and the vendor once one is;
  - the page asks storage for the vendor alone, never the key;
  - a stored vendor Attest does not call reads as none.

**20. [LOW] telemetry-api: the 500 path, the size limit's exact edge, and the Mongo store when the database is down.**

- **Written:** `telemetry-api/tests/test_api_edges.py`, 5 tests. ruff, ruff format and mypy strict are clean.
  - An unplanned error is answered 500 in the one shape, with no traceback and nothing of the payload. The API's log line holds the event and status alone. That the error then escapes to uvicorn is GAP 4.
  - A body of exactly `max_body_bytes` is read, and one byte more is 413, stored nowhere.
  - `MongoStore` with no server: `StoreError` naming no payload, `ping()` false, and 503 from both routes.

## PERF

| Gate | Measured | Limit | Status |
|---|---|---|---|
| Popup first paint at 5,000 receipts, in Chromium | bench: median 64 ms (60 to 72). `test:perf`: median 64.0 ms (runs 72, 64, 56, 64, 64) | 100 ms | PASS |
| Popup's day paint (today's list) | bench: median 96 ms (92 to 120). `test:perf`: 96.0 ms | none | No gate (Sprint 4 QA GAP 3) |
| UI reads at 5,000 receipts, in Node | `test:perf`: popup 16.7, timeline page 11.1, filtered page 17.7, detail 0.8 ms (median CPU). bench: 15.8, 13.7, 13.4 and 0.7 | 50 ms | PASS |
| Gmail Sent pass, 10,000 rows, in Chromium | median 724.2 ms CPU (724.2, 727.8, 723.6), in the e2e run | 2,000 ms | PASS |
| Grading, 5,000 claims × 50,000 rows, in Node | `test:perf`: median 1,455.7 ms CPU (2,079.2, 1,455.7, 1,267.4). bench: median 1,281.1 ms CPU | 2,000 ms | PASS |
| Steady-state batch at 2,000 claims | median 479.3 ms CPU | 1,500 ms | PASS |
| Candidate lookup, 5,000 claims × 50,000 rows | `test:perf`: median 440.9 ms CPU. bench: 404.5 | 2,000 ms | PASS |
| Coverage reads for a batch of 100 claims | 2,150 rows read | 3,000 rows | PASS |

- The bench ran with the machine otherwise idle (load 2.6). `test:perf` ran as the unit run's load fell (load 9 after it). The Gmail gate ran inside the e2e run, on 2 workers.
- The grading gate's first run took 2,079.2 ms of CPU, over its limit. The gate is the median of three fresh runs; the first is the cold one.
- Sprint 5 adds no perf gate: the model is asked after a batch and outside it, at most 10 claims a run of at most 2 s each.
- QA's files are quick (test time, measured on their own after the runs):
  - the grade property 4.5 s (5,000 runs, up to 5 gradings each);
  - the batch property 4.0 s (3,000 batches, 2 gradings each);
  - every other QA file 0.3 s or less.
