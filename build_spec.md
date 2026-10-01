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
| Encryption at rest | Optional passphrase: WebCrypto AES-GCM, key from PBKDF2 (600k iterations). Off by default; on = ledger unreadable without the passphrase. |
| Grading policy | `policy/default.json`, versioned. Thresholds and windows live here, never in code. |
| License | **Apache-2.0**. |
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
├── LICENSE                        # Apache-2.0
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
│   │   │   └── redact.ts          # allowlist projection + hashing
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
