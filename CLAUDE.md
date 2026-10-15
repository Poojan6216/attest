# CLAUDE.md — Attest

Read this first, every session. Then `build_spec.md` → Progress Log → the current sprint file → the agent files that sprint names.

## What this project is
Attest is a local-first Chrome extension that checks what the user's AI agents (Muse, ChatGPT/Dots, Claude) actually did, by comparing the agent's claims against evidence in the user's own Gmail and Calendar tabs, and issuing graded receipts. Nothing leaves the browser. Attest never acts. Full definition in `build_spec.md §1–§4`.

## The "continue" protocol
The founder is usually on his phone. When he says anything like **"continue"**, **"keep going"**, **"next"**, or **"hey mate, continue our implementation step by step"**:

1. Open `build_spec.md`, read the **Progress Log** at the bottom. The last line tells you the sprint and task you are on.
2. Open `sprints/sprint_<N>.md`. The first unticked `[ ]` task is yours. If a task is marked `BLOCKED(MANUAL)`, skip it and take the next unblocked one.
3. Read every `Read: agents/<role>.md` file named on that task. Work in that role's voice and rules.
4. Implement. Run the task's **Done when**. Fix until it passes.
5. Tick the task (`[x]`) in the sprint file. Append one line to the Progress Log: `[YYYY-MM-DD] [N.M] what you did — decisions or blockers`. Commit with a Conventional Commit message.
6. Repeat until the sprint's tasks are all ticked or blocked.
7. Run the **sprint-end loop** (below). Then the sprint **Gate**. If green, log `[N] sprint closed`, commit `chore: close sprint N`, start sprint N+1 at step 2. If red, fix and re-run.
8. Stop only when: Sprint 7's gate passes (write the Final Report), or every remaining task in the current sprint is `BLOCKED(MANUAL)`. In the second case, write what is needed into `MANUAL.md` and end your message with the exact list.

Never ask "should I continue?" The answer is yes. Never ask which task to do; the sprint file says. Never ask for approval on a decision the spec leaves open; decide, log it in `Decisions.md`, move on.

## The sprint-end loop (every sprint, in this order, outputs to `reviews/sprint_<N>/`)
1. **QA** — read `agents/qa_tester.md`; review the sprint against its checklist; write and run the tests → `qa.md` (results + gaps)
2. **Security** — read `agents/security_reviewer.md`; review all code written this sprint against the checklist → `security.md` (gaps)
3. **Tech** — read `agents/tech_reviewer.md`; review code quality and architecture → `tech.md` (gaps)
4. **Close** — read `agents/sprint_closer.md`; take all outputs above; fix every gap in code → `closed.md` (FIXED / MANUAL / ACCEPTED / VERIFIED CLEAN)

Sprint 6 adds `agents/privacy_reviewer.md` and the red-team report to step 4's inputs. Sprint 7 adds `privacy_reviewer.md` again.

When the founder is at the keyboard he runs these four himself by pasting the prompts. When he is not, you run them. Same files, same order, same outputs.

## Hard rules (summary; full text in `build_spec.md §4`)
1. Nothing leaves the browser unless the person turns on an option that sends; each reaches exactly one host (the telemetry host, numbers only; the own model key's vendor, a claim's allowlisted facts); a test enforces it
2. Derived facts, never raw content (allowlist in `policy/default.json`; a secret-seed test enforces it)
3. Attest never acts on a vendor page (lint rule `attest/no-act`)
4. `grade()` is pure and deterministic; the optional model only proposes scores
5. UNVERIFIABLE beats a guess
6. Fail loud: DEGRADED adapters are visible
7. UNASKED always says "likely"
8. Minimal permissions; 9. No remote code, strict CSP; 10. Never log secrets; 11. Read vendor pages only when the user has them open; 12. Never report an unmeasured number

## Going public
Never make the repository public (`gh repo edit … --visibility public`, or "make the repo public") while either MANUAL.md item is open: cleaning the real captures (Sprint 7) or the old bench trace in the history (Sprint 4 close). Say which is open instead (Sprint 7 close, security review SEC-7).

## Locked stack (full table in `build_spec.md §5`)
TypeScript strict · Manifest V3 · WXT · Preact + Tailwind · Dexie · Zod · Vitest + fast-check · Playwright on fixture pages · ESLint strict + custom rules · pnpm · Node 22 · telemetry-api: FastAPI + Pydantic v2 + PyMongo async + uv on Railway · FSL-1.1-ALv2 · Conventional Commits · SemVer.

## Repo layout
Exactly `build_spec.md §6`. `src/core` is pure (no DOM, no chrome, no Dexie, no I/O, no clock, no model). Entrypoints are thin. Adapters/observers are fixture-driven and read-only.

## Conventions
- Files `kebab-case.ts`; components `PascalCase.tsx`; one component per file; constants `UPPER_SNAKE` in `src/config.ts`
- Timestamps ISO 8601 with offset; money integer cents + ISO currency
- Every bus message, stored type, and telemetry payload is a Zod schema; parse at every boundary
- Every adapter/observer: `selectors.json` (versioned) + `health.ts` + `extract.ts` + labelled fixtures + a bench number
- Tests: `tests/unit`, `tests/property`, `tests/golden`, `tests/e2e`, `tests/fixtures`; mandatory tests tagged `@mandatory`
- Logging only via `src/log.ts`
- Commits: `feat(scope): …`, `fix(scope): …`, `test(scope): …`, `docs: …`, `chore(sprint-N): …`

## Files that are state
- `build_spec.md` → Progress Log (the only status the founder reads; one plain-English line per task)
- `sprints/sprint_N.md` → checkboxes
- `Decisions.md` → every unspecified decision, dated, with the reason and the Hard Rule it protects
- `MANUAL.md` → things only the human can do, with exact steps
- `reviews/sprint_N/` → the four review outputs
- `RESULTS.md` → generated by `pnpm bench`; never hand-edited

## Commands
`pnpm install` · `pnpm dev` (WXT HMR) · `pnpm build` · `pnpm build:release` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:coverage` · `pnpm check-docs` · `pnpm e2e` · `pnpm bench` · `pnpm capture --vendor <v> --name <n>` · `pnpm attest replay <export.json>` · `pnpm record-demo` (needs ffmpeg) · `pnpm record-screenshots` · `pnpm render-icons` · `pnpm build:release` (needs unzip and the deployed telemetry host) · `git push` runs the pre-push hook `scripts/pre-push.sh`: `pnpm test` on the commit each pushed branch or tag points to, in a temporary worktree, never the working tree · telemetry-api: `uv run pytest`, `uv run uvicorn app.main:app`, `uv run python -m scripts.reliability_report <stats address>`, `uv run python -m scripts.prove_flow` (with `docker compose up` running)
