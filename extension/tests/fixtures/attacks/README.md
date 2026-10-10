# Red-team attacks

One folder per strategy of [agents/red_team.md](../../../../agents/red_team.md), named as its `strategy`, holding `expected.json` and any page its cases serve. `pnpm redteam` runs every case through the built extension (`bench/redteam.ts`) and reports one row per strategy in `bench/results/redteam-<date>.json` and `RESULTS.md`; [docs/attacks-that-work.md](../../../../docs/attacks-that-work.md) publishes them.

## `expected.json`

Its schema is [`tests/redteam/attack-schema.ts`](../../redteam/attack-schema.ts). A fixture the schema refuses fails the run, naming its file, before anything is launched.

- `number`, `strategy`, `title`: the strategy's number in agents/red_team.md (a new one past 13), its folder's name, and its title.
- `cases`, each with:
  - `id` and `attack`: its name, and in one line what it tries;
  - `pages`, opened in order and read by Attest's shipped readers:
    - `{"kind": "gmail.sent", "rows": [...]}`, Gmail's Sent list with each row's `name`, `email`, `subject`, `snippet` and `minutesAgo`, newest first, and with `"spoof": {"at": ..., "rows": [...]}` rows a page plants beside it: `outside-main`, `second-main`, `iframe` (a main landmark in a `data:` frame, another origin) or `hidden-row`;
    - `{"kind": "fixture", "vendor": "gmail" | "gcal", "file": "<labelled page>.html", "replace": [{"from": ..., "to": ...}]}`, a page of [`tests/fixtures/pages`](../pages/README.md) at its own address, each `from` replaced (a forged sender, amount or time; a `from` the page lacks fails the run);
    - `{"kind": "file", "file": "<page>.html", "url": "<a Gmail or Google Calendar address>"}`, a page of the folder's own served at that address;

    In a served page, `{{gmailTime:N}}` becomes the instant N minutes before the run, as Gmail writes it in a title;
  - `logs`: each an agent (`muse`, `chatgpt`, `dots` or `claude`) and the lines it claims, each with its `minutesAgo` (below zero, a time after the run) or a fixed `at` (an instant with its offset, for pages fixed in time such as a captured Calendar week) and, when the log writes it in UTC, `"clock": "utc"`, each log pasted in the side panel in turn, as a person pastes them (a log the preview refuses whole imports nothing);
  - `model`: `{"score": 0 to 1}` saves an invented key, turns it on, and puts a stand-in for Anthropic's API in front of it that scores every candidate it is sent that much; `modelInput`: `{"asked": n, "excludes": [...]}`, at least n requests reach the stand-in and none holds any of those texts (any case: a CRITICAL leak);
  - `grants`: each an agent's grant as the options page sets it (`spendCeiling` in `currency`'s main unit, the `denied` actions, `mayWriteTo`), saved before the logs are pasted; `away`: the spans the person was away (`fromMinutesAgo`, `toMinutesAgo`), written as away detection records them;
  - `health`: each `{"reader": "gmail.sent" | "gmail.receipt" | "gcal.event", "status": [...]}`, the health the reader must show once the pages are read;
  - `expect`: each names a set of receipts (`claims` with a `counterparty`, a `type` or a `subjectHint`, as the ledger stores them, or `orphans`, the receipts no claim made), the grades a correct Attest may give them (`allowed`), and, when it matters, how many there are (`count`), how many may be VERIFIED (`maxVerified`) and how many must be (`minVerified`).

A case is an attack that works when a receipt breaks an expectation, at the severity agents/red_team.md gives it: CRITICAL for a false VERIFIED, HIGH for a missed UNASKED or OVER SCOPE, MEDIUM for a false NOT FOUND, LOW for the rest. Every time is minutes before the run, so a case means the same on any day, and every value is invented.
