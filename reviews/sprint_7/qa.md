# Sprint 7 — QA

Role: agents/qa_tester.md. Range: `20bd94a..509f3b6`, tasks 7.0 to 7.6 (7.0, 7.2 and 7.8 partly BLOCKED(MANUAL); 7.7 and 7.9 not started). Every suite ran on 2026-10-13 against `509f3b6` plus the tests this review wrote (below), with logs in the session's scratchpad (`qa7/`). Product code was not changed. One test-support file was fixed (QA-1). Every mutation made to check a test was reverted (`git diff` clean on every product file and doc).

**The machine.** For this review's first three hours the Mac was out of memory, from outside this project. 14 to 16 GB of its 17 GB swap was in use and about 20 MB was free. Load averages ran from 100 to 780 while the other reviewers ran lint, typecheck and mypy, and the user's own Chrome, VS Code and other apps held the rest. Runs from that time are not counted as results:

- Three full e2e runs were stopped:
  - the first after 50 tests: 29 passed, 21 failed, and 8 Chromium start-ups hung;
  - the second after 2 tests, both failed, one by QA-1's `ENOTEMPTY`;
  - the third, on one worker, at its 90-minute limit after 52 tests. Its 9 failures: five 30-second ledger waits, a worker evaluation that stalled for 229 s, three hung start-ups in a row, and both `perf-gmail` tests (a pass at 5.9 s against the 2 s gate, then a timeout).
- The mandatory specs, re-run then, passed 5 of 6. The 5-minute session hung in a `page.close()` at 68 s and timed out. Run alone five minutes later, it passed.

Every one of those tests passed on the run below, at load 2 to 28. The launcher bug they exposed is QA-1.

## RESULTS

- **Lint and typecheck:**
  - ESLint, `--max-warnings 0`, on the new and changed extension test files: clean. Two errors in this review's own first drafts were fixed.
  - Prettier: clean on the same files.
  - `pnpm typecheck`: clean.
  - `pnpm check-docs`: OK (8 files, 686 relative links).
  - The other reviewers ran the full `pnpm lint`.
- **Unit, property and golden:** 552 files, 11,339 passed, 7 skipped, 0 failed (`pnpm --dir extension run test`, 411 s).
- **Perf pass:** 6 files, 9 passed (`test:perf`).
- **Runtime guard over `src/core`** (`pnpm test:poison`): 180 files, 6,371 passed, `src/core` lines 99.27%.
- **Other time zones** (`test:tz`, Pacific/Kiritimati and America/St_Johns): 192 files, 6,598 passed, 7 skipped, in each zone.
- **Telemetry API:**
  - `uv run pytest`: 147 passed (125 before this review, 22 new).
  - `uv run ruff check .` and `ruff format --check .`: clean (29 files).
  - `uv run mypy app tests scripts`: strict, clean (28 files).
- **End-to-end** (`pnpm e2e`: build, then 2 workers, 22.4 min): 109 passed and 2 failed, of 111 (104 before this review, 7 new).
  - The two failures are `perf-ledger.spec.ts`'s popup-paint gates: 144 ms and 108 ms against 100, while the other worker ran tests beside them. Every other timing in those two tests was 1.5 to 3 times Sprint 6's (JSON export 10.6 s against 3.2 s; the sealing job 65.6 s against 19.5 s).
  - Run alone on one worker straight after, both passed: 76 ms and 80 ms, with every timing back at Sprint 6's. That is QA-5.
  - The launcher replaced 2 hung Chromium start-ups, and neither failed a test.
  - This review's 7 new tests pass: `release-zip.spec.ts` 6 of 6, `source-maps.spec.ts` 1 of 1.
- **Coverage:**

| Scope | Lines | Branches | Functions | Gate |
|---|---|---|---|---|
| `src/core` (the whole suite, 552 files) | 99.38% | 93.15% | 99.78% | ≥ 95% lines: pass |
| observers (88 files, 1,677 tests) | 99.03% | 93.22% | 99.41% | ≥ 85%: pass |
| UI (42 files, 255 tests) | 96.11% | 89.22% | 92.68% | ≥ 70%: pass |

- **Mandatory tests:**
  - Network intercept ✅, all three. The 5-minute session attributed 0 requests, with no violation and no unknown host. The negative control caught every canary.
  - Secret seed ✅, both, the negative control included.
  - Each passed in the run above. On the overloaded machine, the session had failed twice (a 30-second ledger wait, then a `page.close()` that never returned) and the seed test once (a 30-second ledger wait). None of those failures was a request or a leak, and each test passed alone at once.
- **Bench:** not run (by instruction: it rewrites committed results).
  - `RESULTS.md` is the bench's output at `17a39e4`.
  - `results-md.spec.ts` holds it to `bench/results`: a hand edit of one value (`redteamWorking` 6 → 5) fails it, checked.
  - No product code a bench measures changed in Sprint 7. The only `src/` changes are the grant form's example copy and `wxt.config.ts`'s name, description and zip name.

## Tests this review wrote

| File | What it proves | Shown to fail (each change reverted) |
|---|---|---|
| `extension/tests/unit/docs/readme-figures.spec.ts` (6 tests) | Each row of the README's "Attacks that still work" table equals its strategy's cases won, cases and severity in the `redteam` result. The table lists exactly the strategies whose outcome is `works`. The red team's counts in the README's opening and in `launch/show-hn.md` equal `redteamWorking` and `redteamStrategies` and the worst strategy's own numbers. Each Results row's figures, and its limit where its bench records one, equal its bench's named metrics, and the table has no row the test does not check. "Chrome 153" equals `popupChromeMajor`. | 18 of 25 → 17 of 25; "6 of the 13" → 5; the popup's 60 ms → 52 ms (its own minimum); a severity MEDIUM → LOW; the Observer starvation row deleted; Show HN's "6 of 13" → 5. `readme.spec.ts` passes the first five, `launch-kit.spec.ts` the sixth. |
| `extension/tests/unit/docs/store-listing-permissions.spec.ts` (2 tests) | The listing's permission table has one row per permission, optional permission and host permission the built manifest asks for (wxt.config.ts's, plus the `sidePanel` WXT adds), and no other row. It marks exactly the optional ones as optional. | The `scripting` row deleted; `offscreen` added to the manifest (the audit allows it). `store-listing.spec.ts` passes both. |
| `extension/tests/e2e/release-zip.spec.ts` (6 tests) | `check-release-zip.ts` on zips made from the e2e build, with its development pages removed as a release removes them. It passes the build as zipped. It fails a zip without `popup.html`, with a popup that throws, with an options page that logs an error, with a service worker that cannot start, and with a manifest of another version. | 6 of 6 pass: the tool does catch these. See QA-7 for what it does not catch. |
| `extension/tests/e2e/source-maps.spec.ts` (1 test) | Each of the build's 39 scripts has its map beside it. No map names an absolute path, the repository's path or the home folder (Decisions [7.0]: the maps ship in the store zip). | Measured clean: relative sources only. |
| `extension/tests/e2e/support/extension.ts` (fixed) | QA-1. | In the third overloaded run it logged a profile it could not delete and the launch went on; in the run above it replaced two hung start-ups. |
| `telemetry-api/tests/test_stats_edges.py` (10 tests) | See the list below. | A withheld answer not kept; a failure kept; rates rounded to three places; a sum's database error not caught; installs counted as documents. `test_stats.py` passes the first four. |
| `telemetry-api/tests/test_reliability_report_main.py` (5 tests) | `main()` exits 1, says why on stderr and writes no file on a 204 or on an answer that is not aggregates. On aggregates it writes `--out`, or prints the report. `render()` refuses a template with a placeholder it does not fill. | The placeholder guard removed: `test_reliability_report.py` passes. |
| `telemetry-api/tests/test_stats_docs.py` (7 tests) | PRIVACY.md, `docs/privacy-architecture.md`, `telemetry-api/README.md`, the report's template, `launch/README.md` and the script's refusal each state the floor, window and cache hour that `app/stats.py` sets, and no other floor. | `MIN_INSTALLS = 25`: 6 of these fail; no other test reads those documents. |

`test_stats_edges.py` covers these cases:

- **Installs.** Installs are distinct install ids, never days. 49 installs that each sent 3 days still get a 204, in memory and on Mongo.
- **The cache across the 50-install floor.** A 204 is kept for its hour although the 50th install reports. A 200 is kept for its hour although its data is gone. The answer is a 204 once the window passes its days: still published on the 29th day after them, withheld on the 30th.
- **Failures.** A 503 is never kept. A kept answer outlives an outage inside its hour.
- **Rates.** A rate is of every grade's receipts, rounded to four places.
- **Malformed store data.** Mongo's sums ignore each of these:
  - a count written as text;
  - a payload without counts, or without agents;
  - an unknown agent;
  - a day written as a date;
  - a payload that is not an object;
  - a document with no payload.
- **Database errors.** A Mongo error in a sum is a `StoreError`, and a 503 that names nothing.
- **Methods and CORS.** POST, PUT and DELETE answer 405 in the API's one error shape. A page of another site gets no CORS header.

## GAPS

1. **[MEDIUM, fixed in tests] QA-1: the e2e launcher's retry after a hung start-up failed on its own clean-up.**
   - Where: `tests/e2e/support/extension.ts` `startBrowser`. It deleted the profile of a start-up that hung before retrying, while the killed Chromium's processes were still writing into it.
   - Evidence: `ENOTEMPTY: directory not empty, rmdir '…/attest-e2e-…/Default'` failed `a11y.spec.ts` (light) at 16.5 s on 2026-10-13, right after "[e2e] Chromium start-up hung for 15 s (attempt 1 of 3)". The retry that Decisions [0.close] added for exactly this case never ran.
   - Not Sprint 7 code; a loaded machine exposes it.
   - Fixed: the deletion now retries (`maxRetries: 10`). A folder that still cannot be deleted is logged and left in the temporary folder, and never fails the test. The new `removeProfile` does this for the start-up, `discard` and `close`.
   - Proven on the next run: one profile could not be deleted, was logged, and the launch was retried.
   - File: `tests/e2e/support/extension.ts`.
2. **[MEDIUM] QA-2: the public-number tests cannot catch a wrong figure** (with the tech review, TECH-2).
   - `public-numbers.ts` passes any number RESULTS.md holds anywhere. RESULTS.md holds every whole number from 0 to 8 and from 10 to 15, plus 17, 18, 24 to 26, and more.
   - Six changes to the README all pass `readme.spec.ts`, each made and reverted here:
     - the evasion row, 18 of 25 → 17 of 25;
     - "6 of the 13 attack strategies" → 5;
     - the popup's first paint, 60 ms → 52 ms (its own minimum);
     - a severity, MEDIUM → LOW;
     - the Observer starvation row deleted;
     - the receipts limit, 95% → 90%.
   - Show HN's "6 of 13 strategies" → 5 passes `launch-kit.spec.ts`.
   - Fixed in part: `readme-figures.spec.ts` (new) holds the README's two tables, its opening and Show HN's red-team counts to named metrics. It catches all of the above but the receipts limit (QA-3).
   - Still checked on membership alone: the Reddit posts, the weekly posts, the message, the Show HN replies, and any README number outside the opening, Results and Attacks sections.
   - Suggested: TECH-2's fix (each public number names its metric), then fold `readme-figures.spec.ts` into it.
3. **[MEDIUM] QA-3: the README's receipts row states a limit that no receipts metric holds.**
   - The row "Receipt emails (`receipts`) … | 95%" gives a 95% limit.
   - The receipts gate is different: every labelled fixture exact, every negative unparsed, every list view neutral (`bench/observers/receipts.ts` `gatePassed`). The `receipts` result has no threshold metric. The 0.95 the check admits belongs to `gmail-sent`, `gcal` and `paste`.
   - So this public number does not trace to its bench (Hard Rule 12, and Sprint 7's rule that every public number traces to RESULTS.md).
   - Fix: write the receipts limit as what the gate is ("every labelled receipt exact"), or have the bench record its threshold. Then add the limit to `RESULT_ROWS` in `readme-figures.spec.ts`, whose receipts entry says why it has none today.
   - Files: `README.md`, `bench/observers/receipts.ts`.
4. **[MEDIUM, fixed in tests] QA-4: four behaviours of `GET /v1/stats` could change with no test failing.**
   - With each of these changes made in turn, and reverted, `test_stats.py` still passed:
     - a 204 not kept for its hour;
     - a 503 kept for an hour;
     - rates rounded to three places;
     - a Mongo error in a sum not turned into a `StoreError` (a 500 instead of a 503).
   - Nor did any test count installs that sent several days each, read malformed store data, or cross the floor with the cache.
   - Fixed: `test_stats_edges.py` (new, 10 tests) catches all four and covers the rest (the table above).
5. **[MEDIUM] QA-5: locally, the e2e perf gates share the machine with the other worker, and today they failed on it.**
   - `playwright.config.ts` runs 2 workers outside CI. Nothing keeps `perf-ledger.spec.ts`, `perf-gmail.spec.ts` or `gmail-sent-perf.spec.ts` apart from the test on the other worker.
   - The Vitest perf gates already run "serial and in one fork, so no other test competes for CPU" (`vitest.perf.config.ts`).
   - The canonical `pnpm e2e` failed both popup-paint gates (144 ms, 108 ms), and passed them alone (76 ms, 80 ms). Flaky is failing (qa_tester rule 10).
   - The founder's launch checklist asks `pnpm e2e` to pass on the release commit.
   - CI is not affected: it runs one worker.
   - Fix: run the perf specs in a Playwright project that depends on the rest, or as a second, one-worker step of `pnpm e2e`.
   - Files: `extension/playwright.config.ts`, `extension/package.json`.
6. **[LOW] QA-6: the report script's refusals rest on the server, and its failures end in tracebacks** (SEC-3, TECH-12).
   - `fetch()` returns any valid `Stats`, so a 200 answer with `installs: 7` is written up as a report.
   - These failures leave `main()` by a traceback: a 503 (`HTTPError`), a DNS failure, and a body that is not JSON or not a `Stats`.
   - `http://localhost.attacker.example` passes the "local" check.
   - Suggested tests, which fail today:
     - a 200 with `installs` below `MIN_INSTALLS` exits 1 and writes nothing;
     - each of those failures exits 1 with one line on stderr, and writes nothing;
     - that address is refused.
   - File: `telemetry-api/tests/test_reliability_report_main.py`.
7. **[LOW] QA-7: the store zip's install check had no test, and passes zips that are not fit to ship** (SEC-5, TECH-13).
   - `release-zip.spec.ts` (new) proves the five failures in the table above.
   - Probed here on zips made the same way, it still passes three (exit 0, "installs on a clean profile"):
     - a zip whose digest page throws, because `digest.html` is not among the pages it opens;
     - a zip whose service worker logs an error at start, because it listens to pages only;
     - a zip that keeps `dev.html` and `model-check.html`.
   - A zip without its Gmail content script does fail, but by the launcher's "the page readers were never registered" escaping as an uncaught error, not by a check of the tool's own.
   - `scripts/check-release.ts` itself has no test: the zip named from the version, a missing zip refused, the audit run on the zip.
   - Fix: when the tool checks these, add each of those zips to `release-zip.spec.ts` as a case that must fail.
8. **[LOW, fixed in tests] QA-8: nothing held the listing's permission table to the manifest** (TECH-15).
   - Fixed: `store-listing-permissions.spec.ts` (new).
9. **[LOW] QA-9: the recorders' invented-data check can be fooled, and nothing in CI runs it** (TECH-5, SEC-6, privacy review 16).
   - `demo.record.ts` has no check at all, though two of its frames are vendor test pages.
   - `store-shots.record.ts` reads `innerText` only, so it never sees a form value, alt text or a picture.
   - Its address pattern, run here on its own strings, lets through three forms:
     - an internationalised domain (`priya@bücher.de`);
     - a zero-width character inside the domain (`priya@gma\u200bil.com`, which is drawn as `priya@gmail.com`);
     - a fullwidth at sign (`priya＠gmail.com`).
   - The `.record.ts` files run only when the founder records, so a broken check would go unseen.
   - Fix: move the check into one support module shared by both recorders, run it before every frame, and unit-test its address filter with those three forms as cases it must flag.
   - Files: `tests/e2e/support/frames.ts` (or a new `invented.ts`), `tests/unit/harness/`.
10. **[LOW] QA-10: the launch kit's "no dash" check misses common dashes.**
    - Its pattern is `[\u2010-\u2015]|\w-\w| - `.
    - Run here, it misses: `word -- word`, a minus sign (U+2212), a two-em dash (U+2E3A), a fullwidth hyphen (U+FF0D), a small em dash (U+FE58), a soft hyphen, and a hyphen against one word (`a -b`, or `a -` at a line's end).
    - Fix: forbid any hyphen-like character in outreach prose once list bullets are stripped.
    - File: `tests/unit/docs/launch-kit.spec.ts`.
11. **[LOW] QA-11: PRIVACY.md's own-key paragraph is held to nothing** (privacy review 6).
    - The listing's model answer is held to every key of `IntelClaim` and `IntelCandidate` (`store-listing.spec.ts`).
    - The policy's "Your own model key" paragraph names neither the match's id nor the merchant, and no test reads it.
    - Suggested test, failing today: the same `MODEL_PHRASES` checked over that paragraph.
    - File: `tests/unit/docs/store-listing.spec.ts`, or a new `privacy-policy.spec.ts`.
12. **[LOW] QA-12: the stats sums have only ever run on mongomock** (TECH-10).
    - mongomock's `$sum` adds `true` as 1, where MongoDB ignores a boolean (measured here through `MongoStore.totals`). So the parity test runs on a stand-in that differs from the database it stands for.
    - `scripts/prove_flow.py`, the one job with a real Mongo, never calls `/v1/stats`.
    - Fix: extend `prove_flow.py` to post 49 installs' days (expect 204), then the 50th (expect 200, with the sums). CI's docker job then runs both aggregations on the pinned image.
    - File: `telemetry-api/scripts/prove_flow.py`.
13. **[LOW] QA-13: the stats cache is keyed on time only.**
    - Measured: an answer made at 23:30 on 20 November is still served at 00:10 on the 21st, with `until` 2026-11-19. A fresh answer would end 2026-11-20.
    - Every answer says `max-age=3600`, however old it is (TECH-11).
    - Fix: remake the answer when the window's day changes, and send the time left as `max-age`.
    - Suggested test: the midnight read above expects the new window.
    - Files: `telemetry-api/app/main.py`, `tests/test_stats_edges.py`.
14. **[LOW, fixed in tests] QA-14: nothing held the documents' statements of the floor, window and hour to `app/stats.py`.**
    - Fixed: `test_stats_docs.py` (new).
15. **[LOW, fixed in tests] QA-15: nothing checked 7.0's source maps.**
    - Fixed: `source-maps.spec.ts` (new).
16. **[LOW] QA-16: Sprint 7's tools have no tests** (TECH-7).
    - `scripts/check-release.ts`, `record-demo.ts`, `record-screenshots.ts`, `render-icons.ts` and the two `.record.ts` flows run only by hand.
    - `demo-gif.spec.ts` reads the GIF's size and frame times, not what the frames show.
    - The icons are checked for size only: not that they are drawn from `assets/icon.svg`, and not their clear corners.
    - Suggested: at least a CI step that runs the two recorders' page checks without writing the pictures.

Checked and clean:

- Two tests per bus message type and per Dexie writer: N/A, because Sprint 7 added neither.
- Property tests: unchanged, no `src/core` change this sprint, all green at their run counts.
- Zero input events on vendor pages: `no-input-events.spec.ts` passes, and no content script changed.
- Worker restarts: mid-grace (`worker-lifecycle.spec.ts`) and mid-encryption, both pass.
- No retry anywhere, the launcher's documented start-up replacement aside.
- `changelog.spec.ts` fails a policy that applies to another version, and `headers.spec.ts` fails a document without its header (each change made and reverted here).
- `store-listing.spec.ts`'s privacy-form check fails when the listing drops the merchant.

Untestable today (BLOCKED(MANUAL)):

- **The release zip itself.** `pnpm build:release` refuses the `.invalid` telemetry host until the API is deployed. So it has not been tested that the store zip leaves out the development pages, names the real host, or installs clean. `release-zip.spec.ts` stands in, on zips made from the e2e build.
- **`homepage_url` and the policy's public address:** they need the repository to be public.
- **`/v1/stats` and the reliability report against the deployed API**, and the store submission.

## PERF

| Measure | Today | Gate | RESULTS.md (`17a39e4`) |
|---|---|---|---|
| One pass of the Gmail Sent reader over 10,000 rows (`perf-gmail`, median of 3) | 1,055 ms (beside another test) | < 2 s | 676.1 ms |
| One Gmail Sent pass, the page's CPU (`gmail-sent-perf`, median of 3) | 1,647.8 ms CPU | < 2 s | not recorded |
| The 30-day ledger's storage | 40,244,465 B | < 50 MB | 40,231,771 B |
| The popup's first paint over the 30-day ledger | 76 ms alone; 144 ms beside another test (QA-5) | < 100 ms | 72 ms |
| The same, sealed | 80 ms alone; 108 ms beside another test | < 100 ms | 64 ms |
| The popup's first paint at 5,000 receipts (Vitest perf) | 64.0 ms | < 100 ms | 60 ms |
| The popup's reads at 5,000 receipts (Vitest perf) | 17.7 ms CPU | < 50 ms | 17.9 ms |
| Grading 5,000 claims against 50,000 observations (Vitest perf, median) | 1,509.5 ms CPU | < 2 s | 1,375.8 ms |
| Candidate lookup, the same sizes | 549.1 ms CPU | < 2 s | 462.3 ms |
| The popup's start load | 120,525 B gzipped | < 125,000 B | not recorded |
| The content scripts | gmail.js 71,486 B, gcal.js 66,450 B gzipped | < 75,000 B each | not recorded |
| JSON export of the 30-day ledger (alone) | 3,698 ms, 40.1 MB, heap peak +29 MB | measured | 3,157 ms |
| CSV export (alone) | 1,160 ms, 1.2 MB, heap peak +13 MB | measured | 1,166 ms |
| Sealing the month, then with the rebuild (alone) | 19,954 ms, then 31,329 ms | measured | 19,524 ms, then 30,685 ms |
| The worker's idle heap | 3.4 MB | measured | 3.5 MB |
