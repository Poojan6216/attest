# Agent Reliability Report, {{month}}

<!--
Purpose: the template of the monthly Agent Reliability Report, written 2026-10-13 (sprint_7 7.5, 7.6) and changed at the Sprint 7 close. It is never filled by hand: `uv run python -m scripts.reliability_report <stats address>`, run in `telemetry-api/`, reads the public aggregates (`GET /v1/stats`) and writes the report from this file, leaving this note out. The endpoint publishes one closed calendar month, counting an install only once it reported on at least 3 days of it, and publishes nothing while fewer than 50 installs report in the month; the script checks the answer again and stops on anything less: a rate of a handful of people is no rate. Every number below comes from that one answer. Before publishing, compare the installs with the store's count of users: the installs are random ids the server cannot verify.
-->

From {{installs}} Attest installs that chose to send anonymous daily counts, each on at least 3 days from {{since}} to {{until}}: for each agent, how many of those installs used it, its receipts, and how many of them Attest verified, could not find, or found done unasked.

| Agent | Installs | Receipts | Verified | Not found | Unasked (likely agent) |
|---|---|---|---|---|---|
{{agents}}

## What these numbers cannot say

- They come only from people who turned the usage numbers on, which is off by default, and from no one else.
- An install is a random id each copy of Attest makes for itself, and the server cannot verify one. Someone could send made-up installs; counting an install only once it has reported on 3 days of the month makes that slow, not impossible.
- An agent fewer than 50 of these installs used has no numbers here.
- A receipt is only as good as what Attest could see: the tabs people had open. A claim no open tab could check is Unverifiable, and it counts among the receipts above.
- Unasked means an agent likely did it, never that it did: Attest cannot prove who pressed send.
- The counts are per receipt, not per person: one busy install counts as much as many quiet ones.
- The agents' own pages are not read; their claims come from the logs people pasted.

How each grade is decided: [docs/grading.md](https://github.com/Poojan6216/attest/blob/main/docs/grading.md). What the usage numbers hold, and nothing more: [docs/privacy-architecture.md §11](https://github.com/Poojan6216/attest/blob/main/docs/privacy-architecture.md#11-anonymous-usage-numbers).
