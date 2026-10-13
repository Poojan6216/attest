# Launch kit

**Purpose:** every launch asset as a file the founder can paste, indexed with its status, written 2026-10-13 (sprint_7 7.6; agents/launch_engineer.md). Every number in a public file is in [RESULTS.md](../RESULTS.md), and every claim about Attest names its test. Store submission and every post are the founder's steps (MANUAL.md, Sprint 7).

## The files

| File | What it is | Status |
|---|---|---|
| [store-listing.md](store-listing.md) | The Chrome Web Store listing: name, summary, description, permissions, privacy answers | Needs founder edit: the privacy policy's address, and certifying the privacy answers |
| [screenshots/](screenshots/) and [promo-tile.png](promo-tile.png) | The store's five screenshots and its small promo tile, invented data only (`pnpm record-screenshots`) | Ready |
| [demo.gif](demo.gif) | The 60 second demo, also in the README (`pnpm record-demo`) | Ready |
| [show-hn.md](show-hn.md) | The Show HN title, body and first five replies | Needs founder edit: the incident and install links |
| [reddit/](reddit/) | Three posts: [r/privacy](reddit/r-privacy.md), [r/ChatGPT](reddit/r-chatgpt.md), [r/ClaudeAI](reddit/r-claudeai.md) | Needs founder edit: the links; r/ClaudeAI says open source, which holds only if the license stays open (MANUAL.md, license) |
| [dm-template.md](dm-template.md) | The message to incident authors and commenters | Needs founder edit: each name, incident and the Loom link |
| [weekly-posts.md](weekly-posts.md) | Four weeks of one post each | Needs founder edit: the incident links, and his own receipt screenshots when he has them |
| [alerts.md](alerts.md) | Searches for people describing an agent acting unasked, and a three line reply | Ready |
| [reliability-report-v0.md](reliability-report-v0.md) | The monthly Agent Reliability Report's template, filled from `GET /v1/stats` by `uv run python -m scripts.reliability_report` in `telemetry-api/`, which leaves its note out | Ready; it never ships with fewer than 50 installs, each reporting on at least 3 days of the month, and the endpoint publishes nothing until then. Before publishing, compare its installs with the store's count of users |
| [launch-checklist.md](launch-checklist.md) | The launch day, hour by hour, the founder's steps marked | Ready |

## The weekly loop after launch

One post from [weekly-posts.md](weekly-posts.md), one reply from [alerts.md](alerts.md), and one selector repair when a reader shows Degraded: the agent fixes the code, the founder captures the page again (`pnpm capture`, [docs/adapters.md §7](../docs/adapters.md#7-repairing-a-broken-selector)).
