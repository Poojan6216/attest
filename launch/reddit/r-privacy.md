# r/privacy post

**Purpose:** the r/privacy post, drafted 2026-10-13 (sprint_7 7.6; agents/launch_engineer.md item 5): the local only angle. Post only from an account older than six weeks with real comments in the subreddit. Needs the founder's edit: the `[link]`.

## Title

I built a checker for AI agents that never sends your mail anywhere

## Post

AI agents now send email and book things inside our accounts, and the only record of what they did is the vendor's own activity view.

I wanted a second witness that does not need anyone's server. Attest is a Chrome extension: you paste an agent's activity log, and it checks each claim against your own Gmail Sent folder and Calendar, in tabs you already have open. Each claim gets a receipt: Verified, Not found, Unverifiable and so on, with the evidence.

Nothing leaves the browser unless you turn on an option that sends, and two tests check that on every build: one fails on any network request, the other plants fake secrets and searches every channel for them. The code is open: [link].

What it cannot do: it sees only open tabs, it cannot see your phone, and when it flags an email nobody claimed it says "likely agent", because it cannot prove who pressed send.

For people here who already use these agents: what would you need to see before you trusted a tool like this with your inbox?
