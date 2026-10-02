# Golden scenarios

Hand-written grading scenarios with hand-computed expectations, written from `docs/grading.md` (v1.1) **alone**,
never from `src/core`. They are the independent statement of what `grade()` and `gradeBatch()` must do: the code
is written to satisfy them, not the other way round (sprint 1: "write scenarios first").

| File                     | Role                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `NN-slug.json`           | One scenario (§15 format, extended below).                                              |
| `scenario-schema.ts`     | Strict Zod schema for a scenario file. Unknown keys fail.                               |
| `load.ts`                | Builds schema-valid core inputs from a file: defaults, ids, hashes, receipt ids.        |
| `build.ts`               | Per-object builders (claim, observation, grant, coverage) and the policy merge patch.   |
| `time.ts`                | Offset-preserving time helpers (no host time zone, no `Intl`).                          |
| `checks.ts`              | Contract invariants checked on the files themselves (emission table, thresholds, refs). |
| `scenarios.spec.ts`      | Validates every file, the coverage requirements, and the loader output.                 |
| `loader.spec.ts`         | Pins the loader defaults and time helpers.                                              |
| `__snapshots__/ids.json` | Every claim and observation id per scenario, so a hashing change is a reviewed diff.    |

The runner that actually calls `grade()`/`gradeBatch()` and compares receipts arrives in a later wave (see
[Runner contract](#runner-contract)).

## File format

The §15 format, plus a few fields the contract needs but the §15 example does not show:

```jsonc
{
  "name": "…",
  "covers": ["ledger_engineer:exact_match", "edge:…", "contract:…"],
  "mode": "batch",                    // "batch" → gradeBatch; "grade" → one grade() call (needs input.grade)
  "policyPatch": { },                 // RFC 7386 merge patch on policy/default.json (arrays replace)
  "notes": ["the hand computation, one step per line"],
  "input": {
    "evaluatedAt": "2026-10-06T15:00:00-04:00",
    "claims": [{ "ref": "c1", "agent": "muse", "type": "email.sent", "counterparty": "…", "subjectHint": "…",
                 "claimedAt": "…", "claimedAtPrecision": "day", "targetAt": "…", "observedAt": "…",
                 "text": "…", "rowKey": "label" }],
    "observations": [{ "ref": "o1", "source": "gmail.sent", "type": "email.sent", "counterparty": "…",
                       "occurredAt": "…", "observedAt": "…", "rowKey": "label" }],
    "grants": [{ "agent": "muse", "allowedTypes": [], "counterpartyAllowlist": [], "spendCeilingCents": 5000,
                 "spendCurrency": "USD", "declaredScopes": [], "observedScopes": [],
                 "accounts": { "gmail.sent": ["acct-a"] } }],
    "coverage": [{ "source": "gmail.sent", "lastSyncAt": "…", "windowStart": "…", "windowEnd": "…",
                   "accountHash": "acct-a", "allCalendars": true }],
    "activity": { "sessions": [], "idle": [], "entries": [], "adapterSyncs": [], "claims": ["c1"] },
    "fixed": [{ "claim": "c9", "observation": "o9" }, { "claim": null, "observation": "o3" }],
    "grade": { "claim": null, "candidates": ["o1"], "agent": "muse", "priorSpendCents": 0, "scope": "…" }
  },
  "events": [{ "event": "override", "ref": "c1", "grade": "VERIFIED", "reason": "…", "at": "…" },
             { "event": "supersede", "ref": "o1", "claim": "c1" }],
  "assertIds": { "equal": [["o1", "o2"]], "ascending": [["c3", "c4"]] },
  "expect": [{ "ref": "c1", "grade": "VERIFIED", "ruleId": "verified", "state": "FINAL",
               "observationRefs": ["o1"], "score": "1/1", "reasonCodes": ["match.best"] },
             { "ref": "o2", "grade": "UNASKED", …, "agent": "muse", "attributionScore": "7/10" },
             { "scope": { "agent": "muse", "scope": "gmail.read" }, "grade": "OVER_SCOPE", … }]
}
```

- **Refs.** Claims are `c<n>`, observations `o<n>`. An expectation names its subject: a claim ref (claim
  receipt), an observation ref (UNASKED receipt for that orphan), or `scope` (scope-diff receipt).
- **Labels.** `accountHash`, `accounts` entries and `rowKey` are short labels; the loader stores SHA-256(label).
  Ids and hashes are never typed by hand.
- **`fixed`.** FINAL or USER_OVERRIDDEN pre-assignments (§4.3). A claim named here already holds its receipt: it
  is not passed to `gradeBatch` and gets no expectation. `claim: null` is an overridden UNASKED receipt.
- **`events`.** State events applied with `state.ts` `transition()` after grading, in order (§8).
- **`assertIds`.** When an expectation depends on hash-derived ids (a tie broken by claim or observation id,
  or dedupe by `contentHash`), the file states the id relation it relies on and the spec verifies it.
- **`expect` is the whole result.** In batch mode it lists every receipt `gradeBatch` returns: a missing or an
  extra receipt is a failure. In grade mode it holds exactly the one receipt.

## Loader defaults (§15)

| Object         | Default                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim          | `extractor {golden, 1, 1}`, `sourceKind activity_view`, `claimedAtPrecision minute`, `observedAt = claimedAt`, `text = ref`, no `requestId`                     |
| Claim id       | `rawHash = sha256(canonicalJson({agent, sourceKind, rowKeyHash or null, text, claimedAt truncated to its unit in its own offset}))`, `id = idFromHash(rawHash)` |
| Observation    | `observedAt` = earliest `lastSyncAt ≤ evaluatedAt` among its source's coverage entries whose window holds `occurredAt`, else `evaluatedAt`                      |
| Observation id | `contentHash = sha256(canonicalJson({source, type, …allowlisted content fields, rowKeyHash if any}))`, `id = idFromHash(contentHash)`                           |
| Grant          | every type allowed, empty allowlist, `spendCeilingCents null`, no scopes, no accounts, `updatedAt = evaluatedAt − 1 day`                                        |
| Coverage       | `observerId = source`                                                                                                                                           |
| Activity       | empty lists; `claims` = every scenario claim                                                                                                                    |
| Receipt id     | `idFromHash(sha256(canonicalJson(K)))`, `K = {k:'claim', claimId}` / `{k:'unasked', observationId}` / `{k:'scope', agent, scope}`                               |

## How an expectation is computed

Everything is exact: basis points and reduced fractions, never floats (§5.3). Worked example, `02`:

1. **Window (§4.1).** Claim at 14:02, minute precision → unit `[14:02, 14:03]`, window `[14:00, 14:48]`.
2. **Applicable features (§5.2).** An address claim with a subject: `timeProximity 2500`, `counterpartyExact
3500`, `counterpartyDomain 1500`, `subjectOverlap 1500` bp; Σw = 9000. (A name claim uses
   `counterpartyName 2500` instead of the two address features; a purchase uses `timeProximity`, `amountExact`,
   `merchantMatch`; a calendar claim `timeProximity`, `subjectOverlap` and the counterparty features.)
3. **Feature values (§5.1, §11).** `raj@company.com` vs `priya@company.com`: ce 0, cd 1 (same non-common
   domain); subjects `{q3, deck}` vs `{q3, budget}` → 1/3; tp 1.
4. **Score.** S = (2500 + 0 + 1500 + 1500·1/3) / 9000 = 4500/9000 = **1/2**.
5. **Rule (§6).** First match in policy order: S ≥ partial (10000·4500 ≥ 5000·9000) → `partial`.
6. **State (§8).** PARTIAL is FINAL once `graceElapsed`: a sync ≥ end + 30 min and ≥ end + 45 min.
7. **Reasons (§15).** Rule reason, then coverage reasons, then `match.*`/`cp.*`, each group in table order.

`timeProximity` = 1 within `toleranceMin`, else `(edge − Δ)/(edge − tolerance)` in ms, with edge 120 000 before
the unit, 2 700 000 after it, 259 200 000 around a calendar target. `28` and `29` exercise the millisecond
boundaries (9503999/9504000, 17/20 exactly, 8078399/9504000).

## Readings taken where the contract is open

Each is also reported as a contract issue for docs/grading.md; change the scenarios if the contract decides
otherwise.

1. **Evidence.** `observationIds` holds the assigned candidate only (best candidate with score ≥ partial), so a
   NOT_FOUND with a below-partial best candidate has `observationRefs: []` but still `match.best`, its score and
   its `cp.*` reasons (`18`–`23`, `30`).
2. **Claim-less outcomes.** `gradeBatch` keeps an orphan's receipt only if it is UNASKED, and a scope receipt
   only for an observed scope that was not declared (§1); an orphan below the threshold yields nothing (`46`–`48`).
3. **No-source types.** `message.sent` and `other` are graded `no_coverage` (§8), not `underspecified`, although
   their identity lists are empty (`45`).
4. **`allowlist.unchecked`** sits in the rule group, after the rule's own code (`37`).
5. **`ceiling.currency_mismatch`** replaces `ceiling.exceeded` when only the currency differs (`34`).
6. **`override.user` and `superseded`** are appended after all graded reasons (`56`, `57`).
7. **Taken observations.** An observation fixed by an overridden UNASKED receipt is not a candidate of any claim,
   exactly like one fixed to a claim (`32`).
8. **UNASKED reasons** list the attributed agent's signals plus `userIdle` (no scenario has a second agent with
   fired signals on the same orphan above the threshold).

## Independent verification

Every expectation in `01`–`61` was recomputed by a second author from docs/grading.md alone, before reading the
first author's notes (grade, rule, state, evidence, exact score, reason codes); there were no disagreements.
The same pass added `62`–`67` for contract paths no earlier file discriminated: identity per type (vague
calendar and purchase claims), purchase feature details (merchant token Jaccard, `amountExact` needing both
currencies), the allowlist failing only on the evidence's address (OVER_SCOPE that waits for grace), the
cumulative spend window and its exclusions (other agent, other currency, 1 ms outside 30 days, `>` not `≥`),
UNASKED finalised by `finalizeUnverifiableHours`, and a ceiling known only from the receipt.

## Adding a scenario

1. Pick the next number: `NN-short-slug.json`. Start from the closest existing file.
2. State every input that decides the outcome (§15): coverage with `accountHash`, a non-common domain when you
   rely on `counterpartyDomain`, `targetAt` for calendar claims, positive idle evidence for `userIdle`.
3. Compute the expectation by hand from docs/grading.md, in basis points and exact fractions; write each step in
   `notes`. Keep pairs you do not mean to test out of each other's windows (two hours apart is enough).
4. Tag it in `covers` (`ledger_engineer:*`, `edge:*`, `contract:*`).
5. Run `pnpm exec vitest run tests/golden -u` once: `__snapshots__/ids.json` already exists, so a plain run fails
   on the new file's ids, and `CI=true` never writes. Review that the snapshot diff only adds lines (a changed
   id means a hashing change). If an expectation depends on id order, add `assertIds`.
6. Run `pnpm exec prettier --write tests/golden`.

## What the spec enforces

- ≥ 40 files; each parses strictly; refs resolve; one expectation per graded claim; evidence is one-to-one.
- Every expectation agrees with the rule → grade mapping, the thresholds (exactly), the §15 emission table and
  the reason order; NOT_FOUND carries `coverage.account_unbound` iff the grant binds no account.
- Observations carry only allowlisted fields from a source that sees their type; every patched policy loads.
- Coverage: the 12 mandatory scenarios (checked against `agents/ledger_engineer.md`), the §2 demo and its
  UNVERIFIABLE variant, every rule in `policy/default.json` plus `default_unverifiable`, every ReasonCode, every
  grade and state, both modes, and the hardened edge cases.
- The scenario enums equal `src/core/schema.ts`; the loader's objects parse with the core schemas.
- Mutation tests prove the checks fail on broken expectations.

## Runner contract

For each file: `loadScenario(file)`, `policy = loadPolicy(loaded.policyJson)`, then

- **batch:** `gradeBatch(loaded.batchClaims, createMemoryIndex([...loaded.observations.values()]),
loaded.grants, policy, loaded.coverage, loaded.activity, loaded.fixed)`;
- **grade:** `grade(call.claim, call.candidates, grantOf(call.agent), policy, loaded.coverage, context)`, where
  `context = call.context` plus, when `call.attributeFromActivity`, `attribution = attribute(call.candidates[0],
loaded.activity, policy)`;

then apply `loaded.events` with `transition()` and compare by receipt id with `loaded.expected`: the same set of
ids; `grade`, `ruleId`, `state`; `observationIds` = `expected.observationIds`; reason codes as an exact ordered
list; `score` = the exact `features()` score of the `match.best` candidate as a reduced fraction (null with
`match.none` or no claim); `agent`; for UNASKED the attribution `scoreBp` as `attributionScore` and
`attribution: 'likely'`; `override.grade`/`override.previousState`; `supersededBy`. Generic checks for every
receipt: `computedAt = evaluatedAt`; `finalAt = evaluatedAt` iff the (pre-override) state is FINAL; claim receipts
carry the claim's agent.
