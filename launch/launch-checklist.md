# Launch day checklist

**Purpose:** the day of the launch, hour by hour, drafted 2026-10-13 (sprint_7 7.6; agents/launch_engineer.md item 10). Steps marked **MANUAL** are the founder's alone; the rest are checks anyone can run. Times are Eastern, on a Tuesday, Wednesday or Thursday.

## Before the day

- [ ] **MANUAL** The repository is public, under the license chosen (MANUAL.md, Sprint 7), and GitHub Pages serves `PRIVACY.md`.
- [ ] **MANUAL** The telemetry API is deployed (MANUAL.md, Sprint 5), and `pnpm build:release` has made and checked the store zip.
- [ ] **MANUAL** The store listing is live ([store-listing.md](store-listing.md)); its link replaces the placeholders in [show-hn.md](show-hn.md), [reddit/](reddit/) and the README.
- [ ] **MANUAL** Each `[link]` in the posts is filled with the incident's source, read again that week.
- [ ] `pnpm lint`, `pnpm test` and `pnpm e2e` pass on the commit the zip was built from.
- [ ] **MANUAL** The Reddit account is older than six weeks and has real comments in each subreddit.

## The day

- [ ] 07:30 **MANUAL** Install the store build on a clean Chrome profile, paste the demo log of `launch/demo.gif` into the side panel, and see the three receipts.
- [ ] 08:00 **MANUAL** Post [show-hn.md](show-hn.md): the chosen title, the body, the repository link.
- [ ] 08:00 to 14:00 **MANUAL** Answer every comment on Show HN, starting from the five drafted replies; say what Attest cannot do before anyone asks.
- [ ] 10:00 **MANUAL** Post [reddit/r-privacy.md](reddit/r-privacy.md).
- [ ] 12:00 **MANUAL** Post [reddit/r-chatgpt.md](reddit/r-chatgpt.md).
- [ ] 14:00 **MANUAL** Post [reddit/r-claudeai.md](reddit/r-claudeai.md).
- [ ] 15:00 **MANUAL** Send [dm-template.md](dm-template.md), one message each, to the incident authors and the commenters who asked for proof.
- [ ] 17:00 **MANUAL** Post week one of [weekly-posts.md](weekly-posts.md).
- [ ] 18:00 Read every new issue on the repository; a reader marked Degraded is the first fix.

## The week after

- [ ] **MANUAL** Turn on the searches in [alerts.md](alerts.md), and reply where a person asked or lost something.
- [ ] Keep to the weekly loop in [README.md](README.md).
