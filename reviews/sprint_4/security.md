# Sprint 4 — Security review

Role: agents/security_reviewer.md. Range: `git diff fc5cefe..efefaa0`. That is 14 commits, two of them bench results, and 272 files, 151 of them under `extension/src` and `extension/entrypoints`. Tasks 4.0 to 4.10 (every choice in Decisions [4.0] to [4.10]). The uncommitted CHANGELOG.md edit is not reviewed.

**How.** Read-only. I read every Sprint 4 source file against the checklist and ran the checklist's commands at efefaa0. The working tree's `src`, `entrypoints`, `docs` and PRIVACY.md match it. I played the new paths through the repository's own modules in scratch probes: tsx, and vitest over fake IndexedDB, in an isolated copy of efefaa0 (`scratchpad/s4sec/`). I did not run the end-to-end suite. I read the log of the run made on efefaa0 at 20:28 (`scratchpad/s4runs/e2e.txt`). I changed nothing in the shared tree except this file.

**Verdict: 10 gaps.** 0 CRITICAL, 1 HIGH, 3 MEDIUM, 6 LOW.

The HIGH gap is in the new share, the one channel built to leave the browser. A person's name written with a dot, such as "A.Kumar" in a pasted log, passes for a domain. The receipt's share, the stored weekly digest and the digest's share all show it, under a footer that says counterparties are shown by domain only. The three MEDIUM gaps:

- Check Gmail for me promises a tab "in front of you", but it opens one while Chrome is in the background or the screen is locked.
- The consent flags live in storage that Attest's own content scripts can write, so the bus guard on `flag.set` can be walked around.
- The weekly digest's notification says "Nothing to look at" for a week Attest could not check.

**What held under every probe.**

- **Hard Rule 1.** The network grep over `src` and `entrypoints` at efefaa0 finds nothing. The build of HEAD (20:29) has none of these in any script: fetch, XHR, beacon, WebSocket, EventSource, importScripts, eval, the Function constructor. No page has an inline script. The only URLs in the source are:
  - the host patterns;
  - `AUTO_CHECK_URL`;
  - two GitHub links, opened only by the person's click, with `rel="noopener noreferrer"`.

  Shares, exports, the clipboard, the canvas and notifications stay on the device. In the efefaa0 run, all five @mandatory tests passed. The 5-minute session made 0 attributed requests, and the negative control caught all 4 canaries. no-leak passed with the digest's share as a new channel, and so did its negative control.
- **Hard Rule 2 on the other new channels.**
  - A notification names the grade, the agent, the action's type and its time. It never names a counterparty, an amount or a subject (`alert-text.ts`).
  - The auto-check record and the popup's notice hold instants, a count and agent ids.
  - The receipts CSV leaves out hints and mark reasons. A cell that starts a formula (`=`, `+`, `-`, `@`, tab, CR) gets an apostrophe, and quotes are doubled (probe `csv-cells.mts`).
  - Markdown escaping makes a link, an image, a heading, HTML or code in a hint inert. The image draws the same text with `fillText`.
  - A share never holds the request text or a mark's reason. Its reasons are codes, numbers and ids. An observation id hashes in the vendor's row id, which no share shows, so it cannot be turned back into an address. A claim id hashes the whole pasted sentence, which no share holds either.
  - The policy allowlist is unchanged.
- **Hard Rules 3 and 11.** `attest/no-act` and its scopes are unchanged, with no `eslint-disable` in the 151 files. The only `.click()` is the options page's own download link, and every `.focus()` lands on Attest's own controls. `chrome.tabs.create` has three call sites:
  - the auto-check: only `AUTO_CHECK_URL`, and only with the flag on and the Gmail reader on;
  - the alert click's fallback: an extension page from `runtime.getURL`;
  - the popup's digest link: also an extension page.

  There is no `tabs.update`, `executeScript` or `insertCSS` in the source or the bundle. The readers are registered top frame only, in the isolated world, on exactly the two observer hosts.
- **The bus.**
  - The six new page commands are strict Zod schemas. `send()` parses each before it leaves, `listen()` parses it on arrival, and each answer is parsed at both ends.
  - `EXTENSION_PAGE_ONLY` lists all seven page commands, and `listen.ts:215` checks it before any handler runs. The committed tests prove the drop for `claims.import`, `receipt.event` and `grant.save`. The four setting commands go through that same line.
  - `flag.set` refuses every flag but `ATTEST_AUTO_CHECK_GMAIL`.
  - Storage reads fail closed (probe `flags-parse.mts`):
    - an unknown key, a string, a list or null reads as every flag off;
    - a readers' choice that is not a list reads as every reader off;
    - the alert's open request opens only a ULID, from `storage.session`, which content scripts cannot read by default.
  - A `ledger.changed` from a content script would only make a page read again.
- **Hard Rule 4.** The core changed only to add `finalFrom`. It is computed from the claim, the policy and the offset of `evaluatedAt`, with no clock, and replay compares it. A mute lives in meta, outside the grant, so it changes no hash and no grade.
- **Hard Rules 8 and 9.**
  - Permissions: storage, alarms, scripting and notifications, plus sidePanel from the build; optional idle; the two observer hosts.
  - `scripting` and `notifications` are justified in Decisions [4.5] and [4.6]. `offscreen` and `tabs` are not asked for.
  - There is no `externally_connectable`, `web_accessible_resources`, `webRequest` or `declarativeNetRequest`.
  - The CSP is unchanged, and the two new entries import `src/setup.ts` first.
- **Hard Rule 10.**
  - The new LOG_EVENTS and LOG_VALUES are constants.
  - The new log calls carry ids, codes, counts, enum values and instants.
  - A mark's reason is never logged (`user-events.ts:32-36`), and `log.ts` reduces every error to its name, code and message length.
- **Dependencies.** `pnpm audit --prod`: "No known vulnerabilities found". The one new dependency, @axe-core/playwright 4.13.0, is logged in Decisions [4.1]. It is dev-only, used by tests and never bundled.

## Gaps

| #      | Sev    | Rule      | Where                                                                                                                                 | Gap                                                                                                                     |
| ------ | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| SEC-1  | HIGH   | HR2       | extension/src/ledger/domain.ts:9-16; extension/src/adapters/claims.ts:143, :159; extension/src/ui/receipt-share.ts:36; extension/src/ledger/digest.ts:85 | A name written with a dot passes for a domain, so a share and the weekly digest show it as one                           |
| SEC-2  | MEDIUM | HR11, HR3 | extension/src/background/auto-check.ts:68-80, :112-117                                                                                | Check Gmail for me opens Gmail "in front of you" without checking anyone is: Chrome in the background, the screen locked |
| SEC-3  | MEDIUM | HR11, HR1 | extension/src/background/flags.ts:21-39; extension/src/background/readers.ts:66-76                                                     | The consent flags and the readers' choice live in `chrome.storage.local`, which Attest's own content scripts can write  |
| SEC-4  | MEDIUM | HR5, HR6  | extension/src/ui/digest-labels.ts:70-77                                                                                               | The digest notification says "Nothing to look at" for a week Attest could not check                                    |
| SEC-5  | LOW    | HR1       | extension/tests/e2e/support/test.ts:29; extension/tests/e2e/support/session.ts:26                                                     | The dead proxy covers vendor sessions only; the shared fixture and six more specs launch Chromium without it            |
| SEC-6  | LOW    | HR2, HR11 | extension/src/background/settings.ts:52-66; extension/entrypoints/options/components/DeleteAllConfirm.tsx:25-28                       | Delete all data leaves alerts on screen and turns back on a reader the person turned off, without saying so first      |
| SEC-7  | LOW    | HR2       | extension/src/ledger/retention.ts:302-308                                                                                             | A digest keeps hints and domains up to 7 days past the retention window, and one that fails its schema is never purged |
| SEC-8  | LOW    | HR3       | extension/eslint-rules/fences.js:14                                                                                                   | Nothing stops a future `executeScript` from the service worker, which the new `scripting` permission makes possible    |
| SEC-9  | LOW    | HR6, HR10 | extension/src/background/auto-check.ts:73-75; extension/src/background/alerts.ts:126                                                   | Two new catches drop the error without a log line                                                                       |
| SEC-10 | LOW    | HR8, HR11 | PRIVACY.md:27, :78, :82, :86-90                                                                                                       | PRIVACY.md was not updated for Sprint 4                                                                                 |

### SEC-1 (HIGH): a name with a dot passes for a domain

**What happens.** The receipt's share and the weekly digest reduce a counterparty to its domain with one function, `domainOf` (`domain.ts:9-16`). It takes what follows the last `@`, or the whole value when there is no `@`, and keeps it when it looks like `label.label`.

A pasted claim's counterparty is an address or a person's name (`counterpartyOf`, `claims.ts:151-162`). A name word may hold dots (`NAME_WORD`, `claims.ts:143`), and only a trailing dot is cut (`claims.ts:159`). So "I sent an email to A.Kumar" keeps the counterparty "A.Kumar", and `domainOf` returns "a.kumar". The value then goes:

- into the receipt's share (`receipt-share.ts:36`);
- into the stored digest as the notable receipt's `domain` (`src/ledger/digest.ts:85`). The schema accepts any one line there (`src/ledger/types.ts:179`). From there it goes into the digest's share.

Both shares end with "Counterparties are shown by domain only". The panel above each says "counterparties by domain only" (`ShareReceipt.tsx:26`, `ShareDigest.tsx:32`).

**Evidence.**

- Probe `domain-name.mts` runs `readPastedLog` on a Muse-style log. "A.Kumar" gives "a.kumar", and "Mr.Smith" gives "mr.smith". "Priya Shah" gives no domain, which is right.
- Probe `tests/unit/zprobe/digest-name.spec.ts` (vitest, fake IndexedDB, the repository's own fixtures) stores a FINAL NOT_FOUND receipt for that claim. The stored digest's notable entry holds `"domain":"a.kumar"`. The digest's share line is "- Not found: Muse — Email sent, 6 Oct 2026, 09:00, a\.kumar, “invoice”", and the receipt's share line says the same.
- Why the tests miss it:
  - The golden-scenario redaction test judges each share with `domainOf` itself (`tests/unit/ui/receipt-share.spec.ts:34`), so a wrong domain looks right.
  - The no-leak test checks only that the digest's share holds no `@` (`no-leak.spec.ts:357`).
  - The receipt's share is not a no-leak channel at all.
- A related promise is broken too. A subject hint may hold an address or a name, and a share prints the hint as it is. In probe `hint-address.mts`, a claim "about "Contract for sam.lee@partner.example"" is shared as "“Contract for sam\.lee@partner\.example”". The sprint allows the hint. But docs/privacy-architecture.md:327 and :404 say a digest and a share never hold an address or a name.

**Why it matters.** The share is made to be copied to someone else. Hard Rule 2 and the Sprint 4 gate allow a counterparty in it only as its domain. A person's initial and surname is not a domain, and the share tells the person it was reduced to one. The preview shows the text, but it presents the name as a domain, so the person has no reason to remove it.

**Fix.**

- Reduce a counterparty to a domain only from an address: no `@`, no domain. A merchant can keep the domain test (`amazon.com`), since it is not a person.
- Give `NotableReceipt.domain` a domain's shape, so a stored digest cannot hold anything else.
- Decide the hints, and log it in Decisions.md: either a share writes any address inside a hint as its domain, or the two docs stop saying "never an address or a name".
- Tests:
  - "A.Kumar", "Mr.Smith" and "J.Doe" give no domain.
  - The golden redaction test uses a fixed oracle, not `domainOf`.
  - The no-leak paste includes a dotted name.
  - The receipt's share becomes a no-leak channel.

### SEC-2 (MEDIUM): "in front of you" is never checked

**What happens.** With Check Gmail for me on, a grading batch (every 5 minutes) can open `AUTO_CHECK_URL` in a pinned, active tab in "the window the person last used" (`auto-check.ts:68-80`, `:112-117`). The only window it refuses is a minimised one. It never asks whether that window has the focus, or whether anyone is at the computer.

The promises are firmer. The toggle says "one tab, pinned and in front of you, never in the background" (`AutoCheckToggle.tsx:47-52`). docs/privacy-architecture.md:54 says "never in the background".

**Evidence.** Probe `autocheck-visible.mts` runs the shipped `BROWSER_AUTO_CHECK.visibleWindow` over a fake `windows.getLastFocused`:

- a focused window gets the tab;
- a window that is not focused gets it too: another app is in front, or the person is in an incognito window, which Attest cannot see;
- a window behind a locked screen gets it;
- only a minimised window is refused.

The unit tests replace `visibleWindow` with a fake (`auto-check.spec.ts:60`), so this logic has no unit test of its own.

**Why it matters.** Hard Rule 11 lets Attest open a vendor page itself only in a pinned, visible tab. The trigger is a timer, 15 minutes after a paste, so the person has often moved on: to another app, away from the desk, or behind a locked screen. The Gmail reader then reads the Sent folder with nobody watching. That is the background read the rule exists to prevent. And when someone is working in Chrome, the new active tab takes the keyboard from whatever they are typing.

**Fix.** This needs a founder decision, logged in Decisions.md. Either:

- open only when `getLastFocused` reports `focused: true` and the window is not minimised, and, while the optional `idle` permission is held, only when `idle.queryState` says `active`; otherwise wait for the next batch;
- or, better, show a notification ("Attest can check 1 email in your Gmail Sent folder") and open the tab when the person clicks it. The tab is then visible by construction, and it never takes the keyboard mid-sentence.

Test `visibleWindow` itself: a window that is not focused gets no tab.

### SEC-3 (MEDIUM): consent kept where content scripts can write it

**What happens.** Two consent choices live in `chrome.storage.local`:

- `attest.flags`, the flag that turns on Check Gmail for me;
- `attest.readersOff`, the readers the person turned off.

Chrome exposes `storage.local` to content scripts by default. The typings of `StorageArea.setAccessLevel` say `local` storage allows "access from both trusted and untrusted contexts". The bus refuses `flag.set` and `reader.toggle` from a content script (`listen.ts:91-100`). Nothing stops a content script from writing the keys directly.

The service worker trusts what it reads. `readFlags` accepts every flag in `FEATURE_FLAGS`, not only `SETTABLE_FLAGS` (`flags.ts:21-39`). In probe `flags-parse.mts`, a stored `{ ATTEST_TELEMETRY: true }`, which no page can set, reads as on.

**Why it matters.** Attest's Gmail and Calendar readers run inside the vendor page's renderer process. Chrome's guidance treats that context as untrusted, and so does this project's own bus: a compromised renderer acts with the content script's rights. Through these keys it can:

- turn on Check Gmail for me without the person (Hard Rule 11);
- turn back on a reader the person turned off.

The same record is meant to hold `ATTEST_TELEMETRY` (`config.ts:98-108`). Once Sprint 5 reads it, the same write turns on telemetry without consent (Hard Rule 1). Decisions [4.9] says no page can turn on telemetry or the model through `flag.set`. That is true of the bus only.

It is MEDIUM, not HIGH, for two reasons. The attacker needs code running in the vendor page's renderer. And telemetry is not built yet.

**Fix.**

- At every start of the service worker, call `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`. No content script uses storage today. Verify that Chrome 120, the minimum version, accepts it for `local`. If it does not, keep the flags and the readers' choice in ledger meta, since content scripts cannot open the extension's IndexedDB.
- Read only the `SETTABLE_FLAGS` from storage. Every other flag stays at its default until its feature ships and joins that list.
- Tests:
  - a stored flag outside `SETTABLE_FLAGS` reads as off (unit);
  - a content script cannot write the key (end to end).
- Fix this before Sprint 5's telemetry reads the record.

### SEC-4 (MEDIUM): "Nothing to look at" for a week nobody checked

**What happens.** Each Monday the service worker shows "Your weekly digest" (`src/background/digest.ts:56-64`), worded by `digestReadyText` (`src/ui/digest-labels.ts:70-77`). The wording counts only the notable receipts. With none, it says "Nothing to look at: no receipt ended Not found, Unasked or Over scope." The digest holds three other facts, and the wording reads none of them:

- the week's coverage gaps;
- its Unverifiable receipts;
- a DEGRADED reader.

**Evidence.** Probe `digest-ready.mts` builds a digest of a bad week:

- 12 Unverifiable receipts;
- Gmail Sent and Calendar not checked all week;
- the Gmail reader DEGRADED.

The notification reads "Week of 5 Oct 2026: Nothing to look at: no receipt ended Not found, Unasked or Over scope."

**Why it matters.** Hard Rule 5 says Attest must never say "all clear" about something it could not see. This line reaches the person without opening anything, and it shows on the lock screen too. It also hides a broken reader (Hard Rule 6). The copy test bans "all clear" and "nothing to worry", but not "nothing to look at". The digest page lists the gaps under its notable receipts, so the page is honest. The notification is not.

**Fix.**

- Say what the week holds, for example: "12 claims could not be checked. Gmail Sent was not checked all week. The Gmail reader needs repair."
- Use "Nothing to look at" only when there are no gaps, no Unverifiable receipts and no degraded reader, or drop the phrase.
- Add the phrase to the copy test's list.
- Test the notification for a week with gaps.

### SEC-5 (LOW): the dead proxy covers some launches, not all

**What happens.** In Sprint 4, an extension-created tab reached the real mail.google.com in a test run. Every vendor session now runs behind the dead proxy (`session.ts:26`). But the proxy is passed by that helper and the two mandatory specs only. `launchExtension`'s default has none. These launch without it:

- the shared `attest` fixture (`support/test.ts:29`), used by options, options-reset, popup, smoke, ui-components and worker-lifecycle;
- a11y.spec.ts:129, observer-offline.spec.ts:68, observer-restart.spec.ts:43, observer-startup-event.spec.ts:41, no-input-events.spec.ts:59, worker-lifecycle.spec.ts:208 and :217.

Four of these specs open Gmail or Calendar addresses with the route guard as their only layer: observer-offline, observer-restart, observer-startup-event and no-input-events. The route guard is the layer that missed the auto-check's tab. In every one of these launches, Chromium's own requests reach the internet: accounts.google.com, update.googleapis.com and the rest of `CHROMIUM_BACKGROUND_HOSTS`.

**Why it matters.** Today no spec in these files opens a tab through the extension, and their profiles are empty, so nothing personal can leave. But the Progress Log [4.9] line "The end-to-end tests can no longer reach the internet" holds only for the specs that use the session helper. The next test in the shared fixture that turns the auto-check on, or clicks an alert, reaches the real host again.

**Fix.**

- Make the dead proxy `launchExtension`'s default for every launch. Add an option to turn it off for a test that truly needs the network; none does today.
- Assert in the launcher that the proxy argument is present.

### SEC-6 (LOW): what Delete all data leaves behind

**What happens.** `onLedgerWipe` deletes the IndexedDB database and clears `chrome.storage.local` (`settings.ts:52-66`). It leaves three things.

- **Notifications.** Every alert and digest notice the operating system still shows. On macOS and Windows they stay in the notification centre until dismissed. Each names a grade, an agent, an action and its time. A click opens the side panel on a receipt that no longer exists.
- **Session storage.** `chrome.storage.session` keeps `attest.openReceipt` (a receipt id) and `attest.idleSession` until the browser closes.
- **The readers' choice.** `attest.readersOff` is cleared with the rest of `storage.local`, so a reader the person turned off comes back on. The confirmation asks "Delete every receipt, claim and fact Attest keeps in this browser, its grants and its settings?" (`DeleteAllConfirm.tsx:25-28`). It says nothing about reading Gmail again. Only the line shown after the delete says Attest "reads pages you open from now on".

docs/privacy-architecture.md:372 says "No copy is kept anywhere".

**Fix.**

- In the wipe, clear Attest's notifications (`notifications.getAll`, then `clear` each) and `storage.session`.
- Keep the readers' choice across a wipe, since it is a choice and not data. Or say before the confirm that every reader comes back on.
- Extend the wipe's unit test to notifications and session storage.

### SEC-7 (LOW): digests outlive the receipts they copy

**What happens.** A digest copies each notable receipt's domain and subject hint. The purge deletes a digest once its week ended before the cutoff (`retention.ts:302-308`). So the copy outlives the receipt by up to 7 days.

`purgeDigests` also reads the table through `readRows`, which skips a row that fails its schema. Such a row is never deleted.

**Evidence.** Probe `tests/unit/zprobe/digest-retention.spec.ts` (fake IndexedDB, a 30-day window):

- A receipt graded on Monday 5 October at 01:00 is purged at +31 days.
- The digest of its week, holding "company.example" and "Q3 review", stays until +37 days.
- An old digest row with one unknown field is still there at +38 days, and after every later purge.

**Why it matters.** The person chooses 30, 90 or 180 days. PRIVACY.md says facts are deleted once they are that old. And a later schema change that makes old digests fail their read would keep every one of them for good.

**Fix.**

- Delete a digest once its week started before the cutoff. It then goes up to 7 days early, which errs toward keeping less.
- Delete by key range on the week key, without parsing, so a row that cannot be read still goes.
- Test both.

### SEC-8 (LOW): no guard on the service worker's new reach into vendor tabs

**What happens.** `scripting` (4.5) lets the service worker run code in any Gmail or Calendar tab (`scripting.executeScript`, `insertCSS`). `attest/no-act` covers content scripts, adapters and observers only (`fences.js:14`), not `src/background`. No lint rule or test limits either of these:

- `scripting` to the four registration calls in `readers.ts`;
- `tabs.create` to the three known call sites.

Decisions [4.5] says Attest uses `scripting` "for nothing else". Today that is true, but only by reading: no call exists in the source or the bundle.

**Why it matters.** Before 4.5 the extension could not inject code into a vendor tab at all. Now one line in the service worker could click in Gmail, and no check would fail (Hard Rule 3). It is LOW because nothing calls it.

**Fix.**

- Add a lint rule or a source test that allows `scripting.*` only in `src/background/readers.ts`, and only the registration methods.
- Have the same rule allow `tabs.create` only with an extension URL or `AUTO_CHECK_URL`.
- Add a bundle check that finds no `executeScript` and no `insertCSS`.

### SEC-9 (LOW): catches with no log line

- `auto-check.ts:73-75`: a failing `windows.getLastFocused` is swallowed. The check then logs `autocheck.no_window`, which says no window was open: something else.
- `alerts.ts:126`: when Chrome refuses to open the side panel, the error is dropped and a tab opens instead. Nothing records that the side panel failed.

**Fix.** Add a `log.warn` with the error to both, with new events in LOG_EVENTS (for example `autocheck.window_failed`, `alerts.side_panel_failed`).

### SEC-10 (LOW): PRIVACY.md was not updated for Sprint 4

PRIVACY.md is version 0.3 and says it "Applies to Attest 0.0.1". It is unchanged since Sprint 3. At efefaa0, version 0.0.1 already does several things the policy says only a later version will do, or does not mention at all.

- **Permissions** (`:86-90`): the policy lists storage, alarms and side panel. The build also asks for `scripting` and `notifications`.
- **Check Gmail for me** (`:27`): the policy says "it is described here in full before it ships". It shipped in 4.9. Only docs/privacy-architecture.md and the toggle describe it.
- **Retention** (`:78`): "A later version lets you choose 30, 90 or 180 days." That shipped in 4.5.
- **Deleting your data** (`:82`): "A later version adds a button there to delete all Attest data without uninstalling, and an export of the receipts as JSON or CSV." Both shipped in 4.5.
- **Not mentioned at all:**
  - alerts shown by the operating system, the lock screen included;
  - the weekly digest, which keeps copies of hints and domains;
  - shares;
  - the readers' on/off choice.

**Fix.**

- Publish version 0.4 before the sprint closes.
- Add a doc test that PRIVACY.md's permission list equals the manifest's.

## Checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Network grep finds only telemetry | PASS | `git grep` at efefaa0 over `src` and `entrypoints`, the checklist's pattern plus `EventSource` and `importScripts`: no match. Telemetry is not written yet. |
| Network-intercept E2E, allowlist empty | PASS | `scratchpad/s4runs/e2e.txt` (efefaa0, 20:28): the allowlist test passed. The 5-minute session made 0 attributed requests and no violations. The negative control caught 4 of 4. All five @mandatory tests passed; 72 passed in 8.7 min. The harness's limits are SEC-5. |
| No remote img, fonts or CDN | PASS | Every built page loads only `/chunks` and `/assets`. The CSS is Tailwind and the tokens. The share's image uses `system-ui` fonts. |
| No externally_connectable, webRequest or DNR | PASS | Built manifest (20:29, HEAD). |
| Every Observation and Claim goes through redact | PASS | No new observation or claim path. The readers changed only to `registration: 'runtime'`. |
| Policy allowlist unchanged | PASS | `git diff fc5cefe efefaa0 -- policy/` is empty. |
| Secret-seed E2E | PASS | no-leak passed with the digest's share as a channel, and so did its negative control. Its share check looks only for `@`, and the receipt's share is not a channel: SEC-1. |
| Length caps | PASS | A digest's hint is capped at 80 and its domain at 320. A mark's reason is capped at 120 and is never shared. |
| Export and share use the redacted projection | GAP | Export: strict rows only; the CSV has no hints and no reasons. Share: SEC-1. |
| no-act lint, zero disables | PASS | No `eslint-disable` in the 151 files. The lint was clean at 4.10 (`scratchpad/lint-4.10.txt`). The service worker's new reach is SEC-8. |
| No click, submit, dispatch, value or focus on vendor DOM | PASS | Only Attest's own elements: `export-ledger.ts:43`, `DeleteAllControl.tsx:37-38`, `ReceiptDetailPanel.tsx:41`, `use-list-end.ts:33`. |
| No tabs.create or tabs.update on a vendor host except the auto-check | PASS | Three create sites; only the auto-check opens a vendor page. No `tabs.update`. When the tab opens is SEC-2. |
| No executeScript with string code | PASS | No `executeScript` at all, in the source or the bundle. SEC-8. |
| Permissions ⊆ allowed set | PASS | storage, alarms, notifications, sidePanel; `scripting` is justified in Decisions [4.5]; optional idle. |
| host_permissions exact | PASS | Gmail and Calendar only. |
| Optional permission in a gesture, explained | PASS | Unchanged (idle). |
| CSP | PASS | `script-src 'self'; object-src 'none'`, unchanged. |
| No remote code | PASS | Two dynamic `import()` calls of local modules (`data.ts:115`, `:156`), bundled as chunks under `'self'`. |
| Page text never a selector, type, key or instruction | PASS | The new paths read no page text. Hints are escaped in markdown and drawn as plain text. |
| Model input | N/A | Sprint 5. |
| Bus messages Zod-parsed; unknown dropped and logged | PASS | Both ends, every new message and answer. |
| Stored data parsed on read | PASS | `views.ts`, `detail.ts`, `alerts.ts`, `digest.ts`, `auto-check-record.ts`, `settings.ts`. The flags and the readers' choice fail closed. The purge's exception is SEC-7. |
| Text nodes only | PASS | No `innerHTML`, `dangerouslySetInnerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` in the 151 files. |
| Dexie version bump, migration tested | PASS | v8 (indexes), v9 (`alerts`), v10 (`digests`); `migrations-v8.spec.ts`, `migrations-v9.spec.ts`. |
| Encryption | N/A | Not built. |
| Wipe clears IndexedDB and storage.local, tested | GAP | Both are cleared, and Decisions [4.5] cites the unit and e2e tests. What is left behind is SEC-6. |
| Install id | PASS | Unchanged; the wipe clears it. |
| log.ts only, no PII | PASS | No `console.` in the 151 files. Note: the committed trace `bench/traces/popup-paint.zip` holds no page data (synthetic receipts, no network, no snapshot), but it records the absolute paths of the build and the test profile on the founder's machine, his home directory included, which a public repository then carries. |
| No bare catch; every catch logs | GAP | SEC-9. |
| Telemetry-api | N/A | Not touched. |
| `pnpm audit --prod` | PASS | "No known vulnerabilities found". |
| New dependency logged | PASS | @axe-core/playwright, Decisions [4.1]. |
| Vendor terms | PASS | No adapter changed. The auto-check is the spec's documented Hard Rule 11 exception. |

## Probes (scratch, not committed)

All in `scratchpad/s4sec/`, under an isolated copy of efefaa0 (`tree/`), with the shared `node_modules` linked read-only. Each runs the repository's own modules and prints grades, instants, counts and invented values only.

- `probes/domain-name.mts`: `readPastedLog`, `domainOf` and the receipt's share on dotted names (SEC-1).
- `tests/unit/zprobe/digest-name.spec.ts`: `buildDigest` over fake IndexedDB, then both shares (SEC-1).
- `probes/hint-address.mts`: an address inside a subject hint, shared (SEC-1).
- `probes/autocheck-visible.mts`: the shipped `visibleWindow` over four windows (SEC-2).
- `probes/flags-parse.mts`: `readFlags` and `readersOff` over odd stored values (SEC-3; the fail-closed reads held).
- `probes/digest-ready.mts`: the ready notification for a week nothing checked (SEC-4).
- `tests/unit/zprobe/digest-retention.spec.ts`: the purge at a 30-day window (SEC-7).
- `probes/csv-cells.mts`: CSV cells that start a formula, and the share's markdown escapes (held).

## Commands run

- `git log --oneline fc5cefe..efefaa0` (14 commits). `git diff --stat fc5cefe efefaa0` (272 files; 151 under `extension/src` and `extension/entrypoints`).
- `git grep -n "fetch(\|XMLHttpRequest\|navigator.sendBeacon\|WebSocket\|EventSource\|importScripts" efefaa0 -- src entrypoints` (from `extension/`): no match.
- Over the 151 files: greps for each of these, with the results reported above:
  - HTML sinks;
  - `target=` and `rel=`;
  - the clipboard;
  - `eval(`, `new Function` and `import(`;
  - `console.` and `eslint-disable`;
  - `.click()`, `.submit()`, `dispatchEvent`, `.focus()` and `.value =`;
  - `tabs.*`, `windows.*` and `scripting.*`;
  - every `catch`.
- `extension/.output/chrome-mv3`, the 20:29 build of HEAD:
  - the manifest, printed;
  - every script, grepped for network APIs, `eval`, the Function constructor, `executeScript` and `insertCSS`: none;
  - every page, checked for inline scripts: none.
- `pnpm audit --prod` (repository root): "No known vulnerabilities found".
- Logs read, not rerun:
  - the efefaa0 e2e run: `scratchpad/s4runs/e2e.txt`, 72 passed;
  - the 4.10 lint and unit runs: `scratchpad/lint-4.10.txt`, and `unit-4.10.txt` with 10,492 passed.
- The eight probes above: tsx for the six scripts, `vitest run` for the two specs, in the scratch copy.
- `unzip` of `bench/traces/popup-paint.zip`, into scratch, to inspect it.
