# MANUAL.md — things only Poojan can do

The agent appends here whenever a task is `BLOCKED(MANUAL)`. Each item: what, where, why, and which sprint task it unblocks. Tick when done and tell the agent "done: <item>" so it can un-block the task.

## Before Sprint 0
- [x] Create the GitHub repo `Poojan6216/attest`. Done 2026-10-01: founder said "create the repo"; the agent created it public with `gh repo create` and pushed `main`: https://github.com/Poojan6216/attest
- [x] Install Node 22 + pnpm on the Mac. Done 2026-10-01: Node 22.14.0 was present; the agent installed pnpm 10.34.6 into `~/.local/bin`.

## Sprint 0 close
- [x] **Done by the agent 2026-10-01 (run 36943492956 green).** **Push and confirm CI is green (QA-1, TECH-1).** After the integrator commits the sprint-0 close: `git push origin main`, then `gh run list --limit 1` until the newest run shows `completed success` for the pushed commit. If "Upload build" fails again, send the agent the output of `gh run view <id> --log-failed`. Unblocks the Sprint 0 Gate ("CI green").
- [x] **Done by the agent 2026-10-01 (PR #3, run 36943566697 red at E2E @mandatory).** **Prove a broken mandatory test turns a PR red (QA-5, task 0.11 Done-when).** Once main is green, on a throwaway branch: (1) `git switch -c chore/mandatory-red-proof`; (2) in `extension/entrypoints/background.ts` add `void fetch('https://example.com/');` as the first line inside `main()`; (3) because the new lint fence would stop the run at Lint before the E2E step, in `.github/workflows/ci.yml` on this branch only change the Lint step's `run: pnpm lint` to `run: echo lint skipped on the proof branch`; (4) `git commit --no-verify -am "test: prove the mandatory gate goes red"`, `git push -u origin chore/mandatory-red-proof`, `gh pr create --draft --fill`. Expected: the PR's run is red, failing at `E2E (@mandatory)` with `violations: ["example.com"]` (an earlier red step also makes the PR red; send the agent the log either way). Paste the run URL to the agent (it records it in Decisions.md), then `gh pr close --delete-branch` and `git switch main`.
- [ ] **Protect `main` (SECURITY-V6).** GitHub only offers branch protection and rulesets on a private repo with GitHub Pro (about $4/month) or once the repo is public. When either is true: Settings → Rules → Rulesets → New branch ruleset → target `main` → enable "Require status checks to pass" with the check `lint · typecheck · unit · build · e2e`, enable "Block force pushes", save. Until then nothing on GitHub stops a red @mandatory test from landing; the gate is the sprint process, CI on every push, and a local pre-push hook (`scripts/pre-push.sh`) that runs `pnpm test` on the commit each pushed branch or tag points to, in a temporary worktree, so uncommitted files neither block nor pass a push. **Recommended default: leave this as is while the repo is private and you are the only committer.** Optional, any time: buy GitHub Pro, or decide this together with the license and visibility choice before launch.

## Sprint 1 close
- [ ] Push `main` to GitHub (`git push origin main` from the repo root), then check the Actions tab: CI must be green, including the new steps "Core coverage" (`pnpm test:coverage`) and "Core under the runtime guard" (`pnpm test:poison`). The agent cannot push from here. ~1 minute. **Still to do as of 2026-10-07:** 10 commits of the real-capture work wait on your Mac, the whole gate green on them (`reviews/sprint_2/closed.md`, "The gate, on the re-closed tree"); the agent's own push is blocked by its safety settings.

## During Sprint 2 (observers)
- [x] **Done 2026-10-06** (the founder signed in; the agent drove the capture Chrome): 8 Gmail pages in `extension/tests/fixtures/pages/gmail/2026-10-06/`, labelled: `sent-list-1`, `sent-list-2`, `sent-list-last`, `second-account-sent`, `drafts`, `inbox`, `sent-thread`, `sent-thread-with-reply`. The four receipt pages captured the same day were held out of the repository: the security re-review found your address inside Uber's compressed click links, trip addresses in map links, names and order numbers in the bodies, and the "Amazon" page was a birthday gift-card email (Decisions.md `[2.close-r2]`). They were never pushed. Your mail holds no Facebook Marketplace or OpenTable message; the synthetic pages cover those parsers.
- [ ] **Eight receipt captures, each read by you before the agent labels it** (about 20 minutes; they complete task 2.1, which needs 12 real Gmail pages, and give the receipt parsers real pages). Start the capture Chrome as in `docs/adapters.md` §6.1 and sign in. For each name below, search Gmail for the query, open the newest match, then run from `extension/` (put your own name after `--names`; the sanitiser now cuts other sites' link paths, phone links and card endings by itself):
  ```sh
  pnpm capture --vendor gmail --name <name> --tab mail.google.com/mail/u/0/ --names "<Your Name>" \
    --redact-selector '.at' --redact-selector '.iA.g6' --redact-selector '[data-legacy-last-message-id]' \
    --redact-selector 'span.y2' --redact-selector 'div.afn' --redact-selector 'div.brd' --redact-selector '[role="tab"] .aKs' \
    --keep-selector 'h2[data-legacy-thread-id]' --keep-selector '.a3s' --keep-selector 'span.g3' --keep-selector 'td.xW'
  ```
  - `receipt-stripe`: search `from:stripe.com subject:receipt`
  - `receipt-instacart`: search `from:instacart.com subject:receipt`
  - `receipt-uber`: search `from:uber.com subject:trip`
  - `receipt-amazon`: search `from:amazon.com subject:shipped` (a shipping notice; not a gift card)
  - `receipt-shopify`: search `from:shopifyemail.com subject:(order OR receipt)`
  - `receipt-generic-order`: search `subject:"order confirmation"` and open one that is not from Amazon, Uber, Instacart or Stripe
  - `newsletter-prices-1` and `newsletter-prices-2`: search `category:promotions sale`, open two different newsletters that show prices
  Before you tell the agent, open each file from the fixture server (`docs/adapters.md` §6.3) and read it top to bottom: a receipt body keeps the merchant's text (what you bought, a driver's or shopper's first name, an order number) unless you add `--names` or `--redact-selector`; re-capture with `--force` if anything personal is left. Then tell the agent "done: receipt captures"; it labels them and runs the deep leak test before any commit.
  Then quit the capture Chrome (⌘Q): its debugging port lets other programs on the Mac control it (it is still open from 2026-10-06; quit it now if you are not capturing). If a search finds nothing, skip that name and say which.
- [x] **Done 2026-10-06**: 9 Google Calendar pages in `extension/tests/fixtures/pages/gcal/2026-10-06/`, labelled (task 2.4): `week-before`, `week-list-not-loaded`, `week-after`, `week-edited`, `week-deleted` (the test event "Attest test", created, moved and deleted by the agent; no guests), `month`, `second-calendar-on`, `second-calendar-off`, `week-other-calendar`.
- [ ] **Capture an invitation week** (`week-invited`, about 5 minutes; for re-enabling Calendar UNASKED, task 2.8): from your second Google account, create an event this week and invite your main account. In the capture Chrome, open the main account's Calendar week view, click that event so its details show, and run from `extension/`: `pnpm capture --vendor gcal --name week-invited --tab calendar.google.com --names "<Your Name>"`. Delete the event afterwards and quit the capture Chrome (⌘Q).
- [ ] Live smoke (task 2.8), about 20 minutes. You do the steps; the agent reads the three exported files (times, shapes and health only, never your email or event text); you check the few things that need the text yourself (step 9). Unblocks 2.8 and the Sprint 2 gate.
  - Setup: run `pnpm build`, then in Chrome open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose `extension/.output/chrome-mv3/`. Use your normal Chrome profile, not incognito (Attest does not run in incognito).
  - Steps, in order:
    1. Open Gmail → Sent and leave it for 2 minutes. Move the mouse slowly over a few rows for 10 seconds, then scroll down one page.
    2. Send an email to yourself and click "Undo" in the bar that appears. Then schedule one to yourself for tomorrow (the arrow next to Send → Schedule send).
    3. Open one email you sent, then two receipt emails you have (any shop or service).
    4. Click Drafts, then Inbox, for a few seconds each.
    5. Open Google Calendar in week view and leave it for 2 minutes. Create an event called "Attest test" with a second address as a guest, wait 2 minutes, move it to another time, wait 2 minutes, then delete it.
    6. With both tabs still open, send an email and create a calendar event from your phone, and note the time.
    7. Turn Wi-Fi off with both tabs open. After 1 minute, open Attest's options page (right-click the Attest icon → Options), click "Export ledger" and keep the file (file 1). After 2 more minutes, turn Wi-Fi back on.
    8. Close the laptop lid for 5 minutes. Open it and, within 30 seconds, click "Export ledger" again (file 2).
    9. Wait 2 minutes and click "Export ledger" once more (file 3). Open file 3 in a text editor and check three things: it holds no email body text; every `subjectHint` is just a subject line (no preview text, no attachment names); and no Calendar `subjectHint` is a place. Then tell the agent "smoke done", where the three files are, and what you saw in this step.
  - What the agent checks in the three files (the review items QA-9, QA-V2, SEC-1, SEC-10, SEC-12): every observer's health is OK, or its DEGRADED reasons name what broke; Gmail times match your time zone and each recipient is an address; neither the undone nor the scheduled email is a Sent row; no DEGRADED reason appeared while you moved the mouse over rows; how long the phone's email and event took to appear (each row's first sighting against the time you noted); no coverage was written while Wi-Fi was off or within 30 seconds of waking (the `lastSyncAt` values of files 1 and 2) and coverage resumed afterwards (file 3); the "Attest test" event's creation, move and deletion rows, each with its first-look marker, and its guest kept as one address plus fingerprints; and the "loading" markers cleared (no `page.busy`).
  - Already read from the captures of 2026-10-06 (Decisions.md): Gmail's older-page arrow is disabled only on the last Sent page; the account label ends with the address in brackets, and a second account's label carries a note after it; every event from June to October reads "Accepted" except the one the account created itself, which has no reply word. Still to read: what an event you organise with a guest reads (step 5 above) and an invitation from another person (`week-invited`), so Calendar UNASKED can come back for events you organise on your own calendars; whether a Calendar label lists guests as addresses; the account label in another display language (optional); and the longest subject Gmail draws.
  - Not measured by this smoke (carried to Sprint 6.4): how often each tab is read and how long a read takes on real pages, and whether hovering rows still starts reads.
  - Each answer is recorded in Decisions.md with the selector versions, and any difference becomes a fix with a new fixture.

## During Sprint 3 (agent adapters)
- [ ] Confirm the Muse web app host (the URL in your browser when using Muse on the web). Unblocks 3.0 host permission.
- [ ] Capture Muse fixtures: a conversation with ≥ 5 turns where Muse claims actions, the activity/audit view, the permissions/connected-apps settings page, an approval prompt. Unblocks 3.1 → 3.2.
- [ ] Capture ChatGPT agent-mode fixtures (conversation + activity view + connected apps settings). Unblocks 3.3.
- [ ] **Dots:** get Pro-tier access, then capture the Dots Activity View + a Dots conversation + settings. Until then the Dots adapter stays flagged and reports DEGRADED(dots_fixture_missing). Unblocks 3.3 Dots section.
- [ ] Capture Claude.ai fixtures: a conversation with connector tool-use entries, the connectors settings page. Unblocks 3.4.
- [ ] Read the terms of Meta (Muse), OpenAI, Anthropic, Google for reading their web UI in your own browser; tell the agent your decision per vendor (ship / ship with notice / ship disabled). Unblocks 3.10.
- [ ] Live smoke on Muse + Claude (+ ChatGPT agent mode) for one real task each; tell the agent "smoke done". Unblocks 3.9.

## During Sprint 5 (telemetry)
- [ ] Create a Railway project + MongoDB, set `MONGO_URL` and `ALLOWED_EXT_IDS` env vars; give the agent the public URL for `config.TELEMETRY_HOST`. Unblocks 5.8 deploy (docker-compose proves it locally meanwhile).

## During Sprint 6
- [ ] Nothing expected. If the privacy pre-review (6.7) returns NOT READY on an item only you can change (e.g., a store account setting), it lands here.

## Sprint 7 (launch)
- [ ] Decide when to make `Poojan6216/attest` public again (it was made private on 2026-10-01 at your request). Needed before 7.2 (GitHub Pages for `PRIVACY.md` on the free plan) and before launch posts that say "read the source". To flip it: `gh repo edit Poojan6216/attest --visibility public --accept-visibility-change-consequences`, or tell the agent "make the repo public".
- [ ] Chrome Web Store developer account ($5 one-time), same Google account as the GitHub Pages owner. Unblocks 7.8 submission.
- [ ] Enable GitHub Pages on the repo (Settings → Pages → main, `/docs` or root) so `PRIVACY.md` has a public URL. Unblocks 7.2.
- [ ] Submit the release zip: upload `.output/attest-0.1.0.zip`, fill the data-usage form from `launch/store-listing.md` (the agent writes the exact answers), add screenshots from `launch/screenshots/`, submit for review.
- [ ] Post, in order, from `launch/launch-checklist.md`: Show HN (Tue–Thu 8–10am ET, then answer comments for 6 hours), Reddit posts (only from an account older than 6 weeks with prior comments), DMs to the incident authors, first weekly X/LinkedIn post.

## After launch (weekly, ~1 hour)
- [ ] One post from `launch/weekly-posts.md`
- [ ] One alert reply from `launch/alerts.md`
- [ ] One selector repair if any adapter shows DEGRADED (agent does the code; you re-capture the fixture)
- [ ] Choose the license before the repo is ever made public again: keep Apache-2.0 (open source; forks may be published), switch to a source-available license (code readable for audit, redistribution forbidden), or proprietary. Any version published under Apache-2.0 stays Apache-2.0 for anyone who copied it, so this must be decided first. Tell the agent the choice; it updates `LICENSE`, `package.json`, the README and the launch copy. Raised by the founder 2026-10-01 (concern: someone republishing a fork).
