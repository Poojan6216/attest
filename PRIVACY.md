# Attest privacy policy

Version 0.8. Effective 12 October 2026 (version 0.7, of 10 October 2026, did not yet say that turning encryption on, or a new passphrase, ends with Attest rebuilding its database so Chrome's files keep no unsealed copy of your records, that Delete all data has Chrome compact its files, or that your own model key is sealed while encryption is on; version 0.6, of 10 October 2026, did not yet describe the optional encryption at rest or state the Limited Use of what Attest reads; version 0.5, of 10 October 2026, said what the model and the usage numbers send but not where the model runs, what it can change, what is kept of its answers, what the telemetry server keeps, or how often reports go; version 0.4, of 9 October 2026, said nothing ever leaves your browser and that telemetry would come later, before your own model key and the usage numbers existed; version 0.3, of 9 October 2026, still listed three permissions and described the retention choice, deleting all data and the receipts' export as coming later, and said nothing of alerts, the weekly digest, shares, turning a reader off or Check Gmail for me; version 0.2, of 8 October 2026, said turning away detection off deletes every time away without saying that receipts already made keep their reasons; version 0.1, of the same day, said Attest stored no claims or receipts yet; version 0, of 1 October 2026, said later versions would read your AI agents' pages). Applies to Attest 0.0.1.

## The short version

Nothing leaves your browser unless you turn it on. Attest reads only pages you have open, plus, if you turn on Check Gmail for me, the one Gmail tab it opens in front of you. It keeps what it finds in your browser. It sends something only if you turn on one of two options, both off by default: your own model key, which sends a few facts about a claim to the AI company your key is for, and anonymous usage numbers, which send counts once a day. It has no accounts and no ads. It never clicks, types, sends or buys anything on any page.

## Where things stand today

Attest 0.0.1 is a pre-release. It reads your Gmail Sent folder, receipt emails you open, and Google Calendar, only in tabs you have open, and keeps the facts listed below in your browser. It does not read your AI agents' pages: Meta (Muse), OpenAI (ChatGPT) and Anthropic (Claude) do not allow collecting data from their sites by automated means, so Attest's readers for them are off, and stay off unless those companies permit them. Instead, you can paste an agent's own activity log into Attest's side panel: Attest reads the paste there, keeps only the actions it finds and the minutes the log names, and checks each action against your Gmail and Calendar. The text you paste is never stored.

You see what it found in its popup, in a timeline in the side panel, in alerts and in a weekly digest, all described below. Any version that changes what is read, stored or sent updates this policy first.

## Limited Use

What Attest reads from your Gmail and Calendar tabs, and the activity logs you paste into it, is used for one purpose only: to check what your AI agents say they did and give each claim a receipt, for you. It is kept in your browser. It is never sold, never used for advertising, credit or any other purpose, never used to train any model, and never transferred to anyone, Attest's maker included, except by an option you turn on that sends: your own model key, which sends the few facts about a claim listed under "The optional model" to the company your key is for, and the anonymous usage numbers, which send counts only. No one at Attest reads what Attest reads for you: none of it reaches Attest's maker, whatever you turn on, since the usage numbers are counts, never content.

## What Attest reads

Attest reads these pages, and only in tabs you have open yourself:

- your Gmail Sent folder, to see which emails were actually sent
- receipt emails you open in Gmail, to see purchases
- Google Calendar, to see which events exist

Later versions read these too, but only if their makers permit it:

- the activity and chat pages of the AI agents you use (Meta Muse, ChatGPT and Dots, Claude), to see what the agent says it did
- those agents' settings pages, to see which apps and accounts you have connected to them

Attest only reads these pages. It never clicks, types, sends, cancels or submits anything on them. It does not run in incognito windows, so nothing you open there is read or stored. It never signs in for you. It does not use the Gmail API or any server-side access to your accounts.

You can turn the Gmail reader or the Calendar reader off in Attest's options page, under Adapters. A reader that is off does not run on that site at all: a page you open there is not read, and nothing from it is stored. Turning it on again reads the pages you open from then on. Your choice stays when you delete all Attest data.

## Check Gmail for me

Attest never opens a page on its own, with one exception, which is off unless you turn it on: Check Gmail for me, in the options page under Adapters.

When it is on and the Gmail reader is on, Attest looks every 5 minutes for an email your agent says it sent that has waited 15 minutes for a check, with no Gmail tab showing Attest your Sent folder since then. When it finds one, it opens your Gmail Sent folder in one new tab, pinned and in front of you, in the Chrome window you are using. It never opens one in the background: it waits while another app is in front of Chrome, the screen is locked, or the window is minimised, and, if away detection is on, while Chrome says you are away. One tab serves every email waiting at that moment. After it, Attest opens no other tab for 30 minutes, and never opens a second one for the same email.

Attest reads that tab as it reads any Gmail tab you open, and never clicks or types in it. The popup says why the tab opened and for which agent. Attest keeps when it opened the tab, until when it waits before it may open another, how many emails it was for and which agents. Turning the feature off stops it at once.

## What Attest stores

Attest stores derived facts, not content. For each agent claim, sent email, receipt or calendar event it keeps only:

- who it was to: an email address or a name
- a short subject hint, at most 80 characters
- timestamps
- amounts and currency
- the merchant name
- content hashes: a fingerprint that lets Attest recognise the same item again without keeping the item

It also keeps:

- the first 200 characters of what you asked an agent to do, so a receipt can show which request it belongs to
- the receipts it works out: the grade and the reasons for it
- a mark you put on a receipt (Verified or Not found), with the reason you write for it, and a mark you take back
- the limits you set for each agent, whether you muted its alerts, and the names of the apps and accounts each agent's settings page shows as connected
- when your Gmail and Calendar tabs were open and whether you were active in them, with a fingerprint of the account instead of its address, so a receipt can say UNVERIFIABLE when Attest could not see, and can flag sends made while you were away
- whether each page reader is working
- for an activity log you paste: the actions it reports, kept as above, and the minutes its entries name, which show when the agent was working; never the text you pasted
- for each receipt, what it was checked with (which tabs had been seen and when, the limits you set for the agent, and the rules in force), so the receipt can be checked again later from your export
- only if you turn on away detection in the options page: when each time you were away from this computer began and ended, as Chrome reports it, and nothing else
- for each Google Calendar range you look at, every event shown: its title (at most 80 characters), its start and end, whether it is all day, its first guest's email address, and a one-way fingerprint of each guest's address (never the address), so Attest can later tell which events were created, changed or deleted; calendar names and Google's event ids are kept only as fingerprints
- for each receipt that alerted you: which receipt, the agent, the grade, and when the alert was handled
- the weekly digests described below
- only if you turn on a model (below): for each claim Attest asked it about, which model, when, and the scores it gave; never what the model was given, its words or your key
- your choices: which readers are off, whether Check Gmail for me, a model and the usage numbers are on, and how long to keep your history

It never stores email bodies, attachments, chat transcripts or full pages. The full list, table by table and field by field, is in docs/privacy-architecture.md.

## Alerts

When a receipt ends Not found, Unasked (an action no agent reported, likely one of them) or Over scope, Attest asks Chrome to show you a notification, once for that receipt. Chrome and your operating system show it on this device, and depending on your system's settings it can appear on your lock screen. So an alert names only the grade, the agent, and what was done and when, for example "Not found: Muse. Muse said it created a calendar event at 14:00. Attest found no sign of it." It never names who an email was to, an amount or a subject. When more than three arrive at once, you get one notice saying how many. Clicking an alert opens the receipt in the side panel. You can mute each agent's alerts in the options page, under Grants.

## The weekly digest

Every Monday at 09:00, Attest makes a summary of the week before and keeps it in your browser, so you can read earlier weeks again. A digest holds, for each agent, how many receipts ended in each grade; the receipts worth a look, each with its grade, agent, kind of action, time, amount, the domain of who it was to (company.com, never the address) and its subject hint, with any address in the hint written as its domain; the days Gmail or Calendar was not checked; whether each page reader was working; and the marks you put on that week's receipts, with your reasons. A notification says the digest is ready, with counts only. Digests are deleted with the rest of your history (see below).

## Sharing a receipt or a week

You can share a receipt (in the side panel) or a week's digest (on the digest page), as text or as an image. Attest shows you the whole share first and copies it to your clipboard only when you click Copy; it sends nothing anywhere, and a share goes only where you paste it yourself. A share names who an email was to by its domain only, never by address, and never includes what you asked an agent or why you marked a receipt. It keeps times, amounts and a subject's hint, with any address in the hint written as its domain. A hint is the first 80 characters of a subject as written, so it can still hold a name: check the preview before you copy.

## Where it is stored

In your browser, on this computer: in the browser's own database (IndexedDB), and the install id in the extension's local storage. While Chrome is open, its session memory also holds two small markers, which Chrome empties when it closes: whether away detection has started watching in this session, and which receipt a clicked alert asked the side panel to open. Attest does not copy anything to other devices or to any server.

You can also turn on encryption at rest, in the options page's Encryption; it is off by default. Attest then seals the facts that hold content (addresses, subjects, amounts, merchants, what your agents claimed, your grants and marks), and your own model key if you saved one, with a key made from a passphrase only you know, and keeps the key only in Chrome's memory, where session memory holds it for Attest's pages while it is unlocked. Ids, dates, grades and states stay readable, because Attest finds its records by them. While it is locked, Attest reads and stores nothing. Chrome keeps an older copy of a changed record in its files until it compacts them, so turning encryption on, or a new passphrase, ends with Attest rebuilding its database: Chrome's files then keep no copy of your records as they were before. A tool that recovers deleted files from the disk itself may still find one; full-disk encryption covers that. If you forget the passphrase, nobody can open the sealed facts, and Delete all data is the only way back. Details: [What encryption protects](docs/privacy-architecture.md#12-encryption-at-rest).

## The optional model

Attest can ask an AI model for a second opinion on one kind of receipt, only if you turn it on (Options, Model). It is off by default, because whether it helps has not been measured yet. It can change one thing: when an agent's claim matches a sent email or calendar event only partly, a strong answer can lift that receipt from Partial to Verified. It never lowers a grade, never picks which email or event matches, and never verifies a weak match on its own: Attest's own rules decide every grade. An answer that is late (after 2 seconds), malformed or missing is ignored, and the receipt is graded by the rules alone. Each claim is asked once.

You choose where it runs:

- Chrome's on-device model runs on this computer, so nothing is sent anywhere. Attest asks Chrome whether it has the model only when you click "Check Chrome's on-device model", and Chrome downloads it only if you click to. When it is on and ready, Attest uses it, never your key.
- Your own Anthropic or OpenAI key sends a few facts to that company (below). The key is kept where no script on a Gmail or Calendar page can read it, is never logged or exported, and is deleted when you click Forget my key or delete all data.

The model is given only the claim's kind of action, who it was to (an email address or a name), its short subject, its amount and its time, and the same for the one sent email or event it matched. Never a page, never what you asked an agent.

## What leaves your browser

Nothing, unless you turn on one of the two options below. With both off, as they are until you turn them on, Attest makes no network requests: a test in the source code records every request the extension makes during a scripted session, every feature above included, and fails the build if any host is contacted. Alerts are shown by Chrome and your operating system on this device, and a share leaves your browser only if you paste it somewhere yourself.

**Your own model key** (Options, Model). If you save an Anthropic or OpenAI key and turn it on, Attest asks that company's official service (`api.anthropic.com` or `api.openai.com`, nothing else) about each claim it is still checking with a partial match, once per claim: the claim's kind of action, who it was to (an email address or a name), its short subject, its amount and its time, and the same for the one sent email or event it matched. Never a page, never what you asked an agent. Your key goes only to that company, in the request's header; the company keeps what it receives under its own terms, and bills your key. If Chrome's own on-device model is on and ready, Attest uses it instead, and nothing is sent. Turning the key off, or Forget my key, stops it at once.

**Anonymous usage numbers** (Options, Privacy), to help fix page readers that stop working. If you turn them on, Attest checks once an hour and sends one report a day, about the day before, to Attest's own telemetry server (this pre-release has none running, so nothing arrives anywhere yet). A day is sent again only if Attest did not see the server take it, and the server keeps it once; a missed day is never sent later. The report holds only counts and yes-or-no values: how many receipts each agent got of each grade that day, which page readers were on, how many hours of the day they covered and whether they worked; and the Attest version, the Chrome major version, the date and the random install id. It never holds an email address, a name, a subject, an amount, page content or anything you typed: its format allows no other text. The options page shows exactly what the next report holds, and a test checks that what is sent is exactly what is shown. The server keeps each report as it came and the hour it arrived, and nothing else. Like any server it sees your network address when a report arrives; it uses it only to limit how many reports one network sends a day, as a fingerprint kept in memory, and never stores or logs it. Turn off usage numbers, in the same place, stops them at once.

Any other feature that would send something off your computer will be off by default, described here first, and need you to turn it on.

Attest does not sell or share data. No data reaches us.

## The install id

When Attest is installed it creates a random id (a version 4 UUID). It is not made from anything about you, your accounts or your computer. It is kept in the extension's local storage.

Its only use is the opt-in usage numbers described above. Until you reset it, the server can tell that two days' reports came from the same install, though not whose. You can see the id and reset it in Attest's options, under Danger zone. After a reset, reports sent before and after can no longer be linked to each other.

## How long data is kept

You choose in the options page, under Privacy: 30, 90 or 180 days, and 90 until you change it. Once a day, Attest deletes the stored facts, receipts, alerts and weekly digests older than that.

## Deleting your data

Delete all data, in the options page's Danger zone, deletes everything Attest keeps at once: every fact, receipt, mark, alert and digest, your settings and the install id, and it takes down any notification Attest is showing. Attest asks twice before it does. It deletes so that Chrome compacts its own files at once: within seconds they keep nothing of what was deleted. One thing stays, a choice and never data: a page reader you turned off stays off, so deleting never makes Attest read more. Attest then starts again, empty.

Uninstalling Attest also removes everything it stored: Chrome deletes the extension's storage with it. Turning away detection off deletes every time away it kept. Receipts already made keep their reasons: an UNASKED receipt that counted a time away of yours still says so until that receipt is deleted with the rest of your history.

Before you delete anything, the options page can export everything Attest keeps as one JSON file, and your receipts as one CSV file (one line per receipt, without the reasons you wrote for your marks and without subject hints), through your browser's own download.

## Permissions

Attest 0.0.1 asks Chrome for:

- storage, to keep the install id, and the two session markers above while Chrome is open
- alarms, to schedule checks, the daily deletion of old history and the weekly digest
- side panel, to show receipts beside the page you are on
- scripting, to turn its own Gmail and Calendar readers on and off as you choose; it never puts any other code into a page
- notifications, to show alerts and the weekly digest's notice

Only if you turn on away detection in the options page, it then asks for one more:

- idle, to know when you are away from this computer; turning the feature off gives it back

It asks for access to two websites, to read them in tabs you open: mail.google.com and calendar.google.com. Check Gmail for me opens its tab without any further permission. A later version adds an AI agent's site only if its maker permits Attest to read it, and nothing broader.

## Logs

Attest's diagnostic log, visible only in Chrome's developer tools on your computer, prints only what Attest itself wrote into its code: event names and status words from a fixed list, ids and content hashes Attest generated, small counts, versions and timestamps. Any other text is replaced by its length, and any long number by a placeholder, whatever it looks like. It is built never to print email addresses, names, subjects, tokens, the reasons you write or page content, and the secret-seed test checks the log for exactly that on every build.

## What Attest cannot tell you

- It sees only tabs you have open. Actions inside Messenger, phone calls, purchases without an email receipt, and anything on your phone are invisible to it. Those receipts say UNVERIFIABLE.
- When it flags something you did not ask for, it says "likely agent". It cannot prove who pressed send.
- Agent and Google pages change. When a page reader stops matching, Attest marks it DEGRADED and tells you.
- Desktop Chrome only.

## Changes to this policy

Changes are recorded in this file's history in the public source repository and in the changelog. A version that reads, stores or sends anything new updates this policy before it is released.

## Contact

Open an issue at https://github.com/Poojan6216/attest/issues.
