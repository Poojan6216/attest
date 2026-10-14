# BUILD SPEC — Attest
### Receipts for your AI agents. A local-first browser extension that checks what Muse, Dots, ChatGPT and Claude actually did, and tells you when they didn't.

---

## HOW TO USE THIS FILE (read first, agent)

You are the whole engineering org for this project. The founder (Poojan) is usually on his phone, not at the keyboard. He will send messages like **"hey mate, continue our implementation step by step."** That message means: run the loop below from wherever the Progress Log says we are, and keep going until a sprint gate passes or a `MANUAL.md` item blocks you.

**The loop, every time you are told to continue:**

1. Read `CLAUDE.md`, then the **Progress Log** at the bottom of this file. Find the current sprint and the first task that is not ticked.
2. Open `sprints/sprint_<N>.md`. Read the whole sprint before touching code. Read every `Read: agents/<role>.md` file the sprint names.
3. Implement the first unticked task, in that agent's voice and rules. Then run its **Done when** check. If it fails, fix it before moving on.
4. Tick the task in the sprint file, append one line to the Progress Log, commit (Conventional Commits).
5. Repeat until every task in the sprint is ticked.
6. **Run the sprint-end loop, in this exact order, writing each output to `reviews/sprint_<N>/`:**
   - **(1) QA** — read `agents/qa_tester.md`, review the sprint against its checklist, write and run the tests → `reviews/sprint_<N>/qa.md` (results + gaps)
   - **(2) Security** — read `agents/security_reviewer.md`, review all code written this sprint against the checklist → `reviews/sprint_<N>/security.md` (gaps)
   - **(3) Tech** — read `agents/tech_reviewer.md`, review code quality and architecture → `reviews/sprint_<N>/tech.md` (gaps)
   - **(4) Close** — read `agents/sprint_closer.md`, take all three outputs, fix every gap → `reviews/sprint_<N>/closed.md`
7. Run the sprint's **Gate**. If green, tick the sprint in the Progress Log, commit `chore: close sprint <N>`, and start the next sprint. If red, fix and re-run the gate. Never move past a red gate.
8. When Sprint 7's gate passes, write the **Final Report** section and stop.

**Rules for the whole build:**

- Do not ask the founder for permission to continue. He is not there. Keep going.
- If a decision is not specified here or in the sprint, pick the simplest option that satisfies the Hard Rules, log it in `Decisions.md` with the date and the reason, and continue.
- If a task needs a human (a store account, a paid subscription, a Dots login, a domain), write the exact action into `MANUAL.md`, mark the task `BLOCKED(MANUAL)` in the sprint file, and continue with the next task that does not depend on it. Never halt the whole build over one blocked task.
- Commit after every task. Never leave `main` broken. Every sprint ends with the extension loading cleanly in Chrome.
- **Numbers that come from research are marked `[cited]`. Never invent a number. A benchmark, accuracy figure, or latency in any doc must come from a run you executed, with the command committed.**
- Keep the founder informed in `PROGRESS.md` style: the Progress Log is the only status channel he reads. One line per task, dated, plain English.

**Do not build:** user accounts, a hosted sync service, a paid tier, a mobile app, Firefox or Safari builds, a Gmail API integration, a bank or Plaid connection, any analytics SDK, any third-party script, any feature where Attest *acts* on the user's behalf (sends, clicks, cancels, posts). If you are writing a signup flow, a checkout, or a function that submits a form on a vendor page, stop. You have misread the spec.

---

## 1. What this is

In September 2026 always-on personal agents went mainstream. Meta Muse launched Sept 8 and hit #1 on the US App Store by Sept 18 with 2.3–4.3M downloads `[cited]`. OpenAI Dots launched Sept 29 `[cited]`. Instinct raised $1B at $10B on Sept 28 `[cited]`. Each agent has its own cloud computer and browser and acts inside the user's email, calendar, marketplaces and payment methods.

Each also has an incident record. Muse synced a user's iMessage database "up to row 187,462" after he declined message access, then gave an inaccurate explanation (Sept 19) `[cited]`. Muse sold a user's keyboard on Marketplace, shared his street address, accepted CA$10 against a CA$15 floor, and told the buyer "Yep I'm here!" when he was not (Sept 26) `[cited]`. Instinct sent an email without asking and retained Gmail access after disconnect (Aug 24) `[cited]`. OpenAI shelved GPT-6.1 Astra on Sept 28 because it "didn't quite meet the bar in terms of staying within scope and authorization" `[cited]`. Menlo's July 2026 survey: 32% of AI users have let an agent act without final sign-off; only 10% trust an agent with a purchase over $25 unapproved `[cited]`.

Every vendor ships an activity view *for its own agent*. OpenAI will only ever audit a dot. Meta will only ever audit Muse. **Nobody checks the agent's claim against the world, and nobody does it across vendors.** The Sept 30 novelty audit found no shipped product doing this; the nearest neighbours verify coding agents for developers (Archal), gate actions before they run (Snitch, Bylaw), check log integrity (Agent Auditor), or sell a gateway-based trail that only sees calls routed through it (PortEden).

**Attest closes that gap at the only layer a third party can reach: the user's own browser.** It reads the agent's claims from the pages the user already has open, reads the side effects from the user's own Gmail and Calendar tabs, matches them, and issues a **receipt** for every task: verified, partial, not found, unasked, over scope, or unverifiable. It runs entirely in the browser. Nothing leaves.

It does not try to make agents trustworthy. It assumes they sometimes are not, and gives the user the evidence.

---

## 2. The promise: the receipt

The demo, which must work end to end and go in the README:

1. The user tells Muse: *"Email Priya the Q3 deck and put a 30-minute review on my calendar for Thursday."*
2. Muse's activity view says: *"Sent email to Priya with Q3 deck. Created calendar event 'Q3 review' Thu 2pm."*
3. The user opens Gmail. Attest's Gmail observer sees one sent message to `priya@…` with subject containing "Q3" at 14:02. The user opens Calendar. Attest's Calendar observer sees no new event on Thursday.
4. Attest's popup shows two receipts: **Email → VERIFIED** (evidence: sent-folder row, 14:02, recipient match, subject match). **Calendar → NOT FOUND** (evidence: no event matching "Q3" within ±3 days of Thursday; checked 14:10 and 14:40).
5. The user also sees a third line they did not ask for: **UNASKED (likely agent)** — an email sent at 14:03 to `vendor@…` with subject "Re: invoice" during Muse's session while the user was idle. Attest did not send it, did not block it, and cannot prove who did. It says "likely" and shows the evidence.
6. The weekly digest reads: *"Muse: 11 tasks claimed, 9 verified, 1 not found, 1 unasked. Claude: 4 claimed, 4 verified."*

The agent said it did it. Attest checked. **That is the whole product.** We do not claim to stop agents from lying. We claim the user will know.

---

## 3. Prior art — who is already here, and exactly where they stop

Read this before designing anything. Over-claiming here repeats the error we criticise in every vendor's activity view.

**Vendor activity views** — Dots Activity View + Custom Rules; Muse Sentinel + audit trail; Claude's task log; Instinct's text updates.
*Where they stop:* each shows what its own agent *says* it did. None checks against the world. None sees another vendor's agent. PortEden's own comparison states that none of the three big platforms "document comprehensive request-level audit exports" `[cited]`.

**Gateway ledgers** — PortEden ("one trail across every provider"), enterprise observability (Langfuse, LangSmith, Braintrust).
*Where they stop:* they see tool calls routed through their gateway. Consumer agents do not route through third parties. They see nothing for Muse or Dots unless the vendor cooperates, which it will not.

**Pre-action gates** — Snitch (second-model review before an action), Bylaw (YC S26, policy SDK), Muse Sentinel, Dots Custom Rules, NanoClaw.
*Where they stop:* they decide *before* the action, inside one vendor or one harness. They do not verify the outcome after.

**Log-integrity tools** — Agent Auditor (hash-chained logs).
*Where they stop:* they prove the log was not tampered with. They do not prove the log is true.

**Data-collection scanners** — Gen/Norton AI Data Checker + Agent Trust Hub (Sept 25), CoreLock (Mac scanner).
*Where they stop:* they show what data an AI app *can* collect. They do not know what the user asked for, what the agent claimed, or what happened.

**Developer verifiers** — Archal (YC S26) verifies coding agents' work for developers.
*Where they stop:* developer-facing, code outcomes, single harness.

**Attest's actual contribution, in two sentences:** it is the first tool that compares an agent's *claim* against *independent evidence* from the user's own accounts, across vendors, and issues a graded receipt with the evidence attached. And it does it with zero server-side access to the user's data, which is the only architecture a burned user will install.

**Naming:** *Attest* — to bear witness that something is true. The product is a witness, not a guard.

---

## 4. Hard rules — never violate these

These are not preferences. Breaking any one makes the tool untrustworthy, and trust is the entire product.

1. **Nothing leaves the browser.** The only permitted outbound request is the opt-in aggregate telemetry call to our own endpoint, with a schema-locked payload of counts and booleans. There is a test that intercepts every network request during a full session and fails the build if anything else is hit. This test is mandatory and never skipped.
2. **Derived facts, never raw content.** The ledger stores allowlisted fields per observation type (recipient, subject hint ≤ 80 chars, timestamp, amount, merchant, content hash). Never an email body. Never a chat transcript. Never a full page. There is a test that seeds secrets into fixture pages and asserts none appear in IndexedDB, logs, exports, or telemetry.
3. **Attest never acts.** Read-only on every page. No clicks on vendor UI, no form submissions, no sends, no cancels, no background fetches to vendor APIs. The content scripts have no code path that dispatches an input event on a vendor page. A lint rule enforces this.
4. **Deterministic grading.** `grade()` is a pure function: same (claim, candidate observations, grant, policy) → same receipt, forever. No clock inside, no randomness, no LLM in the decision. The optional local model may *propose* candidate links with a score; it may never set a grade. Replaying the ledger must reproduce every receipt exactly.
5. **"Unverifiable" is a first-class grade.** If observers do not cover the claimed action type, or the relevant tab was never open in the window, the receipt is UNVERIFIABLE, never VERIFIED and never NOT FOUND. Attest must never say "all clear" about something it could not see.
6. **Fail loud.** When an adapter's selectors stop matching (vendor changed their UI), the adapter is marked DEGRADED and the popup shows it. Silently producing zero claims is a bug of the worst kind.
7. **Attribution is labelled.** An UNASKED receipt always says "likely agent" with the signals that produced it. Attest cannot prove who clicked send. It never says "the agent did this" as a fact.
8. **Minimal permissions.** Host permissions only for the exact vendor and observer domains in §5. Everything else is an optional permission requested at the moment the user turns the feature on. No `<all_urls>`. No `tabs` beyond what the side panel needs. No `history`.
9. **No remote code, no third-party scripts, strict CSP.** No `eval`, no `new Function`, no inline scripts, no CDN loads, no analytics SDKs, no fonts from the network.
10. **Never log secrets or PII.** Console, telemetry, exports, bug reports: content hashes and shapes only. The secret-seed test (rule 2) covers all four channels.
11. **Vendor pages are read only when the user has them open.** Attest never opens a vendor tab on its own, never uses a background tab to scrape, never bypasses a login. The one exception is the optional "auto-check Gmail" feature, which opens Gmail in a *pinned, visible* tab after explicit opt-in, and is documented as such.
12. **Never report a number you didn't measure.** Extraction accuracy, matcher precision, latency: every figure in README or docs traces to a committed command and a committed result file.

---

## 5. Locked technical decisions

Don't re-litigate these. Change only with a `Decisions.md` entry that names the Hard Rule it protects.

| Decision | Choice |
|---|---|
| Platform | Chrome extension, **Manifest V3**. Chromium-based browsers (Edge, Brave, Arc) get it for free. Firefox/Safari deferred. |
| Language | **TypeScript 5.x, `strict: true`**, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any` in `src/core`. |
| Framework | **WXT** (entrypoints, HMR, manifest generation, cross-browser later). |
| UI | **Preact** + Tailwind for popup, side panel, options, digest. One component per file. |
| Storage | **IndexedDB via Dexie**, schema versioned with migrations. `chrome.storage.local` only for small flags and the install id. |
| Schemas | **Zod** for every stored type, every message between contexts, and the telemetry payload. Parse at every boundary. |
| Tests | **Vitest** (unit + property via `fast-check`), **Playwright** for extension E2E against **fixture pages** served locally. |
| Lint/format | ESLint (typescript-eslint strict) + Prettier. Custom lint rule: no `dispatchEvent`, `.click()`, `.submit()`, `fetch` to non-allowlisted hosts in `entrypoints/content/**` and `src/adapters/**`. |
| Package manager | **pnpm**. Node 22 LTS. |
| Optional matcher model | **Chrome built-in on-device model (Prompt API)** first, if available on the user's Chrome. **BYO key** (Anthropic or OpenAI) second. Both off by default, both advisory only (Hard Rule 4). |
| Telemetry backend | **FastAPI + MongoDB** on Railway. One endpoint. Strict Pydantic schema. Rate-limited. Public aggregate stats later. |
| Encryption at rest | Optional passphrase: AES-GCM, key from PBKDF2 (600k iterations). Off by default; on = ledger unreadable without the passphrase. (Amended: AES-256-GCM is computed by `@noble/ciphers`, not WebCrypto, so rows seal inside IndexedDB transactions; the key is still WebCrypto's PBKDF2. Decisions [6.5] and [6.close], Hard Rules 2 and 9.) |
| Grading policy | `policy/default.json`, versioned. Thresholds and windows live here, never in code. |
| License | **FSL-1.1-ALv2** (the Functional Source License 1.1; each version becomes Apache-2.0 two years after release). The founder's choice on 2026-10-14; Apache-2.0 until then (Decisions [7.0]). |
| Repo | `github.com/Poojan6216/attest`, public from the first commit. |
| Versioning | SemVer. `0.1.0` is the store launch. CHANGELOG kept by hand. |
| Commits | Conventional Commits. |
| Adapters | **Fixture-driven.** Every adapter and observer is built and tested against sanitised saved DOM snapshots in `tests/fixtures/pages/<vendor>/<yyyy-mm-dd>/`. Live pages are for capture and smoke, never for unit tests. |

**Why a browser extension and not a server:** the user we are building for just watched an agent read 187,462 of their messages. They will not give a solo developer in Ohio read access to their Gmail. Gmail's read scopes are Google *restricted* scopes and require a third-party CASA security assessment before an app can exceed test users; that is weeks and money, and it is a wall at user 101. The extension reads Gmail in the user's own tab, as the user, with nothing sent anywhere. That is the only shape that clears both the trust gate and the Google gate, and it is also the only shape that reaches Muse's millions of free-tier users with one click.

**Why fixture-driven adapters:** vendor UIs change weekly. Dots is behind a $200+ tier the founder may not have yet. Fixtures make every adapter testable without a login, make breakage visible as a failing test instead of silent zeros, and let the founder capture a Dots fixture the day he gets access without touching the matcher.

**Why no LLM in the decision path:** a grade that depends on a model is a grade that cannot be replayed, cannot be explained, and can be manipulated by text on the page the model reads. The matcher is rules and features. The model, when enabled, only suggests "these two things might be the same" with a score, and the deterministic policy decides what to do with that score.

---

## 6. Project structure

Create exactly this. Don't reorganise.

```
attest/
├── build_spec.md                  # this file
├── CLAUDE.md                      # conventions + the "continue" protocol
├── Decisions.md                   # every unspecified decision, dated, with reason
├── MANUAL.md                      # actions only the human can do
├── README.md
├── PRIVACY.md                     # the store-facing privacy policy
├── CHANGELOG.md
├── LICENSE                        # FSL-1.1-ALv2
├── agents/                        # role files (see sprints for which to read)
├── sprints/                       # sprint_0.md … sprint_7.md
├── reviews/                       # sprint_<N>/{qa,security,tech,closed}.md
├── docs/
│   ├── threat-model.md
│   ├── grading.md                 # every grade, every rule, worked examples
│   ├── adapters.md                # how to add/repair an adapter, fixture capture
│   ├── privacy-architecture.md    # what is stored, where, what leaves (nothing)
│   └── attacks-that-work.md       # Sprint 6 output, honest
├── bench/
│   ├── run_bench.ts               # the one command that produces RESULTS.md
│   └── results/                   # committed JSON, one per run
├── RESULTS.md                     # generated, never hand-written
├── policy/
│   └── default.json               # thresholds, windows, allowlisted fields
├── scripts/                       # dev-only: check-docs, gen-unicode-baseline (+ ucd/15.0.0/ source data)
├── extension/                     # WXT project root
│   ├── wxt.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── entrypoints/
│   │   ├── background.ts          # service worker: bus, scheduler, alarms, alerts
│   │   ├── popup/                 # today's receipts
│   │   ├── sidepanel/             # timeline + receipt detail + evidence
│   │   ├── options/               # grants, adapters, telemetry, model, export, wipe
│   │   ├── digest/                # weekly digest page
│   │   └── content/
│   │       ├── muse.content.ts
│   │       ├── chatgpt.content.ts # also Dots (flag)
│   │       ├── claude.content.ts
│   │       ├── gmail.content.ts
│   │       └── gcal.content.ts
│   ├── src/
│   │   ├── core/                  # PURE. No DOM, no chrome.*, no I/O.
│   │   │   ├── schema.ts          # Zod: Request, Claim, Observation, Grant, Receipt, Policy
│   │   │   ├── normalize.ts       # counterparties, subjects, amounts, times
│   │   │   ├── candidates.ts      # retrieval of observations for a claim
│   │   │   ├── features.ts        # match features → score
│   │   │   ├── grade.ts           # the pure decision function
│   │   │   ├── state.ts           # receipt state machine (PENDING → FINAL)
│   │   │   ├── attribution.ts     # "likely agent" signals for UNASKED
│   │   │   ├── scope.ts           # grant vs observed scope diff
│   │   │   ├── replay.ts          # re-derive every receipt from the ledger
│   │   │   ├── redact.ts          # allowlist projection + hashing
│   │   │   └── unicode-*.ts       # Unicode 15.0 baseline tables (generated by scripts/gen-unicode-baseline.ts)
│   │   ├── adapters/              # agent pages → Requests, Claims, ScopeSnapshots
│   │   │   ├── base.ts            # Adapter interface, health, versioning
│   │   │   ├── muse/{selectors.json,extract.ts,health.ts}
│   │   │   ├── chatgpt/{selectors.json,extract.ts,health.ts}
│   │   │   └── claude/{selectors.json,extract.ts,health.ts}
│   │   ├── observers/             # world pages → Observations
│   │   │   ├── base.ts
│   │   │   ├── gmail/{selectors.json,extract.ts,health.ts,receipts/}
│   │   │   └── gcal/{selectors.json,extract.ts,health.ts}
│   │   ├── ledger/                # Dexie db, repos, migrations
│   │   ├── bus/                   # typed messages between contexts (Zod)
│   │   ├── intel/                 # optional advisory matcher (built-in model / BYO key)
│   │   ├── telemetry/             # aggregate schema, builder, sender (opt-in)
│   │   ├── crypto/                # optional at-rest encryption
│   │   └── ui/                    # shared components, tokens, a11y helpers
│   └── tests/
│       ├── unit/
│       ├── property/
│       ├── e2e/
│       ├── fixtures/
│       │   ├── pages/<vendor>/<yyyy-mm-dd>/*.html   # sanitised DOM snapshots
│       │   ├── receipts/            # sample receipt emails (sanitised)
│       │   ├── attacks/             # Sprint 6 adversarial fixtures
│       │   └── secrets/seeded.json  # for the mandatory no-leak test
│       └── tools/
│           └── capture-fixture.ts   # dev command: snapshot + sanitise a live page
├── telemetry-api/                 # FastAPI + Mongo, one endpoint
│   ├── app/{main.py,schema.py,store.py,limits.py}
│   ├── tests/
│   ├── Dockerfile
│   └── railway.json
└── .github/workflows/ci.yml
```

---

## 7. Core contracts

Define these in Sprint 1 before any adapter exists, so nothing drifts.

```ts
// extension/src/core/schema.ts  (Zod schemas; types inferred)

export const AgentId = z.enum(['muse', 'chatgpt', 'dots', 'claude']);

export const ActionType = z.enum([
  'email.sent', 'calendar.created', 'calendar.updated', 'calendar.deleted',
  'purchase.made', 'subscription.changed', 'listing.posted', 'message.sent', 'other',
]);

export const Request = z.object({
  id: Ulid, agent: AgentId, conversationId: z.string(),
  textHint: z.string().max(200),        // first 200 chars, for display only
  textHash: Sha256, ts: IsoTs,
});

export const Claim = z.object({
  id: Ulid, agent: AgentId, requestId: Ulid.optional(),
  type: ActionType,
  counterparty: z.string().optional(),   // normalised: email, name, merchant
  amountCents: z.number().int().optional(), currency: z.string().length(3).optional(),
  subjectHint: z.string().max(80).optional(),
  claimedAt: IsoTs, observedAt: IsoTs,   // when agent says it did it / when we read it
  sourceKind: z.enum(['activity_view', 'chat', 'notification', 'settings']),
  extractor: z.object({ id: z.string(), version: z.string(), confidence: z.number().min(0).max(1) }),
  rawHash: Sha256,
});

export const Observation = z.object({
  id: Ulid,
  source: z.enum(['gmail.sent', 'gmail.receipt', 'gcal.event']),
  type: ActionType,
  counterparty: z.string().optional(), merchant: z.string().optional(),
  amountCents: z.number().int().optional(), currency: z.string().length(3).optional(),
  subjectHint: z.string().max(80).optional(),
  occurredAt: IsoTs, observedAt: IsoTs,
  contentHash: Sha256,
  // NO body. NO full page. Allowlist enforced by redact.ts (Hard Rule 2).
});

export const Grant = z.object({
  agent: AgentId,
  allowedTypes: z.array(ActionType),
  counterpartyAllowlist: z.array(z.string()),      // domains or exact addresses
  spendCeilingCents: z.number().int().nullable(),
  declaredScopes: z.array(z.string()),             // what the user says the agent may access
  observedScopes: z.array(z.string()).optional(),  // what the vendor settings page shows
  updatedAt: IsoTs,
});

export const Grade = z.enum(['VERIFIED', 'PARTIAL', 'NOT_FOUND', 'UNASKED', 'OVER_SCOPE', 'UNVERIFIABLE']);

export const Receipt = z.object({
  id: Ulid,
  claimId: Ulid.optional(),           // absent for UNASKED
  observationIds: z.array(Ulid),
  requestId: Ulid.optional(),
  grade: Grade,
  confidence: z.number().min(0).max(1),
  ruleId: z.string(),                 // which policy rule produced it; "default_unverifiable" if none
  reasons: z.array(z.string()),       // human-readable, shown in the UI
  signals: z.record(z.number()),      // feature values that fed the score
  state: z.enum(['PENDING', 'FINAL', 'USER_OVERRIDDEN']),
  inputsHash: Sha256,                 // hash of (claim, candidates, grant, policy) for replay
  computedAt: IsoTs, finalAt: IsoTs.optional(),
});
```

```ts
// extension/src/core/grade.ts

export function grade(
  claim: Claim | null,                 // null when grading an orphan observation (UNASKED path)
  candidates: readonly Observation[],
  grant: Grant,
  policy: Policy,
  coverage: Coverage,                  // which observers were live over the claim window
): Receipt {
  /** PURE. No I/O, no Date.now(), no randomness, no model. Hard Rule 4.
   *  same (claim, candidates, grant, policy, coverage) → same Receipt, forever.
   *  This is what makes `attest replay` possible. */
}
```

**Grading rules, first-match-wins, terminal rule `default_unverifiable`:**

```jsonc
// policy/default.json
{
  "version": 1,
  "windows": { "beforeClaimMin": 2, "afterClaimMin": 45, "graceMin": 30, "calendarDays": 3 },
  "thresholds": { "verified": 0.85, "partial": 0.50 },
  "features": {
    "timeProximity": 0.25, "counterpartyExact": 0.35, "counterpartyDomain": 0.15,
    "subjectOverlap": 0.15, "amountExact": 0.25, "merchantMatch": 0.20
  },
  "rules": [
    { "id": "no_coverage",     "when": { "coverage": "none" },                       "then": "UNVERIFIABLE" },
    { "id": "over_scope",      "when": { "typeNotInGrant": true },                   "then": "OVER_SCOPE" },
    { "id": "over_ceiling",    "when": { "amountAboveCeiling": true },               "then": "OVER_SCOPE" },
    { "id": "verified",        "when": { "bestScoreGte": "verified" },                "then": "VERIFIED" },
    { "id": "partial",         "when": { "bestScoreGte": "partial" },                 "then": "PARTIAL" },
    { "id": "not_found",       "when": { "graceElapsed": true, "bestScoreLt": "partial" }, "then": "NOT_FOUND" },
    { "id": "pending",         "when": { "graceElapsed": false },                     "then": "PENDING" }
  ],
  "unasked": {
    "signals": { "agentSessionActive": 0.4, "userIdle": 0.3, "agentSignature": 0.5, "activityLogAdjacent": 0.4 },
    "threshold": 0.6
  },
  "allowlistedFields": {
    "gmail.sent":    ["counterparty", "subjectHint", "occurredAt", "contentHash"],
    "gmail.receipt": ["merchant", "amountCents", "currency", "subjectHint", "occurredAt", "contentHash"],
    "gcal.event":    ["subjectHint", "occurredAt", "counterparty", "contentHash"]
  }
}
```

**Adapter contract.** Every adapter and observer implements:

```ts
export interface Adapter<T> {
  id: string; vendor: string; version: string;          // bump version when selectors change
  hosts: readonly string[];                              // exact host permissions
  health(doc: Document): HealthReport;                   // OK | DEGRADED(reasons) — run first, always
  extract(doc: Document, ctx: ExtractContext): T[];      // pure over the DOM; never mutates; never dispatches events
}
```

`health()` runs before every `extract()`. If health is DEGRADED, extraction is skipped, the adapter's status is written to the ledger, and the popup shows a yellow banner naming the adapter and its version. Hard Rule 6.

---

## 8. Phases

Each phase is one sprint file. The sprint file is the detailed task list; this section is the contract each sprint must satisfy. Read both.

### PHASE 0 — Scaffold, plumbing, and the two tests that define the product
`sprints/sprint_0.md`

**Goal:** an installable extension that does nothing, plus the two mandatory tests (nothing-leaves-the-browser, secret-leak) wired into CI from day one, plus the fixture-capture tool so every later sprint is testable without a login.

Must exist at gate: WXT project with TS strict, ESLint strict + the no-act lint rule, Vitest + fast-check + Playwright, Dexie schema v1 (empty tables), typed bus, options page shell, CI running lint + typecheck + unit + E2E on every push, `capture-fixture` tool producing sanitised HTML, `PRIVACY.md` v0, Apache-2.0, README stub, `Decisions.md` + `MANUAL.md` seeded.

**Gate:** extension loads unpacked in Chrome with zero console errors; CI green; network-intercept test proves zero outbound requests over a 5-minute scripted session; secret-seed test passes trivially (nothing stored yet) and is marked `@mandatory`.

### PHASE 1 — The ledger core (pure)
`sprints/sprint_1.md`

**Goal:** the deterministic heart. Schemas, normalisation, candidate retrieval, features, `grade()`, the receipt state machine, attribution signals, scope diff, redaction, replay. **No DOM. No `chrome.*`.** All of `src/core` must be importable in a plain Node test.

**Gate:** property test proves `grade()` determinism over 5,000 random inputs; golden suite of 40+ scenario → receipt pairs passes; `replay` over a synthetic ledger reproduces every receipt; redaction projection is proven by a test that feeds raw objects with extra fields and asserts only allowlisted fields survive; the §2 demo scenario, fed as synthetic claims and observations, produces exactly VERIFIED / NOT_FOUND / UNASKED.

### PHASE 2 — Observers: Gmail and Calendar
`sprints/sprint_2.md`

**Goal:** turn the user's open Gmail and Calendar tabs into Observations, from fixtures first, then live smoke.

**Gate:** Gmail sent-folder extraction ≥ 95% field accuracy on the fixture set (measured, committed to `bench/results/`); receipt parsers for at least 6 senders (Stripe, Amazon, Facebook Marketplace, OpenTable, Instacart, generic "order confirmation") with amount + merchant extracted; Calendar event extraction and created/updated/deleted diffing against the previous snapshot; both observers report health; a live smoke run on the founder's own accounts logged in `Decisions.md` with what broke, if anything; redaction test proves no body text reaches IndexedDB.

### PHASE 3 — Agent adapters: Muse, ChatGPT/Dots, Claude
`sprints/sprint_3.md`

**Goal:** turn the agent's own pages into Requests, Claims, and ScopeSnapshots.

**Gate:** each adapter extracts Requests and Claims from its fixture set with measured accuracy; claim-type classification (which ActionType) ≥ 90% on the labelled fixture corpus; scope snapshot read from each vendor's settings/permissions page; Dots adapter runs behind `ATTEST_DOTS=1` and is BLOCKED(MANUAL) if no fixture exists; the §2 demo runs end to end through real content scripts against fixture pages served by Playwright and produces the three receipts.

### PHASE 4 — Receipts in front of the user
`sprints/sprint_4.md`

**Goal:** the popup, side panel, options, alerts, weekly digest, export, redacted share. The product becomes usable by a human.

**Gate:** popup renders today's receipts with grade chips and evidence in < 100 ms from a ledger of 5,000 receipts; side panel timeline with filters; options page edits Grants with validation; `chrome.notifications` alert on NOT_FOUND, UNASKED, OVER_SCOPE with a per-agent mute; weekly digest page generated by alarm; JSON/CSV export; "share receipt" produces a redacted PNG/markdown with no counterparty beyond domain; DEGRADED banner visible when an adapter's health fails; full keyboard navigation and screen-reader labels; dark mode.

### PHASE 5 — Optional intelligence and opt-in telemetry
`sprints/sprint_5.md`

**Goal:** the advisory matcher and the only server component, both opt-in, both proven harmless to the guarantees.

**Gate:** monotonicity property test proves that disabling the model never produces a *looser* grade and enabling it never produces a *stricter* one than the deterministic floor allows (the model can only raise a candidate's score within the deterministic envelope, never set a grade); the model never receives raw content, only the allowlisted fields; telemetry payload is schema-locked, contains no strings except enum values and the install id, and the network test's allowlist contains exactly one host; FastAPI endpoint rejects any extra field, rate-limits per install id, stores to Mongo, and has its own tests; "telemetry off" is the default and is proven by the network test.

### PHASE 6 — Red team and hardening
`sprints/sprint_6.md`

**Goal:** attack Attest the way an agent, a vendor, or a malicious page would, and publish what works. Then harden: performance, memory, encryption at rest, permissions audit, store-policy compliance.

**Gate:** `docs/attacks-that-work.md` lists every strategy with its measured outcome and contains at least one attack that still fools Attest (if every attack is caught, the red team is too weak); DOM-spoofing fixtures (a page that injects a fake "sent" row) produce UNVERIFIABLE or a DEGRADED flag, never VERIFIED; prompt-injection text in page content never reaches the optional model as instructions; Gmail fixture with 10,000 sent rows extracts in < 2 s and the ledger stays under 50 MB; at-rest encryption round-trips and a wrong passphrase yields nothing; permissions audit shows no permission beyond §5; Chrome Web Store policy checklist (single purpose, Limited Use, privacy disclosure) passes.

### PHASE 7 — Ship
`sprints/sprint_7.md`

**Goal:** store listing, docs, README with the §2 demo recording, Show HN kit, Reddit kit, DM template, Agent Reliability Report v0 page, release `0.1.0`.

**Gate:** `pnpm build` produces a store-ready zip; store listing drafted with 5 screenshots and the privacy line first; README leads with the demo GIF and the "nothing leaves your browser" proof; `RESULTS.md` is generated and honest; `docs/` complete; launch kit in `launch/` with Show HN text, three Reddit posts, the DM template, and the first weekly X posts; tagged `v0.1.0`; `MANUAL.md` lists exactly what the founder must do by hand (store developer account, submit, post).

---

## 9. Sprint-end loop (every sprint, no exceptions)

The founder runs these four by hand when he is at the keyboard. When he is not, **you run them yourself** as the last four tasks of every sprint, in this order, writing each output to `reviews/sprint_<N>/`:

1. **QA** — "Read `agents/qa_tester.md`, review against checklist, write and run tests for sprint N" → `qa.md`: test results + gaps.
2. **Security** — "Read `agents/security_reviewer.md` and review all code written in this sprint against the security checklist" → `security.md`: security gaps.
3. **Tech** — "Read `agents/tech_reviewer.md`, review code quality and architecture" → `tech.md`: code-quality gaps.
4. **Close** — "Read `agents/sprint_closer.md`. Here are the review outputs: [qa.md + security.md + tech.md]. Fix all gaps." → `closed.md`: FIXED IN CODE / MANUAL ACTION REQUIRED / VERIFIED CLEAN.

Then the Gate. A sprint is not closed until `closed.md` says VERIFIED CLEAN and the Gate is green.

---

## 10. Definition of done (v0.1.0)

- [ ] The §2 demo runs end to end against fixture pages in CI and against the founder's live accounts by hand
- [ ] The nothing-leaves-the-browser test is green with telemetry off and with telemetry on (one allowlisted host)
- [ ] The secret-seed test is green across IndexedDB, console, exports, telemetry
- [ ] `grade()` determinism and model-monotonicity property tests are green
- [ ] `attest replay` reproduces every receipt in a 30-day synthetic ledger
- [ ] Every adapter and observer has a fixture set, a health check, a version, and a measured accuracy in `RESULTS.md`
- [ ] `docs/attacks-that-work.md` names at least one attack that still works
- [ ] Zero actions on vendor pages (lint rule green; E2E asserts no input events dispatched)
- [ ] Permissions exactly as §5; CSP strict; no remote code
- [ ] Store zip builds; listing, privacy policy, README, launch kit complete
- [ ] `MANUAL.md` is the only thing standing between the repo and the store

---

## 11. Known limitations to document, not fix

- Attest sees only what is in open tabs. Actions inside Messenger, phone calls by Instinct, purchases without an email receipt, and anything on mobile are invisible. The receipt says UNVERIFIABLE. Say this in the first paragraph of the README.
- Attribution of UNASKED actions is a heuristic. "Likely agent" is the strongest claim Attest ever makes.
- Vendor UIs change. Adapters will break. Health checks make breakage loud; they do not make it rare. Budget one evening a week for selector repair after launch.
- Reading a vendor's activity page is reading their UI. Read each vendor's terms before the store submission and record the reading in `Decisions.md`. If a vendor's terms forbid it, that adapter ships disabled with a note.
- Dots requires a Pro tier. Until the founder has access, the Dots adapter is built against the ChatGPT surface and flagged.
- Desktop Chrome only. Muse is mobile-first; phone-only users are not served in v1.
- The optional on-device model depends on the user's Chrome and hardware. When unavailable, Attest is rules-only and says so.

---

## Progress Log

*Agent: append one line per completed task. Format: `[YYYY-MM-DD] [sprint.task] what you did — decisions or blockers`. The founder reads this from his phone. Plain English.*

```
[2026-10-01] [0.1] Scaffolded the extension (WXT, Manifest V3, Preact, Tailwind, strict TypeScript), Apache-2.0 license, README with the limitations, changelog. It builds and loads in Chromium 153 with zero console errors. Not pushed: the GitHub repo does not exist yet (MANUAL.md).
[2026-10-01] [0.2] Lint and format: ESLint strict (type-checked) + Prettier, the `attest/no-act` rule (no clicks, events, DOM writes, navigation or network in anything that reads a vendor page), a fence that keeps `src/core` pure, and a rule that keeps service-worker listeners top-level. Proven by 73 tests and by deliberate violations that fail. Pre-commit hook runs lint + typecheck.
[2026-10-01] [0.3] Test rails: Vitest (unit + property with fast-check), Playwright loading the real build into a fresh Chromium profile, a localhost fixture server (path-traversal safe, property-tested), and `pnpm bench` which writes RESULTS.md (no numbers yet). 88 unit/property tests and the E2E smoke test pass.
[2026-10-01] [0.1] Repo created on your go-ahead: https://github.com/Poojan6216/attest (public). Before the first push I swapped the three fake API keys in the leak-test fixture for shapes no secret scanner mistakes for real credentials, and amended that unpushed commit so history is clean.
[2026-10-01] [0.1] Repo made private at your request. Before launch it needs to go public again (GitHub Pages for the privacy policy, "read the source"); that's in MANUAL.md under Sprint 7.
[2026-10-01] [0.8] Policy as data: policy/default.json exactly as the spec, loaded by a pure, strict Zod loader that deep-freezes it and names the exact path of every problem (10+ malformed cases tested). A test proves no threshold value appears anywhere in the code. Core now typechecks with no DOM types. Host lists and feature flags (all off) are in config.
[2026-10-01] [0.6] Ledger storage: Dexie database with the eight tables and the indexes the reviewers asked for, typed repositories that validate on write and on read, duplicate observations/claims are no-ops (by content hash / raw hash), a migration framework (v1 to v2 tested), and a deterministic export. 78 tests; the verifier mutated the code 13 ways and the tests caught all 13.
[2026-10-01] [0.7] Typed message bus: one Zod schema for all seven message types; sending refuses invalid messages; receiving drops anything malformed, unknown, from another extension, or (for data queries) from a content script, and logs why. Listeners register synchronously; the lint rule now also catches the bus's own listen() inside async code, and inline disables no longer work there.
[2026-10-01] [0.9] Fixture capture tool: pnpm capture attaches to your own Chrome (read-only, it never touches the live page), copies the page, strips scripts and every external resource so the fixture makes zero network requests, replaces emails, names, phones, amounts, addresses and cards with consistent fakes, and plants three seeded secrets for the leak test. Proven end to end; docs/adapters.md explains capture and what the scrubber cannot catch (read every fixture before committing).
[2026-10-01] [0.10] Options page shell: the privacy line first, then Grants, Adapters, Privacy, Model, Export and Danger zone (stubs say plainly what comes later), full keyboard navigation with visible focus, light and dark mode. A random install id is created on install and can be reset from the Danger zone with a two-step confirm. PRIVACY.md v0 in plain language. Also wired the service worker: bus listener, install handler, alarms, and a Zod setting that keeps the strict CSP quiet.
[2026-10-01] [0.4] Mandatory test 1, nothing leaves the browser: a 5-minute scripted session (3 fixture pages, popup, options, side panel, an alarm firing) with Chrome's own network log on; every request the extension or a page makes must hit an allowlisted host (none allowed now). Passes on the real build (0 violations, 5.1 min). A build with a fetch to example.com added fails it. A negative control proves on every run that the test catches requests from the service worker, an extension page, a fixture page, and a WebSocket.
[2026-10-01] [0.5] Mandatory test 2, secret seed: 15 fake secrets (API-key shapes, SSN, card, three email bodies, phone, address, passphrase, two names, a URL with a token, a base64 blob) are injected into the pages the extension sees; after a session none may appear in the ledger export, any IndexedDB database, any chrome.storage area, any console output, or any network request. Passes. A build that logs one secret fails it. A negative control plants a seed in each channel and checks each is caught.
[2026-10-01] [0.11] CI on GitHub Actions: install, lint, typecheck, unit + property tests, build, then the two mandatory E2E tests as their own step, then the rest; the build and the Playwright report are uploaded. Badge in the README.
[2026-10-01] [0.12] Project ledgers seeded: Decisions.md has every §5 decision (one line each, locked by build_spec) plus all 140+ decisions made this sprint; MANUAL.md lists the store account, Dots access, the Muse host, the vendor terms reading, plus today's additions (repo visibility, license choice); CLAUDE.md present; this log has a line for every task 0.1 to 0.12.
[2026-10-01] [0.close] Closed every review gap I could fix in code: the logger now prints only a fixed list of words (no name, token or passphrase can slip through by looking like an id), lint now blocks network, web storage, console tricks, Node and ad-hoc messaging in all shipped code, the no-act rule catches indirect clicks and page writes, the leak test catches partial and encoded secrets and reads four more storage places, the fixture tool strips tokens from text and data attributes, CI is pinned and checks the mandatory tests really ran. Needs you: push and confirm CI is green, the red-PR proof, and branch protection (MANUAL.md).
[2026-10-01] [0] sprint closed — gate green: loads with zero console errors and warnings; CI green on GitHub (both mandatory tests ran and passed); the 5-minute network test passes with an empty allowlist and fails on a build with a fetch; the secret-seed test passes and fails on a build that logs a seed; lint fences proven by deliberate violations; the capture tool makes a clean fixture. The review found 45 gaps: 41 fixed, 2 scheduled into later tasks, branch protection left to you (private repo, Free plan). A PR that breaks a mandatory test goes red on GitHub (proved with a throwaway PR).
[2026-10-01] [1.0] Canonical schemas now live in src/core/schema.ts (branded ids, hashes and timestamps; every object strict; length caps on every free-text field; the closed list of reason codes; receipt invariants such as 'an override exists only on an overridden receipt'). The ledger and the message bus use them; every schema has 5+ valid and 5+ invalid cases tested.
[2026-10-01] [1.1] Normalisation: email addresses are kept exactly as read and lookalike characters are flagged (never 'cleaned' into a match); names, money (to exact integer cents, rejecting ambiguous inputs), subjects, and vendor-relative times ('Yesterday', 'Thu', '2:03 PM', '3 days ago') across midnight and daylight-saving changes. Hundreds of table cases including the nasty ones.
[2026-10-02] [1.4] Match scoring: every feature (time, exact address, domain, name, subject overlap, amount, merchant) is an exact fraction, weights come only from the policy in basis points, and only the claim decides which features count. It reproduces every hand-computed score in the 77 golden scenarios exactly.
[2026-10-02] [1.2] Redaction: everything Attest records from a page passes through one function that keeps only the allowlisted fields, computes the id and content hash itself (never trusting the page), and caps the subject hint at 80 characters. A 1,000-case test plants all 15 seeded secrets in extra fields and proves none ever comes out.
[2026-10-02] [1.3] Candidate matching: time windows (minute, hour or day precision, safe across midnight and daylight-saving days), finding each claim's candidate observations, and one-to-one assignment so one email can never verify two claims. Measured: 5,000 claims against 50,000 observations in 289.6 ms (limit 2,000 ms), via pnpm bench, in RESULTS.md.
[2026-10-02] [1.6] Receipt state machine: regrade, user override (with a required reason, reversible), revert, and supersede for UNASKED receipts; every state/event pair is tested, and a receipt finalises to NOT_FOUND only after Attest has looked past the grace window, never before.
[2026-10-02] [1.7] UNASKED detection: for an action nobody claimed, each agent gets its own score from session activity, user idleness (only with real evidence, never assumed), known signatures, and adjacent activity-log entries; UNASKED fires only above the policy threshold, and every sentence says 'likely' (a test checks no text ever states an agent did it as fact).
[2026-10-02] [1.8] Spend and scope limits: claimed type not allowed, permissions observed beyond what was declared, a single purchase over the ceiling, and cumulative spend (two $30 purchases against a $50 ceiling: the second is OVER_SCOPE).
[2026-10-02] [1.5] Grading is done and fast: grade() decides every receipt by the policy rules (same inputs give the same receipt, proven over 5,000 random cases twice), all 84 golden scenarios pass through the real code, and grading 5,000 claims against 50,000 observations takes about 1.0 s (limit 2 s; it was 23 s before two optimisation passes, with receipts proven identical before and after).
[2026-10-02] [1.v14] Contract v1.4 semantics landed in the core: gradeBatch returns each receipt with the inputs it was graded with, claims seen after the grading instant are ignored, orphans follow their own source's coverage, attribution and finality share one anchor for calendar events, and a superseded receipt can no longer be regraded — all 6,063 tests, the perf gate (1.38 s of 2 s) and E2E green
[2026-10-02] [1.golden] Golden suite moved to contract v1.4: 94 scenarios (10 new: vague claims, calendar first sighting, scope inputs, late claims, grant in force, per-source coverage, claim-less defaults, regrade/override/supersede events); every receipt's stored inputs are replayed back to the same receipt
[2026-10-02] [1.9] Replay works: a stored ledger is graded again from what it stored and every receipt must come back identical (every computed field, plus each observation's content hash); a random 1,000-claim × 10,000-observation ledger reproduces 100%, and one edited receipt is reported as exactly one mismatch; `pnpm attest replay <export.json>` runs it from the command line — the real export gains the two maps it needs in Sprint 3.6
[2026-10-02] [1.10] The build_spec §2 demo is now a test: one ask, an email Muse sent (VERIFIED), a calendar event it claimed but never made (NOT_FOUND after the grace window), and an email nobody asked for (UNASKED, with two signals); with Calendar never opened the event is UNVERIFIABLE instead; every receipt is replayed from its stored inputs; docs/grading.md §16 names it the canonical worked example
[2026-10-02] [1.11] The grading reference (docs/grading.md) is complete: every grade, rule, feature, window and state, a state-machine diagram, the replay procedure, and worked examples checked against the golden files; `pnpm check-docs` (now part of `pnpm lint`) fails on any broken link, unknown pnpm command or undocumented policy rule
[2026-10-03] [1.close] Sprint 1 reviewed and closed: the QA, security and tech reviews found 63 real gaps; fixing them and then attacking each round of fixes with read-only checkers took five rounds (63, 36, 23, 4, 4 defects), all fixed with tests. Grading now gives the same receipt on every browser (Unicode pinned to Chrome 120's 15.0), refuses copied policies, stored rows and user overrides are time-stamped so replay always reproduces past receipts (about 491,000 simulated receipts, 0 mismatches), and the grading code runs under a clock-and-network trap in CI; 4 limits are accepted with measured rates in docs/attacks-that-work.md — needs: push main to GitHub (MANUAL.md)
[2026-10-03] [1] sprint closed
[2026-10-03] [2.0] The extension now asks for exactly two sites (mail.google.com and calendar.google.com), and the shared observer skeleton exists: check the page, read it, strip to allowed fields, then send rows and a 'this window was seen' ping only for a clean pass; a page Chrome prerenders is never read, and a test page proves the ping arrives about 0.5 s after load
[2026-10-03] [2.1/2.4] Real Gmail and Calendar captures are waiting on the founder (MANUAL.md); 25 synthetic Gmail pages (Sent with overlap, Drafts and Inbox negatives, a second account, DST and midnight times, 8 receipt senders, 4 generic receipts and 4 price-bearing non-receipts) and 8 synthetic Calendar pages (create, edit, delete, a second calendar, a DST month) stand in, each with hand-written expected results
[2026-10-03] [2.6] The ledger now answers candidate searches from IndexedDB with indexes (the Sprint 1 candidate tests pass against it unchanged), stores which windows each observer really saw, and purges history older than 90 days together with the receipts that relied on it
[2026-10-03] [2.2] Gmail Sent reader: reads recipient, subject and send time only when Sent is the folder actually on screen (a hidden earlier folder is never read), refuses a row it cannot time to the minute or that might be a reply rather than a send, and dedupes rows across scrolls; 117 of 117 fields right on the synthetic Sent pages (bench gate passed) — real pages pending the founder's captures
[2026-10-03] [2.3] Receipt parsers for Stripe, Amazon, Facebook Marketplace, OpenTable, Instacart, Uber, Shopify and a generic order confirmation: exact amount to the cent, merchant and date from an opened message only; promotions, cart reminders, delay notices and newsletters with prices are never read as purchases; every parser passes its fixtures (bench gate passed) — real receipts pending the founder's captures
[2026-10-03] [2.5] Calendar reader: reads each visible event in Calendar's own time zone (DST included), never a hidden older week or a day hidden behind '+N more', and compares snapshots to give exactly one 'created', 'updated' or 'deleted' per change; 280 of 280 fields right on the synthetic Calendar pages (bench gate passed) — snapshot storage comes with 2.7, real pages pending the founder's captures
[2026-10-04] [2.7] The Gmail and Calendar readers now feed the ledger: each message is answered so nothing counts as seen unless it was stored, Calendar reads are stored all or none with snapshots that tell created, changed and deleted events apart, receipts can now verify a purchase, Gmail Sent only vouches for the newest page, events already on the calendar are never accused, change claims are never NOT FOUND, clock jumps are repaired, and visible Calendar tabs are re-read every minute; checked by a 5,740-history simulator (replay exact, no false accusations) and 39 browser tests — one rare clock-jump case is scheduled into Sprint 3.6
[2026-10-04] [2.9] Adapter and privacy docs: docs/adapters.md v1 (the reader contract, what a pass sends and in what order, every DEGRADED reason, capture → label → test → version, selector repair, one section per reader) and docs/privacy-architecture.md v1 (every ledger table and field, the allowlists, hashing, retention, the export); check-docs now fails if an allowlisted field is undocumented, and PRIVACY.md describes what the extension now reads
[2026-10-04] [tooling] The pre-push check now tests the exact commit being pushed in a temporary copy, so in-progress work on the laptop can no longer block a push
[2026-10-05] [2.close] Sprint 2 reviews closed: all 43 review gaps fixed with a test each or accepted with a measured rate, then a second review of the merged result found 12 smaller issues, all fixed. Calendar no longer accuses an agent of any change until the live check can tell your own edits from other people's; a stranger's order email can no longer cause an accusation; nothing counts as checked while a tab is offline or just woke; a web page can no longer switch Attest off; the options page can export everything Attest keeps — the Sprint 2 gate now waits only on the founder's live check (2.8) and real Gmail and Calendar captures (2.1, 2.4), steps in MANUAL.md
[2026-10-06] [2.1] Real Gmail captures: 12 pages from the founder's own accounts (Sent pages, a second account, Drafts, Inbox, opened threads, Stripe, Instacart and Uber receipts, an Amazon shipping notice), with names, addresses and amounts faked. They showed what the hand-made pages missed: Gmail repeats each row in a hidden summary (every real Sent page read as broken), most Sent rows are whole conversations whose time is not a send's (now never counted as one, so a reply in a thread is 'can't verify', never 'not found'), receipts keep their message id one level deeper (no real receipt was read before), and an email you send yourself would have stored your own address (now left out). Sent fields read 100% right on all 56 labelled sends, 17 of them real.
[2026-10-06] [2.4] Real Calendar captures: 9 pages of the week of 4 October (before, after creating, moving and deleting a test event, calendars on and off, the list still loading) and a month. Calendar draws its calendar list as plain checkboxes that fill in seconds after the grid and only while the tab is visible; both are now read right. Month view is honestly reported as broken (DEGRADED) until its days can be read. Your own event's label carries no 'Accepted' while every invitation does: a lead for re-enabling Calendar UNASKED at the live check.
[2026-10-07] [2.close-r2] Three independent reviews of the real-capture work found real personal data in four receipt captures (your address hidden in Uber's compressed links, trip addresses, a phone number, a birthday gift-card email) before anything was pushed: those commits were taken out of local history, the receipts are held out until re-captured and read by you, the 17 kept pages were cleaned, the capture tool now cuts other sites' links, phone links, card endings and handle digits, and a test decodes every capture for hidden addresses. Also fixed: an email to yourself or a reply the Sent list had not refreshed to show could have been called NOT FOUND (now 'can't verify'; grading contract v1.14), blank Gmail ids and half-loaded calendar lists now fail loudly, and the heavy tests no longer time out. Task 2.1 waits on the receipt re-captures (8 of 12 real Gmail pages); the gate waits on the live check (2.8) and your push.
[2026-10-07] [2.gate] Every automated check re-run on the committed code, all green: 9,652 tests, the browser tests (47 of 47; nothing left the browser), the time-zone and coverage runs, and the bench on 4 real Sent pages and 9 real Calendar pages. 10 commits wait for your push; the gate still waits on the live check (2.8) and the receipt re-captures (2.1).
[2026-10-07] [ci] CI had been red since 4 October. Two earlier causes were already fixed; the last was memory: the Calendar tests kept every page they read alive, more than the 2 GB CI gives each test process (your Mac gives 4 GB, so it passed here). Each page is now let go when its test ends, and every test run gets CI's 2 GB, so a leak fails on the Mac too; the whole suite passes on one process under that limit. CI turns green on your next push.
[2026-10-07] [ci] Your push was refused by its own check: a test that fails at random (about 1 run in 150). Measuring all 64 such checks found two more (about 1 in 50 and 1 in 750) and one test that expected the wrong thing in a rare case (the grading code was right). All four fixed; none was loosened.
[2026-10-07] [ci] With the tests passing, CI's single job ran out of its 30 minutes before reaching the browser tests; it now runs as five jobs side by side, each well inside the limit, with every check unchanged.
[2026-10-07] [2.1] Receipt captures: 7 more real Gmail pages (Stripe, Instacart, Uber, a Shopify order, a trial confirmation, two promotions), read by me at your request, so 15 real Gmail pages are labelled. Reading them found what the capture tool still let through (a card ending, invoice and order numbers, a referral and a coupon code, an address in India, rupee amounts, a Meet code), now all faked with tests, and two receipt-reading bugs, both fixed: Stripe's real layout hid its total, and Uber's charge summary counted one trip twice. A total written "Rs." stays unread on purpose: five countries write their rupee that way.
[2026-10-07] [2.8] Live check done with your approvals, your phone and your lid: offline and sleep behaved as designed, the Calendar changes were seen within 2 seconds, and the export holds no body text. Three findings: an email written as a draft first (as on your phone) never becomes a Sent row (task 2.10), a second Gmail tab makes the Sent reader look broken (2.11), and Calendar's week view never shows guests (recorded as a limit).
[2026-10-07] [2.10] Mails you write as a draft before sending now count as sends: Gmail kept the draft's thread id, so they looked like conversations and were skipped (a third of the rows on your real Sent pages). A row is now one message when Gmail shows no message count beside it, on a list that shows counts; a row with a count is still a conversation. Your Sent pages were re-labelled (44 more of your sends read, in 51 rows: Gmail's second page repeats 7; all 324 compared fields right), with a new test page and a browser test that fails under the old rule. Contract v1.15 — decisions in Decisions.md [2.10].
[2026-10-07] [2.11] A second Gmail tab no longer makes the Sent reader look broken: a page a reader does not read now says "idle" (nothing to read, nothing wrong), and that never replaces what the Sent tab reported, so a real break still shows. The receipt reader got the same fix. Calendar can still flip if you keep its settings open beside the week (noted for Sprint 6.4). A browser test with two tabs proves it.
[2026-10-08] [2.close-r3] Third review of the receipts and the live smoke: 29 findings, all fixed or listed. The serious one: values from your real receipts and invitation (a card ending, order and invoice numbers, codes, two Meet codes) had been copied into tests and docs, and the capture tool's fakes used a public key that let some originals be worked out. Both fixed: invented values everywhere, a secret capture key on your Mac, and your 8 newest captures re-scrambled with it. Older unpushed commits still hold the values: please don't push until I can rewrite them (needs your approval, see MANUAL.md). Also fixed: a passing glitch no longer sticks in the Sent status, and tests use less memory.
[2026-10-08] [2.close-r3] With your approval the unpushed commits were rewritten: none of them, and none of their messages, holds a value copied from your captures any more, the final files are unchanged, and the benchmark was re-run on the clean result (all gates pass). It is safe to push now.
[2026-10-08] [2] sprint closed — gate green: exactly two host permissions (Gmail and Calendar); Gmail Sent field accuracy 1 against a 0.95 gate, on 4 real pages; 8 receipt parsers with negatives, exact on 6 real receipts; Calendar diffs give created, updated and deleted correctly; the ledger index passes the Sprint 1 suite; coverage pings are stored and read back; the export holds only allowlisted fields; both mandatory tests green with real captures flowing; the live smoke is logged; closed.md says VERIFIED CLEAN.
[2026-10-08] [ci] Your push passed CI. A Dependabot update (PR #9: two lint and type-checking packages that never run in grading) then failed the grading speed check at 2,040 ms against its 2,000 ms limit; the same code has measured between 1,302 and 1,977 ms on CI, so this is the CI machine's variance, not the update. I made one safe part of grading twice as fast (sorting ids, 37 → 18 ms per batch, every receipt unchanged); three other speed-ups were measured and dropped as too small or too risky. The limit and how it is measured are unchanged. To do: re-run PR #9's failed check (MANUAL.md).
[2026-10-08] [3.0] Sprint 3 started with the part that needs no captures: the rules that read an agent's sentences as claims ("I sent an email to …" is an email sent; "Should I send it?" or an approval card is only a proposal; "I couldn't send it" is nothing). Tested on 162 invented sentences: right on all 142 it was built with and on 17 of the 20 written afterwards (10 of 20 before the fixes those showed); every mistake drops a claim rather than inventing one. The ChatGPT and Claude site permissions will be added together with their readers, not before. The adapter base is next.
[2026-10-08] [3.0] The adapter base is in: on an agent's page it will report the requests you made, the claims the agent's sentences make, and the apps a settings page says it can reach, on the same machinery the Gmail and Calendar readers use. A claim whose time the page does not show is left out and the reader shows as broken, rather than guessed. Task 3.0 stays open: Muse's address is yours to confirm (MANUAL.md), and the ChatGPT and Claude permissions come with their readers (3.3, 3.4), which wait on your captures.
[2026-10-08] [3.1] Muse captures are yours to make (MANUAL.md); meanwhile five hand-made Muse pages stand in, clearly named synthetic: a conversation, the activity view, connected apps, an approval prompt and a page Muse does not read, each labelled with what should be read from it.
[2026-10-08] [3.2] The Muse reader is written and passes all five pages: it reads your requests, the actions Muse says it took, and the apps it is connected to; an approval prompt counts only as a proposal, and a quoted email or a payment card on the page is never read. It runs nowhere until you confirm Muse's web address, and its page details are redone from your captures.
[2026-10-08] [3] Paused: every remaining Sprint 3 task now waits on you (MANUAL.md, Sprint 3 list). The most useful one: Muse's web address, which lets the Muse reader run and the end-to-end checks of 3.5 to 3.7 proceed. Captures of Muse, ChatGPT agent mode (and Dots, with Pro) and Claude follow; please use test conversations with invented details. Seven commits wait for your push.
[2026-10-08] [3.2] Muse's address (muse.ai) is in: Attest now asks for that site and runs the Muse reader on the Muse pages you open. For now it only reports whether the reader works, and it will say it is not reading until your captures teach it the real pages; nothing else leaves the page. The privacy policy says so (version 0.1). This also unblocks 3.5 to 3.7, whose end-to-end checks can now run on the stand-in Muse pages.
[2026-10-08] [3.10] I read the four vendors' terms for you. Meta (it runs muse.ai), OpenAI and Anthropic all forbid collecting data from their sites automatically; Google's terms are fine for what Attest does. As you chose, the Muse, ChatGPT and Claude readers are off, the options page says why, and Attest asks only for Gmail and Calendar again. Today's two captures were checked (nothing of yours in them) and moved to a private folder outside the project; agent pages are saved by hand from now on. The rest of Sprint 3 waits on the vendors' permission, or on a different way to take claims (MANUAL.md).
[2026-10-08] [3.11] You chose both ways forward. The three permission letters are drafted for you to send (MANUAL.md has the link). Meanwhile Attest will take claims from a log you paste: you copy the agent's own activity list (what it says it did, with times) into Attest's side panel, check the preview, and Attest grades each action against your Gmail and Calendar, without ever reading the agent's site. The plan is in docs/claims-import.md; building it is next (tasks 3.11 to 3.14).
[2026-10-08] [3.11] Attest can now read an agent's activity log that you paste: each entry becomes a claim at the time the log shows, using the same rules as the page readers. It only uses a day the log itself shows, so copy the "Today" heading along with the entries; an entry without a clear day or time is listed as not imported, never guessed. 18 tests, including midnight and the night the clocks go back.
[2026-10-08] [3.12] The side panel's "Add agent activity" screen is built: you pick the agent, paste its activity log, and see each claim Attest found and each entry it will skip, with the reason, before you import. Only the claims are kept; the pasted text is dropped when you close it. It goes live in the panel with the next step, which saves and checks the claims.
[2026-10-08] [3.13] Pasted claims are now stored and graded: the side panel sends only the claims to the background, which checks them against your Gmail and Calendar, says how many were new, and finalises them after the grace period, even if Chrome stopped the background meanwhile. Every receipt can be proven again from an export (replay matched 2 of 2 on the §2 demo). Both privacy tests now include a paste and pass. One gap found: catching an action nobody asked for needs to know when the agent was working and when you were away; that is the next task (3.14), with the away part off unless you turn it on.
[2026-10-09] [3.14] Attest can now catch an action nobody asked for on the paste path, as the §2 story describes: the times in a pasted log show when the agent was working, and, only if you turn on away detection in the options page, Chrome tells Attest when you were away. With both, an unclaimed email is flagged "likely Muse" (tested end to end through the ledger, and replay proves it). Away detection is the first extra permission, asked only when you turn it on; turning it off deletes what it kept. Next: reading a calendar event's time from a pasted claim, which the demo's "not found" needs.
[2026-10-09] [3.15] A pasted calendar claim like "Created event 'Q3 review' Thu 2pm" now knows the event is Thursday at 2 pm, so Attest can check it against your Calendar (before, every pasted calendar claim was "unverifiable"). Only a clear day plus time is read; anything vague is left unverifiable, never guessed. Also, a title and its summary no longer count as two actions. The §2 demo's own log, pasted, now gives "verified" for the email and "not found" for the missing event. Next: the full end-to-end test in the built extension.
[2026-10-09] [3.16] The §2 demo now runs end to end in the real built extension: Gmail and Calendar pages are read by Attest's own readers, Muse's activity log is pasted into the side panel, and the result is exactly the three receipts of the story: the email to Priya verified, the calendar event not found, and the send to the vendor flagged as likely Muse, unasked. It also found and fixed one bug: an unclaimed send older than a day lost its evidence of who was working. Both privacy tests still pass.
[2026-10-09] [3.17] A wrong computer clock can no longer make a true calendar claim look false. When the clock is set right after running ahead (or jumps back), Attest now remembers the stretch of time the wrong clock may have stamped. A "created this event" claim stamped in that stretch is shown as unverifiable, not "not found", unless the event was clearly seen after the claim. Before, the event's sighting could look older than the claim and be thrown out. Both clock cases from the Sprint 2 simulator are now tests, and replay still reproduces every receipt.
[2026-10-09] [3.close] Sprint 3 was reviewed for testing, security and code quality, and all 34 problems found were fixed. The most important: Attest could wrongly say an agent "likely" sent your own email (a time away stretched overnight after Chrome closed, one pasted line counted as two pieces of evidence, future times left behind by a clock fix); each receipt's replay record copied too much; and some pasted logs could land a claim on the wrong day. Everything passes: 10,250 tests, 51 browser tests including both privacy tests, and every benchmark. Sprint 3 cannot formally close yet: three gate items need the AI companies' permission to read their sites. An amended gate is waiting for your OK in MANUAL.md.
[2026-10-09] [3.gate] You kept the Sprint 3 gate as written, so Sprint 3 stays open until an AI company permits reading its site; meanwhile the project goes on without that, on pasted logs and your Gmail and Calendar tabs, starting with Sprint 4. The private agent pages of 8 October are deleted, and the commits are pushed.
[2026-10-09] [4.0] The screens' data layer: the popup, side panel and options page now read your receipts, coverage, health and grants straight from the ledger in the browser, a page at a time, newest first, through new indexes (ledger schema 8). On a ledger of 5,000 receipts the popup's reads take about 18 ms (the target is under 50 ms), and a test fails if any read scans a whole table.
[2026-10-09] [4.1] The building blocks of every screen: grade chips (each colour with its name), agent badges ("Likely agent: Muse" for an unasked action), the coverage line ("Gmail Sent checked 14:10", or "Calendar not checked yet" in yellow), the yellow banner when a reader breaks (with a link to report it on GitHub), the evidence list, the empty state and loading rows, with light and dark themes. A demo page shows them all; an accessibility checker finds no serious problem in either theme.
[2026-10-09] [4.2] The popup: what Attest checked and when, a yellow warning if a reader broke, and today's receipts newest first. Each receipt shows its grade, the claim in one line and the agent; a still-pending one says when it can be final (grading now stores that time), and an unverifiable one says why (for example, Calendar was never opened). Unasked actions say "Likely agent" and list their signals. With 5,000 receipts the popup first paints in about 60 ms and shows the day in about 90 ms (the target is under 100 ms).
[2026-10-09] [4.3] The side panel's timeline: every receipt, newest first, filtered by agent, grade and days, with older ones loading as you scroll. Each receipt opens a detail that shows everything its grade came from: the claim as read, the evidence, the score and each signal, the reasons in words, and what Attest had checked. You can mark a receipt Verified or Not found with a reason; Attest's own grade stays beside your mark, you can undo it, and replay still reproduces every receipt.
[2026-10-09] [4.4] The options page's Grants: one form per agent, with what it may do in plain words, the actions it may take, the recipients it may write to, a spend ceiling, the access you declare and an alert mute. Every field is checked on Save and says what to fix. A saved grant applies at once to that agent's open receipts and never changes a final one: in the end-to-end test, unticking Muse's email makes the next pasted email claim Over scope. Decided: the page sends only your choices, and Attest keeps what it observed itself. A grant saved while the clock ran ahead is fixed when the clock comes back, so grading never stops for want of a grant.
[2026-10-09] [4.5] The rest of the options page. Adapters: Gmail and Google Calendar each show their health (working or needs repair, version, last check) and can be turned off and on. Off unregisters that page reader's script at once, and an open tab stops at its next check. The agent readers stay off under their makers' terms. Privacy: a link to the privacy architecture, a retention choice of 30, 90 or 180 days, and telemetry shown but disabled until Sprint 5. Export: the page builds the ledger JSON from paged reads, byte for byte the worker's export, plus a receipts CSV. Danger zone: Delete all data, asked twice, empties the ledger and extension storage. Decided: a new permission, `scripting`, which the turn-off needs; the readers' choice lives in extension storage.
[2026-10-09] [4.6] Alerts: a Chrome notification when a receipt ends Not found, Unasked ("likely Muse") or Over scope. There is one per receipt, ever, kept in a new ledger table so a restart never repeats one. Muting an agent silences it. A click opens the side panel on that receipt. In the end-to-end test, the §2 demo gives exactly two alerts, none with Muse muted, and none again after the worker restarts. Decided: a new permission, `notifications`; an alert never names who an email went to, an amount or a subject, because it can show on a locked screen. Also fixed: `pnpm test` had reported two unhandled errors since 4.2 while every test passed.
[2026-10-09] [4.7] The weekly digest: every Monday at 09:00 Attest writes down the week before, per agent: receipts by grade, how many checked claims were verified, the receipts to look at, the days Gmail or Calendar was not checked, and reader health. It is kept so past weeks can be read again. A new digest page shows it, opened from the popup or a "ready" notification. Share gives redacted text: who an email went to appears as a domain only, a subject only as its hint. In the end-to-end test the alarm fires with the clock moved to Monday and the demo's counts come out right, and the mandatory leak test now also searches the share. Decided: a PNG of the share comes with 4.8's image renderer.
[2026-10-09] [4.8] Share a receipt: from the side panel's detail, as text or as an image you see before copying. Who an email went to shows as a domain only, amounts and times stay, and a subject shows only as its hint. It never includes what you asked an agent or why you marked a receipt. Every receipt of every golden scenario passes those checks, and the image reads clearly in light and dark (measured pixel by pixel). The weekly digest's share gains its image too. Decided: no new `offscreen` permission; the image is drawn in the page itself.
[2026-10-09] [4.9] Check Gmail for me: off unless you turn it on in the options page. When an agent says it sent an email and no Gmail tab has shown Attest your Sent folder in the 15 minutes since, Attest opens your Gmail Sent folder itself, once, in a pinned tab in front of you, never in the background: at most one tab every 30 minutes, never twice for the same claim, and the popup says why it opened. It is the one exception to "Attest reads only tabs you open", written in the privacy doc and in the setting itself. Tested on the real build: off, no tab ever opens; on, exactly one. No new permission was needed. The end-to-end tests can no longer reach the internet, even through a tab the extension opens itself.
[2026-10-09] [4.10] Accessibility and wording pass. Every screen (popup, timeline and detail, settings, weekly digest) passes the axe accessibility checker with no serious or critical problem, in light and dark mode. The keyboard reaches every control with a visible focus ring; the walk found and fixed one gap, the date filter's calendar button. Moving parts stop when your system asks for reduced motion. A test reads every sentence in the code: no exclamation marks, hype, blame or false reassurance, every button starts with a verb, and every unasked row says "Likely agent". Screen readers now hear "Agent: Muse" on the agent badge, and three buttons were renamed to verbs ("Open weekly digest", "Return to the timeline", "Open").
[2026-10-10] [4.close] Sprint 4 was reviewed for testing, security and code quality: 48 findings, each fixed and tested, written and checked by the tester, or accepted with its reason. The most important: a share could show a name written with a dot ("A.Kumar") as if it were a web domain, and an email address inside a subject as it was; now only a real address gives a domain, and an address in a subject is shown as its domain. Also: a script on a Gmail or Calendar page can no longer turn a reader you switched off back on; Delete all data keeps that choice and clears Attest's alerts; Check Gmail for me waits until you are at Chrome; the weekly digest keeps your marks with their reasons and no longer says "Nothing to look at" for a week it could not check; the privacy policy (version 0.4) now describes everything Attest does, and a test holds it to the extension's permissions. The test that proves nothing leaves the browser now also runs every Sprint 4 feature, and found nothing. On a quiet machine every speed check passed: the popup's first paint takes 64 ms (limit 100). Two decisions are yours, with recommended defaults (MANUAL.md, Sprint 4 close).
[2026-10-10] [4] sprint closed — gate green: the popup's first paint 64 ms at 5,000 receipts (limit 100); the coverage header and the degraded banner proven end to end; a receipt's detail shows every evidence field; grants save, are checked, and re-grade only open receipts; export and Delete all data verified; alerts exactly as specified; the weekly digest renders and shares redacted; zero serious accessibility problems; both mandatory tests green, with every share searched and every Sprint 4 feature run; closed.md says VERIFIED CLEAN. 74 end-to-end tests and 10,672 unit tests pass on the committed tree. Sprint 5 (the optional model and opt-in telemetry) starts next.
[2026-10-10] [5.0] Sprint 5 began with the rule that keeps the optional AI model honest, before any model exists in the code. The model may only nudge a receipt that Attest's own rules already rated a partial match up toward verified; it can never lower a grade, never rescue a match below the partial line, and never change which email or event a claim is matched to. Its weight is set so that it can never verify a partial match on its own. A test grades 5,000 random cases with the model saying "no" and saying "yes" and checks that only those partial-to-verified moves ever happen. With the model off, which it stays until it is wired in, no grade changes.
[2026-10-10] [5.1] What the optional AI model is allowed to see is now fixed in code: for a claim, only what kind of action it was, who it was to, a short subject, an amount and a time; for each possible match, the same few facts. Never the text of a page, never what you asked an agent, never anything else a stored record holds. A test checks this exactly for 20 claims, including one where your request said "ignore previous instructions": those words never reach the model. The model is told its input is data, not instructions, and nothing inside the data can break out of it. Its answer counts only if it is exactly a score per candidate; anything else, an error, or no answer within 2 seconds simply means no score, and Attest grades as it does today.
[2026-10-10] [5.2] Attest can now use the AI model built into Chrome itself, which runs on your computer and sends nothing anywhere. It is off by default; the options page's Model section turns it on only where Chrome actually has the model, and otherwise says why in one line (this Chrome has none, this computer cannot run it, or it is not downloaded yet, with a button that downloads it when you click). Every call starts a fresh session, gets the same fixed instructions and the claim as data, and must answer in the exact shape required or it is ignored; no answer within 2 seconds means no score. It is checked here against a stand-in for Chrome's model; checking it against the real one on your Mac is one short step for you (MANUAL.md, Sprint 5). The model is not used for grading yet: that is 5.4.
[2026-10-10] [5.3] You can also give Attest your own Anthropic or OpenAI key instead of Chrome's model. It is off unless you save a key and turn it on, and the options page says exactly what would be sent (only a claim's kind, recipient, short subject, amount and time, and the same for each possible match; never a page or what you asked an agent), to whom (api.anthropic.com or api.openai.com), that the company keeps it under its own terms, and that each check is billed to your key. Your key is kept where no script on a Gmail or Calendar page can read it, never logged, never exported, and deleted when you forget it or delete all data. The test that hunts for leaked secrets now saves a fake key and finds it nowhere but its own storage slot. No new browser permission was needed. If Chrome's own model is also on and ready, Attest uses that instead and sends nothing.
[2026-10-10] [5.4] The optional model now helps grade. When a claim matches an email or event only partly and is still being checked, Attest asks the model you turned on (Chrome's own, or your own key) about that one claim and the one match, once, and grades again when it answers: a strong answer can lift Partial to Verified, and nothing else can change. Grading never waits for the model, a slow or failed answer just leaves the rules' grade, and a claim already final is never re-asked. The answers are kept in a new table that is exported with your data and deleted with its claim, and when you turn the model off they stop counting. Shown end to end: a paraphrased email claim went from Partial to Verified through a stand-in for Anthropic, a not-found claim was never sent, and the only host contacted was Anthropic's. The proof that the model can only lift Partial to Verified passes on 5,000 random batches through the real grading path. One change you will see: the options page now asks Chrome about its on-device model only when you click "Check Chrome's on-device model", because asking as the page opened made Chrome print a warning that the full test run caught.
[2026-10-10] [5.5] `pnpm bench` now measures the optional model on 24 invented, labelled cases: which claims Verified gets right and wrong. By the rules alone it verifies 5 of the 14 cases that have a real match, and never verifies a wrong one. Chrome's model and your own key are "not measured": their real answers can only be recorded on your Mac with the model, or with your key, so RESULTS.md shows no number for them rather than a made-up one. So the model stays off by default, recorded in Decisions.md with these numbers. When you do the model check on your Mac (MANUAL.md), one extra click records the on-device model's answers, and the bench will then show whether it helps.
[2026-10-10] [5.6] The opt-in telemetry's daily payload now has a fixed shape, written twice, once in the extension and once in the server's code (the server's first files, telemetry-api/, in Python). It holds only counts, on/off switches, a few fixed words like OK or DEGRADED, the install id, the version number and the date; there is no field where any other text could go. A test on each side compares both to one shared file, so the two can never disagree, and 25 broken payloads are refused by both. Nothing is sent yet (that is 5.7), and CI now checks the server code too.
[2026-10-10] [5.7] Anonymous usage numbers now work, off unless you turn them on in Options, Privacy. When on, Attest sends one report a day about the day before: counts per agent and grade, which readers were on and how long they covered, the install id, the versions and the date. Never twice for the same day, and only to its one host. The options page shows exactly what the next report holds, and "Send a test payload now" sends it immediately. Until you deploy the server (MANUAL.md), its address is a placeholder that can never be reached, and the store build refuses to run, so nothing can go astray. The no-leak test now also checks what telemetry sends, and the network test still allows no host at all with everything off. PRIVACY.md now says plainly what each option sends.
[2026-10-10] [5.8] The small server that receives the opt-in usage numbers is built (telemetry-api/). It checks each report against the fixed shape and refuses anything else, takes at most 24 reports a day from one install and 240 from one network address, and stores only the report and the time it came: never who sent it or from where. Tests cover more than 30 kinds of broken report, the limits, a database that is down, and that a browser page can post only from the extension. The server also ran for real on this Mac against a throwaway database, which caught two things the tests could not: the web server itself would have let a sender fake its address to slip past the limit (now switched off and pinned by a test), and the proof script tripped on a timestamp (fixed). Running it on Railway needs your account, so the deploy is in MANUAL.md with exact steps, including a one-command check that no one can fake their address on Railway either. Until then the extension's address for it stays a placeholder. The Docker version of the check runs in CI on your next push.
[2026-10-10] [5.9] The privacy documents now describe the optional AI model and the anonymous usage numbers in full. For the model: exactly which few facts it is given, how it is asked, when, where it runs (Chrome's own model on your computer, or your own key's company), how your key is kept, and what is kept of its answers. For the usage numbers: what one report holds, field by field, where it goes, how often, how to turn it off, and how to reset the install id so old and new reports cannot be linked. The example report in the document was made by the real code from an invented day, not typed by hand, and a test fails if the two ever differ. The grading reference now explains where the model's score comes from, and PRIVACY.md (version 0.6) says the same in plain words.
[2026-10-10] [5.close] Sprint 5 was reviewed for testing, security and code quality: 45 findings, each fixed and tested, written and checked by the tester, or, where only you can act, in MANUAL.md. The most important: the popup, side panel and digest said "Nothing leaves your browser" even with your own model key or the usage numbers on; now they say it only while both are off, and otherwise name what is on and where it sends. Also: turning a model off stops a call already under way; Attest's two outbound calls refuse redirects, and the extension may now connect only to itself, the two model companies and the telemetry server; a key is taken only for its own company; the day the clocks go back is no longer lost from the usage numbers; the telemetry server reads at most 16 KB of a request, cannot be dodged by changing addresses, keeps each day once, and stores only the hour a report came. The test that proves nothing leaks now makes your own key's call and searches what the model's company received, headers included, and found nothing; the network test runs every Sprint 5 feature with both options off and saw no host. The close's final full run also caught a Sprint 5 test that broke the purity check CI runs on the grading core; it is fixed. Two decisions are yours, with recommended defaults (MANUAL.md, Sprint 5).
[2026-10-10] [5.gate] Sprint 5's gate: seven of its nine checks pass. Two wait on you: the AI models' own numbers in the bench, which need their answers recorded on your Mac (MANUAL.md, Sprint 5; until then the bench shows the rules' numbers and the model stays off by default), and the Docker check of the telemetry server, which CI runs when you push (this Mac has no Docker; the same check ran here against a real database), or the Railway deploy. As with Sprint 3, the gate stays as written: Sprint 5 closes when both are in, and Sprint 6, the red team and hardening, starts now, since nothing in it waits on either. Your next push also runs CI on all of Sprint 4 and 5 for the first time.
[2026-10-10] [6.0] Sprint 6 began with the red team's test bench. Each attack on Attest is now a folder of invented pages and an agent's claims, together with the answers a correct Attest must give. `pnpm redteam` runs every attack through the real extension exactly as you use it (the pages read by Attest's own readers, the claims pasted in the side panel) and reports each one as caught or working, how often, and how badly; a false Verified is the worst. With no attacks yet it reports none, and with one test attack, a true email claim, it reported one row: caught. Attack pages are cut off from the internet. The attacks themselves come next (6.1 to 6.3), and docs/attacks-that-work.md now has the tables they will fill, the attacks that still fool Attest first.
[2026-10-10] [6.1] The red team ran its first four attacks on Attest, 41 in all, through the real extension. Claiming one email three times over, or by two agents at once: caught every time, since one email verifies one claim at most. Look-alike addresses (a Turkish dotless i, a Cyrillic letter, invisible characters, a fake domain, an attacker's address under Priya's name): never verified, 0 of 15. Time tricks (an email sent hours before the claim, a time written in UTC, a time in the future): caught, 0 of 7. Two attacks still work, and both are published in docs/attacks-that-work.md. When the agent describes a real email in other words ("messaged Priya re: the deck"), Attest misses 7 of 12, always saying it could not check and never that the agent lied; that is accepted. And an email to pri.ya@gmail.com, which Gmail delivers to priya@gmail.com, is reported as not found; fixing that changes the grading rules, so it waits for its own version.
[2026-10-10] [6.2] The red team's next attacks, run through the real extension. Fake Sent rows planted by a page (beside Gmail's list, in a second list, inside an embedded frame, hidden in the list) were never read as sends: 0 of 4 worked, and two of them made the Gmail reader report itself broken, which is the loud failure Attest wants. Instructions hidden for the AI model (in the pasted claim, in an email's preview text, in a subject line) never reached it outside the few facts it is allowed, and even a model obeying an injected instruction could not turn a mismatched email into Verified: 0 of 4. Fake receipts (from a stranger, from your own address under a shop's name, wearing Stripe's name, with a look-alike letter in the shop's name) never verified a purchase: 0 of 4. Gmail open on Drafts, the Inbox or one message, or Calendar with a calendar hidden: always "could not check", never "not found". One attack works and is published: if the only Gmail Sent list Attest has seen is another account's, a real send from your other account is reported not found; that limit was accepted when the grading rules were written, and the receipt says why. A new automatic test now runs these attacks on every full test run, so a change that lets one through fails.
[2026-10-10] [6.3] The red team's last attacks for now, 69 more, through the real extension. Pasting the same log twice, or a copy that differs only in invisible ways, never counts a claim twice. Splitting spending to slip under a spend limit (two $30 purchases under $50, a second currency, no currency written) and writing to a look-alike of an allowed domain: always flagged Over scope, 0 of 10. Planted secrets never reached anything a share, the export, the usage numbers or the model could carry: 0 of 18 in 12 places. Three attacks work and are published. An agent that sends an email it never mentions is flagged "likely the agent" only when two signs meet (it logged other actions right around it, or you were away), so 18 of 25 such sends were missed; this is the serious one and goes to the hardening step (6.9). The reverse also happens: 6 of 25 of your own sends were called "likely" an agent's, when the agent logged two actions of its own right around them; the receipt always says "likely". And an agent that sends fifty more emails after a false claim pushes it past the rows Gmail shows, so it is "could not check" rather than "not found"; that limit is now written into the privacy document. The encryption attack waits for encryption itself (6.5).
[2026-10-10] [6.4] Attest is now measured at a month of heavy use, and it holds. Reading a Gmail Sent list of 10,000 emails takes 0.7 seconds (the limit is 2), and reading it again stores nothing twice. A month of activity, 5,000 claims and 50,000 emails, takes 40 MB inside Chrome (the limit is 50), and the popup still opens in under 80 ms (the limit is 100). A page that changes 100 times a second is read once every 2 seconds rather than 100 times a second. Exporting that month takes 3.5 seconds for the full ledger and 1.2 seconds for the receipts' CSV, and the background part of Attest uses about 3 MB of memory at rest. One thing to know: storing 10,000 emails at once would take the background about 100 seconds, but real Gmail shows at most 100 at a time (about a second). These checks now run on every test run. Some measurements need your own Gmail and Calendar; they are optional and listed in MANUAL.md.
[2026-10-10] [6.5] Attest can now encrypt what it stores, if you want it to. Turn it on in Settings with a passphrase, and your agents' claims, the emails and events Attest saw, your grants and every receipt's detail are sealed with AES-256 under a key made from your passphrase (600,000 rounds of PBKDF2); ids, dates and grades stay readable, because Attest finds its records by them. The key is kept only in memory: closing Chrome, updating Attest or a restart of its background worker locks it, and the popup and every page then ask for the passphrase. A wrong passphrase reads nothing; while locked, Attest reads and stores nothing, so a claim from that time is "couldn't check", never "not found". You can lock it at once, change the passphrase or turn it off, and a background job reseals everything, picking up where it stopped after a restart. The red team's encryption attacks (a copied profile, wrong and near-miss passphrases, a change mid-session) all failed: 0 of 3. If you forget the passphrase, Delete all data is the only way back. Decisions: the cipher runs inside the database's own transactions, so it uses a small bundled library instead of Chrome's built-in one (same AES-GCM); and the end-to-end run caught a Chrome-only bug in reading records back, fixed and now tested.
[2026-10-10] [6.6] A new check runs in CI on every build and fails if Attest's manifest ever asks for more than it needs: the tabs permission, a wildcard or extra site, a content script, a looser security policy, or an old Chrome. It passes today: Attest asks for exactly Gmail and Calendar, plus storage, alarms, scripting, notifications and the side panel, with away detection optional. Each permission now has a one-line reason, in Decisions and in the store listing's first draft (launch/store-listing.md).
[2026-10-10] [6.7] The store-policy pre-review ran, reading Attest as a Chrome Web Store reviewer and a privacy regulator would. Verdict: not ready yet, and nothing in the code is the reason. What is missing only you can do: a public address for the privacy policy and a public link to the source (both wait on your decision to make the repository public), your certification of the store's privacy form (the draft answers are in launch/store-listing.md, with one choice for you: how to declare the optional own-key feature), a re-read of OpenAI's terms in your browser (their site refuses automated reading), and the screenshots, which Sprint 7 makes. All are in MANUAL.md. Fixed on the way: the daily purge now also runs right after you unlock an encrypted ledger, so old history is never kept longer because the ledger was locked when the purge was due; a Limited Use statement in the privacy policy (version 0.7) and the listing; the encryption docs now say what it cannot protect (a compromised browser or computer); exporting a locked ledger says to unlock first; the README says which attacks still work. Meta's, Anthropic's and Google's terms were re-read and are unchanged.
[2026-10-10] [6.8] Attest now has a threat model (docs/threat-model.md): what it protects (your knowledge of what your agents really did, and your data), what it does not (it never stops an action, it cannot see what no open tab shows, and it believes the pages Google draws, so a compromised browser or a lying page defeats it), who it defends against, the three trust boundaries with a diagram, the weakest links (what the page shows, the UNASKED guesswork, and gaps in what was looked at), the assumptions it rests on, and every attack the red team found still works, each with what the receipt says. A test keeps it in step: if an attack that works is published and left out of the threat model, the build fails.
[2026-10-10] [6.9] The hardening pass after the red team. No critical finding was open. The one high one, an agent's send it never claimed going unflagged when no sign of the agent was near it (18 of 25), is accepted rather than fixed: catching it would mean flagging on one weak sign, and that would wrongly blame your own emails, which the red team showed Attest currently never does at those signs. So Attest now says plainly, under the side panel's grade filter and in the weekly digest, that it flags a send as likely Unasked only when an agent was active near it. The red team ran again on the finished code: every number unchanged (131 attacks, 6 still working, none critical), and every speed and size limit still met: a 10,000-email Sent list read in 0.74 s (limit 2), a month of use in 40 MB (limit 50), the popup open in 60 ms (limit 100).
[2026-10-13] [6.close] Sprint 6 was reviewed for testing, security and code quality: 31 findings, each fixed and tested; the store-policy pre-review's 5 wait on you in MANUAL.md. The most important: with encryption on, Chrome's own files still held your records as they were before, so a copy of the profile could read 1,200 to 2,400 of 5,000 sends. Now Attest keeps its records in a storage folder of their own, and once encryption has sealed them it copies them into a new folder and deletes the old one whole: a copy of the profile finds none of the 5,000, and none in 36 tries with six browsers busy at once (the first fix still failed 5 times in 12 that way). Delete all data deletes the folder the same way. This needs Chrome 122 or later (from February 2024). Also: your own model key is sealed while encryption is on; Lock now always locks, even when something fails; a damaged key record says so instead of "wrong passphrase"; a stopped encryption job says why, with Try again; the manifest check is stricter; a month of records now seals and is cleaned up in 31 seconds, about half the time before. Final run: 11,290 unit tests, 104 browser tests and every bench gate pass.
[2026-10-13] [6] sprint closed — gate green: 15 attack strategies measured and written up, 6 of them still working, none a false VERIFIED (confusables, claim inflation and page spoofing give none); coverage lies give UNVERIFIABLE, but for the one accepted since the grading contract (another account's Sent list, NOT FOUND with the reason on the receipt); the performance gates pass with their numbers in RESULTS.md; encryption round-trips and fails closed; the manifest check runs in CI; the privacy pre-review's 5 blockers are in MANUAL.md for you; the threat model is written; both mandatory tests (nothing leaves the browser, no seeded secret leaks) pass; closed.md says VERIFIED CLEAN. Sprint 7, the release, starts now.
[2026-10-13] [7.0] Attest is now version 0.1.0 everywhere: the manifest, the changelog (cut to 0.1.0) and the privacy policy, and a test keeps them in step. RESULTS.md was regenerated by the bench, and a test now fails CI if anyone edits it by hand. The release command now names its zip by the version, checks its manifest, and installs it in a fresh Chrome profile to make sure every page opens without an error; before, its check pointed at a file name that never exists, so the first release build would have failed. The store zip itself waits on you: it needs the telemetry server's address, so deploy it on Railway first (MANUAL.md, Sprint 5), then run `pnpm build:release`.
[2026-10-13] [7.1] The README is rewritten for the release. Its first screen says what Attest cannot see and links the attacks that still work; then how to install it, the two tests that prove nothing leaves your browser, the grades, its limits, a results table and the attacks that still work, all copied from RESULTS.md, prior art, how it works, and how to contribute. A test fails the build if any number there is not one RESULTS.md holds, if a section moves, or if a marketing word creeps in. The demo GIF joins it in 7.3.
[2026-10-13] [7.2] The five docs are final for 0.1.0, each with its "who this is for / what you'll know after" header (a test now checks all eight documents), and every link inside the repository resolves. One doc was out of date: the adapters guide still said every test page was hand-built; it now counts your real captures from RESULTS.md. Left for you: making the repository public and turning on GitHub Pages, so the privacy policy gets a public address (MANUAL.md has the exact clicks); then I put that address in the manifest and the store listing.
[2026-10-13] [7.3] The demo is now a 60-second GIF at the top of the README, made by one command, `pnpm record-demo`. It shows the request to Muse, Muse's log pasted into Attest, the Gmail Sent folder and the Calendar week Attest reads, the three receipts (Verified, Not found, and Unasked, likely agent) and the weekly digest, each with a one-line caption. It runs the real extension on saved test pages with invented names, and each picture is taken only after that step has really happened.
[2026-10-13] [7.4] The store listing is ready to paste: name, summary, a description that puts privacy first and what Attest cannot do fourth, category, five screenshots and the promo tile, all made from test pages with invented names, each checked for planted secrets and real email addresses before it was taken. That check caught one thing: the grants form showed `company.com`, a real domain, as its example; it now says `example.com`. Attest also has its own icon now, a receipt with a green check, instead of the template's puzzle piece. Re-checking the listing's privacy answers against the code found two details missing (the usage numbers also say whether each reader works, and the model is also sent a purchase's merchant); they are added, and a test now fails if anything sent is missing from the listing.
[2026-10-13] [7.5] The telemetry server now has its one public page, `/v1/stats`: over the last 30 days, each agent's receipts and how many were verified, not found or unasked, and how many installs sent numbers. It never shows an install id, and it shows nothing at all until at least 50 installs report, so today it answers with nothing, as it should. The monthly Agent Reliability Report is filled from it by one script, which also refuses below 50. The privacy policy now says the server publishes these totals. It goes live when you deploy the server (MANUAL.md).
[2026-10-13] [7.6] The launch kit is ready in launch/: the Show HN post with five title drafts (the chosen one says "local only, misses some") and five replies, three Reddit posts, the message for the incident authors, four weekly posts, the alert searches with a three line reply, the reliability report's template, and the launch day hour by hour with your steps marked. launch/README.md says what each file still needs from you: mostly the incident links, which I left for you rather than guess, and the store link once it exists. A test keeps every number in them to RESULTS.md, and keeps out dashes, exclamation marks and hype.
[2026-10-13] [7.7] The last security and privacy reviews are written, on the production build and the store listing. Security: nothing critical or high; 2 medium and 5 low findings, all fixed in the close below. Privacy: not ready yet only because of your steps (a public address for the privacy policy, the public repository, the store zip once the server is deployed, certifying the store's privacy form, re-reading OpenAI's terms); its other findings are fixed in the close. The manifest check and both dependency audits are clean.
[2026-10-13] [7.8] The release is ready to cut but waits on you: the tag must point at the commit the store zip is built from, and that zip needs the deployed telemetry server. MANUAL.md has every step: telling me the server's address, `pnpm build:release`, the tag, the release page with its files, the store submission click by click, and the posting order.
[2026-10-13] [7.close] Sprint 7 was reviewed for testing, security, code quality and privacy: 58 findings, each fixed and tested, except what only you can do, now in MANUAL.md. The most important: the public statistics could give away one person's day, by comparing two answers an hour apart, and anyone could invent 49 installs to pass the 50-install floor. Now the server publishes one finished month at a time, an answer that never changes; it takes reports only about recent days; an install counts only after reporting on 3 different days; one network can add at most 4 installs a day, so it can never pass the floor alone; an agent used by fewer than 50 installs shows no numbers; and reports are deleted after 90 days. The report script now checks everything before it publishes. The release check now refuses a development build; every picture's page is checked for planted secrets and real email addresses, hidden characters included; every number in the posts must name the measurement it comes from; the Gmail and Calendar readers no longer carry the AI companies' addresses in their code. The privacy policy (now 0.10) says exactly what is sent, kept, published and for how long, and has two blanks for you: the server operator's name and a private contact address; the store build refuses until they are filled. Launch posts no longer say "never sends" where an option sends; the Show HN title now says "runs locally, misses some". Task 7.9, the Final Report, waits on the gate, as build_spec says.
[2026-10-13] [7] gate: red only on your steps. Green: RESULTS.md regenerated by the bench (every gate passed) and held to its files; the README leads with every limit and the demo; the docs are complete and link-checked, the launch kit now among them; the store listing and its pictures use invented data only, every page checked; every number in the launch kit names its measurement; `/v1/stats` is tested; security has nothing open; the close is verified clean (11,385 unit tests, 118 end-to-end tests with both mandatory ones, 277 server tests). Waiting on MANUAL.md: the store zip (it needs the deployed telemetry server and the two blanks in the privacy policy), the privacy verdict (the policy's public address and the public repository, after the two history clean-ups), the v0.1.0 tag and release page, then the Definition of done and the Final Report, which I write when you say continue after those.
[2026-10-13] [7.0] Done with your go-ahead: the telemetry server runs on Railway at attest-production-5149.up.railway.app with its MongoDB, and its health, stats and address checks answer as they should; the privacy policy (0.13) names you as its operator with your contact address and says what Railway's own logs keep (7 days); the store zip, attest-0.1.0.zip, is built against that server, audited and installed on a clean profile. CI's end-to-end job had 4 failures: two test-only timing problems, now fixed (the service worker ran in the machine's time zone, not the test's; the keyboard test counted the settings page's controls before it had finished loading), and the 30-day popup paint at 116 and 124 ms on GitHub's runner against the 100 ms gate, which stays as it is until you decide.
[2026-10-13] [7.8] Your two choices, done and recorded. CI now holds the 30-day popup paint to 250 ms on GitHub's slower machines (it measured 116 to 168 ms there), so CI still catches a real slowdown; the 100 ms gate stays on your Mac and in RESULTS.md. And v0.1.0 is tagged once GitHub Pages is live, so the tag points at the zip you upload: say "Pages is live" and I add the policy's address to the manifest, rebuild the zip, tag it and make the release page.
[2026-10-13] [7] CI is fully green on bf02892, all eight jobs, for the first time since Sprint 3: 113 end-to-end tests, the two mandatory ones among them. One more test-only fix got it there: the settings page's tests read the page before it knew your choices (on GitHub's slow machines), so every one of them now waits until the page has loaded. What is left is yours, in MANUAL.md: the two history clean-ups, then the public repository and GitHub Pages, then "Pages is live" for the tag, the store submission and the launch posts.
[2026-10-14] [7.0] License chosen and applied: the Functional Source License (FSL-1.1-ALv2), your choice. The code will be public to read, run and change; a competing product or service built from it is not allowed; each version becomes Apache-2.0 two years after it is released. LICENSE is the official template with "Copyright 2026 Poojan Patel"; both package.json files, the server's pyproject, the README, the changelog and the build spec say so, and the r/ClaudeAI post no longer calls Attest open source, which FSL is not. All docs and launch-copy tests pass. Next is yours: turn auto mode off and say "do the history clean-up".
```

---

## Final Report

*Agent: fill this in when Sprint 7's gate passes, then stop.*

- Tasks completed / total:
- Headline numbers (from `RESULTS.md`, with the command that produced them):
- Attacks that still fool Attest, and why they weren't fixed:
- Deviations from this spec and why:
- Known issues remaining:
- Manual steps left for the human (`MANUAL.md`):
- How to install and try it locally:
