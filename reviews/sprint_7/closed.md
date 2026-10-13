# Sprint 7 — Close

Role: agents/sprint_closer.md. Inputs, in this folder: `qa.md` (16 gaps: QA-1, QA-4, QA-8, QA-14 and QA-15 fixed by the QA review itself, 11 open), `security.md` (7 gaps), `tech.md` (18 gaps) and `privacy.md` (17 gaps, the 7.7 review). The reviews and QA's tests are committed as `d2d3db9`. Range closed: `d2d3db9` to HEAD (`3a86f14`, `5166db3`, `792bcf6`, `f782c37`, `44a693e`, `23ea9c6`, the bench's `c03d43d`, and the close's own commit). Every gap is fixed in code or, where only the founder can act, in MANUAL.md with its exact steps. Nothing was fixed by weakening a test, a Hard Rule, a lint rule, a threshold, a gate or an allowlist. Where a test pinned the old behaviour, the change is the stricter one, said in its commit and in Decisions.md: QA's hourly-answer tests of `/v1/stats`, rewritten to the closed month. Where a fix would have loosened a guard, the guard won and the fix took another way: the perf gates' split, since the mandatory-test guard forbids Playwright projects. Every `[7.close]` entry in Decisions.md records a decision the close made. Where two reviews raised one gap, it is fixed once and listed once, with every name.

## FIXED IN CODE

Severity order. No gap touched Hard Rules 1 to 4 at CRITICAL: SEC-1 and SEC-2 bear on Hard Rule 1, and are first.

### MEDIUM

1. **SEC-1, privacy review gap 10: two answers of `/v1/stats` an hour apart gave away one install's day.**
   - **Changed:** the endpoint publishes one closed calendar month, made once and never remade. A report is taken only about a day from two days before the server's UTC date to the day after (`app/days.py`; the extension sends only its local yesterday, which in every time zone falls in that range, a test sending it from each offset at every quarter hour). A month is published from the fourth day after it ends, a whole day after the last date that takes a report about it, so no answer about a month can differ from another. An agent fewer than 50 counted installs used is `null`.
   - **Code:** `telemetry-api/app/days.py` (new), `app/stats.py` (`PublishedStats`, `seconds_left`), `app/main.py`.
   - **Tests:** `tests/test_days.py` (the days taken from every time zone; no date takes a report about the month it publishes, over two years of dates); `tests/test_stats.py` (the same answer until the next month; the agent floor; `max-age` the time left); `tests/test_stats_edges.py` (QA's, at the month's scale).
2. **SEC-2: the 50-install floor counted install ids anyone could make, on any day.**
   - **Changed:** an install counts only once its reports about the month arrived on 3 UTC dates, counted by arrival, which a made-up install cannot choose. One client may send for at most 4 install ids a day, so one address alone can make at most 45 count in a month (`INSTALLS_PER_CLIENT_PER_DAY`; 5 would have allowed 56). A day far from the server's date is refused. PRIVACY.md, the privacy architecture, the API's README and the report say the server cannot verify an install id. The founder compares the installs with the store's users before publishing the report (MANUAL.md, monthly).
   - **Code:** `app/store.py` (one pipeline), `app/limits.py` (`DailyIds`), `app/settings.py`.
   - **Tests:** `tests/test_stats.py::test_counts_an_install_only_once_its_reports_arrived_on_three_dates`; `tests/test_api_close_7.py` (days refused and never counted, the install-id cap, the bound of one client against the floor).
3. **TECH-1: the published report would carry its template's "Purpose" note and relative links.** The note is an HTML comment the script strips, and the links are absolute. `launch/reliability-report-v0.md`, `scripts/reliability_report.py` `render`; `tests/test_reliability_report.py::test_leaves_the_template_s_notes_out_and_links_absolutely`.
4. **TECH-2 / QA-2: the public-number check took any value RESULTS.md held anywhere, and missed whole shapes of number.** Every number in posted text now names the metric it quotes (`extension/tests/unit/docs/figures.ts`); any other number fails. The reader reads grouped numbers, numbers with a unit joined on, hyphenated ones and spelled-out ratios. `extension/tests/unit/docs/public-numbers.ts`; `figures.spec.ts` (the posted texts; each shape QA probed).
5. **QA-3: the README's receipts row gave a 95% limit no receipts metric holds.** The limit is what the bench's gate is, "every labelled receipt exact, no other email read", held to `receiptParsersGatePassed` and its counts. `README.md`; `extension/tests/unit/docs/readme-figures.spec.ts`.
6. **TECH-3, privacy review gap 17: the first-screen tests checked slogans, not build_spec §11.** One list of §11's seven limits, held to §11's length, against the README's first screen and the listing's fourth paragraph; the slogan pins dropped. Both texts gain Dots' Pro tier and the on-device model. `extension/tests/unit/docs/copy-rules.ts` `SECTION_11_LIMITS`; `readme.spec.ts`, `store-listing.spec.ts`.
7. **TECH-4: `/v1/stats` kept its own copy of the agents and grades.** `AGENTS` and `GRADES` are read from the payload's models; the report's names are held to them. `app/schema.py`; `tests/test_stats.py::test_publishes_and_sums_exactly_the_schema_s_agents_and_grades`, `tests/test_reliability_report.py::test_names_every_agent_the_schema_counts`.
8. **TECH-5 / SEC-6 / QA-9, privacy review gap 16: the invented-data check ran in one recorder only, and could be fooled.** One check, `onlyInvented`, runs before every picture of both recorders, the demo's two vendor test pages included. It reads what the page draws, every form field's value and every alt, title, label and placeholder. Addresses are read as drawn: NFKC, default-ignorable characters removed, any letter in a domain. `extension/tests/e2e/support/invented.ts`, `support/launch-shots.ts`; `tests/unit/harness/invented.spec.ts` (QA's three bypasses and four more); the listing says which shot's seed search can catch a kept secret.
9. **TECH-6, privacy review gap 7: PRIVACY.md said no telemetry server runs, and that no data reaches the maker.**
   - Both sentences are gone. The policy says the options page shows the host.
   - `pnpm build:release` refuses to build while the policy does not name the deployed host.
   - `extension/wxt.config.ts` `assertReleasable`.
   - **Tests:** `tests/unit/telemetry/facts.spec.ts`; `tests/unit/docs/privacy-policy.spec.ts` (no "none running"; the host named once it is real).
10. **QA-5: the e2e perf gates shared the machine with another worker.** They are tagged `@perf`, and `pnpm e2e` runs them last, on one worker. A Playwright project would have needed the mandatory-test guard loosened, and it is kept. `extension/package.json` `e2e`; the three perf specs.
11. **Privacy review gap 6, QA-11: what the own key sends was understated.** PRIVACY.md and privacy-architecture §1 name Attest's id for the match, the merchant and the receipt case. Both of the policy's paragraphs on the key are held to every field of the model's input schema. `PRIVACY.md` 0.10; `tests/unit/docs/privacy-policy.spec.ts`.
12. **Privacy review gap 8: the server's data had no retention, and the policy no operator or private contact.**
    - Documents are deleted 90 days after arrival, by a TTL index; an index on the day serves the sums.
    - The policy says so, and that reports already sent stay until then.
    - It names Railway as the host, and has the operator and the contact as blanks marked "to fill before release". The release build refuses while they are there.
    - `app/store.py`, `PRIVACY.md`, `docs/privacy-architecture.md` §11.
    - **Tests:** `tests/test_store.py::test_the_first_call_makes_the_retention_and_day_indexes`, `scripts/prove_flow.py` step 7 on real Mongo.
13. **Privacy review gap 9: the publication was not disclosed where people consent.** The options page's statement beside the switch, the listing's form answer and its Limited Use statement now say that totals are published a month at a time, never one install's. The policy's purpose is widened. `TelemetryStatement.tsx`; `tests/unit/options/telemetry.spec.ts`.
14. **Privacy review gap 11: launch copy said "never sends" where an option sends.**
    - The r/privacy title now says Attest keeps your mail in your browser. The message adds "unless you turn it on". The Show HN title says "runs locally, misses some".
    - The kit's test refuses these claims.
    - `launch/`; `tests/unit/docs/launch-kit.spec.ts`.

### LOW

15. **SEC-3 / TECH-12 / QA-6: the report script trusted its answer.**
    - **The address:** https, or http to exactly `localhost`, `127.0.0.1` or `::1` with no user name. It is parsed, and a redirect is never followed.
    - **The answer:** one whole month, at least 50 installs, Attest's agents exactly, and numbers that add up, read strictly.
    - **Failures:** every one is a single line and exit 1.
    - **The API:** every path with a final slash is a 404.
    - **Run as:** `python -m`, as documented.
    - **Tests:** `tests/test_reliability_report.py` (eight bad addresses; a real local server's 307 not followed; sixteen bad answers), `tests/test_reliability_report_main.py` (eight failures), `tests/test_api_close_7.py` (no slash redirects).
16. **SEC-4 / TECH-10 / TECH-11 / QA-12 / QA-13: refreshes stampeded, scanned twice unindexed, ran only on mongomock, and kept stale.**
    - One pipeline, indexed by day. One read of the store serves every ask that waits on it, a failed one too.
    - The month's answer is remade at the first read after the switch.
    - `max-age` is the time left.
    - GET is limited per client.
    - `prove_flow.py` now runs the month's sums on CI's real MongoDB, in a database of its own that it drops, held equal to the tests' store, whose rules follow MongoDB's.
    - **Tests:** `tests/test_stats_edges.py` (the one-read test, the midnight test), `tests/test_api_close_7.py` (the GET limit).
17. **SEC-5 / TECH-13 / QA-7: the release check passed a development zip.**
    - **Refused:** a development page or its code, a `.invalid` host, or a name, description or version that is not the build's.
    - **Also checked:** the digest page is opened, and the service worker's console is read from its first line.
    - **Zips:** development zips are named `-dev`; old zips are deleted before a release zip; the two stale zips are deleted.
    - **Launcher:** it takes the build as an option.
    - **Tests:** `tests/e2e/release-zip.spec.ts` (nine cases: QA's three, and four of the content checks); `tests/unit/tools/check-release.spec.ts`.
18. **SEC-7: the launch steps made the repository public before the clean-ups.** The launch checklist, the Pages step and the go-public item name both clean-ups as preconditions, and CLAUDE.md tells the agent to refuse until they are done.
19. **TECH-7 / QA-16: the recorders repeated flow code, and nothing ran them.**
    - One shared flow, which `pnpm e2e` runs writing nothing.
    - `pasteActivity` is split into preview and import. `Frame` is a union type.
    - One driver script makes both recorders' pictures. The GIF is encoded before it is copied.
    - The icons are redrawn from the SVG and held to the committed files.
    - **Tests:** `tests/e2e/launch-shots.spec.ts`.
20. **TECH-8: the stats route was not thin, and Python had no size check.** `add_stats_route`; an AST test holds every function in `app/`, `scripts/` and `tests/` to 60 lines and every file to 400 (`tests/test_sizes.py`).
21. **TECH-9: the stats code's module boundaries and names.** `Totals` is in the store. The answer's base model is `Answer`, with snake_case fields and camelCase aliases. N815 is excused for `app/schema.py` alone. Shared test helpers are in `tests/support.py`.
22. **TECH-14 / QA-10: the docs tests repeated helpers and held copy to four lists.** One `copy-rules.ts`: the repository's root, a section reader, one list of words no copy uses (now also over the extension's strings), and any dash character in outreach.
23. **TECH-15 / QA-8:** fixed by the QA review (`store-listing-permissions.spec.ts`).
24. **TECH-16: commands and the tools they need were documented only in the CHANGELOG.** The README's Contributing and CLAUDE.md's Commands list them, with ffmpeg and unzip. `render-icons` and `check-release-zip` run through the extension's scripts, and Decisions records why they live there.
25. **TECH-17: stale text.** The sprint file's config name, pyproject's description, the API README's decisions, the store's docstrings, the launcher's comment, and `company.com` in the grant form and the policy.
26. **TECH-18: check-docs did not read the launch kit.** It reads `launch/**`, CHANGELOG.md, MANUAL.md and the API's README. It found one wrong command, now fixed. `scripts/check-docs.ts`; `tests/unit/docs/check-docs.spec.ts`.
27. **Privacy review gap 12: "counts only".** The policy and the listing say "counts, a random install id, versions and the date". Held by `privacy-policy.spec.ts`.
28. **Privacy review gap 13: the storage lists.** PRIVACY.md names everything local and session storage hold, as the listing does.
29. **Privacy review gap 15: the page readers carried the AI vendors' endpoints.**
    - `src/config.ts` no longer re-exports the network config, and the agents' sites moved to `src/config-agents.ts`.
    - The Gmail and Calendar content scripts hold none of the telemetry host, the vendors' hosts and endpoints, or the agents' sites.
    - **Tests:** `tests/e2e/built-bundle.spec.ts`.
30. **Privacy review gap 4, in part:** the listing drafts which form categories the usage numbers come under. Certifying the form is the founder's (below).

## MANUAL ACTION REQUIRED

Each is in MANUAL.md with its steps.

1. [ ] A public address for the privacy policy, and `homepage_url` → MANUAL.md, Sprint 7: the go-public item, then GitHub Pages (privacy review gap 1).
2. [ ] The public repository, after both clean-ups (the real captures, Sprint 7; the bench trace in history, Sprint 4 close) and the license choice → MANUAL.md (gap 2, SEC-7).
3. [ ] The store zip → deploy the API (MANUAL.md, Sprint 5), then "Release 0.1.0", whose steps now name the host in PRIVACY.md (gap 3, sprint_7 7.0).
4. [ ] Certify the privacy practices form, with the draft categories → `launch/store-listing.md` (gap 4).
5. [x] Re-read OpenAI's Terms of Use in a browser → done later on 2026-10-13, in the founder's Chrome: they read as `[3.10]` quoted them (gap 5). Meta's, Anthropic's and Google's were re-read the same day and stand (Decisions `[7.close]`).
6. [x] Done later on 2026-10-13: the founder's name and address are in PRIVACY.md 0.11. Write the server's operator and a private contact into PRIVACY.md → MANUAL.md, Sprint 7 (gap 8). The release build refuses until you do.
7. [ ] See what Railway's request logs hold, and for how long, when you deploy → MANUAL.md, Sprint 7 (gap 14).
8. [ ] Each month, before publishing the report, compare its installs with the store's users → MANUAL.md, after launch.

## ACCEPTED AS KNOWN LIMITATION

1. **Made-up installs from several addresses can pass the published floor.**
   - The server cannot verify an install id. With 4 install ids per address a day and 3 dates for an install to count, one address can make at most 45 count in a month. Two addresses can reach 50.
   - Stated in PRIVACY.md, the API's README, privacy-architecture §11 and the report's limits.
   - The founder compares the installs with the store's users before publishing.
   - Decisions `[7.close]`.
2. **The server's host may log the address.** PRIVACY.md says Railway may keep request logs; what they hold is MANUAL (7, above).

## VERIFIED CLEAN

Run on `c03d43d`, a clean tree, with this report and the Progress Log apart:

- **`pnpm test`:** 11,385 unit, property and golden tests in 556 files pass (7 skipped, as before this close), then the 9 serial perf gates.
- **Coverage:** `src/core` 99.38% of lines (gate 95%); the observers and adapters 99.03% (gate 85%); the UI 96.11% (gate 70%).
- **`pnpm test:poison`:** 6,371 pass. **`test:tz`:** 6,598 pass in each of Pacific/Kiritimati and America/St_Johns.
- **`pnpm e2e`:** 112 of 112, then the `@perf` pass, 6 of 6 on one worker. Both mandatory tests ran and passed, all five of their pinned tests: "nothing leaves the browser" and "no seeded secret leaks".
- **`pnpm bench`:** every gate passed. RESULTS.md was regenerated (`c03d43d`), and the unit run holds it to its result files and the README's figures to its metrics. The new popup trace holds no path of this machine.
- **telemetry-api:** 277 pytest pass; ruff, `ruff format --check` and mypy strict clean; `uv lock --check` current; pip-audit finds no known vulnerability.
- **`pnpm audit --prod`:** no known vulnerability.
- **Lint and typecheck:** ESLint, Prettier and check-docs (now 22 files) clean on every commit, by the pre-commit hook.
- **Not run here:** `scripts/prove_flow.py` needs Docker, which this machine lacks. CI's `telemetry-api-flow` job runs it on the next push, the month's sums on real MongoDB among its steps. Its sums step was run here against the tests' store only.

Commit: `chore(sprint-7): close 58 review gaps`.
