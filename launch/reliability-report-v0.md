# Agent Reliability Report, {{since}} to {{until}}

**Purpose:** the template of the monthly Agent Reliability Report, written 2026-10-13 (sprint_7 7.5, 7.6). It is never filled by hand: `uv run python scripts/reliability_report.py <stats address>`, run in `telemetry-api/`, reads the public aggregates (`GET /v1/stats`) and writes the report from this file. With fewer than 50 installs in the window the endpoint publishes nothing and the script stops: a rate of a handful of people is no rate. Every number below comes from that one answer.

From {{installs}} Attest installs that chose to send anonymous daily counts, over the days {{since}} to {{until}}: each agent's receipts, and how many of them Attest verified, could not find, or found done unasked.

| Agent | Receipts | Verified | Not found | Unasked (likely agent) |
|---|---|---|---|---|
{{agents}}

## What these numbers cannot say

- They come only from people who turned the usage numbers on, which is off by default, and from no one else.
- A receipt is only as good as what Attest could see: the tabs people had open. A claim no open tab could check is Unverifiable, and it counts among the receipts above.
- Unasked means an agent likely did it, never that it did: Attest cannot prove who pressed send.
- The counts are per receipt, not per person: one busy install counts as much as many quiet ones.
- The agents' own pages are not read; their claims come from the logs people pasted.

How each grade is decided: [docs/grading.md](../docs/grading.md). What the usage numbers hold, and nothing more: [docs/privacy-architecture.md §11](../docs/privacy-architecture.md#11-anonymous-usage-numbers).
