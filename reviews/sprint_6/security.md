# Sprint 6 — Security review

Role: agents/security_reviewer.md. Range: `git diff 3091d86..8065826` (HEAD). The working tree was clean when this review began; the untracked tests and reviews that other sprint-end reviews have added since are not covered here. That is 22 commits and 172 files: 64 added or changed under `extension/src` and `extension/entrypoints`, the rest tests, benches, docs, `scripts/audit-manifest.ts` and CI. Tasks 6.0 to 6.9, Decisions [6.0] to [6.9]. `telemetry-api/` and `policy/` are unchanged.

**How.** Read-only: end-to-end tests with timing gates were running on this machine, so I started no build, test, bench, browser, lint or typecheck. I read every Sprint 6 file on the encryption path against the checklist:

- `src/crypto`, the ledger's crypto modules and `shared.ts`;
- the worker's commands, keep-awake, locked, catch-up, alarms, router and settings;
- the bus, and the options and unlock UI.

I also read the manifest audit and its CI step, the harness markers and the bundle check, and the docs the sprint changed. Beyond reading, I:

- ran the checklist's greps over the 64 changed source files and over the build already on disk (`extension/.output/chrome-mv3`, built at 16:51 today from the clean tree at HEAD), and printed its manifest;
- read Dexie 4.4.6's middleware levels in `node_modules`, to place the sealing middleware in the stack;
- read the QA pass's logs (`scratchpad/qa6/`) without rerunning them: lint and typecheck exit 0; 534 unit files, 11,182 tests passed, 7 skipped.

I did not run the end-to-end suite. The last result I can cite is the privacy pre-review's: 100 of 100 at 6.5. I wrote one scratch file, the list of the 64 changed source files (`scratchpad/changed.txt`). I changed nothing else but this file.

**Verdict: 10 gaps.** 0 CRITICAL, 0 HIGH, 3 MEDIUM, 7 LOW.

No passphrase or key reaches a log, an export, IndexedDB in the clear, `chrome.storage.local`, a content script or the network. While the ledger is locked, the middleware refuses every read and write of the nine tables on each DBCore method. Dexie's `modify`, `update`, `bulkPut` and `delete`, and the job, are all built on those methods.

The three MEDIUM gaps are about what a copy of the profile still holds, and about the CI guard on the manifest:

- **SEC-1.** Rows written before encryption was turned on, and rows under the old key after a passphrase change, can stay in the profile's IndexedDB files after the job rewrites them. Strategy 13 reads the copied profile only through IndexedDB's API, which never returns them. Yet the options page says a copy cannot be read.
- **SEC-2.** With encryption on, the person's own model key stays in `chrome.storage.local` in the clear. Neither the Encryption section nor §12 says so.
- **SEC-3.** The manifest audit passes a manifest loosened in four ways:
  - a wildcard host in `optional_host_permissions`;
  - incognito allowed;
  - `minimum_chrome_version` lowered to 114;
  - a remote host in any CSP fetch directive but `connect-src`.

## Checklist

| Item | Status | Finding |
| --- | --- | --- |
| Network grep finds only `src/telemetry/send.ts` | PASS, one documented exception (unchanged) | Two hits, as at the Sprint 5 close: `send.ts:37` and `src/intel/providers/byo.ts:94`. No new network construct in the 64 files. In the build on disk, `fetch(` appears only in `background.js`. |
| Network-intercept E2E ran; allowlist one host or none | NOT RUN here | Not run, for the reason above. The privacy pre-review records 100 of 100 end-to-end tests at 6.5, `network-intercept.spec.ts` among them. No Sprint 6 code makes a request. |
| No remote img, fonts or CDN | PASS | No changed page or stylesheet names a URL. But the shipped CSP has no `default-src`, so the CSP itself would not stop one (SEC-3). |
| No externally_connectable, webRequest or DNR | PASS | The built manifest has none. The audit forbids `externally_connectable`, and webRequest and DNR fail its permission list. |
| Observations and claims go through `redact.project()` | PASS | No new observation or claim path. While locked, the worker refuses every observer message and every import before anything is stored (`router.ts:98`, `:114-133`). |
| Policy allowlist unchanged, or logged | PASS | `policy/` is unchanged. |
| Secret-seed test green across every channel | PASS (read, not rerun), with SEC-4 | Decisions [6.3]: green at b2d2028, extended to every share and to the usage numbers. It never turns encryption on, so neither the passphrase nor the ledger key is among its seeds, and the export's passphrase verifier goes unnoticed (SEC-4). |
| Length caps | PASS | No new field. |
| Exports and shares use the projection | PASS, with SEC-4 | An encrypted ledger exports opened, as §8 and §12 document. The export also carries `meta`'s `crypto.*` keys (SEC-4). |
| `attest/no-act`, zero disables | PASS | No `eslint-disable` in the 64 files; lint exit 0 in the QA log. |
| No click, submit, dispatch, value or focus on vendor DOM | PASS | The only hit is `export-ledger.ts:47`, the options page clicking its own download link (pre-existing). |
| No tabs.create or update on a vendor host | PASS | None added. While locked, Check Gmail for me does not run (`alarms.ts:118-120`). |
| No executeScript with string code | PASS | None. |
| Permissions ⊆ allowed set | PASS | storage, alarms, scripting, notifications and sidePanel; optional idle. Each has one line in Decisions [6.6] and in the listing draft. Keep-awake adds no permission. |
| host_permissions exact | PASS | Gmail and Calendar only. Decisions [6.6] explains this is stricter than build_spec's five hosts. |
| Optional permission requested in a gesture | PASS | None added. |
| CSP | PASS, with SEC-3 | `script-src 'self'; object-src 'none'; connect-src 'self' https://api.anthropic.com https://api.openai.com https://telemetry.attest.invalid`. No wasm is needed: AES-GCM runs in @noble/ciphers' JavaScript. There is no `default-src` (SEC-3). |
| No remote code | PASS | No eval, `new Function` or import of a URL in the 64 files; the two dynamic imports load relative modules. The bundle's only `Function(` is Zod's jitless probe, as before. @noble/ciphers is bundled. |
| Page text never a selector, type, key or instruction | PASS | Red-team strategy 6, prompt injection: 0 of 4 work (Decisions [6.2]). |
| Model input allowlisted, tested with a double | PASS | Unchanged. Strategy 6's stand-in model holds every request to the allowlisted model input. |
| Bus messages parsed; unknown dropped and logged | PASS | The five `crypto.*` commands are strict schemas in the union and in `PAGE_COMMAND_RESULTS`. So `listen.ts:83-86` and `:186-188` drop them from a content script before any handler runs. A drop logs the message type only, never the passphrase. |
| Stored data parsed on read | PASS | Session keys go through `StoredKeys` (`session.ts:17-18`). The crypto state is read field by field, and a value of the wrong kind reads as absent (`crypto-state.ts:52-69`). Rows are opened by the middleware, then parsed by `readRow` as before. |
| Text nodes only | PASS | No HTML sink in the 64 files. |
| Dexie bump, migration tested | N/A, with SEC-7 | No table or index changed. A sealed row is a new stored shape of the existing tables. Decisions [6.5] notes that a later migration touching a sealed table needs the key (SEC-7). |
| Encryption: AES-GCM, fresh IV per record, PBKDF2 ≥ 600k, key never stored, wrong passphrase a clean failure | PASS, with SEC-1, SEC-2, SEC-4 | See "Beyond the checklist" below. |
| Wipe clears IndexedDB and storage.local | PASS | `settings.ts:86-88`: forgets the keys, deletes the database, clears `storage.local` and `storage.session`. It works while locked (`crypto-locked.spec.ts:106-107`). The deleted rows' bytes are subject to the same residue as SEC-1, which predates Sprint 6. |
| Install id random, resettable, the only identifier | PASS | Unchanged. The key id (`crypto.keyId`, 6 random bytes) never leaves the profile, except inside an export (SEC-4). |
| `log.ts` only; no DOM or raw objects | PASS | No `console` in the 64 files. The 17 new events log constant values. Commands are logged by name, errors by name and code; the logger never prints an error's message. |
| No PII in user-facing errors | PASS | Every message is a fixed sentence (`crypto-text.ts:11-20`, `UnlockForm.tsx:15-19`). |
| No bare catch; every catch logs | GAP | SEC-6: `crypto.ts:114`, `seal.ts:67`, `:98` and `alarms.ts:131` swallow errors, and two of them turn a damaged state into "wrong passphrase". `middleware.ts:98` rethrows a typed error, and `crypto-job.ts:35` restarts a table: both are acceptable. |
| Telemetry API items | N/A | `telemetry-api/` is unchanged. |
| `pnpm audit --prod` | NOT RUN | It needs the network, which this review does not use. The one new package has no dependency of its own (lockfile: `'@noble/ciphers@2.4.0': {}`) and no install script. |
| New dependency logged | GAP | SEC-10. |
| Vendor terms | PASS | Re-read in 6.7 (Decisions [6.7]); OpenAI's are in MANUAL.md. No adapter changed. |

## Beyond the checklist

**Can a passphrase or key reach a log, an export, IndexedDB in the clear, `chrome.storage.local`, a content script or the network?** No, with SEC-4 for the passphrase's verifier.

- **Logs.** Commands are logged by name (`crypto.ts:98`), and a dropped message by its type (`listen.ts:97-101`). Pages log only an error, and the logger never prints an error's message.
- **The ledger and the export.** `meta` holds the key's id, salt, rounds and check. During a passphrase change it also holds the key before, sealed under the new one (`crypto-writes.ts:58-63`). No key is ever in the clear.
- **`chrome.storage.local`.** Never used for the ledger key: `session.spec.ts` "never touch chrome.storage.local".
- **Content scripts.** Four controls keep the key from them:
  - the session area keeps Chrome's default access level, and no code widens it (the only `setAccessLevel` call is `byo.ts:48`, on `local`);
  - the crypto commands are page-only;
  - `runtime.sendMessage` from a page never reaches a content script;
  - no content entrypoint imports a crypto or ledger module.
- **The network.** No new request.

**Does the sealing middleware fail closed on every read and write path?** Yes while locked: `mutate` (add, put, delete and deleteRange), `get`, `getMany`, `query`, `openCursor` and `count` each refuse before reaching IndexedDB (`middleware.ts:126-155`).

- **Dexie's higher calls.** `modify`, `update`, `upsert`, `bulkPut`, `bulkUpdate`, `delete` and `clear` are built on those methods.
- **Cursors.** A cursor opens each value only when it is read, so a lock part-way through a cursor fails the whole iteration: the key is no longer held (`:93-94`).
- **A key not held.** A sealed row under a key this context does not hold fails the whole read.
- **No bypass.** Nothing in `src` or `entrypoints` reaches IndexedDB outside Dexie: no `backendDB`, no raw `indexedDB`.
- **Its place in the stack.** The sealing middleware sits at level 10, above Dexie's hooks (2), virtual index (1), observability and cache (0) and cacheExistingValues (−1), so those see rows as stored. Attest uses no Dexie hook and no liveQuery.
- **The one opening.** A context's keyring starts open, so a write before the keyring loads goes in the clear (SEC-7). A migration that reads a sealed row fails closed, as Decisions [6.5] says.

**Key and IV handling.**

- **Nonces.** Every value gets a fresh 96-bit nonce from `getRandomValues` (`seal.ts:27`), tested by "uses a fresh nonce". So do the key check and the wrapped key. A ledger stays far below the 2^32 seals per key that random nonces allow.
- **Additional data.** It is the table plus the row's primary key as JSON (`middleware.ts:69`). Every sealed table has an inbound key (no `++`, no outbound key), so the additional data always names the row. The fields kept in the clear are not covered (see the design notes).
- **The key check.** It is a fixed text sealed under `crypto:check`, opened before any row is read. A wrong passphrase gets `wrong_passphrase` and the ledger stays locked.
- **The key before a passphrase change.** It is sealed with additional data that names its own id (`seal.ts:79-82`), deleted when the job ends (`crypto-writes.ts:76-81`), and kept for the pages in session memory until then.
- **The key derivation.** PBKDF2-SHA256 at 600,000 rounds, over a 16-byte salt made at each new passphrase, gives a 256-bit key. Unlock, change and turn-off accept stored rounds only from 600,000 to 6,000,000 (`crypto.ts:110`), a bound no test pins (SEC-6).

**Does a restart of the service worker require the passphrase again?** Yes. `holdKeysHere()` runs first in `main()` (`background.ts:25`) and empties the worker's keys; the worker's keyring reads only its own memory, so it starts locked.

The window between a stop and the next start:

- Open pages keep their keyring, and a page opened in the window reads the session copy. Pages read; they cannot write, since the worker is the ledger's one writer and it starts locked.
- The next start clears the copy, and every page locks. The 5-minute grace alarm (`config.ts:231`) bounds the window.
- §12 documents it. With keep-awake, an unplanned stop is rare, and the ledger stays unlocked for as long as Chrome runs unless the person locks it (design notes).

**Page-only commands.** Confirmed above. A content script's `crypto.*` message is parsed, then dropped as `untrusted_context` before any handler runs.

**The keep-awake loop.**

- It calls `runtime.getPlatformInfo` every 20 seconds while a key is held, and stops on lock, Delete all data and turn-off.
- It reads nothing, sends nothing and needs no permission.
- Its cost is that nothing ever locks on its own.

**Locked-state refusals.** All of these are tested in `crypto-locked.spec.ts`:

- The four observer messages are refused after the site and reader checks (`router.ts:114-133`), and imports likewise (`:98`).
- The grace alarm runs upkeep only, while the purge, the digest and the usage numbers wait (`alarms.ts:118-132`). The catch-up runs them at the next unlock (`catch-up.ts:31-44`).
- A grant save or a receipt mark fails in the middleware as `failed`. Both are reached only from pages that show the lock.

**Strictness of the manifest audit.** See SEC-3.

**Could test-only harness code ship?** No.

- Both harnesses live under `tests/`. They are bundled in memory by `tests/e2e/support/test-bundle.ts` and injected into a page with no extension, while WXT builds only `entrypoints/`.
- `built-bundle.spec.ts` fails on either marker, and on any shipped path naming a harness or tests.
- Shipped code has no test hook: no `__attest`, `globalThis.` or `process.env`.
- The dev pages (`dev`, `model-check`) ship in every build but the release one, as before.

## Gaps

| # | Sev | Rule | Where | Gap |
| --- | --- | --- | --- | --- |
| SEC-1 | MEDIUM | HR2, HR12 | `src/ledger/crypto-job.ts:47-51`; `tests/e2e/support/encryption.ts:1-5`, `:38-88`; `tests/e2e/redteam-encryption.spec.ts:38-62`; `EncryptionStatement.tsx:10-14` | Plaintext written before encryption can stay in the profile's IndexedDB files; the copy is only ever read through IndexedDB's API |
| SEC-2 | MEDIUM | HR10 | `src/background/byo.ts:70`; `EncryptionStatement.tsx:10-23`; `docs/privacy-architecture.md:591-601` | With encryption on, the person's own model key stays in `chrome.storage.local` in the clear, and the Encryption section does not say so |
| SEC-3 | MEDIUM | HR1, HR8, HR9 | `scripts/audit-manifest.ts:43`, `:44-51`, `:65-88`, `:91-118`; `wxt.config.ts:138`; `docs/threat-model.md:57` | The manifest audit passes a wildcard optional host, incognito, Chrome 114 and remote hosts in every CSP fetch directive but `connect-src` |
| SEC-4 | LOW | HR10 | `src/ledger/export.ts:141`; `src/ledger/export-file.ts:121`; `tests/e2e/encryption.spec.ts:52-54` | An export of an encrypted ledger carries the passphrase's salt, rounds and key check: an offline guessing oracle |
| SEC-5 | LOW | HR5 | `src/ledger/shared.ts:49-61`; `src/background/crypto.ts:70-76`, `:172-180` | A failure while locking leaves pages unlocked: a failed reload keeps the keys, and Lock now clears nothing when the worker holds none |
| SEC-6 | LOW | HR6 | `src/background/crypto.ts:106-119`, `:160`, `:245-247`; `src/crypto/seal.ts:62-70`, `:85-101`; `src/background/alarms.ts:131` | A damaged encryption state is reported as a wrong passphrase, or as locked, and never logged as damage |
| SEC-7 | LOW | HR2 | `src/crypto/keyring.ts:28-29`; `src/ledger/shared.ts:63-66`; `src/ledger/migrations.ts:184-198` | Until its keyring loads, a context writes the sealed tables in the clear; only a Decisions sentence stops a migration doing so |
| SEC-8 | LOW | HR5, HR7 | `src/ui/labels.ts:119-120` | The Unasked notice understates what Unasked misses: sends with an agent's activity near them go unflagged too |
| SEC-9 | LOW | — | `docs/privacy-architecture.md:583`, `:476`; `PRIVACY.md:90`; `README.md:9`; `src/bus/send.ts:191-193` | Four statements about encryption are inexact |
| SEC-10 | LOW | — | `extension/package.json:34`; Decisions [6.5]; `build_spec.md:131` | @noble/ciphers' Decisions line lacks size, maintenance and the timing trade against WebCrypto; build_spec §5 still says WebCrypto |

### SEC-1 (MEDIUM, HR2, HR12): a copy of the profile can still hold what was written before encryption

**Where.**

- `extension/src/ledger/crypto-job.ts:47-51`: the job reads up to 200 rows and `bulkPut`s them back sealed. Each row gets a new version; IndexedDB is never asked to forget the old one, and no extension API could ask.
- `extension/tests/e2e/support/encryption.ts:1-5`, `:38-88`: `ledgerAtRest` reads the live rows through `indexedDB.open` and `getAll`, "as someone who copied the profile would".
- `extension/tests/e2e/redteam-encryption.spec.ts:38-62`: the copied profile (`:49`) is launched and read with `ledgerAtRest` (`:54`, `:60`). No file of the copy is ever read.
- What the copy is promised:
  - `EncryptionStatement.tsx:10-14` says "someone who copies your Chrome profile cannot read them";
  - `docs/privacy-architecture.md:591` says the same;
  - `docs/attacks-that-work.md:36` records strategy 13 as 0 of 3;
  - `PRIVACY.md:90` describes the feature.

**What happens.**

1. A person uses Attest for weeks, then turns encryption on. The job rewrites every row, sealed.
2. IndexedDB's live view now holds only sealed values, and that view is all the tests read.
3. Chrome keeps the extension's IndexedDB as files in the profile. In the LevelDB store Chrome has long used, a put never overwrites in place: it adds a new version to the log, and later to the table files. The version it replaces goes only when a compaction rewrites the files that hold it. Until then the plaintext rows are bytes in the profile: addresses, subjects, amounts, what the person asked an agent.
4. Someone who copies the profile reads those files directly, without Chrome or the extension, as any forensic tool does. Read through the API, as the test reads them, a replaced version never shows. So "0 of 3" measures a weaker attack than the one the options page rules out.

The same holds after a passphrase change: rows under the old key stay in the files for a while. So a copy taken after the change can still open in part with the old passphrase, which is often why it was changed. Delete all data and the purge leave the same kind of residue; that predates Sprint 6.

How long the residue lasts depends on Chrome's storage engine and its compaction, and nothing has measured it. That is the gap (Hard Rule 12): a copy of the profile is exactly what §12 says encryption guards against.

**Fix.**

- **Measure.** In strategy 13, read every file under the copied profile's IndexedDB folder as bytes, and search them for each invented value:
  - search both as Latin-1 and as UTF-16LE, since V8 serialises a string either way;
  - decode any compressed blocks of the table files first;
  - search once before the copy is opened and once after.

  Publish the number in docs/attacks-that-work.md, whatever it is.
- **Say it.** In the options statement, §12's "What it does not protect" and `PRIVACY.md`, add: records stored before encryption was turned on, or under a passphrase since changed, can remain in Chrome's database files until Chrome compacts them. To keep a copy from ever holding them, turn encryption on before using Attest, or use Delete all data first and start with it on.
- **Offer it early.** Offer encryption when Attest is installed, so that a person who wants it never stores a plain row.

### SEC-2 (MEDIUM, HR10): with encryption on, the person's own model key stays in the clear

**Where.**

- `extension/src/background/byo.ts:70`: `storage.set` stores the key as given, under `attest.byoKey` (`src/config.ts:26`).
- `extension/entrypoints/options/components/EncryptionStatement.tsx:10-23`: "Not sealed: ids, hashes, dates, grades and states … and your settings."
- `docs/privacy-architecture.md:591-601`, §12's "What it protects" and "What it does not protect"; `PRIVACY.md:90`.

**What happens.**

- **The threat.** Encryption at rest exists for "a copy of your Chrome profile". `chrome.storage.local` lives in that same profile (`Local Extension Settings/<id>`), written as is.
- **What a copy yields.** With encryption on and a key saved, a copy gives the person's Anthropic or OpenAI secret key in the clear. That key bills the person, and opens their API account.
- **What the person is told.** The options page's list of what is not sealed ends with "your settings", and §12 lists the tables without content; neither names the key. §5 and §10 say where the key is kept, but not that encryption leaves it readable.

So a person who turns encryption on to protect a copy of their profile still hands over their API key in that copy.

**Fix.** Either:

- **Seal it.** While encryption is on, keep the key sealed under the ledger key, with additional data naming it, and open it only in the worker while unlocked. The model runs only in the grading batch, which waits while locked anyway. Seal it again at a passphrase change, and open it for good at turn-off.
- **Or say it**, in the options statement, §12's list and `PRIVACY.md`: "Your own model key is not sealed: a copy of the profile holds it."

Either way, add a unit test.

### SEC-3 (MEDIUM, HR1, HR8, HR9): the manifest audit passes a looser manifest

**Where.**

- `scripts/audit-manifest.ts`:
  - `:43`: `MIN_CHROME_VERSION = 114`;
  - `:44-51`: the forbidden keys;
  - `:65-88`: the CSP check;
  - `:91-118`: the keys read.
- `extension/wxt.config.ts:138`: the shipped CSP; `:169-172`: Chrome 120, `incognito: 'not_allowed'`.
- `docs/threat-model.md:57`: "Each adds one host, the CSP allows no other".
- Decisions [0.1] (`Decisions.md:70`: Chrome 120 is the minimum) and [1.close] (`:766`: the Unicode baseline assumes Chrome 120's ICU, Hard Rule 4).

**What happens.** Each of these passes `auditManifest`, and so passes CI:

1. **A wildcard optional host.** `optional_host_permissions: ["<all_urls>"]`, or `https://*/*`, is never read. The sprint's Done-when says a wildcard host fails CI; this one does not, and code could then ask Chrome for it at runtime.
2. **Incognito.** `incognito: "spanning"` or `"split"` is never read. Privacy architecture §3 and Decisions [2.close] rely on `not_allowed`, so that an incognito Gmail tab is never read into the regular profile's ledger (Hard Rules 2, 11).
3. **Chrome 114.** `minimum_chrome_version: "114"` passes, below the 120 the project locked.
4. **The CSP.** Only `script-src`, `object-src` and `connect-src` are held:
   - A `default-src`, `img-src`, `font-src`, `style-src`, `media-src`, `frame-src` or `form-action` naming any host passes. Beyond the `unsafe-` keywords, the regex refuses only a bare `*`, `http:` or `https:`, and anything starting `data:` or `blob:`.
   - So does a host in `script-src-elem` or `script-src-attr`. Chrome's own MV3 check is then the only guard.
   - The shipped CSP has no `default-src`, so it already allows images, fonts, styles, media and frames from any host.
   - The threat model says "the CSP allows no other [host]". Today Hard Rule 1 is held by the code and the network test, not by the CSP.

Two smaller points:

- `chrome_settings_overrides`, which can change the search engine or home page, is not forbidden.
- The audit runs on the development build only. The release zip's manifest is the same today, but nothing checks it.

**Fix.**

- Read `optional_host_permissions` and refuse any entry: none is needed.
- Require `incognito` to be `not_allowed`.
- Hold `minimum_chrome_version` to at least 120, from one constant shared with wxt.config.ts.
- Give the CSP `default-src 'self'`, plus `img-src 'self' data: blob:` only if the share preview needs it. Have the audit require `default-src` to be `'self'` or `'none'`. It should also refuse any host in every fetch directive but `connect-src`, and anything but `'self'` in `script-src-elem`, `script-src-attr` and `worker-src`.
- Forbid `chrome_settings_overrides`.
- Run `pnpm audit:manifest` on the zip's manifest inside `build:release`.
- Add one test per hole in `tests/unit/tools/audit-manifest.spec.ts`, and correct threat-model.md:57.

### SEC-4 (LOW, HR10): the export carries the passphrase's verifier

**Where.**

- `extension/src/ledger/export.ts:141` and `src/ledger/export-file.ts:121` export all of `meta`.
- `src/ledger/crypto-state.ts:14-30`: `meta` holds `crypto.keyId`, `crypto.salt`, `crypto.iterations` and `crypto.check`, and during a change `crypto.previous`.
- `tests/e2e/encryption.spec.ts:52-54` pins those keys in the export.
- `docs/privacy-architecture.md:585` promises only that the key itself is "never in an export".

**What happens.** An export of an encrypted ledger holds the salt, the rounds and the key check: everything needed to test passphrase guesses offline, at PBKDF2's pace, away from the profile.

- The export already holds the records in the clear, so the records lose nothing more.
- The passphrase does. People reuse passphrases, and an export is the file most likely to travel: `pnpm attest replay` reads one, and a person may attach one to a bug report.
- `crypto.previous` is harmless without the new key.

**Fix.**

- Leave every `crypto.` key out of both exports. They mean nothing outside this profile, and replay reads none.
- Read them from `meta` directly in `encryption.spec.ts:52-54`.
- Give the secret-seed test a case with encryption on and an invented passphrase. It should search every channel for the passphrase and the key's base64, and for `crypto.check` in the export; only `chrome.storage.session` may hold the key.

### SEC-5 (LOW, HR5): a failure while locking leaves pages unlocked

**Where.**

- `extension/src/ledger/shared.ts:49-61`: a keyring reload that throws is logged, and the keyring is kept as it was.
- `src/ledger/crypto-state.ts:81-86`: the keyring is replaced only after both reads succeed.
- `src/background/crypto.ts:70-76`: the clear at the worker's start is neither awaited nor retried.
- `src/background/crypto.ts:172-180`: `crypto.lock` does nothing unless this worker holds a key.

**What happens.** By design, a lock clears the session copy, and every page then reloads its keyring from it. Two failures break that:

- **A failed reload.** If the reload throws (a failed `meta` read, or a failed `storage.session.get`), the page keeps the keys it had and keeps reading, while the worker is locked.
- **A failed clear at start.** Every page then reads the old copy until the browser closes. The popup shows records, so it never offers the unlock. Lock now answers "Locked." while clearing nothing, because the restarted worker holds no key.

Both need a storage failure first, so this is defense in depth, not a reachable attack. But here the failure is open, where the rest of the design fails closed.

**Fix.**

- Set a guarded, keyless keyring before reading the state, and on any failure (`loadKeyring`, or `reloadKeyring`'s catch).
- Make `onCryptoLock` always clear the session copy.
- Await the start's clear before the first command, and retry it once.

### SEC-6 (LOW, HR6): a damaged encryption state is reported as a wrong passphrase, or as locked

**Where.**

- `extension/src/background/crypto.ts:106-119`: a missing field, rounds outside 600,000 to 6,000,000, or a salt that is not base64 all return `undefined`, which is answered `wrong_passphrase`. The base64 catch at `:114` logs nothing.
- `src/crypto/seal.ts:62-70` and `:85-101`.
- `crypto.ts:160`: a `crypto.previous` that does not unwrap is dropped silently.
- `src/crypto/middleware.ts:93-94` with `crypto.ts:245-247`: a row under a key not held fails as `locked`, and the job logs it as `crypto.job_paused`, at info.
- `src/background/alarms.ts:131`.
- No unit test sets stored rounds outside the bounds: no case uses `MIN_KDF_ITERATIONS` or `MAX_KDF_ITERATIONS`.

**What happens.** The encryption state in `meta` can be damaged by a partial write, a disk error or an edited profile.

- **Damaged state.** The person types the right passphrase and is told "That passphrase does not open your records", every time. The log holds only `crypto.unlock_refused`.
- **Damaged `crypto.previous`, mid-change.** The unlock succeeds. Then every read of a table that still holds old-key rows fails as `locked`, the pages show the unlock prompt again, and the job logs that it paused.

Nothing is exposed: each path fails closed. But Hard Rule 6 asks for a loud failure, and these loop the person through a false reason. The rounds bound, which Decisions [6.5] counts as a control, has no test.

**Fix.**

- Answer a state that cannot be read with a code of its own (`damaged`), and log it at error, naming the field.
- Log a `crypto.previous` that does not unwrap at error.
- Give the middleware a third code for a key not held while unlocked (`unknown_key`), and log the job's stop at error.
- Add unit tests for rounds of 599,999 and 6,000,001, and for a damaged salt and key before.

### SEC-7 (LOW, HR2): until its keyring loads, a context writes the sealed tables in the clear

**Where.**

- `extension/src/crypto/keyring.ts:28-29`: every context starts `OPEN`, neither sealing nor guarded.
- `src/ledger/shared.ts:63-66`: `openLedger()`, which runs every migration, runs before `loadKeyring`.
- `src/ledger/migrations.ts:184-198`.
- `src/crypto/middleware.ts:76-77`: when not sealing, a row is written as it is.
- Decisions [6.5] (`Decisions.md:1635`).

**What happens.** The middleware cannot tell "not encrypted" from "not known yet".

- Reads fail closed meanwhile, because a sealed row's key is not held.
- Writes do not. A migration that writes a row into a sealed table of an encrypted ledger writes it in the clear, and nothing ever seals it again, because no job is under way.

Migrations 1 to 11 write no sealed row. The only guard on a twelfth is a sentence in Decisions.

**Fix.** Either:

- Read `crypto.sealing` inside the upgrade transaction, before any upgrade function runs, and refuse a write to a sealed table while it is on and no key is held.
- Or, at least, add a unit test that fails when a migration above 11 has an `upgrade` that touches a table in `SEALED_TABLES`.

### SEC-8 (LOW, HR5, HR7): the Unasked notice understates what Unasked misses

**Where.**

- `extension/src/ui/labels.ts:119-120` defines the notice.
- It is shown at `entrypoints/sidepanel/components/TimelineFiltersForm.tsx:54` and in `entrypoints/digest/components/DigestCoverage.tsx`.
- `docs/attacks-that-work.md:15`; Decisions [6.9] (`Decisions.md:1651`).

**What happens.** The notice reads: "Attest marks a send as likely Unasked only when an agent was active near it, so a send with no agent activity near it is never flagged."

The measured rule is two signals near the send. Strategy 10's misses include sends with an agent's activity near them:

- one logged action, or one claimed action;
- two logged actions, which count as one session signal;
- a send one minute after a send the agent does claim.

So a person who reads the notice infers that a send near their agent's activity would have been flagged. Task 6.9 accepted the HIGH on condition of a notice that stops exactly that misreading.

**Fix.** State the rule as measured. For example: "Attest marks a send as likely Unasked only when two signs point to an agent near it, such as the agent's logged activity and your being away. A send with less than that is not flagged, even if an agent made it." Pin the sentence in `copy.spec.ts`.

### SEC-9 (LOW): four statements about encryption are inexact

1. **The passphrase's route.** `docs/privacy-architecture.md:583` says the passphrase "goes only from the page you typed it in to the service worker"; so do `src/bus/send.ts:191-193`, `src/bus/crypto-commands.ts:6` and `entrypoints/options/use-crypto-status.ts:4-5`.
   - In fact, `runtime.sendMessage` from a page reaches every extension page with a listener, and every page that watches the ledger has one (`src/ui/data.ts:134-139`).
   - Each of those pages parses the command, passphrase included, and drops it as `no_handler` (`listen.ts:189-190`).
   - No content script or other origin receives it, so nothing crosses a boundary, but the sentence is wrong.
   - Fix: say "to Attest's own pages and service worker", or send the commands over a port only the worker opens.
2. **"While it is locked, Attest reads and stores nothing"** (`PRIVACY.md:90`). The content scripts still read the page at every pass (`src/observers/base.ts:7-8`); the worker refuses what they send. Fix: say "stores nothing it reads".
3. **"encrypts what Attest keeps with a passphrase"** (`README.md:9`). Encryption seals the content fields; the ids, dates, grades, settings and model key stay as they are (SEC-2). Fix: say "seals what it keeps about your messages and events".
4. **The usage numbers' timing.** §11's "How often" (`docs/privacy-architecture.md:476`) never says that while the ledger is encrypted and locked, the day's send waits and goes at the unlock (`src/background/catch-up.ts:36`). So the hour the server stores can be the hour the person first unlocked Attest that day. Fix: say so in §11.

### SEC-10 (LOW): @noble/ciphers' Decisions line is incomplete

**Where.** `extension/package.json:34`; Decisions [6.5] (`Decisions.md:1629`); `build_spec.md:131`.

**What happens.** For a new dependency, the checklist asks for its size, licence and maintenance. The Decisions line gives:

- the licence (MIT);
- no dependencies and no install scripts;
- why WebCrypto could not be used.

It omits:

- the size it adds to the bundle;
- the maintainer, the release cadence, and whether this version was audited.

It also never weighs the trade it makes. WebCrypto's AES runs on the CPU's AES instructions, while a JavaScript AES uses table lookups whose timing can depend on the key. The package's own README says constant time is not guaranteed in JavaScript (`node_modules/@noble/ciphers/README.md:409-417`). That matters little here, since an attacker in the same process could read the key anyway, but the Decision should say so.

Finally, build_spec §5's locked row still says "WebCrypto AES-GCM".

**Fix.**

- Add to Decisions [6.5]: the bytes the package adds to the bundle; its maintainer, last release and audits; and the timing note.
- Amend build_spec §5's row with a reference to that Decision, as the Sprint 5 close did for Hard Rule 1.

## Design notes (not defects)

- **No automatic lock.** Keep-awake holds the key in the worker and in session memory for as long as Chrome runs, unless the person locks it. §12 documents this: "Lock now, or closing Chrome, locks them."
  - The longer a key stays in memory, the likelier it is to be paged to swap or a hibernation file, which a disk copy includes on a computer without disk encryption.
  - A lock when the person goes away (through the optional `idle` permission) would bound that.
  - The key's bytes are not zeroed on lock: `hold({})` only drops the references.
- **The window after an unplanned stop.** Pages keep reading with their keys until the next start of the worker, and cannot write; the grace alarm restarts the worker within 5 minutes. §12 documents it.
- **The plain fields are not authenticated.** The additional data binds a sealed value to its table and key, but not to the fields kept in the clear beside it. Someone who can write the profile could change a receipt's grade or state without the passphrase. Encryption at rest claims confidentiality only, and nobody writes the profile without already controlling the computer.
- **Hashes in the clear.** `contentHash`, `rawHash` and `accountHash` let someone confirm a guess, as §2 and §6 say. A Gmail row's `contentHash` also hashes its sealed `rowKeyHash`, which defeats most guesses.
- **The passphrase floor.** It counts UTF-16 units after NFC (`crypto-commands.ts:18-21`), and Attest checks no strength; §12 says to use a long passphrase.

## Commands run

- `git log --oneline 3091d86..8065826` (22 commits), and `git diff --name-only` and `--stat` (172 files). At the start, `git status` showed a clean tree at 8065826.
- The checklist's network grep over `src` and `entrypoints`, with EventSource and importScripts added: two hits, both cited above.
- Greps over the 64 changed `.ts` and `.tsx` files for:
  - HTML sinks, `eval`, `new Function` and `import(`;
  - acts on the DOM, `console`, `eslint-disable`, executeScript and tab calls;
  - every `catch`.
- Greps over shipped code for:
  - `setAccessLevel` and `storage.session`;
  - `backendDB` and raw `indexedDB`;
  - `localStorage` and `sessionStorage`;
  - test hooks: `__attest`, `globalThis.` and `process.env`;
  - any crypto or ledger import in the content entrypoints, observers and adapters.
- In the build on disk (`extension/.output/chrome-mv3`, 16:51, from HEAD):
  - the manifest, printed;
  - `fetch(` appears only in `background.js`;
  - `Function(` appears only as Zod's probe;
  - no `eval(`.
- Read in `node_modules`: `dexie/dist/dexie.mjs` for the middleware levels and the stacking order; `@noble/ciphers/package.json` for the scripts and licence; its README's note on timing.
- The `pnpm-lock.yaml` diff: one package added, with no dependency of its own.
- `bench/traces/popup-paint.zip`, the Sprint 6 bench results, RESULTS.md and the new docs: no home-folder path.
- The changed files hold no personal value but the repository's GitHub address; the one key-like string is a test's invented key.
- Read, not rerun: the QA pass's logs in `scratchpad/qa6/`. Lint and typecheck exit 0; 534 unit files, 11,182 tests passed, 7 skipped.
