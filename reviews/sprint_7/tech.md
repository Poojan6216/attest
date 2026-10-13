# Sprint 7 — Tech review

**Role:** agents/tech_reviewer.md (read-only).
**Scope:** everything Sprint 7 committed: tasks 7.0 to 7.6 and the Decisions entries [7.0] to [7.6].
**Range:** `20bd94a..509f3b6` (HEAD). 7 commits, 69 files, +2,108 / −72.
- Shipped extension code and manifest: 4 files, +7 / −6.
  - Two hint strings (`src/ui/grant-form.ts`, `entrypoints/options/components/GrantLists.tsx`).
  - The manifest's name (`wxt.config.ts`), and its description and version (`extension/package.json`).
  - Plus the five icons.
- The rest is tooling, tests, docs, the launch kit, and the telemetry API's new route.

**What I ran:**
- `git log`, `git diff` and `git show` over the range; reading files; `grep`, `wc`.
- `pnpm --dir extension exec vitest run` on the 9 changed unit test files (7 docs, `bench/results-md`, the two grant-form tests): **9 files, 52 tests, all pass**.
- In `telemetry-api/`:
  - `uv run ruff check .`: clean.
  - `uv run ruff format --check .`: 26 files formatted.
  - `uv run mypy app tests scripts`: no issues in 25 files.
  - `uv run pytest`: **125 passed**, 1 warning (Starlette's `httpx` deprecation).
- `pnpm lint`: the full run was stopped at its 15-minute limit inside the extension's ESLint, while other reviewers' e2e and vitest runs were loading the machine. So I ran its parts on what Sprint 7 touched:
  - ESLint on the 19 changed extension TypeScript files, and on the 3 changed root scripts: clean, with `--max-warnings 0`.
  - Prettier on the 57 changed text files: all formatted.
  - `pnpm check-docs`: OK (8 files, 686 relative links, 46 pnpm commands).
- `pnpm typecheck`: clean. That is the extension's four projects (app, `src/core`, tests, node configs) and the root's (`bench/`, `scripts/`).
- Read-only probes in the scratchpad. None prints a seed or a captured value; the seed probes print counts only.
  - The public-number module (`tests/unit/docs/public-numbers.ts`) on 12 sentences, through its own exports.
  - Seeds and canaries in the store shots' and the demo's inputs, after the demo's rewrite.
  - `render()` of the committed report template with a valid answer.
  - A Python AST scan of function lengths over `app/`, `scripts/` and `tests/`.
  - A relative-link and anchor check over `launch/`, `CHANGELOG.md`, `MANUAL.md` and `telemetry-api/README.md`.
  - WXT 0.21.4's own `zip.mjs`, for how the zip is named.

**Not run:** Playwright, `pnpm e2e` (another reviewer runs them), `pnpm bench`, `pnpm record-demo`, `pnpm record-screenshots`, `pnpm render-icons` (each rewrites committed files), `pnpm build:release` (it refuses the placeholder telemetry host). Nothing in the repository was written but this file.

**Out of scope:** uncommitted work in the working tree.
- Changes to `MANUAL.md` and `sprints/sprint_7.md` (task 7.8, in progress). TECH-6 notes what the new release step leaves out.
- Made while I reviewed: one severity changed in `README.md`'s attacks table, and three untracked test files from QA:
  - `extension/tests/unit/docs/readme-figures.spec.ts` (TECH-2 says what it covers);
  - `telemetry-api/tests/test_stats_edges.py` (TECH-9 notes one pattern it repeats);
  - `telemetry-api/tests/test_reliability_report_main.py`.

## Summary

**Gaps: 18. None HIGH, 6 MEDIUM, 12 LOW.**

**What passes:**
- **The recorders never run as tests.**
  - `pnpm e2e` runs `playwright.config.ts`, whose `testMatch` is `**/*.spec.ts` (`:18`), so `*.record.ts` cannot match.
  - Vitest includes only `tests/{unit,property,golden}/**/*.spec.{ts,tsx}` (`vitest.config.ts:5`).
  - `playwright.record.config.ts` spreads the e2e settings and swaps in `**/*.record.ts` with one worker. Decisions [7.3] records why the recorders run under Playwright rather than tsx.
  - Both recorders are still typechecked (`tests/tsconfig.json` includes `./**/*`) and linted, size rules included. The longest function is the store-shots test, at 57 lines.
- **The release zip's name is right.** WXT 0.21.4 fills `{{name}}` from the package name, `attest`, and `{{version}}` from the built manifest (`zip.mjs:31-39`). So `scripts/check-release.ts` names `attest-0.1.0.zip` correctly, even after 7.4 changed the manifest's name. The old root script audited `attest-*-chrome.zip`, a name WXT never writes; that is fixed.
- **RESULTS.md is held exactly.** `tests/unit/bench/results-md.spec.ts` compares the file with `render(latestResults(...))`, so a hand edit fails CI's unit job.
- **The version is held in step.** `changelog.spec.ts` holds three things to one version: the CHANGELOG's newest release, `extension/package.json` (which the manifest takes), and PRIVACY.md's "Applies to". Releases must be newest first and dated.
- **The stats endpoint does what 7.5 asks.**
  - It answers 204 below 50 installs and never names an install id.
  - Rates are null with no receipts.
  - A 503 is not cached.
  - The window is the 30 days before today.
  - The Mongo sums are held to the in-memory ones over mongomock.
  - ruff and `mypy --strict` are clean.
- **Shipped code barely moved.** `company.com` became `example.com` in two strings of the same length. Nothing under `src/core`, `src/adapters`, `src/observers`, `src/bus`, `src/ledger` or `policy/` changed.
- **Sizes.**
  - No changed file is near 400 lines. The largest is `telemetry-api/app/main.py`, at 246.
  - TypeScript functions are held by lint.
  - In Python, the AST scan found one function over 40 lines: `add_routes`, 58 (TECH-8).
- **Decisions.** [7.0] to [7.6] record the release check, the RESULTS.md check, the `.record.ts` split, the 204 floor, the cache, the CORS choice and the hyphen rule. The few unrecorded choices are named in TECH-9 and TECH-16.

## Bundle size

Not re-measured: this review built nothing.
- The only change to shipped JavaScript is two strings of the same length, so each entrypoint's code is the size it was at the Sprint 6 close.
- The manifest's name and description changed.
- The icons shrank: 16 px 559 → 459 B, 32 px 916 → 836 B, 48 px 1,334 → 1,264 B, 96 px 2,366 → 2,280 B, 128 px 3,074 → 2,497 B.

## Checklist

| Item | Status | Finding |
|---|---|---|
| src/core imports nothing from chrome, DOM, Dexie or adapters (lint rule) | verified clean | No file under src/core changed. |
| Entrypoints are thin | verified clean | One hint string in `GrantLists.tsx`. |
| Adapters and observers are pure over Document | verified clean | Untouched. |
| Cross-context messages typed in src/bus and Zod-validated | verified clean | No message added. |
| Policy values from policy/default.json | verified clean | None added to the extension. The API's floor, window and cache time are constants in `app/stats.py`. Decisions [7.5] says the floor is a constant so a deployment cannot lower it. |
| No `any`, no `as unknown as`, no unexplained `!` | verified clean | TypeScript: four single casts on `JSON.parse` results. Three narrow to `version?: unknown` and are checked. The fourth (`store-listing.spec.ts:19`) is compared by the test itself. Python: `Any` in tests only. |
| No hardcoded hosts, ids or URLs | verified clean (LOW note) | The report script takes its address as an argument. Its "local" check is a prefix test (TECH-12). |
| No duplicate selector logic | verified clean | No selector changed. Other duplication: TECH-4, TECH-7, TECH-14. |
| No TODO or FIXME without a task | verified clean | None among the added lines. One `# noqa: S310`, whose reason is weaker than it says (TECH-12). |
| Errors typed, with context, never swallowed | GAP (LOW) | `StoreError` and `NotPublishedError` are typed. The report script lets five failures escape as tracebacks (TECH-12). |
| Functions ≤ 60 lines, files ≤ 400 lines | verified, close to the cap | TypeScript by lint. Python by AST scan: `add_routes` 58, with nothing that would catch 61 (TECH-8). |
| Naming conventions | GAP (LOW) | Files are kebab-case and snake_case. The new Python response model uses camelCase attributes without the parity reason that justifies them in `schema.py`, and two classes are named `Strict` (TECH-9). |
| No clock, randomness or model in src/core | verified clean | Untouched. The API reads its injected `now()`. |
| Ids from hashes where idempotency matters | n/a | No ids added. |
| Timestamps ISO with offset; money in cents | verified clean | `since` and `until` are ISO dates. |
| Indexes for every query path | GAP (LOW) | The stats query has no index on `payload.dayBucket` (TECH-10). |
| Ledger reads paginated; no `toArray` on unbounded tables | n/a | No ledger read added. |
| Content scripts debounce DOM observation | n/a | Untouched. |
| Service worker does no work on onStartup beyond alarms | n/a | Untouched. |
| Bundle size per entrypoint reported; popup < 150 KB gzipped | not re-measured | See Bundle size: the shipped code is the same size. |
| New messages, tables, fields and grades documented | verified clean | No extension change. The route is in `telemetry-api/README.md`, `docs/privacy-architecture.md` §11 and PRIVACY.md. PRIVACY.md contradicts itself (TECH-6). |
| Decisions.md entry for every unspecified choice | GAP (LOW) | [7.0] to [7.6] are there. Unrecorded: why `render-icons` lives under `tests/` (TECH-16), and why the output model is camelCase (TECH-9). |
| CHANGELOG updated | verified clean | Sprint 7's lines are under `[0.1.0] - 2026-10-13`, cut before the tag. Decisions [7.0] says it is re-dated at the tag. |
| Tests follow the build_spec §6 layout | verified (LOW note) | New specs are under `tests/unit/docs/` and `tests/unit/bench/`. The two recorders sit in `tests/e2e/` though they are not tests (TECH-7). |
| telemetry-api: routers thin; validation in schema; storage in store.py | GAP (LOW) | The stats route owns caching and windowing (TECH-8). `store.py` imports the publishing module (TECH-9). |
| telemetry-api: type hints complete; ruff + mypy --strict clean | verified clean | Both clean. The `str`-keyed dicts hide the agent mismatch from mypy (TECH-4). |

## Gaps

### TECH-1 (MEDIUM): the reliability report publishes its template's own "Purpose" note

**Where:**
- `launch/reliability-report-v0.md:3`: the template's note.
- `telemetry-api/scripts/reliability_report.py:60-71`: `render`.
- `telemetry-api/tests/test_reliability_report.py:55-63`: the test.

**What is wrong:**
- `render` fills the four placeholders and returns the whole file.
- So the published report's second paragraph is the note: "**Purpose:** the template of the monthly Agent Reliability Report, written 2026-10-13 (sprint_7 7.5, 7.6). It is never filled by hand: `uv run python scripts/reliability_report.py <stats address>`, run in `telemetry-api/`…". Rendering the committed template with a valid answer shows it, second, under the title.
- The test checks the placeholders and the rows, not what else ships.
- The links on `:19` are relative to `launch/` (`../docs/grading.md`), so they break wherever the report is posted.
- `launch/README.md` marks the template "Ready", and the script's header promises a report to publish.

**Fix:** mark the template's notes so that `render` strips them (an HTML comment block, say), use absolute repository URLs for the links, and test that the output holds neither.

### TECH-2 (MEDIUM): the public-number check misses whole shapes of number, and admits any value RESULTS.md holds anywhere

**Where:**
- `extension/tests/unit/docs/public-numbers.ts:14-39`.
- Used by `readme.spec.ts:63-68` and `launch-kit.spec.ts:102-104`.

**What is wrong:**
- A number passes when it equals any of RESULTS.md's 97 distinct numeric values, from any metric. That admits:
  - 31 of the integers from 0 to 100;
  - the percentages 0%, 20%, 24%, 72%, 90%, 95% and 100%. "100%" always passes, because every accuracy metric of 1 is a fraction of 1.
- Probes through the module's own `numbersIn` and `unsourced`:
  - "It checks 5,000 claims" is read as 5 and 000, both held: it passes whatever the real figure.
  - "10x faster", "37ms", "93MB" and "a 37-day window" are not read at all, because a letter or a hyphen after the digits excludes them.
  - Spelled-out numbers ("Seven in nine sends") are not read.
- These are the shapes a marketing figure usually takes. The founder will edit these files before posting (launch/README.md), and this test guards Sprint 7's first hard rule.
- Decisions [7.1] records "a value RESULTS.md holds". It does not record these holes.
- QA's untracked `readme-figures.spec.ts`, written during this review, holds the README's attack table, its Results rows, and the red-team counts in the opening and in Show HN to named metrics. If committed, it covers those figures.
- The Reddit posts, the weekly posts, the message, the replies and every other sentence still rely on this module alone.

**Fix:** read grouped, unit-suffixed, hyphenated and spelled-out numbers, and have each public number name the RESULTS.md metric it quotes (a comment or a sidecar map), checked against that metric's value.

### TECH-3 (MEDIUM): the first-screen tests check slogans, not build_spec §11

**Where:**
- `extension/tests/unit/docs/readme.spec.ts:47-51` (the opening).
- `:18-29`: `ORDER`, ten exact headings.
- `:60`: no `!` anywhere, code blocks included.
- `store-listing.spec.ts:82` and `:93`: two exact opening sentences.

**What is wrong:**
- The README's opening must hold three strings: `**Attest cannot see everything.**`, `likely agent` and the attacks link.
- Delete every other §11 limitation from the opening and the test passes. That means "only tabs you have open", what is invisible, UNVERIFIABLE, "Vendor pages change … DEGRADED" and "Desktop Chrome … only".
- Yet an honest rewording of the bold slogan fails it.
- 7.1's Done when ("a reader who only reads the first screen knows what Attest cannot do") rests on this test.
- The store listing's test checks four limits by phrase (`:94-100`). The README's checks one.

**Fix:** keep one exported list of §11 limits and assert it against both the README's opening and the listing's fourth paragraph, then drop the slogan pins.

### TECH-4 (MEDIUM): `/v1/stats` keeps its own copy of the agents and grades, so a new agent is dropped silently

**Where:**
- `telemetry-api/app/stats.py:18-19`, against `app/schema.py:38-55` (`GradeCounts`, `AgentCounts`).
- Further copies: `scripts/reliability_report.py:20` (`NAMES`), `tests/test_stats.py:27` and `:52`.
- Loose types: `stats.py:34` (`dict[str, dict[str, int]]`) and `:62` (`dict[str, AgentStats]`).

**What is wrong:**
- A parity test holds the payload schema to the extension's. Nothing holds `AGENTS` and `GRADES` to the schema.
- Add an agent to `AgentCounts` (the sprint defers two more agents to v0.2) and everything goes on with the old four:
  - `MongoStore.totals` sums them;
  - `stats_of` publishes them;
  - the report prints them.
  Nothing fails.
- Add it to `AGENTS` but not `NAMES`, and `row()` raises `KeyError`.
- The `str`-keyed dicts hide both cases from mypy.

**Fix:** derive the lists from `AgentCounts.model_fields` and `GradeCounts.model_fields` (or shared `Literal` aliases), key the types by them, and test that the stats' agents are the schema's.

### TECH-5 (MEDIUM): the invented-data check is in one recorder only, and it cannot fail on four of the five store shots

**Where:**
- `extension/tests/e2e/demo.record.ts:79-122`: no check. Frames 3 and 4 are the Gmail and Calendar pages themselves (`:101`, `:106`).
- `store-shots.record.ts:28-34` (`onlyInvented`), `:117-121`, `:69-83`.
- `launch/store-listing.md:28`.

**What is wrong:**
- The store recorder searches each page's text for every seeded secret and requires every address to be at a reserved domain. The address check is what caught the grant form's `company.com` ([7.4]).
- The demo recorder shares the flow but checks nothing. Yet the GIF tops the README, and it is the only picture that shows vendor pages.
- Counted in this review (counts only):
  - after `demoSentPage` and `emptyWeek`, the demo pages hold none of the 18 seeds or their canaries. Each source fixture held 9 matches;
  - `DEMO_LOG` holds none;
  - only `brokenSentList()` holds any (9), and it is read just before shot 4.
- So shots 1, 2, 3 and 5 search pages built from inputs that hold no seed, and cannot fail. The listing says each page was searched for every seeded secret.

**Fix:** move `onlyInvented` into `support/frames.ts` and run it on every page shot, the demo's vendor pages included. Then either plant seeds where the demo pages carry them unread, or say in the listing that the seed search covers the degraded shot only.

### TECH-6 (MEDIUM): PRIVACY.md says no telemetry server runs, which the release makes false

**Where:**
- `PRIVACY.md:112`: "(this pre-release has none running, so nothing arrives anywhere yet)".
- `PRIVACY.md:14`: "Attest 0.1.0 is its first release".
- `changelog.spec.ts:77-89` holds only "Applies to Attest 0.1.0."

**What is wrong:**
- The two sentences contradict each other.
- Since 7.5, the paragraph on `:112` also says the server publishes totals.
- `pnpm build:release` will not build until the telemetry host is deployed, so every store zip ships while a server runs, and the store-facing policy says none does.
- Nothing ties the parenthetical to the placeholder host (`TELEMETRY_HOST = 'telemetry.attest.invalid'`, `src/config-network.ts:20`).
- The working tree's new release step in MANUAL.md sets the host, but does not touch the policy.

**Fix:** hold PRIVACY.md's sentence to `TELEMETRY_HOST` with a test ("none running" only while the host is the `.invalid` placeholder), and put the policy edit in the step that sets the host.

### TECH-7 (LOW): the two recorders and the e2e helpers repeat flow code, and nothing runs the recorders

**Where:**
- Identical bodies:
  - the popup with its three grades: `demo.record.ts:61-69` and `store-shots.record.ts:36-45`;
  - the digest: `demo.record.ts:72-77` and `store-shots.record.ts:85-91`.
- `demo.record.ts:43-58` types out `support/paste.ts:10-21` again ("Add agent activity", "Activity log", "Preview", "Import 2 claims"), to shoot between preview and import.
- Near-identical test openings (`demo.record.ts:79-87`, `store-shots.record.ts:111-119`) and driver scripts (`scripts/record-demo.ts:18-29`, `scripts/record-screenshots.ts:24-42`).
- `support/frames.ts:15-20`: `Frame` allows neither or both of `image` and `words`. `compose` then draws an empty frame (`:54-57`).
- `scripts/record-demo.ts:32-41` has ffmpeg write straight to `launch/demo.gif`. The screenshots go to a temporary folder first (`record-screenshots.ts:43-49`).

**What is wrong:**
- No `pnpm e2e`, CI job or test runs a `*.record.ts`.
- A change can break only a recorder's own copy of a step. For example, `pastedFrame` matches exactly "Import 2 claims", where `pasteActivity` accepts any count. Such a change passes typecheck and every test, and is found only at the next manual run.
- A failed encode leaves a broken GIF over the committed one.

**Fix:** move the shared shots into `support/launch-shots.ts`, split `pasteActivity` into preview and import, use one driver script and a union `Frame` type, and encode the GIF to a temporary file that is renamed only once ffmpeg succeeds.

### TECH-8 (LOW): the stats route is not thin, and `add_routes` is 58 of 60 lines with no Python size check

**Where:**
- `telemetry-api/app/main.py:165-222`: `add_routes`, 58 lines by AST scan.
- `:64-75`: `StatsCache`.
- `:204-222`: the stats route.

**What is wrong:**
- The route does five things itself:
  - works out the window;
  - reads the store;
  - maps the store's error;
  - chooses publish or withhold;
  - writes the cache's two public fields (`:216`).
- Sprint 5 split `create_app` at 68 lines (TECH-11 there) but added no size check for Python. One more route breaks the limit with nothing to say so.

**Fix:** put the cached read in `app/stats.py`, register it from its own `add_stats_route`, and add an AST test holding `app/`, `scripts/` and `tests/` to 60-line functions and 400-line files.

### TECH-9 (LOW): the stats code's module boundaries and names

**Where:**
- `app/store.py:17` and `tests/memory.py:7` import `AGENTS`, `GRADES` and `Totals` from `app/stats.py`, the publishing rules.
- Two classes are named `Strict`, and they differ:
  - `app/stats.py:37-40` forbids extra keys only;
  - `app/schema.py:32-35` also sets `strict=True`.
- `app/stats.py:43-53` uses camelCase attributes, with `N815` ignored for the whole project (`pyproject.toml:35`). So `scripts/reliability_report.py:53-55` reads `stats.verifiedRate`.
- Test helpers live in a test module: `tests/test_reliability_report.py:21` imports from `tests/test_stats.py`, and so does QA's new edge test.

**What is wrong:**
- Storage depends on the publishing module.
- One class name means two levels of strictness.
- `schema.py` is camelCase for its JSON Schema parity with the extension. An output model the extension never reads has no such reason, and no Decisions entry gives one.

**Fix:** move `Totals` and the lists beside the schema, rename the answer's base model, use snake_case fields with `alias_generator=to_camel` (scoping `N815` to `schema.py`), and move shared test helpers to a support module.

### TECH-10 (LOW): the stats sums are two scans per refresh with no index, and run only on mongomock

**Where:**
- `telemetry-api/app/store.py:73-91`.
- `scripts/prove_flow.py`: no stats step.

**What is wrong:**
- Installs and grade sums come from two aggregations, so a day stored between them counts in one and not the other.
- `payload.dayBucket` has no index, so each refresh scans the whole collection twice. The collection grows by one document per install and day, with no expiry.
- The pipelines have run only against mongomock. The Sprint 5 real-stack proof never calls `/v1/stats`.

**Fix:** use one `$facet` pipeline, create an index on `payload.dayBucket` at startup, and add a 204 check to `prove_flow.py`.

### TECH-11 (LOW): the stats cache can stampede, and a client may keep an answer for two hours

**Where:** `telemetry-api/app/main.py:204-222`.

**What is wrong:**
- Requests that arrive while an expired answer is being remade each see the stale cache across `await store.totals` (`:212`). Each then runs both aggregations.
- Every answer says `max-age=3600`, even one made 59 minutes earlier. So a client or proxy may keep it for nearly two hours, though `stats.py`'s header says it is kept `CACHE_SECONDS`.

**Fix:** remake the answer under an `asyncio.Lock`, and send as `max-age` the time it has left.

### TECH-12 (LOW): the report script's failures escape as tracebacks, and its "local" check is a prefix test

**Where:** `telemetry-api/scripts/reliability_report.py`:
- `:27-40`: `fetch`;
- `:29`: the address check;
- `:32`: the `# noqa: S310`;
- `:68-71`: `render`'s `ValueError`;
- `:80-84`: `main` catches only `NotPublishedError`;
- `:18`: the template's path.

**What is wrong:**
- The header promises a message and exit 1 for anything but a valid aggregate. Five failures escape as tracebacks instead:
  - an HTTP 503 (`HTTPError`);
  - a DNS failure (`URLError`);
  - a body that is not JSON;
  - an answer that fails `Stats.model_validate`;
  - a leftover placeholder (`ValueError`).
- `"http://localhost"` is matched as a prefix, so `http://localhost.attacker.example/v1/stats` passes as local, over plain HTTP. The `noqa` rests on that check.
- The template is found by `parents[2]`.

**Fix:** turn each of those into `NotPublishedError`, compare the parsed hostname (`urllib.parse.urlsplit`) exactly, and add a `--template` option.

### TECH-13 (LOW): the release install check chooses its build through the environment, and never listens to the service worker

**Where:**
- `extension/tests/tools/check-release-zip.ts:26-28` and `:31-44`.
- `extension/tests/e2e/support/extension.ts:18-24`.

**What is wrong:**
- `EXTENSION_PATH` is read once, when the launcher's module loads. So the check sets `process.env` and must import the launcher afterwards. An earlier static import would load `.output/chrome-mv3` and check the wrong build, silently.
- The launcher's comment still says the variable is only for the broken-build proof and that CI never sets it.
- The console and error listeners are per page, and attached after launch. An error the service worker logs while it starts (a migration, a reader's registration) passes a check whose header says "no console error".
- Playwright 1.63's `Worker` has its own `console` event, and `ConsoleMessage.worker()` names a service worker.

**Fix:** pass the build through a `launchExtension({ extensionPath })` option, and have the launcher listen to the service worker's `console` events from the moment it appears.

### TECH-14 (LOW): the docs tests repeat helpers and keep four different lists of banned words

**Where:**
- Section extractors: `readme.spec.ts:39-44`, `launch-kit.spec.ts:35-40`, `store-listing.spec.ts:24-29`.
- `REPO_ROOT` is redefined in six specs, though `public-numbers.ts:10` exports it.
- Four banned-word lists:
  - `readme.spec.ts:32-33`, 12 terms;
  - `launch-kit.spec.ts:31-32`, 10;
  - `store-listing.spec.ts:102`, 6;
  - `tests/unit/copy.spec.ts:39`, 7.

**What is wrong:** the launch posts and the store description are held to narrower lists than the README.
- "enterprise-grade" is one of docs_writer rule 3's own four words. It passes in the store description, which has no dash rule.
- In a Show HN draft, "enterprise grade", "best in class", "blazing" and "powered by AI" all pass. The kit's dash rule catches only the hyphenated spellings.

**Fix:** have one `copy-rules.ts` export the full list, `section()` and `REPO_ROOT`.

### TECH-15 (LOW): nothing holds the listing's permission table to the manifest

**Where:**
- `launch/store-listing.md:45-54`.
- `store-listing.spec.ts`: it checks the privacy form only.
- `wxt.config.ts:190-193`; WXT adds `sidePanel` itself.

**What is wrong:**
- The privacy answers are held to their schemas. The permission justifications, which the founder pastes one per permission, are held to nothing.
- A permission added later, and to the manifest audit's allowlist, would reach the store form with no line.

**Fix:** compare the table's first column with the built manifest's `permissions`, `optional_permissions` and `host_permissions`.

### TECH-16 (LOW): the new commands and the tools they need are documented only in the CHANGELOG, and extension tools are run three ways

**Where:**
- `CLAUDE.md:66`: Commands.
- `README.md:117-132`: Contributing.
- `package.json:19-21`.
- `scripts/check-release.ts:22`.
- `scripts/record-demo.ts:5`: ffmpeg.
- `extension/tests/tools/check-release-zip.ts:25`: unzip.

**What is wrong:**
- The CHANGELOG names the three new root commands, as its test requires (`pnpm record-demo`, `pnpm record-screenshots`, `pnpm render-icons`), and the report script (`scripts/reliability_report.py`).
- CLAUDE.md's Commands names none of the four. Neither does the README's Contributing block; the README mentions `pnpm record-demo` once, under the GIF.
- ffmpeg and unzip are required, and named only in code comments and a CHANGELOG line.
- Tools that live in the extension are run three ways:
  - a root script that runs an extension script (`capture`, `attest`, `bench`);
  - `pnpm --dir extension exec tsx tests/tools/render-icons.ts`;
  - `pnpm exec tsx extension/tests/tools/check-release-zip.ts` from the root.
- `render-icons` makes shipped assets (`extension/public/icon/*.png`) from under `tests/`. No Decisions entry says why: it needs `@playwright/test`, which only the extension depends on.

**Fix:** list the commands and their prerequisites in both places, run `render-icons` and `check-release-zip` through scripts in `extension/package.json`, and record the placement rule in Decisions.

### TECH-17 (LOW): text left stale or contradicted

**Where and what:**
- `sprints/sprint_7.md:16` names `extension/playwright.demo.config.ts`. Commit `1b8efaf` renamed it `playwright.record.config.ts`.
- `telemetry-api/pyproject.toml:4`: "validated and stored, and nothing else". The API now also publishes totals.
- `telemetry-api/README.md:3` gives the decisions as `[5.6]` and `[5.8]`. The new route's are `[7.5]`.
- `telemetry-api/app/store.py` has two docstrings the sums outgrew:
  - `:22-23`, `StoreError`: "did not take a document";
  - `:31-32`, `Store`: "Stores one aggregate, and says whether the database answers".
- `extension/tests/e2e/support/extension.ts:19-21`: see TECH-13.
- `extension/src/ui/grant-form.ts:144` (a doc comment) and `PRIVACY.md:83` still use `company.com` as the example domain. Decisions [7.4] replaced it as a registered domain.

**Fix:** correct each line.

### TECH-18 (LOW): check-docs does not read the launch kit

**Where:** `scripts/check-docs.ts:4`: docs/*.md, README.md and PRIVACY.md only.

**What is wrong:**
- Several files' relative links and anchors are checked by nothing:
  - the launch kit's, which point at doc sections, scripts and screenshots;
  - CHANGELOG.md's, MANUAL.md's and telemetry-api/README.md's.
- The `pnpm` commands quoted in them are not checked either.
- I checked the links by hand: all resolve today. A renamed doc section would break the store listing's links silently.

**Fix:** add `launch/**/*.md`, CHANGELOG.md, MANUAL.md and telemetry-api/README.md to the files check-docs reads.
