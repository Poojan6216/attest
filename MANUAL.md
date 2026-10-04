# MANUAL.md — things only Poojan can do

The agent appends here whenever a task is `BLOCKED(MANUAL)`. Each item: what, where, why, and which sprint task it unblocks. Tick when done and tell the agent "done: <item>" so it can un-block the task.

## Before Sprint 0
- [x] Create the GitHub repo `Poojan6216/attest`. Done 2026-10-01: founder said "create the repo"; the agent created it public with `gh repo create` and pushed `main`: https://github.com/Poojan6216/attest
- [x] Install Node 22 + pnpm on the Mac. Done 2026-10-01: Node 22.14.0 was present; the agent installed pnpm 10.34.6 into `~/.local/bin`.

## Sprint 0 close
- [x] **Done by the agent 2026-10-01 (run 36943492956 green).** **Push and confirm CI is green (QA-1, TECH-1).** After the integrator commits the sprint-0 close: `git push origin main`, then `gh run list --limit 1` until the newest run shows `completed success` for the pushed commit. If "Upload build" fails again, send the agent the output of `gh run view <id> --log-failed`. Unblocks the Sprint 0 Gate ("CI green").
- [x] **Done by the agent 2026-10-01 (PR #3, run 36943566697 red at E2E @mandatory).** **Prove a broken mandatory test turns a PR red (QA-5, task 0.11 Done-when).** Once main is green, on a throwaway branch: (1) `git switch -c chore/mandatory-red-proof`; (2) in `extension/entrypoints/background.ts` add `void fetch('https://example.com/');` as the first line inside `main()`; (3) because the new lint fence would stop the run at Lint before the E2E step, in `.github/workflows/ci.yml` on this branch only change the Lint step's `run: pnpm lint` to `run: echo lint skipped on the proof branch`; (4) `git commit --no-verify -am "test: prove the mandatory gate goes red"`, `git push -u origin chore/mandatory-red-proof`, `gh pr create --draft --fill`. Expected: the PR's run is red, failing at `E2E (@mandatory)` with `violations: ["example.com"]` (an earlier red step also makes the PR red; send the agent the log either way). Paste the run URL to the agent (it records it in Decisions.md), then `gh pr close --delete-branch` and `git switch main`.
- [ ] **Protect `main` (SECURITY-V6).** GitHub only offers branch protection and rulesets on a private repo with GitHub Pro (about $4/month) or once the repo is public. When either is true: Settings → Rules → Rulesets → New branch ruleset → target `main` → enable "Require status checks to pass" with the check `lint · typecheck · unit · build · e2e`, enable "Block force pushes", save. Until then nothing on GitHub stops a red @mandatory test from landing; the gate is the sprint process, CI on every push, and a local pre-push hook that runs the unit suite. **Recommended default: leave this as is while the repo is private and you are the only committer.** Optional, any time: buy GitHub Pro, or decide this together with the license and visibility choice before launch.

## Sprint 1 close
- [ ] Push `main` to GitHub (`git push origin main` from the repo root), then check the Actions tab: CI must be green, including the new steps "Core coverage" (`pnpm test:coverage`) and "Core under the runtime guard" (`pnpm test:poison`). The agent cannot push from here. ~1 minute.

## During Sprint 2 (observers)
- [ ] Capture Gmail fixtures with `pnpm capture --vendor gmail --name <name>` while each page is open in your Chrome (~20 minutes). Names to use: `sent-list-1` and `sent-list-2` (Sent, then scrolled one page), `sent-thread` (an opened sent email), `sent-thread-with-reply` (a sent thread that has a reply), `drafts`, `inbox`, `second-account-sent` (Sent in your other Google account), and one opened receipt each: `receipt-stripe`, `receipt-amazon`, `receipt-marketplace-listing`, `receipt-opentable`, `receipt-instacart`, `receipt-uber`, `receipt-shopify`, `receipt-generic-order`, plus two newsletters that show prices (`newsletter-prices-1`, `newsletter-prices-2`). The agent fills in the expected results afterwards (format: `extension/tests/fixtures/pages/README.md`). Unblocks 2.1 → 2.2, 2.3 on real pages.
- [ ] Capture Google Calendar fixtures with `pnpm capture --vendor gcal --name <name>` (use `gcal`, not `calendar`): `week-before`, then create a test event and capture `week-after`, move it and capture `week-edited`, delete it and capture `week-deleted`, `month` (a month with a '+N more' day), and `second-calendar-on` / `second-calendar-off` (the same week with another calendar ticked and unticked). Unblocks 2.4 → 2.5 on real pages.
- [ ] Live smoke: open your real Gmail Sent and Calendar with the unpacked build for 10 minutes; tell the agent "smoke done". Unblocks 2.8.

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
