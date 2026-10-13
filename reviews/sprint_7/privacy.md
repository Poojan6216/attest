# Sprint 7 — Privacy review (7.7)

Role: `agents/privacy_reviewer.md`, run in full, reading Attest 0.1.0 as the Chrome Web Store's reviewer and a privacy regulator would. Range: `20bd94a..509f3b6` (7.0 to 7.6) and the whole product as it would ship. Written 2026-10-13. Nothing was fixed; this file is the review's only write.

**What was read.** The production build that exists, `extension/.output/chrome-mv3/` (made by `pnpm build` at 05:36 from `509f3b6`, the tree then differing only in `MANUAL.md` and `sprints/sprint_7.md`): its manifest, every bundle, every source map. The store zip cannot be built yet: `pnpm build:release` refuses the placeholder telemetry host until the API is deployed (MANUAL.md, Sprint 5). The release build differs from this one in two ways only. It leaves out the two development pages, `dev.html` and `model-check.html` (`releaseEntrypoints`, `extension/wxt.config.ts:108-113`). Its CSP and its telemetry call name the deployed host instead of `telemetry.attest.invalid`. Also read: `PRIVACY.md` 0.9, `docs/privacy-architecture.md` v3.1, `README.md`, all of `launch/` (the listing, the five screenshots, the promo tile, the GIF's six frames, every post), the code behind each answer the listing gives (`src/telemetry/schema.ts` and `send.ts`, `src/intel/input.ts`, `prompt.ts` and `providers/byo.ts`, `src/background/intel.ts`, the options page's statements), and `telemetry-api/` (`stats.py`, `main.py`, `store.py`, `settings.py`, its README). The vendors' terms were re-read on 2026-10-13.

**Verdict: NOT READY.** No data leaves the browser in a way the code does not disclose, and nothing CRITICAL was found. Four HIGH items block the store, all known and all the founder's: a public address for the policy, a public source, the release zip, and the certified privacy form. Sprint 7 also added a public server endpoint and launch copy, and seven MEDIUM gaps came with them. The privacy policy lags the code and the listing in three places: what the own key sends, whether a server runs, and what the server keeps and for how long. A new public use of the usage numbers is not stated where people consent to them. The 50-install floor on that publication can be beaten with made-up installs. Some launch copy says "never" where an opt-in option sends. Each MEDIUM is a text or small server change the closer can make before submission.

## Sprint 6's gaps, now

| Sprint 6 pre-review gap | Now |
|---|---|
| 1. The privacy policy has no public URL | Open: gap 1 below. |
| 2. No public link to the source | Open: gap 2. |
| 3. The privacy practices form is the founder's to certify | Open: gap 4. The draft answers are now correct: 7.4 added reader health, the match's id and the merchant, and `store-listing.spec.ts` holds them to the schemas. One answer is still missing: the categories for the usage numbers. |
| 4. OpenAI's terms not re-read | Open: gap 5. openai.com answered 403 again on 2026-10-13. Meta's, Anthropic's and Google's terms were re-read the same day and are unchanged. |
| 5. No screenshots with fixture data only | **Closed.** Five 1280×800 screenshots and the 440×280 promo tile exist, made by `pnpm record-screenshots` on synthetic pages with invented data, each page checked for seeded secrets and non-example addresses before its shot. All six images and the GIF's six frames were viewed: no real name, email or amount (CONFIRMED). |

## GAPS

1. **[HIGH] (MANUAL, known state) The privacy policy has no public address.** So neither the manifest (no `homepage_url`) nor the listing ("Privacy policy URL: not set yet", `launch/store-listing.md:78`) can link it → MANUAL.md, Sprint 7 (make the repository public, then enable GitHub Pages); sprint_7 7.2 is BLOCKED(MANUAL) → Chrome Web Store User Data policy (an item that handles user data must post a privacy policy and link it); role: "Privacy policy URL live, linked in the manifest and the listing". Sprint 6 gap 1.

2. **[HIGH] (MANUAL, known state) No public source, and every pointer to it is a 404 for anyone but the founder.** That includes three links a store reviewer would follow:
   - the options page's "Read how" privacy link (`PRIVACY_DOC_URL`, `extension/src/config.ts:400`);
   - the degraded banner's "Report on GitHub" (`ISSUES_URL`, `:394`; it is in `launch/screenshots/4-degraded.png`);
   - `PRIVACY.md`'s Contact (line 169) and its "public source repository" (line 165).

   Beyond those, the README's CI badge and the posts' "Read the source" and "the code is open" are dead too → MANUAL.md, Sprint 7 (decide visibility; first the real-capture clean-up, SEC-L2, and the license) → CWS code readability; role: "the public repo is linked". Sprint 6 gap 2.

3. **[HIGH] (MANUAL, known state) The store zip does not exist, so this review read the development build.** After the API is deployed and `pnpm build:release` runs, re-check `extension/.output/attest-0.1.0.zip`:
   - (a) `unzip -l` lists no `dev.html`, `model-check.html` or their chunks;
   - (b) the manifest's `connect-src` names the deployed host and nothing under `.invalid`;
   - (c) the bundles still hold exactly two `fetch(` call sites, both in the service worker;
   - (d) `pnpm audit:manifest` passes on the zip;
   - (e) gap 7's sentence is gone from `PRIVACY.md`.

   → MANUAL.md, Sprint 5 (deploy the API) and Sprint 7 (release) → sprint_7 7.7: "re-run on the release zip".

4. **[HIGH] (MANUAL) The privacy practices form is the founder's to certify.** The draft leaves one choice unmade and one answer unwritten.
   - (a) How to declare the own-key option (Sprint 6 gap 3).
   - (b) New: the draft names form categories only for the own-key option. For the usage numbers, which include a persistent install id, it gives prose only (`launch/store-listing.md:75`). The dashboard takes ticked categories, and MANUAL.md's new submission step says to "tick the data categories as the 'Privacy practices form' section says". That section should say which boxes the usage numbers tick, or that they tick none and why.

   → `launch/store-listing.md:70-78`; MANUAL.md, Sprint 6 item (2) → CWS User Data policy, disclosure; role: "Data usage form answers match the code".

5. **[MEDIUM] (MANUAL) OpenAI's Terms of Use are still not re-read.** On 2026-10-13 openai.com answered 403 again and the web archive could not be fetched. The other three were re-read the same day: Meta's Terms of Service §3.2 (effective 1 January 2025), Anthropic's Consumer Terms §3 (effective 8 October 2025) and Google's Terms of Service (effective 30 July 2026). Each reads word for word as the clauses quoted in Decisions `[3.10]`, so the decisions stand; the closer logs that in Decisions.md. The ChatGPT reader stays off whatever OpenAI's terms say, so no shipped behaviour depends on them → MANUAL.md, Sprint 6 item (3) → role: "each vendor's terms re-read this sprint". Sprint 6 gap 4.

6. **[MEDIUM] `PRIVACY.md` understates what the own key sends.**
   - Lines 104 and 110 say the model is given "only" the claim's kind, counterparty, subject, amount and time, "and the same for the one sent email or event it matched".
   - The code sends more. `IntelCandidate` (`extension/src/intel/input.ts:35-43`) also carries Attest's id for the match and its merchant. The match can be a purchase's receipt email, since the model is asked about any PENDING PARTIAL receipt (`modelMayRaise`, `src/core/model-raise.ts`).
   - Line 97 ("a sent email or calendar event") also leaves purchases out.
   - The listing (line 76), the README (line 32) and the options page's `ByoStatement` say it correctly. `docs/privacy-architecture.md` §1 (line 30) has the old list, though its §10 table is right.
   - Nothing holds `PRIVACY.md` to the schemas the way `store-listing.spec.ts` holds the listing.

   → `PRIVACY.md:97,104,110`; `docs/privacy-architecture.md:30` → CWS User Data policy (the policy must fully disclose what is shared, and with whom); role: "Optional BYO-key model documented". Fix: name the match's id, the merchant and the purchase case in both places, bump the policy's version, and extend the listing test's field-to-phrase check to `PRIVACY.md`'s model paragraphs.

7. **[MEDIUM] `PRIVACY.md` misstates the telemetry server for the build it applies to.**
   - Line 112 says: "(this pre-release has none running, so nothing arrives anywhere yet)". Yet the policy applies to 0.1.0 (line 3) and calls it "its first release" (line 14). The 0.1.0 store zip can only be built once a real host is set (`assertReleasable`, `extension/wxt.config.ts:119-125`), so for every store install the sentence is false.
   - Line 116 says: "No data reaches us." That contradicts line 112: with the usage numbers on, an install id, two versions, a date and counts reach Attest's server. Line 20 makes the accurate claim: nothing Attest reads reaches its maker.

   → `PRIVACY.md:112,116` → honesty of copy; CWS User Data policy (an accurate policy). Fix: name the host, or say that reports go to it once you turn them on; reword line 116 to what line 20 says.

8. **[MEDIUM] The server's data has no retention, no deletion route, and no named operator or private contact.**
   - `telemetry-api/app/store.py` keeps every `{payload, received_at}` forever: there is no TTL index and no purge. `/v1/stats` reads only the last 30 days, so nothing needs older documents.
   - `PRIVACY.md` says what the server keeps (line 112) but not for how long; nor does `docs/privacy-architecture.md` §11 "On the server" (line 561).
   - The policy does not say how to have an install id's reports deleted. A reset unlinks later reports and deletes nothing (line 122).
   - It does not say who runs the server, or that Railway hosts it and its database.
   - Its only contact is a GitHub issue (line 169). That channel is public, so a deletion request would publish the install id; today it is also private.
   - "Deleting your data" (lines 128-132) says Delete all data and uninstalling remove everything, and does not say that reports already sent stay on the server. The privacy architecture's §7 says so; the policy does not.

   → `telemetry-api/app/store.py`; `PRIVACY.md:112,122,128-132,169`; `docs/privacy-architecture.md:561` → GDPR Art. 5(1)(e), 13(1)(a) and (e), 13(2)(a), (b) and (d), 17: the install id is a pseudonymous identifier and the founder is its controller; CWS User Data policy; role "What leaves". Fix: a TTL index on `received_at` a little over the 30-day window, and say the period; name the operator and the host; give a private contact (an address) and say how to have one install id's reports deleted.

9. **[MEDIUM] The new public use of the usage numbers is not disclosed where people consent to them.** Since 7.5, the server publishes per-agent totals, and a monthly "Agent Reliability Report" on Meta's, OpenAI's and Anthropic's agents is written from them.
   - The options page's text at the toggle (`entrypoints/options/components/TelemetryStatement.tsx`) says what is sent and to whom, not that totals are published.
   - The listing's form answer (line 75) and its Limited Use statement (line 64) do not say it either.
   - `PRIVACY.md` 0.9 does say it (line 112), but still gives the purpose as "to help fix page readers that stop working". Per-agent grade counts and a public report on named vendors go beyond that purpose.
   - No one has consented yet, since the host was never deployed, so the fix costs nothing now.

   → `TelemetryStatement.tsx`; `launch/store-listing.md:64,75`; `PRIVACY.md:112` → CWS User Data policy (prominent disclosure, and consent for each use; Limited Use: use only for the purpose disclosed); GDPR Art. 5(1)(b), 13(1)(c). Fix: one sentence at the toggle and in the listing ("totals across all installs, never one install's, are published"), and widen the stated purpose.

10. **[MEDIUM] The 50-install floor does not deliver what the policy promises.** `PRIVACY.md` (line 112) and `docs/privacy-architecture.md` §11 (line 478) say: "never ... any one install's day, and nothing at all while fewer than 50 installs report".
    - The floor counts distinct install ids, which are unauthenticated (`store.py` `totals`).
    - `POST /v1/aggregate` accepts any UUID v4 from any client. CORS binds browsers only, the server checks no `Origin`, and one client may post 240 times a day.
    - Reproduced on the real routes (`create_app` over the tests' `MemoryStore`, through `TestClient`, no `Origin` header). A second app instance was used only to skip the one-hour cache; in production one would wait an hour. The script is in this review's scratch folder, not committed:

      ```python
      post(payload(uuid4(), VERIFIED=3, NOT_FOUND=2, UNASKED=1))   # the one real install, the only Claude user
      for _ in range(49): post(payload(uuid4()))                   # made up, one client, every count 0
      get("/v1/stats")  # 200: installs 50, claude {receipts 6, verified 3, notFound 2, unasked 1}
      ```

    - Even without made-up installs, there is no per-agent floor. An agent used by one install among 50 publishes that install's 30-day totals.
    - The window rolls daily, so successive answers subtract to single days.
    - The data are counts, never content, so the harm is small. But the policy promises more than the mechanism gives, and until it is fixed the publication is arguably a transfer of user data that is not anonymous (it ties to gap 9). The same trick lets one person skew a public report about named vendors; that integrity side is for the security review.

    → `telemetry-api/app/stats.py`, `app/store.py`, `app/main.py`; `PRIVACY.md:112`; `docs/privacy-architecture.md:478` → honesty of copy; GDPR Recital 26 and Art. 89(1) safeguards; CWS Limited Use. Fix: a floor per agent as well as overall; fixed monthly windows instead of a rolling one; and policy text that says what the floor can and cannot hold. Then turn the reproduction into a test. Do this before the API is deployed: the attack works best while real installs are few.

11. **[MEDIUM] Launch copy says "never" where an opt-in option sends.**
    - The r/privacy title (`launch/reddit/r-privacy.md:7`): "I built a checker for AI agents that never sends your mail anywhere". With the own key on, a sent email's recipient and its 80-character subject go to Anthropic or OpenAI.
    - The DM (`launch/dm-template.md:7`): "in your browser, sending nothing".
    - The chosen Show HN title (`launch/show-hn.md:15`): "(local only, misses some)".
    - The bodies say "unless you turn on an option that sends". `launch-kit.spec.ts` checks numbers, dashes and hype, not these words.

    → the three files → role: "Honesty of copy" (the copy may make no claim the code cannot prove); the product's one promise. Fix: "keeps your mail in your browser" or "never sends your mail to me"; "sending nothing unless you turn it on"; "local by default". Have the kit's test refuse unqualified "never sends", "sending nothing" and "local only".

12. **[LOW] "Counts only" in the summaries.**
    - The listing's description (line 18) and its Limited Use (line 64) call the usage numbers "counts only", and so does `PRIVACY.md` (line 20).
    - The README (line 33) says "counts about the day before".
    - The payload also carries a persistent random install id that joins an install's days, which is the first limitation the privacy architecture itself states (§11, line 470). It also carries two versions, the date, and on/off and OK/DEGRADED values (`TelemetryPayload`).

    The detailed answers are right (listing line 75, `PRIVACY.md` line 112, `TelemetryStatement`) → those lines → honesty of copy; consistency between listing and policy. Fix: "counts, a random install id, versions and the date".

13. **[LOW] `PRIVACY.md` says less about extension storage than the listing does.**
    - "Where it is stored" (line 91) and Permissions, storage (line 140) name only the install id and two session markers.
    - `chrome.storage.local` also holds the own model key and its vendor (`src/background/byo.ts`; `STORAGE_KEYS`, `src/config.ts:14-27`), the choices, the readers turned off, and the ledger's bucket name.
    - `chrome.storage.session` holds the unlocked ledger's keys, which only the encryption paragraph (line 93) mentions, and a rebuild marker.
    - The listing's storage line (line 47) names the key and the session key, so policy and listing disagree.

    → `PRIVACY.md:91,140` → role: "What is stored, where"; consistency of the permission reasons.

14. **[LOW] The server "never stores or logs" the client's address: true of the code, unverified for the host.** The phrase is in `PRIVACY.md:112`, `docs/privacy-architecture.md:470` and `telemetry-api/README.md:11`. It holds for the API's code. Railway's edge keeps its own HTTP request logs, which, to be confirmed in the deployed project, record each request's source address and user agent for the plan's log retention. Each telemetry and own-key request also carries Chrome's full User-Agent (OS and full version), though the payload holds only Chrome's major version → `PRIVACY.md:112`; MANUAL.md, Sprint 5 deploy step 4 → honesty of copy; GDPR Art. 13(1)(e) (recipients). Fix: check the log fields at deploy, then say what the host keeps, or name it as a recipient.

15. **[LOW] The Gmail and Calendar content scripts carry the AI vendors' endpoints as strings.** `content-scripts/gmail.js` and `gcal.js` hold `https://api.anthropic.com/v1/messages`, `https://api.openai.com/v1/chat/completions`, `https://chatgpt.com/`, `https://claude.ai/` and `https://muse.ai/`, because `src/config.ts:49` re-exports `config-network` whole. Neither script has a `fetch`; the service worker's two calls are the only ones, and the CSP and lint fences hold that. Still, a reviewer reading the script that reads mail sees OpenAI's API in it and asks the obvious question: does this send my email to OpenAI? → the content-script bundles; `src/config.ts:49` → CWS review (readable build); reviewer friction. Fix: give the content scripts a config module without those hosts, and have the built-bundle test keep them out.

16. **[LOW] The demo GIF has no invented-data guard.** `store-shots.record.ts` checks each page before its shot (`onlyInvented`: seeded secrets, reserved-domain addresses). `demo.record.ts` checks nothing, yet the GIF is the README's first image and its third frame shows a Gmail page's rows. It is clean today (`DEMO_SENT` is invented, the page synthetic, and all six frames were viewed) → `extension/tests/e2e/demo.record.ts` → role: "Screenshots show no real names, emails, or amounts" (as a guard against regression); 7.3's Done-when.

17. **[LOW] Two of build_spec §11's seven limitations are missing from the README's first section.** The first paragraph (`README.md:10`) carries five. "Dots requires a Pro tier" and "the optional on-device model depends on your Chrome and hardware" appear only under "What it cannot see" (lines 52-62). The listing's fourth paragraph (line 24) lacks them too, and its description never mentions the on-device model → `README.md:10`; `launch/store-listing.md:24` → role: "Known limitations from build_spec.md §11 appear in the README's first section". Fix: add one clause each, or record in Decisions why they are left out (no agent reader ships, and the model is optional).

## CONFIRMED

### Chrome Web Store policy
- **Single purpose.** One sentence in the listing (lines 20 and 58), with every feature mapped to it (line 60). The manifest's name ("Attest — receipts for your AI agents") and summary (116 characters) are the listing's, held by `store-listing.spec.ts`.
- **Limited Use.** The disclosure is present in the listing (line 64) and in `PRIVACY.md` (line 20). For the published totals, see gap 9.
- **Permissions.** One reason per permission (listing, lines 45-54), matching the built manifest exactly:
  - `storage`, `alarms`, `scripting`, `notifications`, `sidePanel`;
  - optional `idle`;
  - the two Google hosts;
  - `incognito: not_allowed`;
  - no `content_scripts`, `web_accessible_resources`, `tabs` or `identity`.

  `pnpm audit:manifest` passed on the build twice.
- **Data answers match the code.** Read against the code:
  - `TelemetryPayload` (install id, two versions, day, readers on, counts per agent and grade, reader health, hours covered).
  - `IntelClaim` and `IntelCandidate`, and the own-key request: the constant system prompt and one data block; the key only in the auth header; `credentials: 'omit'`, `no-referrer`, `no-store`, `redirect: 'error'`; one candidate per call (`src/background/intel.ts` `askOne`).

  The listing's answers (lines 75-76) name every field, held by `store-listing.spec.ts`. `/v1/stats` publishes only the window, the install count and per-agent sums and rates. Its Pydantic models forbid any other key, and `test_never_names_an_install_id` checks the answer. The stats and report tests pass, 11 of 11.
- **No remote or obfuscated code.**
  - The build is minified with source maps beside it: 39 maps, relative paths only, nothing naming this Mac's home folder.
  - Their embedded sources hold addresses only at reserved example domains, or single-letter examples in comments; the names in comments are invented placeholders; no test fixture is bundled.
  - No `eval`, `new Function`, `importScripts`, XHR, WebSocket, `sendBeacon`, `chrome.identity` or Google API.
  - Exactly two `fetch` call sites, both in `background.js`: the own key's and the telemetry's.
  - Every page loads one local module script and no inline script; the CSS has no `url()` or `@import`.
  - The CSP is `script-src 'self'`, with `connect-src` limited to the extension, the two vendors' APIs and the telemetry host.
- **Screenshots and the GIF.** Viewed one by one: the five screenshots, the promo tile, and the GIF's six frames extracted with ffmpeg.
  - The names are invented (Priya, Sam Chen, Vendor Billing) and the addresses use reserved domains (`supplier.example`, `company.example`, `example.com`). No amount appears.
  - "Nothing leaves your browser." shows with both sending options off, as it should.
  - Both recorders use the synthetic pages (`gmail/2026-10-03/synthetic-sent-page-1.html` and `gcal/2026-10-03/synthetic-gcal-week-two-calendars.html`, whose only addresses are at `example.com`, `.org` and `.net`) and the demo's invented rows, never a real capture.
  - The PNGs carry no text or EXIF chunks; the GIF carries no comment extension.

### What is stored, where
- **Every table and field.** Every table, field, allowlist and retention rule is documented and held by `privacy-architecture.spec.ts`, `doc-pins.spec.ts` and `sealed-fields.spec.ts` (all pass). Sprint 7 changed no stored type: the diff touches no ledger or core schema, only the grant form's example hint.
- **Retention.** The purge runs by alarm (`retention.spec.ts` and `retention-alarm.spec.ts` pass). The catch-up after an unlock: two of three tests passed. The third timed out at 60 s under a load average near 760 on 8 cores, while another process ran the end-to-end suite; it passed at the Sprint 6 close. QA should re-run it on a quiet machine.
- **Encryption, uninstall, Delete all data.** Encryption's honest account (§12), uninstall and Delete all data are unchanged since the Sprint 6 close; `settings.spec.ts` passes.

### What leaves (nothing, unless turned on)
- **Usage numbers.** Opt-in and off by default. The schema and a payload made by the real builder are in §11 (`telemetry-example.spec.ts` passes). The install id is random and resettable, and the options page shows the next payload.
- **The own key.** §10's field table is exact, and the options page's `ByoStatement` says exactly what is sent, to which host, under whose terms. For `PRIVACY.md`, see gap 6.
- **Chrome's on-device model.** It runs on the device and sends nothing (`PRIVACY.md:101`; §10).
- **The GitHub issue.** "Report on GitHub" prefills the adapter's id, its version and Chrome's major version, nothing else (`reportUrl`, `src/ui/receipt-labels.ts:102-109`).
- **Alerts.** They name the grade, the agent, the kind of action and its time, never a counterparty, amount or subject (`src/ui/alert-text.ts`).
- **The mandatory tests in CI.** Both `@mandatory` tests run in CI with a check that each ran and passed (`.github/workflows/ci.yml:216-223`). They were not run here: no Playwright in this review.

### Third parties and vendors
- **Vendor terms.** Meta, Anthropic and Google re-read on 2026-10-13, unchanged in the clauses that decided `[3.10]`. OpenAI: gap 5.
- **Google access.** Gmail and Calendar are read only in the person's own tabs, with no Google API and no OAuth. There is no `identity` permission and nothing calls `googleapis`; this is documented in §1.
- **No data broker, analytics or crash reporter.** The extension's runtime dependencies are `@noble/ciphers`, `dexie`, `preact` and `zod`. The API's are FastAPI, motor, Pydantic, pydantic-settings and uvicorn.

### User rights
- Export (JSON and CSV) and Delete all data are unchanged since the Sprint 6 close; `export.spec.ts` and `settings.spec.ts` pass.
- Every opt-in still has its opt-out beside it: Sprint 7 touched no option.
- **Children.** The listing's audience is adults (line 68), and no feature is age-specific.

### Honesty of copy
- **"Nothing leaves your browser".** The line appears only while both sending options are off. The README and the listing say "unless you turn on an option that sends". The README's grade table defines Verified as matched evidence, never "the agent told the truth". The README never claims more for the server than "no server sees your data", which the architecture holds.
- **The README's first paragraph.** It says: Attest sees only open tabs, so those receipts are UNVERIFIABLE; "likely agent" is the strongest claim; pages change and readers say DEGRADED; agents' pages are not read; desktop Chrome 122 or later. The attacks link is above the fold (line 12). For the two remaining limitations, see gap 17.

### Tests run for this review
- Vitest, 16 files: the listing, the privacy architecture, the telemetry example, headers, README, launch kit, demo GIF, changelog, doc pins, sealed fields, model input, telemetry schema and parity, outbound calls, manifest hosts and log. All 200 tests pass.
- Vitest, 9 files: retention, the retention alarm, export, settings, catch-up, own key, telemetry send and aggregate. 44 of 45 tests pass; the catch-up timeout above was caused by machine load.
- `uv run pytest` on `test_stats.py` and `test_reliability_report.py`: 11 pass.
- `pnpm audit:manifest`: OK.

## STORE-READINESS VERDICT

**NOT READY.**

**Blocking, all MANUAL and known:**
- Gap 1: a public address for the policy, in the manifest and the listing.
- Gap 2: a public source repository.
- Gap 3: the release zip, built once the API is deployed, then this review's checks re-run on it.
- Gap 4: the founder certifies the privacy form; the draft must first say which categories the usage numbers tick.
- Gap 5: OpenAI's terms re-read in a browser before submission.

**Fix before submission (code and text, the closer's):**
- Gaps 6, 7, 8 and 9: the privacy policy's accuracy, the server's retention and contact, and consent for the new public use.
- Gap 10: before the telemetry API is deployed.
- Gap 11: before anything is posted.

Gaps 12 to 17 are LOW and are worth folding into the same edits.

When gaps 1 to 4 are done and gaps 6 to 11 are fixed, a re-run of this review on the release zip can say READY.
