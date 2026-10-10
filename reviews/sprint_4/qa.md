# Sprint 4: QA

Role: agents/qa_tester.md. Range: `fc5cefe..efefaa0` (13 commits, tasks 4.0 to 4.10).

**Scope.** Receipts in front of the person:

- the UI data layer (4.0), design tokens and shared components (4.1);
- the popup (4.2), and the side panel's timeline, detail and a person's mark (4.3);
- the options page: grants per agent (4.4); readers on and off, retention, paged JSON and CSV export, and Delete all data (4.5);
- alerts (4.6), the weekly digest (4.7), and a receipt or a week shared as text and as an image (4.8);
- Check Gmail for me (4.9), and the accessibility and copy pass (4.10).

The uncommitted change to CHANGELOG.md is out of scope.

**Where the numbers come from.**

- The suite numbers (unit, src/core coverage, time zones, poison, E2E and perf) are the main session's runs on efefaa0, taken from their logs.
- The unit, E2E and perf runs ran while two orphaned Vitest workers from an earlier killed run spun at about 100% CPU (load average 30 to 53). They were killed at 20:31. The unit and E2E runs were green all the same. The perf run is not valid (see PERF).
- QA ran its own 12 files, and three coverage runs that no log held, after the main session's runs had finished:
  - the observer and adapter gate (`vitest.observers.config.ts`);
  - the 28 UI suites, over src/ui and the four pages;
  - 37 suites of the Sprint 4 ledger, background and bus modules, over those modules.
  - Each wrote its report to the scratchpad, never to extension/coverage.
- QA also ran `pnpm lint` and `pnpm typecheck` over the whole tree.
- QA changed nothing outside `extension/tests/` and this file.

## RESULTS

**Static checks, with QA's tests in the tree**

- `pnpm lint`: exit 0. ESLint and Prettier are clean, and check-docs is OK.
- `pnpm typecheck`: exit 0.

**Unit, property and golden (`pnpm test` on efefaa0)**

- 443 files: 10,492 passed, 7 skipped, 0 failed, in 484 s. The 7 skips are by design (Decisions [2.6]).
- Perf: see PERF.

**QA's tests**

- 12 new files, 69 tests. QA changed no existing test.
- All 12 ran green twice, together. They also ran green once in each of Pacific/Kiritimati and America/St_Johns.
- The red tests of GAPs 1, 4, 5, 6 and 8 (7 tests) are not in the tree. Their code is below, and each fails at efefaa0. The scratchpad's `s4qa/` holds them as runnable files.

**Coverage**

- **src/core (`pnpm test:coverage`, the same 443 files): 99.39% of lines** (3,808 of 3,831). The gate is 95%: pass.
  - Statements 98.82%, branches 93.19%, functions 99.78%.
  - Under 98% of lines: receipt-hash.ts 92.85% (as at Sprint 3), sha256.ts 96.03%, conditions-finality.ts 97.29% and policy-errors.ts 97.29%.
  - conditions-finality.ts line 151 is new. It is the throw of `claimFinalFromMs` for an UNASKED receipt with a claim, which `isFinal` throws first. It cannot run, and is not a gap.
- **src/observers and src/adapters (QA's run of `vitest.observers.config.ts`): 99.03% of lines** (1,739 of 1,756). The gate is 85%: pass. 87 files, 1,618 passed; QA's bus file is one of them.
- **UI (QA's run of the 28 UI suites): 95.24% of lines** (1,102 of 1,157). Rule 8's bar is 70%: pass.
  - The suites: tests/unit/ui, popup, sidepanel, options and digest, and tests/unit/copy.spec.ts. QA's two UI files are among them.

  | Area | Lines |
  |---|---|
  | src/ui | 97.08% |
  | Popup | 100% (its components 72.72%) |
  | Side panel | 93.44% (its components 98.11%) |
  | Options | 97.95% (its components 95.32%) |
  | Digest page | 63.15% (its components 100%) |

  - Before QA's share-png.spec.ts, src/ui was at 88.11% and share-png.ts at 24.52%: the image was drawn only end to end. share-png.ts is now at 100%.
  - The digest page's 63.15% is its mount (App.tsx and main.tsx, 0%) and use-digests.ts (70.58%): GAP 14.
- **The Sprint 4 ledger, background and bus modules (QA's run of 37 suites):** ledger 98.92%, bus 98.01% and background 87.16% of lines. What the background run leaves out is Chrome's own wrappers (`BROWSER_ALERTS`, `BROWSER_OPEN`, `BROWSER_AUTO_CHECK`, `browserDigest`), which only the end-to-end tests run.

**Time zones (`test:tz` on efefaa0)**

- 182 files: 6,505 passed and 7 skipped in Pacific/Kiritimati, and the same in America/St_Johns.
- Both runs began before QA's two property files existed. QA ran its 12 files in both zones itself: green.

**Poison (`test:poison` on efefaa0)**

- 172 files: 6,291 passed. src/core under the guard: 99.37% of lines (3,807 of 3,831). The gate is 95%: pass.

**E2E (`pnpm e2e` on efefaa0)**

- 72 passed in 8.7 minutes on 2 workers: 0 failed, 0 flaky, no retries.
- The content scripts are inside their budget: gmail.js 69,729 B gzipped of 75,000, and gcal.js 64,688 B.

**Mandatory tests**

- **Network intercept ✅, 3 of 3:**
  - The asserted allowlist is the one the extension ships (empty).
  - The 5-minute scripted session made 0 attributed requests, 0 violations and met no unknown host (5.1 min).
  - The negative control caught all 4 canaries.
  - The session is still Sprint 3's: it opens none of Sprint 4's surfaces (GAP 7).
- **Secret seed ✅, 2 of 2:**
  - The seeded session (20.4 s) left no seed in any channel, the weekly digest's share included. That share holds no `@`.
  - The negative control (6.6 s) caught all 18 plants, the one in the share among them.
  - The receipt's share is not a channel yet (GAP 9).

**Bench:** not run by QA. At efefaa0 every section of RESULTS.md was measured at ccf1014 (task 4.2): GAP 3.

### Sprint 4 Gate: the items QA can speak to

| Gate item | Status |
|---|---|
| Popup < 100 ms at 5,000 receipts | tests/perf/popup-paint.perf.spec.ts holds the first paint; RESULTS.md has 60 ms at ccf1014. The efefaa0 run read 120 ms under the load above: not valid. Re-run on a quiet machine: GAP 3. |
| Coverage header and degraded banner proven by E2E | The coverage header: PASS (popup.spec.ts: a fresh install says "not checked yet"; with Calendar never opened, its line says so). The degraded banner is proven only on the components page, with invented data: GAP 2. |
| Side panel detail shows every evidence field | Each piece of evidence lists every stored field (receipt-labels.spec.ts, timeline.spec.ts; sidepanel.spec.ts end to end). But a claim's amount read behind a bare `$` is shown nowhere: GAP 4. |
| Grants save, validate, and re-grade only PENDING | PASS: grants.spec.ts end to end (a tighter grant makes a new claim OVER_SCOPE); grant-save.spec.ts (a FINAL receipt is untouched); grant-form.spec.ts and grants.spec.ts (inline errors). |
| Export and wipe verified | PASS: options-export.spec.ts (the page's file holds the worker export's bytes; one CSV line per receipt); options-settings.spec.ts and settings.spec.ts (Delete all data leaves everything empty). QA added the CSV end to end with hostile cells, and a wipe run twice. |
| Alerts exactly as specified | PASS: alerts.spec.ts end to end (exactly the NOT_FOUND and the UNASKED; none muted; none again after a worker stop through CDP). QA added an alert pending across a stop. |
| Weekly digest renders and shares redacted | It renders: PASS (digest.spec.ts, with the alarm fired on an advanced clock). Redacted: a name with a dot and an address inside a hint get through (GAP 1). A mark's reason is not in it, though the sprint asks for it (GAP 6). |
| axe zero serious | PASS: a11y.spec.ts (four surfaces, light and dark, reduced motion), popup.spec.ts at 5,000 receipts, and ui-components.spec.ts. |
| Both mandatory tests green, including share output | Green, with the weekly digest's share as a channel. GAPs 7 and 9. |
| closed.md says VERIFIED CLEAN | For the close step. |

### QA rules

| Rule | Status |
|---|---|
| 1: fixtures, not logins | PASS. Every vendor session now runs behind the dead proxy (Decisions [4.9]). Security review SEC-5 notes launches that still do not. |
| 2: labelled corpus and a bench number | No new reader in Sprint 4. The bench predates 8 of the sprint's commits (GAP 3). |
| 3: two tests per bus message type | Every new type is tested valid and malformed at its schema. Through `listen()`, `receipt.event` and `grant.save` were; the four settings were not, nor was `sendSetting`: QA wrote them (GAP 15). |
| 3: two tests per repo method | Every new method has a happy test. Repeats, absences and conflicts were missing for several, and two page reads had no unit test: QA wrote them (GAPs 19, 20). `queueAlerts` given one receipt twice throws (GAP 8). |
| 4: property tests for `src/core` | The core's change (`finalFrom`, contract v1.18) is pinned by five goldens and checked on every golden receipt. It is a field of every receipt, so the 5,000-example determinism property holds it too. QA added two ledger properties (GAPs 16, 24). |
| 5: no input events on vendor pages | PASS on the vendor fixtures. The Gmail tab the auto-check opens has no recorder (GAP 10). |
| 6: service-worker restart via CDP | PASS for the alerts (alerts.spec.ts) and for a stop mid-grace (worker-lifecycle.spec.ts). An alert pending across a stop, and the auto-check across one, are unit models now (GAPs 17, 18). |
| 7: perf gates | The efefaa0 run is not valid: GAP 3. |
| 8: coverage | core 99.39%, adapters and observers 99.03%, UI 95.24%. No CI gate holds the UI (GAP 14). |
| 9: no mocking inside `src/core` | PASS. |
| 10: flaky = failing | 0 flaky in the E2E run. The auto-check test's earlier flake was fixed by polling, but a fixed 3-second wait remains (GAP 10). QA's 12 files ran green twice, and in both zones. |

## GAPS

25 gaps: 1 HIGH, 7 MEDIUM and 17 LOW.

- **Open (14):**
  - Gaps 1, 4, 5, 6 and 8 are product defects, pinned by red tests. Their code is below, not in the tree.
  - Gaps 2, 3, 7 and 9 to 14 are left for the close step.
- **Written by QA (11):** Gaps 15 to 25. They are in the tree, and green.

Some gaps meet the other reviews; each says so. In the red tests:

- `read(agent, ...rows)` is the claims `readPastedLog` reads from the rows joined by line breaks, pasted at `2026-10-08T17:00:00-04:00` with an offset of −240 minutes;
- `unescaped` is `(text) => text.replace(/\\(.)/gu, '$1')`;
- `WEEK` is a valid stored digest with no notable receipt (week `2026-10-05`).

**Open: red tests and gaps for the close step**

**1. [HIGH] Redaction (security review SEC-1): a name with a dot is shared as a domain, and an address inside a hint is shared as it is.**

- **What happens.**
  - A pasted claim's counterparty may be a name with a dot: "Texted J.Smith…" keeps "J.Smith" (`extension/src/adapters/claims.ts:143`).
  - `domainOf` keeps any `label.label` as a domain (`extension/src/ledger/domain.ts:15`). So the receipt's share and the weekly digest show "j\.smith", under "Counterparties are shown by domain only".
  - A subject hint that holds an address is shared as written: "“Lunch with priya@company\.example”" (`extension/src/ui/receipt-share.ts:40`, `extension/src/ui/digest-share.ts:50`).
  - The digest schema takes any one line as a notable receipt's domain, an address or a name included (`extension/src/ledger/types.ts:179`).
- **Why the tests miss it.** The golden redaction test judges each share with `domainOf` itself, and it lets a name through when a hint holds it. No fixture hint holds an address, so the end-to-end checks for `@` pass.
- **Red tests:** 3. Each fails at efefaa0.

```ts
it('gives no domain for a name with a dot, and never shares one', () => {
  for (const name of ['J.Smith', 'Priya.S', 'Dr.Who']) expect(domainOf(name), name).toBeUndefined();
  const [claim] = read('muse', 'Today', '4:33 pm · Texted J.Smith that the deck is ready'); // readPastedLog's claims
  expect(claim?.counterparty).toBe('J.Smith');
  const receipt = Receipt.parse(makeReceipt({ claimId: claim?.id, observationIds: [] }));
  expect(unescaped(receiptMarkdown({ receipt, claim, observations: [] })).toLowerCase()).not.toContain('j.smith');
});

it('never shares an address a subject hint holds', () => {
  const claim = Claim.parse(makeClaim({ subjectHint: 'Lunch with priya@company.example' }));
  const receipt = Receipt.parse(makeReceipt({ observationIds: [] }));
  expect(unescaped(receiptMarkdown({ receipt, claim, observations: [] }))).not.toMatch(/@/u);
  const notable = { receiptId: ulid(3), agent: 'muse', grade: 'NOT_FOUND' } as const;
  const digest = DigestRecord.parse({ ...WEEK, notable: [{ ...notable, subjectHint: 'Lunch with priya@company.example' }] });
  expect(unescaped(digestMarkdown(digest))).not.toMatch(/@/u);
});

it('stores only a domain as a notable receipt’s domain', () => {
  const notable = { receiptId: ulid(3), agent: 'muse', grade: 'NOT_FOUND' } as const;
  for (const domain of ['priya@company.example', 'Priya Raman']) {
    expect(DigestRecord.safeParse({ ...WEEK, notable: [{ ...notable, domain }] }).success).toBe(false);
  }
});
```

**2. [MEDIUM] Gate: no end-to-end test shows the degraded banner on the popup or the side panel.**

- **What exists.** `extension/tests/e2e/ui-components.spec.ts:68` checks the banner on the components page, drawn from invented data. Unit tests draw it from a stand-in ledger (popup.spec.ts, components.spec.ts). No end-to-end test opens the popup or the side panel while a reader is DEGRADED.
- **Suggested E2E**, in popup.spec.ts:
  1. Open the broken Sent list of `extension/tests/e2e/observer-tabs.spec.ts:100` (`brokenSentList`, its time cells gone).
  2. Wait for `gmail.sent` DEGRADED (`selector.missing.time`) in the ledger.
  3. Open popup.html and sidepanel.html. Each shows `role="alert"` with "Degraded: Gmail Sent reader <version>". Its report link names only the reader, the version and the Chrome major.
  4. A clean pass of the Sent list takes the banner away.

**3. [MEDIUM] Rule 7: the perf gates and the bench must run again on a quiet machine.**

- **The efefaa0 run is not valid.** It ran under the load above. Two of its tests failed:
  - the popup's first paint, median 120 ms (runs 92, 120, 120, 84 and 156);
  - the coverage reads for a batch of 100 claims, which timed out at 60 s. It had read 2,150 rows, inside its gate of 3,000.
- **RESULTS.md is older than the sprint.** Every section was measured at ccf1014 (task 4.2). The task commits since (4.3 to 4.10) changed what is timed:
  - the popup loads the auto-check notice and a digest link;
  - `popupView` reads the auto-check record;
  - each batch queues alerts in its own transaction.
- **The day's paint has no gate** (tech review TECH-5). The gate holds the skeleton's first paint. Today's list painted at a median of 96 ms at ccf1014, with one run at 112 ms, and at 176 ms in the loaded run. Gate it as well, or say in Decisions.md why not.
- **Check:** `pnpm test:perf`, then `pnpm bench`, on the sprint's last commit, with nothing else running.

**4. [MEDIUM] Gate: an amount read behind a bare `$` is dropped from the detail, the row and both shares.**

- **What happens.** The paste parser keeps only the cents of an amount behind a bare `$`, with no currency (`extension/src/adapters/claims.ts:178`, Hard Rule 5). The ChatGPT corpus has one: "Completed checkout for … at $89.99". Every surface shows an amount only when both are present:
  - the detail drawer (`extension/src/ui/detail-labels.ts:50`), though the amount fed the score: `amountExact` applies to it, and scores 0;
  - the popup's and the timeline's row (`extension/src/ui/paste-labels.ts:43`);
  - the receipt's share (`extension/src/ui/receipt-share.ts:39`), though 4.8 says "amounts kept";
  - the week's share (`extension/src/ui/digest-share.ts:47`).
- **Red test:** fails at efefaa0. Each of its four checks fails on its own.

```ts
it('shows an amount read behind a bare $ wherever the claim is shown', () => {
  const [claim] = read('chatgpt', 'Today', '3:40 pm · Completed checkout for a pair of running shoes at $89.99.');
  if (claim === undefined) throw new Error('no claim');
  expect([claim.amountCents, claim.currency]).toEqual([8999, undefined]);
  const receipt = Receipt.parse(makeReceipt({ claimId: claim.id, agent: 'chatgpt', grade: 'NOT_FOUND', ruleId: 'not_found', reasons: [{ code: 'match.none', params: {} }], observationIds: [] }));
  expect(claimFields(claim, NOW).map(([label]) => label)).toContain('Amount');
  expect(claimWhat(claim)).toContain('89.99');
  expect(unescaped(receiptMarkdown({ receipt, claim, observations: [] }))).toContain('89.99');
  const notable = { receiptId: ulid(3), agent: 'chatgpt', grade: 'NOT_FOUND', type: 'purchase.made', amountCents: 8999 } as const;
  expect(unescaped(digestMarkdown(DigestRecord.parse({ ...WEEK, notable: [notable] })))).toContain('89.99');
});
```

**5. [MEDIUM] The timeline shows a stale read after its filters change (tech review TECH-2).**

- **What happens.** Each read of the list sets the list when it lands, for the filters it was asked with (`extension/entrypoints/sidepanel/use-timeline.ts:154`). "Show older receipts" does the same (`:175`). So a read for the filters before lands over the list of the new ones.
- **The effect.** With Verified unticked, the list shows Verified receipts until the next change.
- **Red test** (stand-in sources, as in timeline.spec.ts): fails at efefaa0, showing `['Verified', 'Not found', 'Verified', 'Not found']`.

```ts
it('shows only what the filters now ask, when a read for the filters before them lands last', async () => {
  // sources.page: the first call waits for releaseFirst(); later calls answer at once, filters applied.
  await show();
  await click(box('Verified')); // the person unticks Verified while the first read is out
  expect(grades()).toEqual(['Not found', 'Not found']);
  await act(() => { releaseFirst(); });
  await settle();
  expect(grades()).toEqual(['Not found', 'Not found']);
});
```

**6. [MEDIUM] Sprint requirement with no test (tech review TECH-4): the weekly digest holds no mark's reason.**

- **What the sprint says.** "The override reason is required and visible in the digest." The digest counts marks (`marked`) and keeps no reason (`extension/src/ledger/digest.ts:57`). No test asks for one.
- **To decide with the fix:** the digest page shows the reason; its share keeps leaving it out, as the receipt's share does (Decisions [4.8]).
- **Red test:** fails at efefaa0.

```ts
it('the weekly digest shows each mark the person made, with its reason', async () => {
  // A FINAL NOT_FOUND receipt of the week, marked Verified: "Sent it from my phone".
  const digest = await buildDigest(db, week, madeAt);
  expect(digest.agents[0]?.marked).toBe(1);
  expect(JSON.stringify(digest)).toContain('Sent it from my phone');
});
```

**7. [MEDIUM] Hard Rule 1: the mandatory network-intercept session opens none of Sprint 4's surfaces.**

- **What exists.** `extension/tests/e2e/network-intercept.spec.ts` did not change in Sprint 4. Its session opens the popup, the options page and the side panel, imports a log and fires the purge alarm.
- **What it never runs:** the digest page and its share, a receipt's share with its image, an alert, a grant saved, both exports, a reader turned off and on, Delete all data, or Check Gmail for me.
- **Suggested:** add those to `openAll`. Turn Check Gmail for me on with the Gmail Sent fixture routed at `AUTO_CHECK_URL`, so the only page Attest opens is shown to the guard. Expect no violation and no unknown host.

**8. [LOW] Latent: `queueAlerts` given one receipt twice throws, and would abort its batch.**

- **What happens.** It adds every receipt it was given that has no row yet, with one `bulkAdd` (`extension/src/ledger/alerts.ts:48`). Two copies of one receipt make a `BulkError` (ConstraintError), and the batch's transaction aborts. Today each batch passes each receipt once, so nothing fails yet.
- **Red test:** fails at efefaa0.

```ts
it('queues a receipt given twice once, and never aborts the batch', async () => {
  const receipt = Receipt.parse(makeReceipt({ grade: 'NOT_FOUND', ruleId: 'not_found', reasons: [{ code: 'match.none', params: {} }], observationIds: [], state: 'FINAL', finalAt: '2026-10-01T11:00:00-04:00' }));
  await expect(queueAlerts(db, [receipt, receipt])).resolves.toBe(1);
});
```

**9. [LOW] The receipt's share is not a channel of the mandatory secret-seed test.**

- **What exists.** `extension/tests/e2e/no-leak.spec.ts` searches the weekly digest's share. A receipt's share is made from rows the export channel already searches, so a seed could not reach it unseen. But half of the gate's "share output" is outside the test. Security review SEC-1 asks the same.
- **Suggested:** in `seededSession`, open each receipt's detail in the side panel, share it, and add the text to `share`.

**10. [LOW] Rules 5 and 10: the auto-check end-to-end test waits a fixed 3 seconds for "the check ran".**

- **What happens.** `batchDone` waits for the batch, then sleeps 3 s (`extension/tests/e2e/auto-check.spec.ts:58`) before it asserts that no tab opened. Under load, a check that runs later would open its tab unseen, and the test would pass.
- Also, the Gmail tab the auto-check opens has no input-event recorder.
- **Suggested:**
  - wait for a signal the worker gives once a check is done, for example a debug log line `autocheck.checked` read from the worker's console;
  - install the recorder (`installRecorder`) on the opened tab, and expect zero events.

**11. [LOW] UI states: the PENDING row ("Checking — final from 14:48") has no end-to-end test.**

- **What exists.** receipt-row-labels.spec.ts and popup.spec.ts hold it in unit tests.
- **Suggested:** auto-check.spec.ts already has a PENDING receipt and opens the popup. Check its row says "Checking — final from".

**12. [LOW] A digest alarm lost between firing and rescheduling comes back only at a browser start.**

- **What happens.** The alarm is one-shot, and `runWeeklyDigest` sets the next one first (`extension/src/background/digest.ts:50`). If the worker stops before that call, or `alarms.create` rejects, no digest alarm is left. Only `ensureAlarms` at a browser start (`extension/entrypoints/background.ts:27`), or an install or update, sets it again. Until then, no weekly digest is made.
- **Suggested:** the grace alarm (or every start of the worker) runs `ensureAlarms`. Unit test: after a digest run whose `schedule` rejects, the next grace alarm sets the digest alarm at `nextDigestMs`.

**13. [LOW] Tests for the fixes of security review SEC-6 and SEC-7.**

- **SEC-6:** Delete all data leaves `chrome.storage.session` (`attest.openReceipt`, `attest.idleSession`) and the alerts on screen. Extend `extension/tests/unit/background/settings.spec.ts` so it expects `browser.storage.session.get(null)` to be `{}`, and no notification left.
- **SEC-7:** a digest is purged once its week ended before the cutoff (`extension/src/ledger/retention.ts:302`), so it keeps the hints and domains of purged receipts for up to 7 more days. Extend `extension/tests/unit/ledger/retention.spec.ts` with a week that straddles the cutoff.

**14. [LOW] Rule 8: no CI gate holds the UI to 70%, and the digest page's own folder is at 63.15%.**

- **What exists.** The UI numbers above come from QA's ad-hoc run. The digest page's App.tsx and main.tsx are never run (they only mount), and use-digests.ts is at 70.58% (lines 23 to 25 and 55 to 56).
- **Suggested:** a coverage config over src/ui and the pages' entrypoints, run by CI, failing below 70%, as `vitest.observers.config.ts` does for the readers.

**Written by QA: in the tree, green**

**15. [MEDIUM] Rule 3 and the bus's trust rule: the four setting commands were held only by their schema.**

- **What was missing.**
  - No test sent `retention.save`, `reader.toggle`, `flag.set` or `ledger.wipe` through `listen()` from a content script. If one left `EXTENSION_PAGE_ONLY` (`extension/src/bus/listen.ts:91`), a Gmail tab's script could delete every Attest datum or turn the auto-check on, and every test would stay green.
  - `sendSetting` never ran.
  - Nor did the invalid and unanswered paths of `sendReceiptEvent` and `sendGrant`.
- **Written:** `extension/tests/unit/bus/page-commands.spec.ts`, 28 tests. For each setting, they cover:
  - valid from the options page;
  - dropped from a content script (`untrusted_context`) and from another extension (`foreign_sender`);
  - malformed, with nothing of it logged;
  - a bad or throwing handler answered failed.
  - Then: an invalid command is never sent, and no answer resolves failed.

**16. [LOW] Decisions [4.7]: the multi-zone test it describes was not in the tree.**

- **What was missing.** The decision says the week math was "tested over 2,000 random instants in New York, Santiago, Lord Howe, Kiritimati, St John's and Tehran". tests/unit/ledger/digest-week.spec.ts runs in the host's zone only, and `test:tz` does not run tests/unit/ledger.
- **Written:** `extension/tests/property/ledger/digest-week-zones.property.spec.ts`, 8 tests.
  - Each sets its zone inside the worker and proves it took effect.
  - The zones: those six, plus Havana (clocks change at midnight: a Sunday that starts at 01:00, one whose midnight comes twice) and Chatham.
  - Each runs 1,000 random instants, then each of the zone's clock changes in 2026 and 2027.
  - The oracle is the local calendar: the soonest Monday 09:00, the week before now's week, and seven days that each start at their first instant.

**17. [LOW] Rule 6: an alert pending across a stopped worker.**

- **What was missing.** The end-to-end restart covers alerts already shown. Nothing covered one queued by a batch whose worker stopped before showing it.
- **Written:** `extension/tests/unit/background/alerts-restart.spec.ts`, 2 tests (a fresh module instance, the ledger reopened):
  - the next worker shows it exactly once, even when its start and a batch deliver at once; never again after that;
  - none, when the person marked the receipt while the worker was stopped.

**18. [LOW] Rule 6: Check Gmail for me across a stopped worker.**

- **Written:** `extension/tests/unit/background/auto-check-restart.spec.ts`, 4 tests:
  - within the window, the next worker opens nothing; after it, a claim due at the open opens nothing, and a later claim opens one tab;
  - a stop between the tab and its record opens one more tab at the next check (the decision's accepted case), but none once the Sent folder was read;
  - nothing opens across restarts while the person keeps it off.

**19. [LOW] Rule 3: repeats, absences and two page reads of the new ledger methods.**

- **Written:**
  - `extension/tests/unit/ledger/sprint4-repeat-writes.spec.ts`, 9 tests:
    - `saveGrant` twice, and for an agent with no grant;
    - a digest absent or corrupt, logged by its key only;
    - a week past the digest's cap of 200 notable receipts: the newest 200 kept, all counted, and "And 3 more." shared;
    - the auto-check record written twice, partly missing, and refused;
    - `eachPage` on an empty table and on exactly two pages;
    - `deleteLedger` run twice.
  - `extension/tests/unit/ledger/views-settings-reads.spec.ts`, 4 tests: `sidePanelOverview` and `grantSettings` against a real ledger, each read by key or a small table. Before, they ran only end to end.

**20. [LOW] Schema v10 had no migration test, where v8 and v9 had one.**

- **Written:** `extension/tests/unit/ledger/migrations-v10.spec.ts`, 2 tests: the digests store keyed by week; a v9 ledger upgrades with its receipts and alerts kept, and no digest.

**21. [LOW] Priority 5: the CSV's formula guard was tested on `csvCell` alone.**

- **Written:** `extension/tests/unit/ledger/export-csv-cells.spec.ts`, 1 test, through `receiptsCsvBlob` and an RFC 4180 reader:
  - would-be formulas in counterparties are written after an apostrophe;
  - commas, quotes, emoji, combining marks, a right-to-left mark and Arabic text come back exactly;
  - every line has every column;
  - no mark's reason and no hint is in the file.

**22. [LOW] Priority 7: unicode and markdown in shares.**

- **Written:** `extension/tests/unit/ui/share-escaping.spec.ts`, 4 tests, 1,000 cases each:
  - `escapeMarkdown` leaves nothing unescaped and unescapes to the text exactly;
  - a receipt's share and a week's share keep their shape whatever their page text holds;
  - the image draws each hint as written.

**23. [LOW] The share's image was drawn only end to end.**

- **Written:** `extension/tests/unit/ui/share-png.spec.ts`, 3 tests, over a happy-dom canvas whose drawing is recorded:
  - every word drawn in order;
  - lines wrapped by words to the card, and a word wider than the card alone on its row;
  - fonts and inks by kind, in light and dark;
  - the card's size;
  - no canvas, or no image, is refused.

**24. [LOW] Priority 6: the receipt pages were tested by example.**

- **Written:** `extension/tests/property/ledger/receipt-page.property.spec.ts`. Over 150 random ledgers (8 to 40 receipts, six grading instants, any agents, grades, range and page size), walking every page gives exactly the oracle's list. None is lost or shown twice.
- **Checked not vacuous.** More than 75 runs page more than once, and more than 40 have a page boundary inside one grading instant. The test asserts both.

**25. [LOW] The settings at their edges.**

- **Written:** `extension/tests/unit/background/settings-edges.spec.ts`, 3 tests:
  - a retention window that cannot be stored is answered failed, and nothing is announced;
  - Delete all data asked twice;
  - Delete all data stands when the readers cannot be registered again, and that is logged loud.

## PERF

| Gate | Measured | Limit | Status |
|---|---|---|---|
| Popup first paint at 5,000 receipts, in Chromium (wall) | efefaa0, under load: median 120 ms (92, 120, 120, 84, 156). ccf1014 (RESULTS.md): 60 ms (56 to 64) | 100 ms | Not valid: re-run (GAP 3) |
| Popup's day paint (today's list) | efefaa0, under load: median 176 ms. ccf1014: 96 ms (92 to 112) | none | No gate (GAP 3) |
| UI reads at 5,000 receipts, in Node | popup 21.3 ms, timeline page 11.6 ms, filtered page 19.6 ms, detail 1.0 ms (median CPU) | 50 ms | PASS (under load) |
| Gmail Sent pass, 10,000 rows, in Chromium | Median 871.4 ms CPU (911.0, 857.9, 871.4), in the E2E run | 2,000 ms | PASS (under load) |
| Grading, 5,000 claims × 50,000 rows, in Node | Median 1,838.5 ms CPU (Sprint 3: 1,430.4) | 2,000 ms | PASS (under load) |
| Steady-state batch at 2,000 claims | Median 584.1 ms CPU | 1,500 ms | PASS |
| Candidate lookup | Median 548.1 ms CPU | 2,000 ms | PASS |
| Coverage reads for a batch of 100 claims | Timed out at 60 s, after 2,150 rows read | 3,000 rows | Not valid: re-run (GAP 3) |

- Every number in this table but the RESULTS.md ones comes from runs on a loaded machine. Re-run them all on a quiet one before the Gate (GAP 3).
- QA's suites are quick:
  - the zones property takes about 4 s (8 zones × 1,000 instants);
  - the pages property about 3.5 s (150 ledgers);
  - every other QA file under 2 s.
