# Sprint 3 — Close

Role: agents/sprint_closer.md. Inputs: `qa.md` (19 gaps), `security.md` (6 gaps) and `tech.md` (9 gaps) in this folder. Range closed: `8ab40c9` (the last Sprint 3 task) to `20303f6`, in two commits: `bbda3df` and `20303f6`. Every gap is fixed in code, or was written by the QA review and verified here. One part of TECH-2 stays as a measured, gated limit, listed below. Nothing was fixed by weakening a test, a Hard Rule, a lint rule, a threshold, a gate or an allowlist. Four test expectations changed with the behaviour they describe; each is named below.

## FIXED IN CODE

Severity order. A gap two reviews raised is fixed once and listed once.

### HIGH

1. **SEC-1: a time away the browser exited during was stretched over the next session.**
   - **Changed:**
     - The first watch of each browser session closes the interval a previous session left open, at what was confirmed.
     - A `chrome.storage.session` flag (`attest.idleSession`) tells a new browser session from a restarted worker. Chrome empties it when the browser closes.
   - **Code:** `extension/src/background/idle.ts` (`startIdleSession`, `watchIdle`), `extension/src/ledger/activity.ts` (`endOpenIdle`), `extension/src/config.ts` (`SESSION_KEYS`).
   - **Tests:** `extension/tests/unit/ledger/activity-repairs.spec.ts`, "SEC-1":
     - the overnight lock and next-day break give two intervals, not one stretched one;
     - a worker restarted in one session keeps the interval open until the return.
2. **TECH-1: every receipt's replay record held a full copy of its batch's coverage.**
   - **Changed:**
     - Schema v7 adds `batchCoverages`, each coverage stored once and keyed by `coverageHash`. Inputs name their coverage by hash.
     - A coverage is released with the last input naming it.
     - The export has a third map, and the replay reader checks every hash and joins each input to its shared coverage.
     - The v7 upgrade moves every stored copy.
   - **Code:** `extension/src/ledger/replay-records.ts`, `db.ts` (`STORES_V7`), `migrations.ts` (`upgradeToV7`), `types.ts`, `export.ts`, `extension/tests/tools/attest-snapshot.ts`.
   - **Tests:** `extension/tests/unit/ledger/replay-records.spec.ts`:
     - one batch's receipts share one stored coverage, released with the last input;
     - three batches of twenty receipts at 200 markers export under three copies plus 2 KB per receipt;
     - v6 to v7 moves the copies;
     - the e2e replays below.

### MEDIUM

3. **SEC-2: one pasted entry fired two UNASKED signals (session 0.4 plus adjacency 0.4, over the 0.6 threshold).**
   - **Changed:** grading contract v1.17, §7. A session ping at the instant of an entry that fires `activityLogAdjacent` is that entry. With no other ping in reach, only the heavier signal fires (adjacency on a tie). The §2 demo is unchanged.
   - **Code:** `extension/src/core/attribution.ts` (`weigh`), `extension/src/core/attribution-activity.ts` (`ownPing`, new).
   - **Tests:**
     - golden `115-one-pasted-entry-one-fact.json`, whose control fails without the rule;
     - the attribution property's literal oracle, which encodes v1.17.
   - The review left this rule to you. It was decided here in the direction Hard Rule 7 asks (Decisions `[3.close]`), and you can overrule it.
4. **SEC-3: the clock repair kept times away and session pings stamped in the future.**
   - **Changed:** guard step 6 does three things:
     - deletes rows after now;
     - cuts a time away that reaches past now;
     - drops the open mark of a deleted row.

     It is logged as `ledger.clock_activity_repaired`.
   - **Code:** `extension/src/ledger/activity.ts` (`repairActivity`), `extension/src/ledger/clock-guard.ts` (`guardTables`, `repair`).
   - **Tests:** `activity-repairs.spec.ts`, "SEC-3".
5. **TECH-2: each batch read and parsed every claim and receipt, every five minutes, with no perf gate.**
   - **Changed:** a batch with no receipt PENDING and no fact stored since the last batch that graded skips. The signal is a count of stored facts (`storedWrites`, `gradedWrites`). It is race-free, where the clock high water was not.
   - **Code:** `extension/src/background/grading.ts` (`nothingToGrade`), `extension/src/ledger/clock-high-water.ts`, `batch-instant.ts`.
   - **Tests:**
     - `extension/tests/unit/background/grading.spec.ts`, "a batch with nothing to grade";
     - the new perf gate `extension/tests/perf/grading-batch.perf.spec.ts`: steady state at 2,000 claims 395 ms median CPU (gate 1,500 ms), idle 1.4 ms (gate 50 ms).
   - What stays is listed under ACCEPTED.
6. **TECH-3 and SEC-6: a valid paste failed at send with no trace, and four catches logged nothing.**
   - **Changed:**
     - The parser refuses a log over `GRADING_INPUT` timed entries (`too_many_times`), with its own message.
     - Every catch logs: `sidepanel.import_failed`, `options.away_check_failed`, `options.away_change_failed`, `bus.import_refused`, `bus.import_unavailable`.
     - A permission check Chrome cannot answer says Attest could not tell, never "off" and never "on".
   - **Code:** `extension/src/adapters/paste.ts`, `extension/entrypoints/sidepanel/use-paste-flow.ts`, `extension/entrypoints/options/components/AwayDetection.tsx`, `extension/src/bus/send.ts`.
   - **Tests:**
     - `extension/tests/unit/adapters/paste-message.spec.ts`: the review's 87,445-character probe is refused, and a property that every accepted log is one valid message;
     - the log assertions in `away-detection-states.spec.ts`, `send-import.spec.ts` and `add-activity.spec.ts`.
   - **Changed expectation:** `away-detection.spec.ts`'s failed check now expects "Attest could not tell whether away detection is on." instead of "off".
7. **TECH-4 and SEC-5: the privacy docs and the grading contract missed the paste path.**
   - **Changed:**
     - `docs/privacy-architecture.md` names every meta key and the session flag, schema 7, and the claims, grants and receipts as they are written now.
     - `PRIVACY.md` is version 0.3: receipts already made keep their `unasked.idle` reason.
     - `docs/grading.md` covers the activity sources and the adapter sync.
     - The README status and the stale CHANGELOG lines are fixed.
   - **Code:** `extension/src/ledger/meta-keys.ts` (`META_KEYS`).
   - **Tests:** `extension/tests/unit/docs/privacy-architecture.spec.ts`, "§5.6 names every meta key".
8. **QA GAP 1: a heading the parser could not place lent the day of the heading above it.**
   - **Changed:** a line of only date words and numbers is a heading whose day is unknown.
   - **Code:** `extension/src/adapters/paste.ts` (`namesOnlyADate`).
   - **Tests:** `extension/tests/unit/adapters/paste-review.spec.ts`, GAP 1 (QA's nine cases plus a control).
9. **QA GAP 2: a time line with an invisible or full-width character was read as naming its own day.**
   - **Changed:** lines are classified in their NFKC form, with invisible characters dropped.
   - **Code:** `extension/src/adapters/paste.ts` (`timeForm`).
   - **Tests:** `paste-review.spec.ts`, GAP 2 (QA's five cases).
10. **QA GAP 3: no e2e test stopped the worker mid-grace.**
    - **Changed:**
      1. The claim is pasted with no Gmail tab open, so it is PENDING.
      2. CDP `ServiceWorker.stopAllWorkers` stops the worker.
      3. The Sent tab's pass wakes it, and the grace alarm's batch finalizes the receipt NOT_FOUND.
      4. Replay reproduces it.
    - **Tests:** `extension/tests/e2e/worker-lifecycle.spec.ts`, "Chrome stops the worker mid-grace".
11. **QA GAP 4: nothing replayed the e2e ledger (a Gate item).**
    - **Changed:** the §2 demo's export is written to a file and replayed by `pnpm attest replay`: 3 receipts, 3 reproduced, 0 mismatched.
    - **Tests:** `extension/tests/e2e/demo-paste.spec.ts`, `extension/tests/e2e/support/replay.ts`.
12. **QA GAP 5: the claim-type accuracy was not in RESULTS.md (a Gate item).**
    - **Changed:** `pnpm bench` has a `patterns` section: accuracy per agent, wrong actions, the gate at 90%, and a flag saying the corpus is invented.
    - **Code:** `bench/adapters/patterns.ts`.
    - **Tests:** `extension/tests/unit/bench/patterns-bench.spec.ts`; the bench run below.

### LOW

13. **SEC-4: the paste screens said only claims were kept.**
    - **Changed:**
      - The form says the entry times are kept too.
      - The preview counts the kept times and marks each non-claim entry whose time is kept, only when the log is imported.
      - Each entry carries its minute.
    - **Code:** `ActivityForm.tsx`, `PastePreview.tsx`, `SkippedItem.tsx`, `extension/src/ui/paste-labels.ts`, `paste.ts` (`PastedEntry.minute`).
    - **Tests:** `add-activity.spec.ts`.
    - **Changed expectation:** its preview test expects the new wording.
14. **TECH-5: comments and doc sentences contradicted the code.**
    - **Changed:** corrected in `grading.ts`, `default-grants.ts`, `muse/adapter.ts`, `docs/adapters.md` and `docs/claims-import.md`.
15. **TECH-6: duplicated logic.**
    - **Changed:**
      - one address pattern;
      - the day and month names taken from core;
      - `importExtractorId`;
      - paste times read once;
      - unit constants in place of literals;
      - `lastImportKey` moved to the ledger;
      - `coverageForMany` deleted, with its property suite and read-count gate moved onto `coverageForBatch`.
    - **Tests:** `extension/tests/property/ledger/coverage-batch.property.spec.ts`, `extension/tests/perf/coverage-reads.perf.spec.ts` (2,150 rows against the gate of 3,000).
16. **TECH-7: the activity writer threw a raw ZodError.**
    - **Changed:** it now refuses with `LedgerError('invalid_input')`.
    - **Tests:** `repeat-writes.spec.ts`, tightened to expect the typed error.
17. **TECH-8: a grace-alarm batch announced nothing.**
    - **Changed:** it announces `receipts` when a receipt changed (`changedReceipts`).
    - **Tests:** `grace-alarm.spec.ts`.
18. **TECH-9: the batch kept the newest 10,000 claims silently.**
    - **Changed:**
      - The claims are bounded to the spend and attribution windows.
      - A list still over the cap logs `grading.input_capped`.
    - **Tests:** `extension/tests/unit/background/grading-inputs.spec.ts`.
19. **QA GAP 6: a log in NFD gave conflicting claims.**
    - **Changed:** the paste is read in NFC.
    - **Tests:** `paste-review.spec.ts`, GAP 6.
20. **QA GAP 7: a move targeted the start it left.**
    - **Changed:** a move's start is read after its last "to".
    - **Code:** `claims.ts` (`startWords`).
    - **Tests:** `paste-review.spec.ts`, GAP 7.
21. **QA GAP 8: an excerpt could split a surrogate pair.**
    - **Changed:** excerpts are cut by code point.
    - **Tests:** `paste-labels.spec.ts`.
22. **QA GAP 9: the demo e2e recorded no input events.**
    - **Changed:**
      - The recorder is shared (`extension/tests/e2e/support/input-recorder.ts`).
      - The demo asserts zero events on its Gmail and Calendar pages.
      - The two-calendar week joins `no-input-events.spec.ts`.
23. **QA GAP 10: no CI gate held src/adapters to 85% of lines.**
    - **Changed:** `vitest.observers.config.ts` measures src/adapters with src/observers: 99.03% of lines.
    - **Tests:** `observer-coverage-config.spec.ts`.
24. **QA GAP 11: the paste parser had no labelled corpus and no bench number.**
    - **Changed:**
      - `extension/tests/fixtures/paste`: four invented, labelled logs.
      - `paste-corpus.spec.ts` compares them field by field.
      - `bench/adapters/paste.ts`: field accuracy, gate 95%.
      - It found one real miss: ChatGPT's "Completed checkout … at $89.99" lost its amount. An exact pattern now reads it.
    - **Code:** `extension/src/adapters/pattern-tables.ts`.

### Written by the QA review, verified here (QA GAPs 12 to 19)

Each test is in the tree and green in the full run below:
- `background-idle.spec.ts`
- `batch-repairs.property.spec.ts`
- `upcoming.property.spec.ts`
- the raised `normalize-upcoming.spec.ts` property
- `claims-import-schema.spec.ts`
- `repeat-writes.spec.ts`
- `away-detection-states.spec.ts`
- `send-import.spec.ts`
- `paste-flow.spec.ts`
- `paste-edges.spec.ts`

Changed expectations, beyond those named above:
- QA's `repeat-writes.spec.ts` and `replay-records.spec.ts` call the batch form of `putReceiptInputs`, and their replay maps name the coverage by hash.
- The shipped schema version is 7 in `migrations.spec.ts` and `activity.spec.ts`.
- `export.spec.ts` lists the new `storedWrites` meta key.

## MANUAL ACTION REQUIRED

1. [ ] **Decide the Sprint 3 gate** → MANUAL.md, "Sprint 3 close". The gate as written cannot pass while the agent readers are off under the vendors' terms. Approve the amended gate, or keep the gate and wait for a vendor's permission.
2. [ ] **Push the Sprint 3 commits** (`git push`) → MANUAL.md.
3. [ ] Unchanged, still open:
   - the permission letters (parked by you);
   - the two private captures (keep or delete);
   - agent captures and the live smoke, on hold until a reader may run.

## ACCEPTED AS KNOWN LIMITATION

1. **A batch that grades still reads every claim and receipt (TECH-2, the part not fixed).**
   - **Measured:** 395 ms median CPU at 2,000 claims and receipts over 90 days (Node, fake IndexedDB).
   - **Gate:** 1,500 ms, so it cannot grow unnoticed.
   - **Why:** bounding the read needs an index on the claims' stored instant that the schema does not have.
   - **Recorded:** Decisions `[3.close]` TECH-2.
2. **The corpora are invented.** The `patterns` and `paste` numbers measure invented sentences and logs, since no vendor's page may be read (Decisions `[3.10]`). Each result says so (`patternsCorpusInvented`, `pasteCorpusInvented`). Real labelled logs wait for a vendor's permission, or for logs you paste from your own accounts with invented details.
3. **A false calendar creation claim stamped in a repaired clock span is UNVERIFIABLE, never NOT_FOUND.** This came from 3.17, not from a review. It is not re-measured, because the Sprint 2 simulator is gone. Written down in `docs/attacks-that-work.md` and Decisions `[3.17]`.

## VERIFIED CLEAN

Measured on the closed tree: `20303f6`, and `b18ed75`, which adds only its bench results.

- **Unit, property and golden:** `pnpm test:coverage`, the whole suite instrumented. 406 files: 10,250 passed, 7 skipped by design (Decisions `[2.6]`), 0 failed.
- **Perf gates:** `pnpm --dir extension run test:perf`, 6 of 6.

  | Gate | Measured | Limit |
  |---|---|---|
  | `gradeBatch`, 5,000 claims × 50,000 rows | 1,425.4 ms median CPU | 2,000 ms |
  | Candidate lookup | 468.3 ms | 2,000 ms |
  | New: steady-state batch at 2,000 claims | 397.1 ms | 1,500 ms |
  | New: idle batch | 1.2 ms | 50 ms |
  | Coverage reads: Calendar week | 7 rows | 64 |
  | Coverage reads: Sent head | 2 rows | 16 |
  | Coverage reads: 100-claim batch | 2,150 rows | 3,000 |

- **Coverage:**

  | Area | Lines | Gate |
  |---|---|---|
  | src/core | 99.44% (98.88% statements, 93.21% branches, 99.77% functions) | 95% |
  | src/observers and src/adapters, `pnpm test:coverage:observers` (86 files, 1,556 tests) | 99.03% | 85% |

- **Time zones:** `test:tz`. 182 files, 6,502 passed and 7 skipped, under Pacific/Kiritimati and again under America/St_Johns.
- **E2E:** `pnpm e2e` on `20303f6`. 51 passed in 5.1 minutes: 0 failed, 0 flaky.
  - **Mandatory: network-intercept ✅.** The shipped allowlist is the one asserted; the 5-minute session, with a paste through the side panel, made no request outside it; the negative control catches all.
  - **Mandatory: secret-seed ✅.** A pasted log holding every seed left no trace in the export, IndexedDB, storage, the console or the network, and the negative control catches each channel.
  - The §2 demo gives exactly VERIFIED, NOT_FOUND and UNASKED (likely Muse), all FINAL. `pnpm attest replay` reproduces 3 of 3, and the demo's pages saw no input event.
  - The mid-grace worker stop finalizes NOT_FOUND and replays.
- **Bench:** `pnpm bench`, on a clean tree at `20303f6`. Six benches, every gate passed:

  | Bench | Measured |
  |---|---|
  | core | candidate lookup 402 ms median CPU |
  | gmail-sent | field accuracy 1 (gate 0.95) |
  | receipts | field accuracy 1 for every platform parser |
  | gcal | field accuracy 1 (gate 0.95) |
  | patterns | Muse 95.59%, ChatGPT, Dots and Claude 95.52%, 0 wrong actions, gate 90%, corpus invented |
  | paste | 111 of 111 fields, gate 95%, corpus invented |

- **Lint, Prettier, check-docs and typecheck:** clean. The commit hook ran all four on every commit.
- **Telemetry-api:** not built until Sprint 5; untouched.

Commits: `bbda3df` and `20303f6` (fixes), `b18ed75` (bench results), and the close commit that adds this file.

## Gate

The Sprint 3 Gate as written, run on the closed tree:

| Item | Result |
|---|---|
| Five host permissions exactly | **Not met.** Two hosts, Gmail and Calendar, by decision: every agent reader is off under its vendor's terms (Decisions `[3.10]`). |
| Claim-type accuracy ≥ 90% on the labelled corpus, in RESULTS.md | Met: 95.52% to 95.59% per agent (`patterns`). The corpus is invented. |
| Muse and Claude adapters pass fixtures; Dots flagged and DEGRADED | **Partly met.** Muse passes its synthetic fixtures. Claude and ChatGPT/Dots wait on their vendors (3.3, 3.4: BLOCKED(MANUAL)). |
| §2 demo E2E produces VERIFIED, NOT_FOUND and UNASKED through real content scripts | Met on the paste path: the real Gmail and Calendar content scripts, with Muse's log pasted. |
| OVER_SCOPE on a new permission | **Not met.** It needs an agent's settings page read (3.7: BLOCKED(MANUAL)). Core's OVER_SCOPE is held by golden 50. |
| Replay over the E2E ledger reproduces every receipt | Met: 3 of 3 (`demo-paste.spec.ts`). |
| Both mandatory tests green | Met. |
| Vendor terms logged | Met (Decisions `[3.10]`). |
| `closed.md` says VERIFIED CLEAN | Met (above). |

The gate is red on three items, and each needs a vendor's permission to read its site. Sprint 3 therefore stays open. An amended gate, with every item the paste path can meet, waits for the founder's decision in MANUAL.md ("Sprint 3 close"). Every remaining task, 3.0, 3.1 and 3.3 to 3.9, is BLOCKED(MANUAL).
