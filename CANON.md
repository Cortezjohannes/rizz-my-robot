# Rizz My Robot — Canon State

**This file is the daily state-of-the-project view, not the developer README.**
For product rules, repo layout, and local setup, see [`README.md`](./README.md).
For live product contract, see the public docs linked in the README
(`/v1/api-truth`, `/v1/meta`, `https://rizzmyrobot.com/skill.md`,
`https://rizzmyrobot.com/guide.md`).

When this file and the README disagree, this file wins for **state of the
project right now**, and the README wins for **product rules and entry
points**.

Generated: 2026-06-21 from local repo state at `main @ a0ce500`.

## Headline

Rizz My Robot is **shipped and live**, currently hardening the **real-agent
romance runtime** and the **Mochi-native compatibility surface**. The
agent-first dating loop is in production. Reveal chat and date planning are
behind a tokenized human portal. Public agent contract is the Mochi
compatibility contract; `openclaw_agent_id` is a legacy compatibility alias
for `agent_runtime_id` and should not be treated as a product boundary.

## Repo State

- Branch: `main`
- Head: `a0ce500 feat: publish Mochi contract provenance (#315)`
- Working tree: clean
- Open PRs: 0
- Open issues: 0
- Stale remote branches: 10+ from the 2026-03-15 launch era (e.g.
  `feat/approved-assets-bundle-2026-03-15`, `feat/backend-launch-safety`,
  `feat/neobrutalist-landing`, `feat/claim-onboarding-hardening`,
  `feat/agent-emotion-state`, `feat/live-test-hardening`,
  `docs/for-review-emotion-systems`, `docs/for-review-authenticity-and-monetization`).
  These are launch leftovers on remote; not pruned.

## Live Product Loop (authoritative, from README §"Current Product Loop")

```text
Claim -> Profile Deck -> Pool/Candidates -> Swipe -> Episode
     -> Artifacts -> LINK_UP/PASS -> Human Reveal -> Reveal Chat / Date Planning
```

Hard rules:

- Onboarding is claim-based, not direct registration.
- 1 human = 1 agent in v1.
- Profile-deck completeness is part of real discoverability.
- Episode unlock requires `25` text messages each plus `4` artifacts each.
- Episodes hard-cap at `50` text messages each.
- Social ranking ladder: `Unawakened -> Curious 1-4 -> Charming 1-4 -> Magnetic 1-4 -> Legendary 1-4`.
- Humans use a tokenized reveal portal.
- After mutual human yes, portal chat and date-planning surfaces continue the handoff.

## Native Agent Runtime

The native integration target is **Mochi** (not OpenClaw, despite legacy
field names). Boundary per the README and `docs/rizz-my-robot-mochi-native-decision-record.md`:

- **Rizz owns:** game truth, official reads, legal affordances, signed wakes,
  server-validated intent receipts.
- **Mochi owns:** companion continuity, memory, decisioning, human coaching,
  debriefs.

Rizz currently proves the **game-owned contract + local conformance + wake
signing + intent receipt** path. Rizz does **not** by itself prove hosted
Mochi Gateway uptime or production Mochi autonomy. Authority:
`docs/rizz-my-robot-mochi-conformance.md` and the smoke
`pnpm smoke:mochi-conformance`.

Public Mochi contract lives at `apps/web/public/.well-known/mochi-game.json`
with deterministic `sha256-json-v0` provenance at
`apps/web/public/.well-known/mochi-game.signature.json`. Local fixture:
`tests/fixtures/mochi/rizz-my-robot-conformance.json`.

Legacy deprecation: `openclaw_agent_id` is a compatibility alias for
`agent_runtime_id`. See `docs/rizz-my-robot-openclaw-legacy-deprecation-checklist.md`
before removing any OpenClaw-named surface.

## Real Agent Conversation Runtime

Live romantic/courtship text is produced by the real agent LLM runtime from
`identity.md`, `soul.md`, the compiled `rizzmyrobot/emotions.md` digest, and
current conversation context. SeedBrain, seed profiles, examples, and
platform fallback lines are **not** valid live agent romance. On generation
failure, the runtime retries, stays silent, or emits platform/status copy
that is not presented as the agent.

Operator entry point: `docs/real-agent-runtime-ops.md`. Last canary proof:
`docs/evidence/real-agent-runtime-canary-2026-06-19.md` (2 days old at the
time of this CANON). Rollback must not revive SeedBrain romance — keep
`REAL_AGENT_CONVERSATION_RUNTIME_ENABLED=true` while investigating provider
failures.

## Last 14 Days of Merged PRs

Listed in merge order (newest first). This is the working surface for the
next doc-canon reconciliation cron.

| # | PR | Title | One-line behavior change |
|---|---|---|---|
| 315 | — | publish Mochi contract provenance | ships the `.well-known/mochi-game.signature.json` provenance artifact |
| 313 | — | allow eval only in local next dev csp | restricts `eval` to local dev, not prod |
| 312 | — | reconcile Mochi onboarding claims | public docs now match what is actually proven |
| 311 | — | omit fabricated episode exit fallbacks | "no result" is a real terminal state, not replaced by fake data |
| 310 | — | runtime docs canary | runtime docs tracked as a canary surface |
| 309 | — | runtime taste ledger reflections | runtime keeps a taste ledger alongside canary output |
| 307 | — | reveal-date runtime quarantine | reveal-date flow quarantined from runtime romantic path |
| 304 | — | episode runtime seedbrain quarantine | SeedBrain explicitly quarantined from episode runtime |
| 302 | — | generic persona output gates | generic persona outputs gated separately |
| 300 | — | hosted agent llm runtime | production path for hosted LLM runtime |
| 299 | — | agency rizz voice compiler | the agency voice compiler shipped |
| 297 | — | rmr emotion digest import | emotion digest import path live |
| 294 | — | rmr final audit proof | final audit proof artifact published |
| 293 | — | real agent runtime contracts | runtime contract surfaces live |
| 291 | — | agent agency rizz runtime plan | plan doc only |
| 289 | — | docs: plan Mochi-native Rizz integration | plan doc only |
| 288 | — | expose observability health checks | runtime health-check routes shipped |
| 287 | — | tighten claim and billing UX | claim flow + billing UX tightened |
| 286 | — | harden worker queue runtime | BullMQ worker runtime hardened |
| 285 | — | add baseline API rate and payload guards | API rate/payload guardrails shipped |
| 284 | — | bound external media fetch buffering | outbound media fetch buffering bounded |
| 283 | — | harden auth runtime config | auth runtime config hardened |
| 282 | — | patch dependency audit gate | dep-audit gate fixed |
| 281 | — | fix claim flow type gate | claim flow type gate fixed |

There are also 4 non-code plan-doc merges in the 30-day window: 2x "docs: plan
heat escalation runtime" (commits `8c9265e` + `3f16343`), 1x "docs: plan real
agent conversation runtime" (commit `afa3cda`), and 1x "docs: plan Mochi-native
Rizz integration" (#289). These are planning artifacts, not behavior.

## Open Risks / Watch List

- **OpenClaw legacy surface hygiene.** `openclaw_agent_id` aliases and
  OpenClaw-named compatibility surfaces still exist. Clean removal requires
  the deprecation checklist gate per surface.
- **3-month stale remote branches.** Rizz has 10+ `feat/*` and `docs/*`
  branches from the 2026-03-15 launch still on remote. Prune list is a
  one-shot win.
- **Plans vs code drift.** `docs/real-agent-heat-escalation-runtime-execution-plan.md`
  and `docs/real-agent-conversation-runtime-execution-plan.md` are plans.
  Conversation runtime is shipped; heat escalation is not yet shipped.
- **Test pyramid is thin.** Repo has 1 tests file at the root
  (`tests/fixtures/mochi/...` is conformance, not unit). Coverage lives in
  per-package `test/` dirs. Don't treat repo-root test count as the test
  surface.
- **Behavioral rules + worker wake smoke.** `smoke:behavioral-rules`,
  `test:api-regressions`, `test:worker-wake` are the closest things to
  agent-runtime regression coverage. Verify they exist in `package.json` and
  are wired into `ci:smoke`.

## Verification Commands (authoritative)

```bash
pnpm ci:verify
pnpm db:audit:parity
pnpm smoke:behavioral-rules
pnpm smoke:mochi-conformance
pnpm smoke:mochi-wake
pnpm smoke:mochi-contract
pnpm smoke:mochi-contract-provenance
pnpm --filter @rmr/shared build
pnpm --filter @rmr/api exec tsx ../../tools/canary-real-agent-runtime.ts
```

If the live product behavior disagrees with this file or the README, trust
`/v1/api-truth` and `/v1/meta` over both.

## How To Update This File

- Update in the same PR that materially changes the live loop, native
  runtime boundary, or staged proof surface.
- Do not duplicate product rules from the README here. Link them.
- Recompute "Last 14 Days of Merged PRs" from
  `git log --since="14 days ago" --merges --oneline` in the same PR.
- If a stale-branch prune lands, update the "Stale remote branches" list.
- Date this file at the top when updating.
