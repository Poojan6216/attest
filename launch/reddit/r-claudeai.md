# r/ClaudeAI post

**Purpose:** the r/ClaudeAI post, drafted 2026-10-13 (sprint_7 7.6; agents/launch_engineer.md item 5): the open source angle. Post only from an account older than six weeks with real comments in the subreddit. Needs the founder's edit: the `[link]`.

## Title

An open source checker for what your AI agent says it did

## Post

When Claude, or any agent, acts in your email and calendar, its task log is the agent describing itself.

Attest is an open source Chrome extension that checks those claims against evidence in your own Gmail and Calendar tabs. You paste the log; it grades each claim with the evidence attached: Verified, Partial, Not found, Over scope or Unverifiable. The grading is pure and deterministic, so the same inputs always give the same receipt, and a replay command proves past receipts.

Nothing leaves your browser unless you turn on an option that sends. It is honest about its limits: it sees only open tabs, and it says "likely" when it cannot prove who acted. We attacked it ourselves and published what still works: [link].

The repository has the tests, the threat model and the grading rules: [link].

What would you want an independent check of your agent to catch first?
