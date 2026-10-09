# Sprint 3: QA

Role: agents/qa_tester.md. Range: `19697ef..8ab40c9` (the Sprint 2 close to the last Sprint 3 commit).

**Scope.** The paste path (3.11 to 3.16): the parser, the side panel's Add agent activity, the `claims.import` message, the grading batch and grace alarm, the default grants and away detection. Also:

- the ledger's replay records (schema v5), activity (schema v6) and clock repairs (3.17);
- core `batch-store` and the reason `coverage.clock_repaired`;
- the Muse adapter on synthetic pages (3.2), with the pattern tables and the adapter skeleton.

**Out of scope by decision.** The agent readers are off under the vendors' terms (Decisions [3.10]). Claims come from a log the person pastes, so the lack of a live adapter is not a gap. Tasks 3.0, 3.1 and 3.3 to 3.9 are BLOCKED(MANUAL).

**Where the numbers come from.**

- The suite numbers (unit, coverage, time zones, E2E) are the main session's runs on 8ab40c9, taken from their logs.
- QA ran only its own new and changed test files, plus `pnpm lint` and `pnpm typecheck` over the whole tree.
- QA changed nothing outside `extension/tests/` and this file.

## RESULTS

**Static checks, with QA's tests in the tree**

- `pnpm lint`: exit 0. ESLint and Prettier are clean, and check-docs is OK.
- `pnpm typecheck`: exit 0.

**Unit, property and golden (`pnpm test` on 8ab40c9)**

- 391 files: 10,159 passed, 7 skipped, 0 failed. The 7 skips are by design (Decisions [2.6]).
- Perf pass: 5 of 5 gates.

**QA's tests**

- 10 files: 9 new and 1 changed. They hold 67 tests.
  - The new files hold 41 tests.
  - The changed file is `tests/unit/core/normalize-upcoming.spec.ts`: its property now runs 1,000 examples, up from 500.
- All 10 ran green twice, together. The 6 that read time zones also ran green once in each of Pacific/Kiritimati and America/St_Johns.
- The core and property files also ran green under the poison guard (coverage off).
- The red tests of GAPs 1, 2 and 6 to 8 (5 tests, 17 cases) are not in the tree.

**Coverage**

- **src/core (`pnpm test:coverage`): 99.44% of lines** (3,776 of 3,797). The gate is 95% of lines: pass.
  - Statements: 98.89%.
  - Branches: 93.17%.
  - Functions: 99.77%.
  - The only core file under 95% of lines is receipt-hash.ts, at 92.85% (92.5% at the Sprint 2 review). Its uncovered lines include `writeRef`'s fallback paths.
- **The other areas:** the main session measured these with one instrumented run of the whole suite (394 files, 10,178 passed). That run started while only QA's first three files existed.

  | Area | Lines |
  |---|---|
  | src/adapters | 98.86% |
  | src/observers | 99.37% |
  | src/background | 98.99% |
  | src/ledger | 99.23% |
  | src/bus | 99.32% |
  | Side panel | 97.14% |
  | Options | 97.79% |
  | src/ui | 100% |

- **The lowest files**, each now run by a QA test:

  | File | Lines | Now run by |
  |---|---|---|
  | entrypoints/sidepanel/App.tsx | 60% | send-import.spec.ts (GAP 18) |
  | entrypoints/background.ts | 75% | background-idle.spec.ts (GAP 12) |
  | AwayDetection.tsx | 86.95% | away-detection-states.spec.ts (GAP 17) |

- **Summary:** core 99.44%, adapters 98.86%, UI 97.14% to 100%. All are above rule 8's bars. No CI gate holds src/adapters to its 85% (GAP 10).

**Time zones (`test:tz`)**

- 180 files: 6,485 passed and 7 skipped in Pacific/Kiritimati, and the same in America/St_Johns.
- Both runs began before QA's property files existed. QA ran those files in both zones itself: green.

**E2E (`pnpm e2e`)**

- 50 passed in 5.1 minutes on 2 workers: 0 failed, 0 flaky.
- `demo-paste.spec.ts` passed in 6.7 s. It ran the §2 demo through the built extension's content scripts and the side panel, and gave exactly VERIFIED, NOT_FOUND and UNASKED (likely Muse), all FINAL.

**Mandatory tests**

- **Network intercept ✅, 3 of 3:**
  - The asserted allowlist is the one the extension ships.
  - The 5-minute scripted session made 0 attributed requests and 0 violations. It now includes an import through the side panel.
  - The negative control caught all 4 canaries.
- **Secret seed ✅, 2 of 2:**
  - A log holding every seed was pasted and imported through the side panel. No seed reached the export, IndexedDB, storage, the console or the network (14.7 s).
  - The negative control catches a seed in every channel (2.7 s).

**Bench:** not run by QA (the main session runs it). At 8ab40c9, RESULTS.md has only the core, gcal, gmail-sent and receipts sections (GAP 5).

### Sprint 3 Gate: the items QA can speak to

| Gate item | Status |
|---|---|
| Five host permissions exactly | Every agent reader is off (Decisions [3.10]), so the build holds exactly two hosts, Gmail and Calendar. built-bundle.spec.ts asserts this and passes. The Gate line still says five (3.0 is BLOCKED(MANUAL)). |
| Claim-type accuracy ≥ 90%, in RESULTS.md | patterns.spec.ts asserts at least 90% per vendor, but RESULTS.md at 8ab40c9 has no such row: GAP 5. |
| Muse and Claude adapters pass fixtures; Dots flagged | Muse passes on its 5 labelled synthetic pages (muse-fixtures.spec.ts). Claude and Dots are BLOCKED(MANUAL). |
| §2 demo E2E: VERIFIED, NOT_FOUND and UNASKED | PASS (demo-paste.spec.ts). |
| OVER_SCOPE on a new permission | BLOCKED(MANUAL) (3.7). |
| Replay over the E2E ledger reproduces every receipt | No test runs it: GAP 4. Ledgers built in unit tests do replay (2 of 2, and 3 of 3). |
| Both mandatory tests green | PASS. |

### QA rules

| Rule | Status |
|---|---|
| 1: fixtures, not logins | PASS. |
| 2: labelled corpus and a bench number | Muse's synthetic pages are labelled, and so is the patterns corpus. The paste parser has no corpus (GAP 11). The bench number is missing (GAP 5). |
| 3: two tests per bus message type | PASS. `claims.import` is tested valid, malformed, from an untrusted sender, and with a failing handler (round-trip.spec.ts). `adapter.scope` is tested valid and malformed (messages.spec.ts). Only one of the import's four provenance checks was tested; QA wrote tests for the other three (GAP 15). |
| 3: two tests per Dexie repo method | Every new repo method has a happy test. Six had no duplicate test; QA wrote them (GAP 16). |
| 4: property tests for `src/core` | The `upcomingIn` property ran 500 examples, in one zone and one month. No property generated `Coverage.repairs`. QA wrote both (GAPs 13, 14). |
| 5: no input events on vendor pages | GAP 9. |
| 6: service-worker restart via CDP | GAP 3. |
| 7: perf gates | PASS (see PERF). |
| 8: coverage | GAP 10. |
| 9: no mocking inside `src/core` | PASS. |
| 10: flaky = failing | Every suite was green without retries. QA's own files ran green twice, and the time-zone ones in both zones. |

## GAPS

19 gaps: none HIGH, 6 MEDIUM and 13 LOW.

- **Open (11):**
  - Gaps 1, 2 and 6 to 8 are product defects, pinned by red tests. Their code is below, not in the tree.
  - Gaps 3 to 5 and 9 to 11 are left for the close step.
- **Written by QA (8):** Gaps 12 to 19. They are in the tree, and green.

**Open: red tests and gaps for the close step**

**1. [MEDIUM] Hard Rule 5: an entry under a heading the parser cannot place takes the day of the heading above it.**

- **What happens.** Some heading lines name a period or a date the parser does not read:
  - "September", "September 2026", "Sep 2026", "2025";
  - "2 weeks ago", "A week ago", "Last Thursday";
  - "Oct 1st", "Earlier today".

  The parser takes each of these lines as entry text. The heading above stays in force. Under "Yesterday", an email sent in September is claimed for yesterday at 9:15, at minute precision. Its activity minute becomes a session ping on the wrong day too. Once Gmail coverage is complete and grace is over, that claim can end NOT_FOUND.
- **The rule it breaks.** docs/claims-import.md §3 says a time under a heading that names a period is "no day", and that the day comes only from the paste.
- **Where:** `extension/src/adapters/paste.ts:91` (`UNPLACED_HEADING` lists a few periods only) and `:137` (any other line is text, while `heading` holds, `:164`).
- **Red test:** 9 of 9 cases fail at 8ab40c9. Each gets `2026-10-07T09:15:00-04:00`.

```ts
const read = (...rows: string[]) => {
  const result = readPastedLog(rows.join('\n'), {
    agent: 'muse',
    pastedAt: IsoTs.parse('2026-10-08T17:00:00-04:00'),
    offsetAt: () => -240,
  });
  if (!result.ok) throw new Error(result.refusal);
  return result.log;
};

it.each(['September', 'September 2026', 'Sep 2026', '2025', '2 weeks ago', 'A week ago', 'Last Thursday', 'Oct 1st', 'Earlier today'])(
  'under “%s”, an entry is never read on the day of the heading above it',
  (heading) => {
    const log = read('Yesterday', 'Sent an email to dana@example.com', '4:33 pm', heading, 'Sent an email to sam@example.org', '9:15 am');
    const sam = log.claims.find((claim) => claim.counterparty === 'sam@example.org');
    expect(sam?.claimedAt).not.toBe('2026-10-07T09:15:00-04:00');
  },
);
```

**2. [MEDIUM] Hard Rule 5 and Decisions [3.11]: a time line holding an invisible character or full-width digits is read as naming its own day.**

- **What happens.** Take a clock line such as `4:` U+200B `33 pm`, which holds a zero-width space. The same goes for a word joiner (U+2060) or a soft hyphen (U+00AD) in the line, and for full-width digits or colon (`４:３３ pm`, `4：33 pm`).
  - Such a line fails `BARE_CLOCK`, which reads the raw line.
  - `resolveRelative` then cleans the line (NFKC and invisible characters) and reads it as a bare clock. That turns the line into a "stamp", a time that names its own day: today, or yesterday when the time is later than the paste (normalize-relative.ts `clockOnly`).
- **The effect.**
  - Under "Yesterday", the claim is stamped today at 16:33, a day off.
  - With no day heading at all, the same entry is still imported, where the ASCII line correctly gives `no_day`.
- **Where:** `extension/src/adapters/paste.ts:83`, `:125` and `:126` to `:131`.
- **Red test:** 5 of 5 fail at 8ab40c9.

```ts
it.each(['4:\u200b33 pm', '4:33\u2060 pm', '4:33\u00ad pm', '\uff14:\uff13\uff13 pm', '4\uff1a33 pm'])(
  'a time line holding %j is read on its heading’s day, or not at all',
  (time) => {
    expect(read('Yesterday', 'Sent an email to sam@example.org', time).claims.map((c) => c.claimedAt)).not.toContain(
      '2026-10-08T16:33:00-04:00',
    );
    expect(read('Sent an email to sam@example.org', time).claims).toEqual([]);
  },
);
```

**3. [MEDIUM] Rule 6: no Playwright test stops the worker mid-grace through CDP.**

- **What exists.**
  - `extension/tests/e2e/worker-lifecycle.spec.ts:19` still says the test "needs receipts and the grace alarm: Sprint 3.6". Both exist since 3.13.
  - The only stop-mid-grace test is a unit model: `extension/tests/unit/background/grace-alarm.spec.ts`. It uses a fresh module instance and the reopened ledger.
  - `demo-paste.spec.ts` never has a PENDING receipt: its story is three days old.
- **Suggested E2E**, added to worker-lifecycle.spec.ts:
  1. Open the routed Gmail Sent fixture.
  2. Paste an email claim stamped about 74 minutes ago, to an address the list does not hold. Grace ends at claimedAt + afterClaimMin 45 + graceMin 30.
  3. Assert that the export holds the claim's receipt PENDING.
  4. Send `ServiceWorker.stopAllWorkers` and wait for `stopped`.
  5. Wait past the grace end and the Sent tab's next heartbeat. Then let the `attest.grade` alarm fire (its period is 5 minutes, or create it from an extension page with `when: Date.now()`).
  6. Assert the receipt is FINAL NOT_FOUND, the worker restarted with no error, and replay reproduces the receipt.
- **Status:** left for the close step. QA does not run E2E here (the main session does).

**4. [MEDIUM] Gate: no test replays the E2E ledger.**

- **What exists.** `extension/tests/e2e/demo-paste.spec.ts:114` to `:117` checks only that `receiptInputs` has a key for each receipt's `inputsHash`. The receipts are never replayed from that export, and nothing else replays a ledger built by the real extension in Chrome. The unit ledgers do replay (2 of 2, 3 of 3).
- **Suggested test:** in demo-paste.spec.ts, write the export to a temp file and run `pnpm attest replay <file>` in `extension/` (execFileSync). Expect 3 receipts, 3 reproduced and 0 mismatched.
- **Status:** left for the close step.

**5. [MEDIUM] Gate and rule 2: the claim-type accuracy is not in RESULTS.md at 8ab40c9.**

- **What exists.**
  - `extension/tests/unit/adapters/patterns.spec.ts` asserts at least 90% per vendor.
  - `bench/run_bench.ts` registers no adapter bench at 8ab40c9, and RESULTS.md has no patterns section.
- **Work in progress.** The working tree holds uncommitted bench work, outside QA's files and not reviewed here:
  - `bench/adapters/patterns.ts`;
  - `extension/tests/unit/bench/patterns-bench.spec.ts`;
  - a change to `bench/run_bench.ts`.
- **Check:** after the commit, `pnpm bench` writes a patterns section with every table at or above 90%, and 0 wrong actions.

**6. [LOW] Re-importing the same log copied in another Unicode normal form is refused.**

- **What happens.** The same entry pasted once in NFC and once in NFD (for example "Texted Zoë…") gives the same claim id. The id comes from `rawHash` over the NFC text (`extension/src/adapters/claims.ts:189`). But the claim's fields keep the pasted form: "Zoë" is 3 code units in NFC and 4 in NFD.
- **The effect.**
  - The ledger's identity check (`extension/src/ledger/upsert.ts:212`) refuses the second import as `id_conflict`.
  - `sendImport` turns that refusal into the preview's "Could not import the claims. Try again." Trying again can never succeed.
- **Confirmed end to end:** `onClaimsImport` answered `{ ok: false, code: 'id_conflict' }` to the NFD paste.
- **Red test:** fails at 8ab40c9.

```ts
it('the same entry pasted in NFC and in NFD gives the same claims', () => {
  const nfc = ['Today', 'Texted Zoë that the meeting moved', '4:33 pm'].map((row) => row.normalize('NFC'));
  expect(read(...nfc.map((row) => row.normalize('NFD'))).claims).toEqual(read(...nfc).claims);
});
```

**7. [LOW] Hard Rule 5: a move's sentence "from X to Y" takes X, the start the event moved from, as `targetAt`.**

- **What happens.**
  - `Moved "Standup" from Friday at 9am to Tuesday at 10am` gives a `calendar.updated` claim with `targetAt` Friday 09:00.
  - `extension/src/core/normalize-upcoming.ts:46` reads the first day-and-time as the start.
  - The update row the Calendar diff stores is the event's new state, with `occurredAt` Tuesday 10:00 (`extension/src/observers/gcal/diff.ts:195`).
  - That is outside the claim window of ± `calendarDays` (3).
- **The effect.** A true move of more than 3 days can never be VERIFIED. In QA's probe it graded UNVERIFIABLE; NOT_FOUND was not shown.
- **The rule it breaks.** docs/claims-import.md §3 reads a start "only when a day and a time are both named" unambiguously.
- **Red test:** fails at 8ab40c9.

```ts
it('a move “from Friday at 9am to Tuesday at 10am” never targets the start it moved from', () => {
  const [claim] = read('Today', 'Moved "Standup" from Friday at 9am to Tuesday at 10am', '4:33 pm').claims;
  expect(claim?.type).toBe('calendar.updated');
  expect(claim?.targetAt).not.toBe('2026-10-09T09:00:00-04:00');
});
```

**8. [LOW] Unicode: the preview's excerpt can cut a surrogate pair.**

- **What happens.** `excerpt` cuts at `max - 1` code units (`extension/src/ui/paste-labels.ts:104`). An emoji at that position leaves a lone high surrogate before the "…", which shows as a replacement character in the preview. This is display only: nothing is stored. `claims.ts` `cut` already avoids this.
- **Red test:** fails at 8ab40c9.

```ts
it('cuts an excerpt between characters, never inside a surrogate pair', () => {
  expect(excerpt(`${'x'.repeat(118)}\u{1F600} and more`)).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
});
```

**9. [LOW] Rule 5: the demo E2E records no input events on the vendor pages it opens.**

- **What happens.**
  - `extension/tests/e2e/demo-paste.spec.ts` opens Gmail Sent and the two-calendar week with their content scripts running, then imports and grades while they are open. It installs no input-event recorder.
  - `synthetic-gcal-week-two-calendars.html` is not in `no-input-events.spec.ts` VENDOR_PAGES (`:32` to `:43`).
- **Suggested test:** add that page to VENDOR_PAGES. Also give demo-paste.spec.ts the same recorder (`installRecorder`, then zero events on both pages after the import).
- **Status:** left for the close step.

**10. [LOW] Rule 8: no CI coverage gate holds src/adapters to 85%.**

- **What exists.** `extension/vitest.observers.config.ts:9` says "The Sprint 3 adapters join it (src/adapters) when they land". They have landed, but the config still covers only `src/observers` and its suites. The 98.86% above comes from an ad-hoc run.
- **Suggested change:** add `src/adapters/**/*.ts` to its coverage `include`, and `tests/unit/adapters/**/*.spec.ts` to `OBSERVER_COVERAGE_SUITES`. Update the guard spec if one pins the list (`tests/unit/lint/observer-coverage-config.spec.ts`).
- **Status:** left for the close step. It is config outside tests/.

**11. [LOW] Rule 2: the paste parser, the one claim source that ships, has no labelled corpus and no bench number.**

- **What exists.** Its tests use inline invented logs. No fixture logs carry a `labels.json` (the outcome and time of each entry; each claim's type, claimedAt, counterparty, subject, amount and targetAt), and no bench reports field accuracy.
- **Suggested:**
  - `extension/tests/fixtures/paste/<vendor>/*.txt` with `labels.json`;
  - a field-equality test;
  - `bench/adapters/paste.ts` (counting synthetic logs, as gmail-sent does).
- **Status:** left for the close step. It can be ACCEPTED while every log is invented (3.8 is BLOCKED(MANUAL)), if Decisions.md says so.

**Written by QA: in the tree, green**

**12. [MEDIUM] Hard Rule 8, privacy: the background entry's away-detection wiring was untested.**

- **What was missing.**
  - `chrome-fakes.ts` `asFreshInstall` swallows the entry's `permissions.onAdded` and `onRemoved` listeners.
  - Nothing proved that turning away detection off while the worker runs deletes every stored interval, as the options page promises.
  - Nothing proved that turning it on starts listening at once.
- **Written:** `extension/tests/unit/background/background-idle.spec.ts`, 2 tests.

**13. [LOW] Rule 4: no property generated `Coverage.repairs`, the contract v1.16 input.**

- **What was missing.** grade.property.spec.ts (5,000 examples) and batch-oracle.property.spec.ts build coverage without repairs. The new path had only the two simulator cases, golden 114 and clock-repaired.spec.ts.
- **Written:** `extension/tests/property/batch-repairs.property.spec.ts`. Over 1,000 random batches:
  - every `gradeBatch` receipt equals the per-claim `grade()` oracle;
  - the spans are a set;
  - a span never creates a NOT_FOUND;
  - a `calendar.created` claim whose bound a span holds is never NOT_FOUND;
  - spans change nothing else, and spans found after `evaluatedAt` change nothing at all.
- **Checked not vacuous.** In one full run, 232 claims that were NOT_FOUND without a span were saved by it. The test asserts more than 50.

**14. [LOW] Rule 4: the `upcomingIn` property ran 500 examples, in one zone and one month, and never crossed a daylight-saving change.**

- **Raised:** `extension/tests/unit/core/normalize-upcoming.spec.ts` now runs 1,000 examples.
- **Written:** `extension/tests/property/upcoming.property.spec.ts`, 3 properties of 2,000 examples each.
  - What they cover: weekdays; `today` and `tomorrow`; month and day forms with and without a year, beside a weekday that agrees or not.
  - The oracle: brute force over each zone's offsets.
  - The zones: New York, St John's, Lord Howe (half-hour daylight saving), Chatham (+12:45/+13:45), Kolkata, Kiritimati and UTC−12.
- **Mutation-checked.** Taking a repeated hour as one instant fails two of the properties. Applying the past rule to `today` fails the third.

**15. [LOW] Rule 3: three of the `claims.import` refinement's four conditions were untested.**

- **What was missing.** The untested conditions were: another agent, a chat claim, and a claim linked to a request. The bounds were untested too: an empty import, BATCH+1 claims, and `activeAt` past GRADING_INPUT or not an instant. So was `ClaimsImportResult`.
- **Written:** `extension/tests/unit/bus/claims-import-schema.spec.ts`, 8 tests.

**16. [LOW] Rule 3: duplicate and conflict tests were missing for 6 new repo methods.**

- **What was missing:**
  - `putReceiptInputs` and `deleteReceiptInputs`;
  - the purge of replay records, run twice;
  - `putSessions` with a repeated instant;
  - `closeIdle` at or before the stored end;
  - `openIdle` with an interval that ends before it starts;
  - `forgetIdle` and `purgeActivity`, each run twice;
  - `keepRepairSpan` and `purgeClockRepairs`, each run twice;
  - `batchRepairs` at LIST+1 spans.
- **Written:** `extension/tests/unit/ledger/repeat-writes.spec.ts`, 9 tests.

**17. [LOW] Priority 6: four AwayDetection states were untested.**

- **What was missing:**
  - checking: no state is claimed and no button shows until Chrome answers;
  - Chrome keeps the permission when it is turned off;
  - a request that throws at once, or rejects;
  - a retry that clears the problem;
  - also, the group's label and its status line.
- **Written:** `extension/tests/unit/options/away-detection-states.spec.ts`, 5 tests.

**18. [LOW] The side panel's sender and one of its notices were untested.**

- **What was missing.** `sendImport` never ran its mapping of a refusal or a failed handler. The notice "Attest already had this claim." never appeared.
- **Written:**
  - `extension/tests/unit/sidepanel/send-import.spec.ts`, 2 tests;
  - `extension/tests/unit/sidepanel/paste-flow.spec.ts`, 4 tests (every notice, and `previewOf` and its refusals).

**19. [LOW] Priority 7: the paste parser's untested clipboard and time-zone edges.**

- **What was missing:**
  - line endings `\r\n`, `\r`, U+2028 and U+2029;
  - U+202F and U+00A0 before "PM", a byte-order mark, and trailing blanks;
  - a re-paste later the same day, and a re-paste the next day relabelled "Yesterday" and "Wednesday", each with the same ids;
  - New York's spring change;
  - St John's autumn change, at half past the hour;
  - Kolkata and Kiritimati just after local midnight.
- **Written:** `extension/tests/unit/adapters/paste-edges.spec.ts`, 7 tests. They all pass and pin the current behaviour.

## PERF

| Gate | Measured | Limit | Status |
|---|---|---|---|
| Popup paint at 5,000 receipts | No gate yet: the popup lists no receipts until Sprint 4 | 100 ms | n/a |
| Gmail Sent pass, 10,000 rows, in Chromium | Median 726.4 ms CPU (runs: 705.8, 726.4, 741.8) | 2,000 ms | PASS |
| Grading, 5,000 claims × 50,000 rows, in Node | Median 1,430.4 ms CPU | 2,000 ms | PASS |
| Candidate lookup | Median 476.6 ms CPU | 2,000 ms | PASS |

- QA's suites are quick:
  - the `upcomingIn` properties take about 1.7 s (3 × 2,000 examples);
  - the repairs property takes about 3.5 s for 1,000 random batches, with 3 or 4 `gradeBatch` calls each, plus the oracle.
