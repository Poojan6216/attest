# MANUAL.md — things only Poojan can do

The agent appends here whenever a task is `BLOCKED(MANUAL)`. Each item: what, where, why, and which sprint task it unblocks. Tick when done and tell the agent "done: <item>" so it can un-block the task.

## Before Sprint 0
- [ ] Create the GitHub repo `Poojan6216/attest`, public and empty (checked 2026-10-01: the name is free). Either create it on github.com (no README, no license, no .gitignore) or reply **"create the repo"** and the agent will run `gh repo create Poojan6216/attest --public --source=. --remote=origin --push` (gh is already logged in as Poojan6216). Unblocks: the first push (0.1) and CI green on GitHub (0.11).
- [x] Install Node 22 + pnpm on the Mac. Done 2026-10-01: Node 22.14.0 was present; the agent installed pnpm 10.34.6 into `~/.local/bin`.

## During Sprint 2 (observers)
- [ ] Capture Gmail fixtures with `pnpm capture --vendor gmail --name <name>` while the page is open in your Chrome (agent will give the exact list: sent-list, sent-thread, drafts, second-account-sent, 8 receipt emails). ~20 minutes. Unblocks 2.1 → 2.2, 2.3.
- [ ] Capture Google Calendar fixtures: week view before/after creating a test event, month view, a second calendar. Unblocks 2.4 → 2.5.
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
- [ ] Chrome Web Store developer account ($5 one-time), same Google account as the GitHub Pages owner. Unblocks 7.8 submission.
- [ ] Enable GitHub Pages on the repo (Settings → Pages → main, `/docs` or root) so `PRIVACY.md` has a public URL. Unblocks 7.2.
- [ ] Submit the release zip: upload `.output/attest-0.1.0.zip`, fill the data-usage form from `launch/store-listing.md` (the agent writes the exact answers), add screenshots from `launch/screenshots/`, submit for review.
- [ ] Post, in order, from `launch/launch-checklist.md`: Show HN (Tue–Thu 8–10am ET, then answer comments for 6 hours), Reddit posts (only from an account older than 6 weeks with prior comments), DMs to the incident authors, first weekly X/LinkedIn post.

## After launch (weekly, ~1 hour)
- [ ] One post from `launch/weekly-posts.md`
- [ ] One alert reply from `launch/alerts.md`
- [ ] One selector repair if any adapter shows DEGRADED (agent does the code; you re-capture the fixture)
