# Attest privacy policy

Version 0. Effective 1 October 2026. Applies to Attest 0.0.1.

## The short version

Nothing leaves your browser. Attest reads only pages you have open, keeps what it finds in your browser, and sends nothing to any server. It has no accounts, no ads and no analytics. It never clicks, types, sends or buys anything on any page.

## Where things stand today

Attest 0.0.1 is a pre-release. It reads no pages and stores no facts. The only thing it stores is a random install id, described below.

The rest of this policy describes how later versions will work, so you can judge the design before Attest reads anything. Any version that changes what is read, stored or sent updates this policy first.

## What Attest reads (later versions)

Later versions read these pages, and only in tabs you have open yourself:

- the activity and chat pages of the AI agents you use (Meta Muse, ChatGPT and Dots, Claude), to see what the agent says it did
- those agents' settings pages, to see which apps and accounts you have connected to them
- your Gmail Sent folder, to see which emails were actually sent
- receipt emails you open in Gmail, to see purchases
- Google Calendar, to see which events exist

Attest only reads these pages. It never clicks, types, sends, cancels or submits anything on them. It never reads from a hidden background tab and never signs in for you. It does not use the Gmail API or any server-side access to your accounts.

It never opens a page on its own, with one exception: an optional feature, off by default, that opens Gmail in a visible, pinned tab so that checks can run. It does nothing until you turn it on, and it is described here in full before it ships.

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
- the limits you set for each agent, and the names of the apps and accounts each agent's settings page shows as connected
- when your Gmail and Calendar tabs were open and whether you were active in them, with a fingerprint of the account instead of its address, so a receipt can say UNVERIFIABLE when Attest could not see, and can flag sends made while you were away
- whether each page reader is working

It never stores email bodies, attachments, chat transcripts or full pages.

## Where it is stored

In your browser, on this computer: in the browser's own database (IndexedDB) and, for a few settings and the install id, in the extension's local storage. Attest does not copy it to other devices or to any server.

A later version adds an optional passphrase that encrypts the stored facts. It will be off by default.

## What leaves your browser

Nothing. Attest makes no network requests. A test in the source code records every request the extension makes during a scripted session and fails the build if any host is contacted.

A later version may offer telemetry to help fix page readers that stop working. It will be off by default and will send nothing unless you turn it on. If you do, it sends one report a day made of counts and yes-or-no values (for example, how many receipts of each grade that day, or whether a page reader is working), the Attest version, the Chrome major version, the date and the random install id. It never sends email addresses, names, subjects, amounts, page content or anything you typed. The exact list of fields will be published in this policy before telemetry ships.

Any other feature that would send something off your computer will be off by default, described here first, and need you to turn it on.

Attest does not sell or share data. No data reaches us.

## The install id

When Attest is installed it creates a random id (a version 4 UUID). It is not made from anything about you, your accounts or your computer. It is kept in the extension's local storage.

Its only use is the opt-in telemetry described above, which does not exist yet. You can see the id and reset it in Attest's options, under Danger zone. After a reset, reports sent before and after can no longer be linked to each other.

## How long data is kept

Later versions delete stored facts and receipts after 90 days by default. You will be able to choose 30, 90 or 180 days.

## Deleting your data

Uninstalling Attest removes everything it stored: Chrome deletes the extension's storage with it. A later version adds a button in the options to delete all Attest data without uninstalling, and an export (JSON or CSV) so you can keep a copy first.

## Permissions

Attest 0.0.1 asks Chrome for:

- storage, to keep settings and the install id
- alarms, to schedule checks
- side panel, to show receipts beside the page you are on

It asks for access to no websites. Later versions ask for access to exactly the agent, Gmail and Calendar sites listed above, and nothing broader. The exact list is added here before release.

## Logs

Attest's diagnostic log, visible only in Chrome's developer tools on your computer, prints only what Attest itself wrote into its code: event names and status words from a fixed list, ids and content hashes Attest generated, small counts, versions and timestamps. Any other text is replaced by its length, and any long number by a placeholder, whatever it looks like. It is built never to print email addresses, names, subjects, tokens or page content, and the secret-seed test checks the log for exactly that on every build.

## What Attest cannot tell you

- It sees only tabs you have open. Actions inside Messenger, phone calls, purchases without an email receipt, and anything on your phone are invisible to it. Those receipts say UNVERIFIABLE.
- When it flags something you did not ask for, it says "likely agent". It cannot prove who pressed send.
- Agent and Google pages change. When a page reader stops matching, Attest marks it DEGRADED and tells you.
- Desktop Chrome only.

## Changes to this policy

Changes are recorded in this file's history in the public source repository and in the changelog. A version that reads, stores or sends anything new updates this policy before it is released.

## Contact

Open an issue at https://github.com/Poojan6216/attest/issues.
