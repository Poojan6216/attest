# Adapters and fixture capture

**Who this is for:** whoever adds or repairs an Attest adapter or observer, starting with capturing the vendor page it reads.
**What you'll know after:** how to capture a sanitised fixture from your own Chrome, how to check it before you commit it, and what the sanitiser cannot catch for you.

> Stub (Sprint 0, task 0.9). The adapter contract, `selectors.json` versioning and repair steps arrive with the first adapter in Sprint 2. Until then, see `build_spec.md` §7 ("Adapter contract") and `agents/adapter_engineer.md`.

## 1. Start a capture-ready Chrome

The capture tool attaches to a Chrome you are already running, over the Chrome DevTools Protocol on `127.0.0.1`.

Chrome 136 and later refuse `--remote-debugging-port` on your default profile. Use a dedicated profile folder, and sign in to the vendor in it once:

```sh
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.attest-capture-profile"

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.attest-capture-profile"
```

Then, in that window:

1. Sign in to the vendor (first time only; the profile remembers it).
2. Open the exact page you want as a fixture, scrolled to what the adapter needs.
3. Close any open compose window or draft. Text you are typing into an editor is part of the page and would be captured.
4. Close tabs you do not need. Fewer tabs means less chance of capturing the wrong one.

While the debugging port is open, any program on this machine can control that Chrome profile. Quit that Chrome when you are done capturing.

## 2. Capture

From the repo root (or from `extension/`):

```sh
# The first web page open in that Chrome
pnpm capture --vendor muse --name activity

# A specific tab, with the real names and free-text cells you know are on the page
pnpm capture --vendor gmail --name sent-list \
  --tab mail.google.com \
  --names "Priya Raman,Daniel Okafor" \
  --redact-selector '<css for the subject cell>' \
  --redact-selector '<css for the snippet cell>'
```

| Option | Default | What it does |
|---|---|---|
| `--vendor`, `--name` | required | Folder and file name. Lowercase letters, digits and `-` only. |
| `--tab <text>` | first web page | Capture the one tab whose URL contains `<text>`. Fails if none or several match. |
| `--names <a,b>` | none | Real names to replace everywhere, whole and word by word, in any case. |
| `--redact-selector <css>` | none | Replace the text and labels (`title`, `aria-label`, `alt`, …) of matching elements with fake phrases. Repeatable. |
| `--seed <text>` | `attest` | Seed for every fake value and for which secrets are injected. Same seed, same fixture. |
| `--date <yyyy-mm-dd>` | today (local) | The date folder. |
| `--cdp <url>` | `http://127.0.0.1:9222` | Must be on this machine. |
| `--out-root <dir>` | `extension/tests/fixtures/pages` | Where fixtures go. |
| `--force` | off | Overwrite an existing fixture and its `labels.json` entry. Without it the tool refuses. |

It writes `extension/tests/fixtures/pages/<vendor>/<yyyy-mm-dd>/<name>.html` and adds an entry to `labels.json` beside it (other entries are left untouched):

```json
{ "<name>.html": { "capturedAt": "<yyyy-mm-dd>", "selectorsVersion": null, "seededSecrets": ["…", "…", "…"], "expected": [], "notes": "" } }
```

The tool prints the tab's address (without its query or fragment), the output path, and counts of what it replaced and removed. It never prints page content.

### What the tool does to your browser

Nothing you can see. It attaches without Playwright's default overrides (no focus or media emulation), reads one tab, and disconnects without closing anything. In the page it reads the DOM and computed styles and builds the fixture from a copy in an inert document. It never clicks, types, scrolls, focuses, navigates or changes the live page. `tests/e2e/capture-tool.spec.ts` checks this on every run: the live page must be byte-identical afterwards, with zero DOM mutations, zero events and zero network requests.

### What the sanitiser does (`extension/tests/tools/sanitize.ts`)

- **Removes what runs or fetches:** scripts, `noscript`, frames, `object`/`embed`, `template`, `<base>`, every `<link>`, `meta http-equiv`, comments, every `on*` attribute, and `javascript:`/`vbscript:`/`data:text/html` URLs.
- **Removes every external resource:** `src`, `srcset`, `poster`, `background`, `ping`, `attributionsrc` and external SVG `href`s. Every image is dropped, including avatars and `data:` images, because a picture can be personal. In CSS, every `url(…)` except `#fragment` becomes `none`, as does every `image-set(…)` and every function whose name is written with an escape (`\75 rl(…)`), which Chrome still fetches. Every at-rule (`@import`, `@font-face`, `@media`, …) is dropped. The same `url(…)` rule applies to SVG attributes Chrome fetches from (`fill`, `stroke`, `mask`, `clip-path`, `marker-*`, `cursor`, …). The critical layout styles are already copied onto each element from the live page.
- **Drops session secrets:** the `value` of hidden inputs (CSRF and session tokens), `nonce` attributes, and `<meta name="csrf-token">`-style tags.
- **Removes tokens from URLs everywhere:** in links (`href`, `action`, `cite`, and the `data-saferedirecturl`, `data-url`, `data-href`, `data-link` attributes vendors keep links in) it keeps the path and a plain `#fragment` and drops `user:password@`. In every link, text node and attribute value (other `data-*`, `<meta content>`, visible text, relative URLs) it drops query strings (`?token=…`, a bare `?session=…`, percent-encoded `%3Ftoken%3D…`) and any fragment that carries parameters (`#access_token=…`, the `?compose=…` of `#inbox?compose=…`).
- **Replaces personal data with seeded fakes:** emails (always `@example.com`, `@example.org` or `@example.net`), including accented ones and two forms a search for `@` cannot see: percent-encoded (`lena%40corp.io` in a search link) and inside base64 ids (Google Calendar event ids carry the calendar owner's address), which are re-encoded with the fake. Also phone numbers, card numbers (groups of four, or Amex 4-6-5), money amounts (same currency and format), street addresses, `--names`, display names next to an email (`Name <email>`, `Name (email)` as in the account button, or `name`/`title`/`aria-label` on an element that carries an email), and `--redact-selector` text. The same real value always gets the same fake within one capture, so labels stay consistent.
- **Turns any other `@` into `＠`** (U+FF20, the full-width at sign), so a search for `@` finds only fake addresses.
- **Keeps** `role`, `aria-*`, `data-*`, `id`, `class` and structure, because adapters anchor on them.
- **Injects three secrets** from `extension/tests/fixtures/secrets/seeded.json` as visible `data-attest-seeded` elements in the main landmark. The no-leak test (0.5) checks they never reach storage, logs or exports.

## 3. Review before you commit (founder checklist)

From `agents/adapter_engineer.md`, plus two mechanical checks:

- [ ] Captured from a real session, by the founder, on the date in the folder name
- [ ] Sanitised: names, emails, amounts and subjects replaced by deterministic fakes; `seeded.json` values injected for the leak test (`seededSecrets` in `labels.json` lists which)
- [ ] A `labels.json` beside the HTML with the expected extraction output (fill in `expected`, and set `selectorsVersion` once the adapter exists)
- [ ] Vendor terms re-read on capture day, with a note in `Decisions.md`
- [ ] `grep -o '@[^"<> ]*' <fixture>.html | sort -u` prints only `@example.com`, `@example.org` or `@example.net`
- [ ] Opened from the fixture server and read top to bottom, with DevTools' Network tab showing nothing but `127.0.0.1`:

```sh
cd extension && pnpm exec tsx tests/tools/serve-fixtures.ts
# then open http://127.0.0.1:4173/<vendor>/<yyyy-mm-dd>/<name>.html
```

If anything personal is left, re-capture with more `--names` or `--redact-selector` and `--force`. Do not hand-edit a fixture to fix it, because the next capture would bring it back.

## 4. What the sanitiser cannot catch

It only finds what has a pattern, or what you tell it about. You have to read the output.

- **Names it was not told about** that do not sit next to an email: greetings ("Hi Daniel"), signatures, names inside subjects, snippets and message text. Learning "Daniel Okafor" from his address does not cover a lone "Daniel" elsewhere on the page. Pass names with `--names` (then every part is replaced everywhere), or cover the cell with `--redact-selector`.
- **Subjects, snippets, chat text and any other free text.** These have no pattern. Use `--redact-selector` on those cells.
- **Numbers without formatting:** a phone written `5415550187`, a card written `4111111111111111`, account and order numbers, national ID numbers, dates of birth. Formatted phone numbers and card numbers in groups (spaces or dashes) are caught.
- **Addresses that do not look like "number + street name + Street/Ave/Lane…"**: PO boxes, most non-US formats, or a city and postcode on their own.
- **Amounts without a currency symbol or code.**
- **Identifiers inside link paths or plain `#fragments`** (for example thread ids). Query strings and parameter fragments are dropped everywhere; paths and plain fragments are kept. A token written into a path segment (`/share/<token>/…`) is not recognised.
- **Data in other encodings:** emails that are hex-encoded, double percent-encoded or inside compressed or encrypted blobs, and names or phone numbers inside any encoding (only plain, percent-encoded and base64 emails are decoded). Names inside CSS (`content: "…"`) are not replaced either.
- **Content it does not capture at all:** shadow DOM, iframes, and values typed into form fields. Text in an open editor is captured, so close drafts first.

It can also over-replace. A name it learned that is also an everyday word (a contact named "Mark" turns "Mark as read" into a fake name) is replaced everywhere. A one-word sender such as `Google <no-reply@google.com>` is only replaced inside its own element, so vendor names in the interface survive. If an adapter needs interface text that was replaced, re-capture without that name in `--names`, then check the output again.

## 5. Tests that cover the tool

- `extension/tests/unit/tools/sanitize.spec.ts`: every strip and neutralise rule, structure kept, seeds injected and visible, determinism, no network, and the final rule that every `@` belongs to a fake domain
- `extension/tests/unit/tools/capture-pii.spec.ts`: every personal-data class (including percent-encoded and base64-hidden emails, and card numbers), name learning, `--redact-selector`, and how fakes are generated
- `extension/tests/unit/tools/capture-url.spec.ts`: query strings and parameter fragments removed from links, `data-*`, `<meta content>`, text and relative URLs; the inert window never runs a script
- `extension/tests/unit/tools/capture-css.spec.ts`, `capture-args.spec.ts`, `capture-output.spec.ts`: CSS neutraliser, command-line arguments, and `labels.json` handling
- `extension/tests/e2e/capture-tool.spec.ts`: a real Chromium over CDP. It checks the live page stays untouched, the fixture renders from the fixture server with zero outside requests, and the `pnpm capture` command works under `tsx`. Run it with `cd extension && pnpm exec playwright test tests/e2e/capture-tool.spec.ts` (no extension build needed).

## 6. Message bus

Content scripts never touch the ledger. They post derived facts to the service worker over the typed bus in `extension/src/bus/` (`send`, `query`, `listen`), and nothing else may call `runtime.sendMessage`, `onMessage`, `tabs.sendMessage` or `connect` (lint fence). Every message is one member of the Zod union in `src/bus/messages.ts`: strict objects, every string and array length-capped (`SCHEMA_LIMITS` in `src/ledger/types.ts`). `send()` refuses an invalid message before it leaves; `listen()` parses on receipt and drops anything else.

| Type | Sender | Receiver | Payload | Response |
|---|---|---|---|---|
| `adapter.health` | content script (adapter or observer) | service worker | `health`: `AdapterHealth` (id and version as `ComponentId` tokens, OK or DEGRADED, reason codes such as `selector.missing` (never page text), checkedAt) | acknowledgement (`undefined`) |
| `adapter.claims` | content script (agent adapter) | service worker | `adapterId`, `version`, `requests`: `Request[]`, `claims`: `Claim[]` (at most 500 each) | acknowledgement |
| `observer.observations` | content script (Gmail or Calendar observer) | service worker | `observerId`, `version`, `observations`: `Observation[]` (at most 500) | acknowledgement |
| `coverage.ping` | content script (observer) | service worker | `ping`: `CoveragePing` (observer id, account hash, sync time, window, user active) | acknowledgement |
| `ui.query` | extension page only (popup, side panel, options) | service worker | `query`: `{ kind: 'ledger.export' }` or `{ kind: 'health.list' }` | a `ui.result` of the same kind |
| `ui.result` | service worker | the page that asked (as its response) | `kind` and `ok: true` with `data`, or `ok: false` with `error` (`unknown_query`, `handler_failed`, `unavailable`) | none |
| `ledger.changed` | service worker | open extension pages | `tables` (1 to 8 ledger table names), `at` | acknowledgement; nobody listening is normal |

In Sprint 0 the service worker handles `ui.query` only (`src/background/router.ts`); observers (2.7) and adapters (3.6) add their handlers there.

**Drops** (`bus.dropped`, logged with the reason and, when it is one of ours, the type; never the payload): `foreign_sender` (not this extension, or an orphaned context), `malformed` (fails the schema, unknown types included), `untrusted_context` (`ui.query` from a content script), each a warning; `no_handler` (this context does not handle that type, routine wherever several pages listen), at debug.

**Send failures** (`bus.send_failed`, the message resolves `undefined`): `no_receiver`, `port_closed`, `context_invalidated`, `send_failed`, each a warning, except `no_receiver` for a broadcast (`ledger.changed`), which is expected when no page is open and logged at debug. An invalid outgoing message is never sent: `send()` rejects with `BusError('invalid_outgoing')`.
