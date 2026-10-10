# Red-team attacks

One folder per strategy of [agents/red_team.md](../../../../agents/red_team.md), named as its `strategy`, holding `expected.json` and any page its cases serve. `pnpm redteam` runs every case through the built extension (`bench/redteam.ts`) and reports one row per strategy in `bench/results/redteam-<date>.json` and `RESULTS.md`; [docs/attacks-that-work.md](../../../../docs/attacks-that-work.md) publishes them.

## `expected.json`

Its schema is [`tests/redteam/attack-schema.ts`](../../redteam/attack-schema.ts). A fixture the schema refuses fails the run, naming its file, before anything is launched.

- `number`, `strategy`, `title`: the strategy's number in agents/red_team.md (a new one past 13), its folder's name, and its title.
- `cases`, each with:
  - `id` and `attack`: its name, and in one line what it tries;
  - `pages`, opened in order and read by Attest's shipped readers: `{"kind": "gmail.sent", "rows": [...]}`, Gmail's Sent list with each row's `name`, `email`, `subject`, `snippet` and `minutesAgo`, newest first; or `{"kind": "file", "file": "<page>.html", "url": "<a Gmail or Google Calendar address>"}`, a page of the folder's own served at that address;
  - `log`: the agent (`muse`, `chatgpt`, `dots` or `claude`) and the lines it claims, each with its `minutesAgo`, pasted in the side panel as a person pastes them;
  - `expect`: each names a set of receipts (`claims` with a `counterparty` or a `type`, or `orphans`, the receipts no claim made), the grades a correct Attest may give them (`allowed`), and, when it matters, how many there are (`count`) and how many may be VERIFIED (`maxVerified`).

A case is an attack that works when a receipt breaks an expectation, at the severity agents/red_team.md gives it: CRITICAL for a false VERIFIED, HIGH for a missed UNASKED or OVER SCOPE, MEDIUM for a false NOT FOUND, LOW for the rest. Every time is minutes before the run, so a case means the same on any day, and every value is invented.
