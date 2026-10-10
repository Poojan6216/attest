# Sprint 5 — Close

Role: agents/sprint_closer.md. Inputs: `qa.md` (20 gaps: 9 written and closed by the QA review itself, 11 open), `security.md` (12 gaps) and `tech.md` (13 gaps) in this folder, on `5f32641`, committed with QA's tests as `d979079`. Range closed: `d979079` to HEAD. Every gap is fixed in code, written and verified by the QA review, or, where only the founder can act, in MANUAL.md with its exact steps. Nothing was fixed by weakening a test, a Hard Rule, a lint rule, a threshold, a gate or an allowlist; every `[5.close]` entry in Decisions.md records a decision the close made. Where two reviews raised one gap, it is fixed once and listed once, with both names.

## FIXED IN CODE

Severity order, Hard Rules 1 to 4 first whatever the review wrote.

### HIGH

1. **SEC-1: "Nothing leaves your browser" was said while an option that sends was on.**
   - **Changed:** the popup, the side panel and the digest page show one line read from the person's choices: "Nothing leaves your browser." only while both options that send are off, otherwise each one on, by name ("Your own model key is on: facts of partial matches go to Anthropic."; "Usage numbers are on: counts go to Attest's server once a day."), and before the choices are read, the sentence true whatever they are. The options page's statement names both options; the store description and the README say nothing is sent unless the person opts in.
   - **Code:** `extension/src/ui/PrivacyLine.tsx`, `privacy-text.ts`, `privacy-data.ts`, `use-privacy.ts`; the four pages; `extension/package.json`; `README.md`.
   - **Tests:** `tests/unit/ui/privacy-line.spec.ts` (every state, a change followed, a failed read); `tests/e2e/telemetry.spec.ts` (the popup says the numbers are on); `tests/e2e/options.spec.ts` (the statement).
   - **Founder:** Hard Rule 1's own wording (MANUAL.md).
2. **SEC-2 / QA 11: turning the key off did not stop a model run under way.**
   - **Changed:** saving or forgetting the key and switching either model stop every run (`model-run.ts`), the call in flight aborted; a run rereads the switch before each claim.
   - **Code:** `extension/src/background/model-run.ts`, `intel.ts`, `byo.ts`, `flags.ts`; `extension/src/intel/index.ts` (`scoresFor`'s stop).
   - **Tests:** `tests/unit/background/intel-stop.spec.ts` (QA's red test among them: one call, not two).
3. **SEC-3 / QA 11: both outbound calls followed redirects.**
   - **Changed:** both set `redirect: 'error'`; the extension's content security policy gains `connect-src` with the extension, the two vendor endpoints and the telemetry host, so Chrome refuses every other host, a redirect's target and every WebSocket included; the development server is added in `pnpm dev` only. The secret-seed test searches request headers.
   - **Code:** `extension/src/intel/providers/byo.ts`, `extension/src/telemetry/send.ts`, `extension/wxt.config.ts`.
   - **Tests:** `tests/unit/telemetry/outbound-calls.spec.ts`; `tests/e2e/csp.spec.ts` (refused before any request); `tests/unit/manifest-hosts.spec.ts`, `tests/e2e/built-bundle.spec.ts` (the policy, exactly); the mandatory controls' canaries moved to hosts the policy allows, each still a violation the guard catches.

### MEDIUM

4. **SEC-4 / TECH-12: the API read a whole body before refusing it.** `read_body` refuses a `Content-Length` over 16 KB before reading, and a body without one as soon as it passes. `telemetry-api/app/main.py`; `tests/test_api_close.py` (calls the app over ASGI and counts the chunks read).
5. **SEC-5: the per-client limit could be dodged.** IPv6 counted by /64, addresses that do not parse as one client, two `X-Forwarded-For` lines refused (400), at most 100,000 keys per limit and 100,000 payloads stored a day. `telemetry-api/app/limits.py`, `main.py`, `settings.py`, `scripts/check_client_address.py` (a fourth send, two lines); `tests/test_api_close.py`, `tests/test_check_client_address.py`.
6. **TECH-1: the options page bundled the ledger's writers again.** The builder reads `healthReports`; the Calendar record schema moved out of the store; the lint fences gain Sprint 5's scopes and writers; the install id panel only reads. `tests/unit/lint/page-reach.spec.ts` pins what each page reaches.
7. **TECH-2 / QA 1: the day the clocks go back was never sent.** Hours capped at 24. `extension/src/telemetry/aggregate.ts`; `tests/unit/telemetry/aggregate-days.spec.ts` (25- and 23-hour days).
8. **TECH-3 / QA 3: a resent day was stored twice.** One document per install and day (`_id` the hash of both); a repeat answered 204 and not stored. `telemetry-api/app/store.py`; `tests/test_store.py`, `tests/test_api.py`; the docs say at least once, stored once.
9. **TECH-4: the privacy docs contradicted the code.** The README rewritten; privacy-architecture §5 lists every `chrome.storage.local` key; `tests/unit/docs/doc-pins.spec.ts` pins the list to `STORAGE_KEYS`.
10. **QA 2: the mandatory network session ran no Sprint 5 surface.** `tests/e2e/support/sprint5-surfaces.ts` runs them with both options off.

### LOW

11. **SEC-6:** the area closed at every worker start (`entrypoints/background.ts`); `tests/e2e/byo-key-storage.spec.ts` proves a content script is refused.
12. **SEC-7:** a key must be its vendor's, in the form, the schema and the stored pair (`keyFitsVendor`); `tests/unit/background/byo-vendor-fit.spec.ts`, `tests/unit/options/model-section.spec.ts`.
13. **SEC-8:** the usage numbers read again on every change, a sent day said to be sent; the own key's statement exact; the install id panel current. `entrypoints/options/telemetry-preview.ts`, `TelemetryPreview.tsx`, `ByoStatement.tsx`, `InstallIdPanel.tsx`; `tests/unit/options/telemetry-preview.spec.ts`, `telemetry.spec.ts`.
14. **SEC-9:** the arrival hour stored, not the instant. `telemetry-api/app/main.py` `hour_of`; `tests/test_api_close.py`.
15. **SEC-10 / TECH-6:** a failed availability check logged and said as "Chrome did not answer". `extension/src/intel/providers/builtin.ts`; `tests/unit/intel/builtin.spec.ts`, `tests/unit/options/model-section.spec.ts`.
16. **SEC-11:** the docs name the weight's cap as the control; `tests/unit/core/model-raise.spec.ts` pins the bound at 14/17.
17. **SEC-12:** every API dependency has a Decisions line; motor's end of support goes to the founder (MANUAL.md).
18. **TECH-5:** stale lines in adapters.md, the CHANGELOG and three comments corrected; doc pins hold the settable flags and the page-only types.
19. **TECH-6 (the rest):** the usage numbers' commands have a failure path; `telemetry.handler_failed` apart from `telemetry.send_failed`; a reply that is not JSON is `bad_reply`. `tests/unit/options/telemetry.spec.ts`, `tests/unit/intel/byo-reply.spec.ts`.
20. **TECH-7:** one definition each: providers, outcomes, the day pattern, Chrome's version, the recording file, the answer parse, the health reader; `modelScores` gave way to the worker's `inputFor`.
21. **TECH-8:** one component per file; `tests/unit/lint/one-component.spec.ts`.
22. **TECH-9:** core `modelMayRaise`; the vendor announcement documented; Anthropic's API version in config. `tests/unit/core/model-may-raise.spec.ts`, `tests/unit/intel/byo-reply.spec.ts`.
23. **TECH-10:** the grace alarm asks the model last (`tests/unit/background/grace-alarm.spec.ts`); the always-on hourly telemetry alarm kept, with its reason in Decisions.
24. **TECH-11 / QA 10:** `create_app` split, the test store in `tests/memory.py`, an `Envelope` model, CI's mypy over `scripts/`.
25. **TECH-12 / QA 4:** an unplanned error answered by a failsafe middleware, never re-raised; `tests/test_api_close.py` with `raise_server_exceptions=True`.
26. **TECH-13:** the POST's 10 s limit in code; the startup delay, Mongo's timeout, the CORS cache and Railway's checks in Decisions.
27. **QA 5:** the secret-seed session makes the key's call; a `model` channel searched, the key allowed in its own header alone.
28. **QA 6:** `tests/e2e/intel-off.spec.ts`: a key saved but off, a claim due, nothing sent.
29. **QA 7:** `alarm.done` and `telemetry.alarm_done` end the fixed wait.
30. **QA 9:** goldens 116 to 119 with `input.modelScores` and `raisedScore`, checked by the batch runner and in grade mode (`tests/unit/core/grade-golden.spec.ts` passes the same scores to `grade()`).

### Found by the close's own full run

31. **`pnpm test:poison` failed on a Sprint 5 test.** `tests/unit/core/model-raise.spec.ts` (5.0) built its observation with the ledger's test fixtures, which load fake-indexeddb and Dexie, so the poisoned run of `src/core` saw `indexedDB` and `BroadcastChannel` change and failed all 8 tests of the file. It builds the observation with the core fixtures now (`O1`, `tests/unit/core/receipt-fixtures.ts`; `33b39e6`), and `pnpm test:poison` passes. No CI run caught it: the last push this clone knows of is Sprint 3's close (`a5de595`), so CI has not yet run on Sprint 4 or 5 (MANUAL.md, Sprint 4 close).

## MANUAL ACTION REQUIRED

1. [ ] Decide Hard Rule 1's wording → MANUAL.md, Sprint 5.
2. [ ] Decide the telemetry API's Mongo driver (motor or PyMongo async) → MANUAL.md, Sprint 5.
3. [ ] QA 8: record the models' bench answers → MANUAL.md, Sprint 5 (the model check, and optionally the own key).
4. [ ] Deploy the telemetry API, with the address check → MANUAL.md, Sprint 5.
5. [ ] Optional: approve `httpx2` → MANUAL.md, Sprint 5.

## ACCEPTED AS KNOWN LIMITATION

None. (The pages' four pinned writer modules are reached through readers they use, not accepted gaps: `tests/unit/lint/page-reach.spec.ts` lists each with its reason.)

## VERIFIED CLEAN

**VERIFIED CLEAN.** Every gap of the three reviews is fixed in code and tested, written and verified by the QA review, or, where only the founder can act, in MANUAL.md with its exact steps; none is accepted. The full suite ran last, on the committed tree (Verification, Gate).

Full suite: unit 514 files, 11,019 tests passed and 7 skipped by design (the candidate index's implementation-only cases, `runIf`), the property tests among them (49 files, 165 tests); e2e 80/80, the five `@mandatory` tests among them; bench green (9 of 9 benches, every gate); telemetry-api 114/114; lint + typecheck clean.
Commit: `chore(sprint-5): close 45 review gaps`.

Written by the QA review, in the tree, and green at the close (gaps 12 to 20 of `qa.md`):

- GAP 12: a model score that could move an observation, as properties (`monotonicity-scores.property.spec.ts` at 5,000 runs, `monotonicity-scores-batch.property.spec.ts` at 3,000 batches).
- GAP 13: the own key's provider held to the time limit (`byo-timeout.spec.ts`).
- GAP 14: `byo.save`, `byo.forget` and `telemetry.send` through `listen()` (`page-commands-sprint5.spec.ts`).
- GAP 15: the key's storage closed before the key is written (`byo-edges.spec.ts`).
- GAP 16: the Sprint 5 repo methods' repeats, conflicts and corrupt rows (`sprint5-repo-edges.spec.ts`).
- GAP 17: the wiring with both models off, and two runs at once (`intel-edges.spec.ts`).
- GAP 18: the Model section's failures shown (`model-section-failures.spec.ts`).
- GAP 19: `loadByoVendor` (`settings-data-byo.spec.ts`).
- GAP 20: the API's 500 path, the size limit's exact edge, and the store with the database down (`telemetry-api/tests/test_api_edges.py`).

## Test expectations changed with the behaviour they describe

- The alarm tests expect `alarm.done` after every alarm's work, after a failed handler too, last (QA GAP 7).
- Grade mode passes a scenario's model scores to `grade()` and expects the raised score as the displayed score and confidence (QA GAP 9).
- A failed check of Chrome's model is `unknown`, logged, never "cannot run" (`builtin.spec.ts`, `model-section.spec.ts`; SEC-10).
- An OpenAI key in the own-key tests has OpenAI's form (`byo.spec.ts`; SEC-7).
- The health reader is `healthReports` (`repo-state.spec.ts`, `text-channels.spec.ts`; TECH-1), the input builder `inputFor` (`input.spec.ts`, `model-scores.spec.ts`, `corpus.ts`; TECH-7), and the model check's component `ModelCheck.tsx` (`model-check.spec.ts`; TECH-8).
- A NetLog request record carries its headers (`netlog.spec.ts`; QA GAP 5, SEC-3).
- The mandatory controls' canaries go to hosts the content security policy allows, each still a violation the guard catches (SEC-3).
- The secret-seed test counts the Gmail Sent page its model call is about among the pages it searches, and waits for that page's own rows (QA GAP 5).
- The usage numbers' e2e waits for `telemetry.alarm_done`, not 1.5 s (QA GAP 7).

## Verification

On a quiet machine, the code at `d49cab0` and the close's fix of item 31 at `33b39e6` (a test file only), its bench results at `aa164b2`:

- `pnpm lint` (ESLint, Prettier, `check-docs`) and `pnpm typecheck`: pass.
- `vitest run`: 514 files, 11,019 tests passed, 7 skipped (the same 7 as at the Sprint 4 close: the candidate index's implementation-only cases). The property tests alone: 49 files, 165 tests.
- `pnpm e2e`: 80 passed, the five `@mandatory` tests among them. The 5-minute network session ran Sprint 5's surfaces with both options off and saw no request outside an empty allowlist; the secret-seed session made the own key's one call and found no seed and no key in any channel, the model's among them.
- telemetry-api: `uv run pytest` 114 passed; ruff, ruff format and mypy (`app`, `tests`, `scripts`) clean; `pip-audit` finds no known vulnerability.
- `pnpm bench` at `d49cab0` (RESULTS.md, Chrome 153), every gate passed: popup first paint median 64 ms (56 to 72; gate 100); the day's paint 108 ms (84 to 116), up from 96 at the Sprint 4 close and inside the range the QA review measured (92 to 120), recorded and not gated (MANUAL.md, Sprint 4 close), 84.3 ms CPU; candidate lookup 382.9 ms and batch grading 1,352.3 ms CPU (gate 2,000); UI reads 16.1, 11.9, 16.0 and 0.7 ms CPU (gate 50); the Gmail Sent, receipt, Calendar, pattern and paste accuracy gates; intel: the rules alone verify 5 of the 14 true matches and no false one (precision 1, recall 0.3571), both models not measured. The committed trace names no machine path.
- Coverage, lines: `src/core` 99.38% (gate 95, `pnpm test:coverage`); observers and adapters 99.03% (gate 85, `pnpm test:coverage:observers`); UI 96.33% (gate 70, `pnpm test:coverage:ui`).
- `pnpm test:poison`: 179 files, 6,367 tests pass, after the close's fix (item 31). `test:tz`, in Pacific/Kiritimati and America/St_Johns: 191 files, 6,594 tests each, pass.
- `pnpm test:perf`: all 9 gates pass. Popup at 5,000 receipts: first paint median 56.0 ms (gate 100), the day's paint 92.0 ms, 76.3 ms CPU; `gradeBatch` over 5,000 claims 1,441.8 ms CPU (gate 2,000); candidate lookup 450.5 ms (gate 2,000); steady-state batch 481.3 ms; idle batch 3.8 ms; UI reads 14.5, 12.4, 15.0 and 1.0 ms (gate 50); `coverageForBatch` 2,150 rows (gate 3,000).

## Gate

| Gate item | At the close |
|---|---|
| Monotonicity property test green at 5,000 | Met: `monotonicity.spec.ts` at 20,000 inputs (Decisions [5.7]), `monotonicity-batch.property.spec.ts` at 5,000 batches through `gradeBatch`, and QA's two (GAP 12) at 5,000 runs and 3,000 batches. |
| Model input proven allowlisted-only (double) | Met: `input.spec.ts`, a test double records the input, equal to the allowlisted projection for 20 claims, "ignore previous instructions" absent; and end to end, the secret-seed session searches what Anthropic's stand-in received (QA GAP 5). |
| Built-in and BYO providers fail silent on timeout | Met: `builtin.spec.ts` and `model-scores.spec.ts` (built-in), `byo-timeout.spec.ts` (BYO, QA GAP 13). |
| Intel bench numbers in RESULTS.md with the default decided | In part: the rules' numbers are in RESULTS.md and the default is decided, off (Decisions [5.5]); neither model has a number, since only the founder's recording can give one (MANUAL.md, Sprint 5; Hard Rule 12). |
| Telemetry schema parity green | Met: `schema-parity.spec.ts` (extension) and `test_schema_parity.py` (API), against the committed contract. |
| Intercept: zero hosts with everything off, exactly one with telemetry on, provider host only with BYO on | Met: `network-intercept.spec.ts` (everything off, Sprint 5's surfaces run: none), `telemetry.spec.ts` (the telemetry host alone), `intel.spec.ts` (Anthropic's host alone). |
| telemetry-api tests green and deployed or docker-proven | In part: 114 tests green, and the whole flow ran on this Mac against a real throwaway Mongo (5.8); this Mac has no Docker, so the Docker proof is CI's flow job on the next push, or the Railway deploy (MANUAL.md, Sprint 5). |
| Secret-seed test covers telemetry and BYO key | Met: `no-leak.spec.ts` searches the `telemetry` channel (what was sent and what the page showed) and the key, at rest in its own slot alone and in the model call's own header alone, with planted controls caught. |
| `closed.md` says VERIFIED CLEAN | Met (above). |

Seven items are met; the two in part wait on the founder alone (Decisions [5.gate]).
