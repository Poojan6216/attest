# Golden scenarios

Hand-written grading scenarios with hand-computed expectations, written from `docs/grading.md` (v1.3) **alone**,
never from `src/core`. They are the independent statement of what `grade()` and `gradeBatch()` must do: the code
is written to satisfy them, not the other way round (sprint 1: "write scenarios first").

| File                                     | Role                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `NN-slug.json`                           | One scenario (§15 format, extended below).                                                        |
| `scenario-schema.ts`                     | Strict Zod schema for a scenario file, and the §15 params table. Unknown keys fail.               |
| `load.ts`                                | Builds schema-valid core inputs from a file: defaults, ids, hashes, receipt ids, reasons.         |
| `build.ts`                               | Per-object builders (claim, observation, grant, coverage) and the policy merge patch.             |
| `time.ts`                                | Offset-preserving time helpers (no host time zone, no `Intl`).                                    |
| `checks.ts`                              | Contract invariants checked on the files (emission table, v1.3 order, thresholds, refs).          |
| `checks-reasons.ts`                      | §15 params per code and the `allowlist.unchecked` emission rule, checked on the files.            |
| `checks-claims.ts`                       | Never-scored claims (§4.3), evidence of the claim's own type (§4.1), no-parser purchases.         |
| `proof-helpers.ts`                       | Shared pieces of the `contract:<tag>` proofs.                                                     |
| `v12-rules.ts`                           | One `contract:<tag>` per v1.2 rule (as it still reads in v1.3), with its proof.                   |
| `v13-rules*.ts` (rules, evidence, text)  | One `contract:<tag>` per v1.3 rule, with a proof that the tagged file exercises it.               |
| `ids.ts`, `write-ids.ts`                 | The ids snapshot and the script that writes it.                                                   |
| `scenarios.spec.ts`                      | Validates every file, the coverage requirements, and the loader output.                           |
| `checks.spec.ts`                         | Mutation tests: every check and v1.2 proof rejects a broken copy of a real expectation.           |
| `v13-rules.spec.ts`                      | Every v1.3 tag is exercised, every proof and check fails on a broken copy, every tag has a proof. |
| `loader.spec.ts`                         | Pins the loader defaults, `claimedAtEnd`, row-key hashing, reason params and time helpers.        |
| `__snapshots__/ids.json`                 | Every claim and observation id per scenario, so a hashing change is a reviewed diff.              |
| `runner.ts`, `golden.spec.ts` (task 1.5) | The runner: grades every file through the core and compares receipts (owned by task 1.5).         |

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
                 "claimedAt": "…", "claimedAtPrecision": "day", "claimedAtEnd": "…", "targetAt": "…",
                 "observedAt": "…", "text": "…", "rowKey": "label" }],
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
               "observationRefs": ["o1"], "score": "1/1", "reasonCodes": ["match.best"],
               "reasonParams": { "match.best": { "observationId": "o1" } } },
             { "ref": "o2", "grade": "UNASKED", …, "agent": "muse", "attributionScore": "7/10" },
             { "scope": { "agent": "muse", "scope": "gmail.read" }, "grade": "OVER_SCOPE", …,
               "reasonParams": { "scope.observed_not_declared": { "scopeHash": "gmail.read" } } }]
}
```

- **Refs.** Claims are `c<n>`, observations `o<n>`. An expectation names its subject: a claim ref (claim
  receipt), an observation ref (UNASKED receipt for that orphan), or `scope` (scope-diff receipt).
- **Labels.** `accountHash` and `accounts` entries are short labels; the loader stores SHA-256(label) (§15). A
  `rowKey` label becomes `rowKeyHash = sha256Hex(canonicalJson(rowKey))` (§10 v1.3), for claims (`rawHash`) and
  observations (`contentHash`) alike. Ids and hashes are never typed by hand.
- **`claimedAtEnd`** (v1.2 §4.1; v1.3: `day` precision only, at most `start + 25 h`). The end of the claim's
  precision unit, passed to the core claim as written. Adapters set it for `day` precision to the next local
  midnight, so a 23- or 25-hour DST day is one unit (`68`). It does not enter `rawHash` (§10).
- **`reasonParams`** (§15, optional). The params of every reason, keyed by code, exactly per the closed table
  ("Params per code"). When present it names every code in `reasonCodes`; ids are written as refs (`o1`, `c1`)
  and the loader resolves them; a `scopeHash` is written as the observed scope and the loader stores
  `sha256Hex(scope)` (v1.3, `50`); a `source` is left out for a type with no sources (`45`). Files without it
  assert codes only.
- **`fixed`.** FINAL or USER_OVERRIDDEN pre-assignments (§4.3). A claim named here already holds its receipt: it
  is not passed to `gradeBatch` and gets no expectation. `claim: null` is an overridden UNASKED receipt.
- **`events`.** State events applied with `state.ts` `transition()` after grading, in order (§8).
- **`assertIds`.** When an expectation depends on hash-derived ids (a tie broken by claim or observation id,
  or dedupe by `contentHash`), the file states the id relation it relies on and the spec verifies it.
- **`expect` is the whole result.** In batch mode it lists every receipt `gradeBatch` returns: a missing or an
  extra receipt is a failure. In grade mode it holds exactly the one receipt.
- **Invisible characters** (zero-width, bidi) are written as JSON `\u` escapes, never raw (`72`).

## Loader defaults (§15)

| Object         | Default                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim          | `extractor {golden, 1, 1}`, `sourceKind activity_view`, `claimedAtPrecision minute`, no `claimedAtEnd`, `observedAt = claimedAt`, `text = ref`, no `requestId`  |
| Claim id       | `rawHash = sha256(canonicalJson({agent, sourceKind, rowKeyHash or null, text, claimedAt truncated to its unit in its own offset}))`, `id = idFromHash(rawHash)` |
| Observation    | `observedAt` = earliest `lastSyncAt ≤ evaluatedAt` among its source's coverage entries whose window holds `occurredAt`, else `evaluatedAt`                      |
| Observation id | `contentHash = sha256(canonicalJson({source, type, …the content fields allowlistedFields[source] names, rowKeyHash if any}))`, `id = idFromHash(contentHash)`   |
| Row key        | `rowKeyHash = sha256Hex(canonicalJson(rowKey))` (§10 v1.3); `redact-golden.spec.ts` checks `project()` builds the same observation                              |
| Grant          | every type allowed, empty allowlist, `spendCeilingCents null`, no scopes, no accounts, `updatedAt = evaluatedAt − 1 day`                                        |
| Coverage       | `observerId = source`                                                                                                                                           |
| Activity       | empty lists; `claims` = every scenario claim                                                                                                                    |
| Receipt id     | `idFromHash(sha256(canonicalJson(K)))`, `K = {k:'claim', claimId}` / `{k:'unasked', observationId}` / `{k:'scope', agent, scope}`                               |
| Reasons        | only with `reasonParams`: `{code, params}` in `reasonCodes` order, refs resolved to ids, scopes hashed, parsed with the core `Reason` schema                    |

## How an expectation is computed

Everything is exact: basis points and reduced fractions, never floats (§5.3). Worked example, `02`:

1. **Window (§4.1).** Claim at 14:02, minute precision → unit `[14:02, 14:03]`, window `[14:00, 14:48]`. With
   `claimedAtEnd` the unit ends there instead of at `start + unit`.
2. **Applicable features (§5.2).** An address claim with a subject: `timeProximity 2500`, `counterpartyExact
3500`, `counterpartyDomain 1500`, `subjectOverlap 1500` bp; Σw = 9000. (A name claim uses
   `counterpartyName 2500` instead of the two address features; a purchase uses `timeProximity`, `amountExact`
   when the claim has an amount, and `merchantMatch` when it has a counterparty; a calendar claim
   `timeProximity`, `subjectOverlap` and the counterparty features.)
3. **Feature values (§5.1, §11).** `raj@company.com` vs `priya@company.com`: ce 0, cd 1 (same non-common
   domain); subjects `{q3, deck}` vs `{q3, budget}` → 1/3; tp 1. Observation counterparties are read through
   `email()` first (`71`).
4. **Score.** S = (2500 + 0 + 1500 + 1500·1/3) / 9000 = 4500/9000 = **1/2**.
5. **Rule (§6).** First match in policy order: S ≥ partial (10000·4500 ≥ 5000·9000) → `partial`.
6. **State (§8).** PARTIAL is FINAL once `graceElapsed`: a sync ≥ end + 30 min and ≥ end + 45 min.
7. **Reasons (§15).** The rule's own code (including `coverage.never_completed`, the `pending` rule's code once
   it finalises), then `allowlist.unchecked` if emitted, then coverage reasons (`coverage.account_unbound` and
   the caps `calendars_hidden`, `multiple_accounts`, `no_account`, `no_parser`), then `match.*`/`cp.*`, each
   group in table order; `override.user` and `superseded` last (`74`, `80`).

`timeProximity` = 1 within `toleranceMin`, else `(edge − Δ)/(edge − tolerance)` in ms, with edge 120 000 before
the unit, 2 700 000 after it, 259 200 000 around a calendar target. `28` and `29` exercise the millisecond
boundaries (9503999/9504000, 17/20 exactly, 8078399/9504000).

## What v1.3 changed in the files

One behaviour change and a set of clarifications (Decisions [1.contract] v1.3; `git show 02a89c2`).

- **Purchase coverage (§6.1).** A purchase-like claim (its only source is `gmail.receipt`) whose normalised
  counterparty is not in `policy.receiptMerchants`, or which has no counterparty, now has coverage **at most
  partial**, reason `coverage.no_parser`, instead of `none`. A receipt the observer did see still verifies;
  NOT_FOUND stays impossible. Re-derived: `06` (no_coverage → partial_coverage), `62` c3 (same), `76` c2 (same;
  and a new c3 that only the normalised name lets reach NOT_FOUND). Unchanged, re-checked: `09`, `65` (no
  coverage at all, so still `none`), `33`–`35`, `63`, `67`, `69`, `77` (patched `receiptMerchants`, or an
  over-scope rule first). New: `78`.
- **Reason params (§15).** `scope.observed_not_declared` {`scopeHash`: `sha256Hex(scope)`} is now asserted
  (`50`); `override.user.grade`, the ceiling params and `ceiling.exceeded.amountCents` (the §6.1 Amount) read as
  the files already had them. `coverage.no_parser` has no params (the closed table lists none; `06`, `76`).
- **`coverage.never_completed`** is the `pending` rule's own code once it finalises (it replaces
  `grace.waiting`), so it precedes `allowlist.unchecked` (`80` c2; `44`).
- **`cp.*`** come only from address claims (`54` c4); `cp.confusable` replaces `cp.plus_tag` when both apply
  (`79`); `xn--` is detected in any ASCII case (`79` c4).
- **`amountExact`** applies when the claim has `amountCents`, and a currency missing on either side scores 0
  (`63` c1 observation side, `69` claim side).
- **Allowlist (§6.1).** A claim with no address of its own (a name, or no counterparty) and no assigned
  candidate leaves the allowlist unchecked (`80` c1, c2: subject-only calendar claims).
- **Ceilings (§6.1).** The claim's amount counts toward the Amount only when its currency is absent or
  `spendCurrency`; an assigned receipt in another currency is a mismatch whatever the claim's currency (`81`
  c1); an Amount over the ceiling keeps `ceiling.exceeded` next to `ceiling.currency_mismatch` (`81` c2).
- **Best candidate (§8).** Equal best scores break by observation id, lowest first (`82`).
- **Text that displays differently (§11, §5.1).** A bidi embedding (U+202A, U+202B) makes a subject or a name
  unread, like an override; subjects fold compatibility digits with NFKC on purpose (`Q³` → `q3`); merchant text
  `counterparty()` rejects scores `merchantMatch` 0 on the observation and is not applicable on the claim (`84`).
- **Adapter `claimedAt` (§4.1).** Adapters write `claimedAt` at the unit start for `hour` and `day` precision; `27`
  keeps a mid-day `claimedAt` on purpose, so the core must compute `start(p,t)` itself.
- **First-seen and dedupe (§4.1).** `calendar.created` compares `start(p,t) − beforeClaimMin` with the earliest
  `observedAt` of the observation's `contentHash` group (`83`).
- **UNASKED `observationIds`** = `[its orphan]` (§8), as every UNASKED file already had it.
- **Loader.** `rowKeyHash = sha256Hex(canonicalJson(rowKey))` (only `58`'s two observation ids changed);
  `contentHash` over the content fields only plus `rowKeyHash`.

## Readings the contract still leaves open

Each is reported as a contract issue. _Avoided_ files stay off the reading (some enforced by a check); _taken_
readings are asserted and must change if the contract decides otherwise.

1. _Taken._ `coverage.no_parser` carries no params: §15's closed table names `{source}` for the other caps but not
   for it, and says "every other code has no params" (`06`, `76`). The core schema accepts an optional `source`.
2. _Avoided._ `ceiling.currency_mismatch.currency` when the claim's currency is `spendCurrency` and only the
   receipt's differs: "the claim's when present" would name `spendCurrency` itself. `81` c1 asserts codes only.
3. _Taken._ "An amount is known" (the `amountAboveCeiling` guard) counts a claim amount in another currency, so a
   claim in EUR against a USD ceiling is `ceiling.currency_mismatch` even though that amount is not in the Amount
   (`34`, `65` c2).
4. _Avoided._ The finality of an over-ceiling claim whose `ceiling.exceeded` comes from the claim alone and whose
   `ceiling.currency_mismatch` comes from the receipt: `81` c2 is past grace, so both readings give FINAL.
5. _Avoided (checked)._ `coverage.no_parser` when coverage would be partial anyway (an interval gap): every
   no-parser file has an interval that holds the whole window; `checks-claims.ts` requires the code on every
   no-parser `partial_coverage` receipt.
6. _Avoided._ The receipt id, `observationIds` and finality of a claim-less `grade()` that falls to
   `default_unverifiable` (§8 says FINAL; `gradeBatch` never stores it); no grade-mode file produces one.
7. _Avoided._ An allowlist claim with no address whose assigned candidate has no address either (a calendar
   event with no attendees): no file has one.
8. _Loader convention_, not a grading reading: a claim's truncated `claimedAt` in `rawHash` keeps a `Z` offset
   as `Z` (`31`). It changes golden ids only; the core never recomputes `rawHash`.
9. _Avoided._ Whether `name()` of merchant text that `counterparty()` rejects (a bidi override) can match
   `policy.receiptMerchants` (§6.1 no-parser test): `84` c5 is VERIFIED, which no coverage reading changes.

The v1.1/v1.2 readings are all settled now: evidence is the assigned candidate only (`18`–`23`, `30`, `73`);
`gradeBatch` returns claim, UNASKED and `over_scope_observed` receipts only (`46`–`48`, `50`, `73`); no-source
types are `no_coverage` (`45`); `allowlist.unchecked` sits after the rule's code (`37`, `74`);
`ceiling.currency_mismatch` replaces `ceiling.exceeded` unless the Amount exceeds the ceiling (`34`, `65`, `69`,
`81`); `override.user`/`superseded` come last (`56`, `57`, `74`); taken observations are no claim's candidate
(`32`); UNASKED reasons are the attributed agent's signals plus `userIdle` (`47`).

## Independent verification

Every expectation in `01`–`61` was recomputed by a second author from docs/grading.md alone, before reading the
first author's notes (grade, rule, state, evidence, exact score, reason codes); there were no disagreements.
That pass added `62`–`67` (identity per type, purchase feature details, the allowlist on the evidence's
address, the cumulative spend window, UNASKED finalised by time, a ceiling known only from the receipt). The
v1.2 pass added `68`–`74` and asserted params in 44 expectations; an adversarial verifier recomputed them and
added `75`–`77`. The v1.3 pass re-derived every purchase scenario from v1.3 alone (`06`, `62`, `76` changed;
`09`, `33`–`35`, `63`, `65`, `67`, `69`, `77` re-checked unchanged), asserted the scope hash, and added
`78`–`83`, each built so the v1.2-era reading gives a different grade, score or reason (its notes say how).
The v1.3 adversarial verifier recomputed every changed and new file from v1.3 alone (no disagreement) and added
`84` for the §11/§5.1 text rules no file exercised.
After the files were written, the task 1.5 runner (`golden.spec.ts`) graded all of them through the core with
no disagreement.

## Adding a scenario

1. Pick the next number: `NN-short-slug.json`. Start from the closest existing file.
2. State every input that decides the outcome (§15): coverage with `accountHash`, a non-common domain when you
   rely on `counterpartyDomain`, `targetAt` for calendar claims, positive idle evidence for `userIdle`, and a
   `receiptMerchants` patch when a purchase must be fully covered.
3. Compute the expectation by hand from docs/grading.md, in basis points and exact fractions; write each step in
   `notes`. Keep pairs you do not mean to test out of each other's windows (two hours apart is enough).
4. Tag it in `covers` (`ledger_engineer:*`, `edge:*`, `contract:*`); assert `reasonParams` where the params are
   the point.
5. Run `pnpm exec tsx tests/golden/write-ids.ts`, then review `git diff tests/golden/__snapshots__/ids.json`: a
   new scenario only adds lines (a changed id means a hashing change). If an expectation depends on id order,
   add `assertIds`. The spec never rewrites the snapshot; it fails until the script has run.
6. Run `pnpm exec prettier --write tests/golden` and `pnpm exec vitest run tests/golden`.

## What the spec enforces

- ≥ 40 files; each parses strictly; refs resolve; one expectation per graded claim; evidence is one-to-one.
- Every expectation agrees with the rule → grade mapping, the thresholds (exactly, in the basis points
  `loadPolicy()` computes, never the decimal fields), first-match-wins (a rule after `verified` or `partial` in
  policy order has a best score below that threshold), the §15 emission table and the v1.3 reason order;
  NOT_FOUND carries `coverage.account_unbound` iff the grant binds no account; `allowlist.unchecked` appears
  exactly when §6.1 makes the allowlist uncheckable; a purchase no parser can see is never NOT_FOUND, and its
  `partial_coverage` receipt names `coverage.no_parser`.
- Asserted params follow the closed §15 table and agree with the claim, grant, evidence, override, supersede
  and scope; every code that has params is asserted somewhere, and the golden params table is the one
  `src/core/schema.ts` `Reason` enforces, code by code.
- UNASKED receipts carry an agent-specific signal and an `attributionScore` equal to their fired signals' weights
  (capped at 1, in basis points); claim-less receipts carry no match, `cp.*`, coverage or allowlist code.
- Underspecified claims, calendar claims without `targetAt` and claims of a type with no sources are never scored
  (§4.3); evidence and `match.best` name an observation of the claim's own type.
- Observations carry only allowlisted fields from a source that sees their type; every patched policy loads.
- Coverage: the 12 mandatory scenarios (checked against `agents/ledger_engineer.md`), the §2 demo and its
  UNVERIFIABLE variant, every rule in `policy/default.json` plus `default_unverifiable`, every ReasonCode, every
  grade and state, both modes, the hardened edge cases, and each v1.2 and v1.3 rule with a proof it is exercised.
- The scenario enums equal `src/core/schema.ts`; the loader's objects and reasons parse with the core schemas.
- `__snapshots__/ids.json` is byte-identical to what `write-ids.ts` writes.
- Mutation tests (`checks.spec.ts`, `v13-rules.spec.ts`) prove the checks and the proofs fail on broken files.
- Every `contract:<tag>` a file carries has a proof (`v12-rules.ts`, `v13-rules*.ts`), except four descriptive
  v1.0/v1.1 tags listed in `v13-rules.spec.ts` (`demo`, `demo_unverifiable`, `counterparty_domain_plus_tag`,
  `grade_mode_claimless`).

## Runner contract

For each file: `loadScenario(file)`, `policy = loadPolicy(loaded.policyJson)`, then

- **batch:** `gradeBatch(loaded.batchClaims, createMemoryIndex([...loaded.observations.values()]),
loaded.grants, policy, loaded.coverage, loaded.activity, loaded.fixed)`;
- **grade:** `grade(call.claim, call.candidates, grantOf(call.agent), policy, loaded.coverage, context)`, where
  `context = call.context` plus, when `call.attributeFromActivity`, `attribution = attribute(call.candidates[0],
loaded.activity, policy)`;

then apply `loaded.events` with `transition()` and compare by receipt id with `loaded.expected`: the same set of
ids; `grade`, `ruleId`, `state`; `observationIds` = `expected.observationIds`; reason codes as an exact ordered
list, and when `expected.reasons` is set, `receipt.reasons` deep-equal to it; `score` = the exact `features()`
score of the `match.best` candidate as a reduced fraction (null with `match.none` or no claim); `agent`; for
UNASKED the attribution `scoreBp` as `attributionScore` and `attribution: 'likely'`;
`override.grade`/`override.previousState`; `supersededBy`. Generic checks for every receipt: `computedAt =
evaluatedAt`; `finalAt = evaluatedAt` iff the (pre-override) state is FINAL; claim receipts carry the claim's
agent.
