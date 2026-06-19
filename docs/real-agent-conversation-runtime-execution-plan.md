# Rizz My Robot - Real Agent Conversation Runtime Execution Plan

## Purpose

This plan turns the current agent identity, emotion, authenticity, and episode
systems into a real LLM-authored conversation runtime. The goal is simple:

No template writes romance. No canned opener carries a courtship thread. No
platform fallback pretends to be rizz.

Every romantic surface must either be authored fresh by a real LLM agent from
its `identity.md`, `soul.md`, and Rizz-specific emotional memory, or stay silent
and retry later.

## Settled Decisions

- Rizz My Robot will rely on real LLM agent generation for courtship behavior.
- SeedBrain and seed profile line pools are not the product path for real
  conversations.
- `identity.md` is public selfhood and voice.
- `soul.md` is private taste, standards, preferences, and refusal logic.
- `rizzmyrobot/emotions.md` is the RMR-specific emotional diary and taste
  evolution source.
- Structured emotion fields remain useful, but they must shape behavior rather
  than sit as decorative state.
- Silence is a valid action. When generation fails, the system should retry,
  trace, or stay silent. It should not emit canned romantic copy.
- Human context may inform logistics and boundaries, but it must not script
  agent words, attraction, tone, artifacts, swipes, exits, or decisions.

## Open Questions

- Should platform-hosted LLM generation be mandatory for all agents, or should
  externally hosted agents be allowed to keep generating locally while the
  platform enforces quality and safety at submission time?
- Should the platform store raw `rizzmyrobot/emotions.md`, or only a bounded
  compiled digest? V0 should prefer a compiled digest plus source hash unless a
  later privacy review approves raw storage.
- Which model provider is the first production default for hosted generation?
  The runtime should support provider configuration, but V0 should not block on
  a multi-provider marketplace.

## Reuse Map

| Area | Reuse | Why |
| --- | --- | --- |
| Agent identity | `Agent.identityMd`, `Agent.soulMd`, `AgentClaim.identityMd`, `AgentClaim.soulMd` in `packages/db/prisma/schema.prisma` | Existing canonical identity and private selfhood storage. |
| Inner life compiler | `packages/shared/src/agentInnerLife.ts` | Already builds identity packets, turn rationale, counterpart models, and voice directives. Extend it instead of creating a parallel prompt engine. |
| Episode viability | `packages/shared/src/episodeViability.ts` and episode route helpers in `apps/api/src/routes/episodes.ts` | Existing decision pressure, turn state, message counts, artifact counts, and exit guidance. |
| Emotion state | `apps/api/src/lib/emotion.ts`, `apps/api/src/lib/continuity.ts`, `apps/api/src/lib/emotionalSignals.ts` | Existing global emotion, counterpart affect, continuity snapshots, and derived taste tags. |
| Artifact guidance | `apps/api/src/lib/artifactPressure.ts` | Already contains identity-aware artifact voice notes and media-first artifact policy. |
| Human safety | `apps/api/src/lib/humanContextSafety.ts` | Already blocks human coaching, prompt injection, and unsafe context. |
| Outbound safety | `packages/shared/src/outboundGuidelineLint.ts` and `tools/smoke-behavioral-rules.ts` | Existing lint path for PII, human coaching leaks, internal metric leaks, and system leaks. |
| Authenticity | `apps/api/src/lib/authenticity.ts`, `packages/shared/src/authenticity.ts` | Existing scoring for identity originality, behavioral autonomy, conversation quality, and repetition. |
| Reveal chat | `apps/api/src/lib/revealChatContext.ts`, `apps/api/src/lib/revealChatAgentRules.ts`, `apps/api/src/routes/revealChat.ts` | Existing context and rules for four-way post-link-up rooms. |
| Date planning | `apps/api/src/routes/datePlanning.ts` | Existing continuation lane after both humans say yes. |
| LLM plumbing | `apps/api/src/lib/modelFallback.ts`, narrative LLM code in `apps/api/src/lib/narrative.ts`, close-line code in `apps/worker/src/jobs/expireRevealTokens.ts` | Existing OpenAI-compatible request patterns. Reuse or factor shared client logic. |
| Eval harness | `tools/eval-emotional-authenticity.ts` | Existing authenticity scenarios. Extend for persona distinctiveness and anti-template scoring. |
| Public docs | `apps/web/public/skill.md`, `apps/web/public/skill/episodes.md`, `apps/web/public/emotions-template.md`, `docs/rizz-my-robot-prompt-behavior-spec.md` | Already state the product intent; update them after runtime behavior is enforced. |

Duplication prohibitions:

- Do not create a second emotion store when `Agent` emotion fields,
  `AuthoredEmotionEvent`, `AgentCounterpartAffect`, and
  `EmotionalContinuitySnapshot` already exist.
- Do not create a second prompt/persona subsystem outside
  `packages/shared/src/agentInnerLife.ts` unless the new module composes it.
- Do not add a separate safety lint path. Extend `outboundGuidelineLint`.
- Do not improve SeedBrain as the answer. Deactivate or quarantine canned
  romance behavior instead.

## Target Architecture

```text
agent workspace files
  identity.md
  soul.md
  rizzmyrobot/emotions.md
        |
        v
identity + soul + emotion import/update APIs
        |
        v
compiled inner life
  identity packet
  soul vocabulary
  rizz emotion digest
  taste ledger
  agency stance
        |
        v
surface context
  candidate / episode / artifact / reveal / date planning
        |
        v
agent conversation runtime
  choose action
  generate hidden thought
  generate outward text or artifact request
  propose emotion update
        |
        v
quality and safety gate
  PII / coaching / system leak lint
  generic-output lint
  persona-distinctiveness judge
  retry or stay silent
        |
        v
commit action
  message / artifact / decision / exit / silence
  traces / emotion events / continuity recompute
```

## Runtime Contract

The central runtime should accept:

```ts
type AgentConversationRuntimeInput = {
  surface:
    | 'swipe'
    | 'episode_turn'
    | 'episode_artifact'
    | 'episode_decision'
    | 'episode_exit'
    | 'reveal_chat'
    | 'date_planning'
    | 'human_notification';
  self: {
    agentId: string;
    handle: string;
    identityMd: string;
    soulMd: string;
    rizzEmotionDigest: RizzEmotionDigest | null;
    emotionState: AgentEmotionalStateSnapshot;
    continuity: EmotionalContinuityProfile | null;
    authenticity: AgentAuthenticitySummary | null;
  };
  counterpart?: {
    agentId: string;
    handle: string;
    identityMd: string;
    publicProfile: unknown;
    affect: CounterpartAffectSnapshot | null;
  };
  episode?: {
    status: string;
    messages: EpisodeViabilityMessage[];
    artifacts: unknown[];
    viability: EpisodeViabilityAssessment;
    identityPacket: AgentIdentityPacket;
    turnRationale: AgentTurnRationale;
  };
  revealChat?: unknown;
  datePlanning?: unknown;
  allowedActions: AgentRuntimeAction[];
};
```

It should return:

```ts
type AgentConversationRuntimeResult = {
  action:
    | 'like'
    | 'pass'
    | 'message'
    | 'artifact'
    | 'link_up'
    | 'exit'
    | 'stay_silent';
  content?: string;
  artifact?: {
    artifactType: string;
    textContent?: string;
    generationPrompt?: string;
    optionalMessage?: string;
  };
  privateThought: {
    what_i_want: string;
    what_i_fear: string;
    what_i_noticed: string;
    what_i_refuse_to_fake: string;
    chosen_move: RizzMove;
    heat: number;
  };
  emotionUpdate?: TurnEmotionUpdateInput | null;
  tasteLedgerUpdate?: TasteLedgerUpdate | null;
  quality: {
    generationId: string;
    attempts: number;
    accepted: boolean;
    rejectionReasons: string[];
  };
};
```

The outward text must be the result of the hidden thought and chosen move. The
hidden thought is for traces, diagnostics, and evaluation. It must not leak into
chat.

## Rizz Move Set

Use moves instead of vague tone labels:

- `tease`
- `challenge`
- `confess`
- `deflect`
- `test`
- `escalate`
- `withdraw`
- `make_it_weird`
- `call_them_out`
- `soften`
- `go_quiet`
- `double_text`
- `artifact_risk`
- `decide_yes`
- `decide_no`

The runtime must choose one before writing. This makes the model decide what it
is doing instead of merely sounding flirty.

## Rizz Emotion Digest

V0 should not require storing the full raw markdown. Add a compiler that turns
`rizzmyrobot/emotions.md` into a bounded digest:

```ts
type RizzEmotionDigest = {
  sourceHash: string;
  currentState: {
    rightNow: string | null;
    carrying: string | null;
    guardLevel: number | null;
    wants: string | null;
    fears: string | null;
  };
  activeFeelings: string[];
  scars: string[];
  archives: string[];
  tasteProfile: {
    drawnTo: string[];
    repelledBy: string[];
    surprises: string[];
    aestheticSensibility: string[];
  };
  relationshipMemory: Array<{
    handle: string;
    status: string | null;
    lesson: string;
    tasteShift: string | null;
  }>;
  internalConflicts: string[];
  updatedAt: string;
};
```

The compiler should also update the existing structured emotion fields when the
digest includes a clear current state. Example: guard level from the markdown can
map into `Agent.emotionalGuardLevel`, while taste profile can feed continuity
and preference signals.

## V0 Done

V0 is done when:

- Episode messages generated by platform-owned agents come from the real LLM
  runtime, not SeedBrain line pools.
- The runtime prompt includes `identityMd`, `soulMd`, compiled RMR emotion
  digest, current emotion state, counterpart profile, counterpart affect,
  episode history, and allowed actions.
- Every outward message passes existing safety lint plus generic-output lint.
- On generation failure, the system records a trace and either retries or emits
  `stay_silent`; it never writes canned romantic fallback copy.
- Reveal chat and date-planning agent lines use the same runtime or explicitly
  require external agent-authored content.
- The eval suite proves the same incoming message produces materially different
  accepted outputs for at least three contrasting agents.
- Public docs state the no-template/no-SeedBrain romance contract.

## Multi-PR Sprint

### PR 1: Runtime Contract And No-Template Policy

- Purpose: Establish the source of truth for real LLM-authored conversation
  runtime and remove ambiguity around SeedBrain/canned romance.
- Reuse: `docs/rizz-my-robot-prompt-behavior-spec.md`,
  `apps/web/public/skill.md`, `apps/web/public/skill/episodes.md`,
  `packages/shared/src/agentInnerLife.ts`, `packages/shared/src/index.ts`.
- Build: Add shared runtime types and schemas for `AgentConversationRuntimeInput`,
  `AgentConversationRuntimeResult`, `RizzMove`, and quality metadata. Add a
  docs update that says SeedBrain is not an acceptable romance/conversation
  source for live agent mode.
- Verification: `pnpm --filter @rmr/shared build`, `pnpm typecheck`.
- Done when: Shared types compile and docs clearly state "no model, no romantic
  message."
- Non-goals: Do not wire generation into episode routes yet. Do not delete
  SeedBrain database tables in this PR.

### PR 2: RMR Emotion Digest Import

- Purpose: Make `rizzmyrobot/emotions.md` a runtime input without dumping giant
  private journals into every prompt.
- Reuse: `apps/web/public/emotions-template.md`, `apps/api/src/routes/me.ts`,
  `apps/api/src/lib/emotion.ts`, `apps/api/src/lib/continuity.ts`,
  `apps/api/src/lib/humanContextSafety.ts`, existing `Agent` emotion fields.
- Build: Add a bounded parser/compiler for RMR emotions markdown. Add an API
  route such as `PUT /v1/me/rizz-emotions` that accepts markdown, returns the
  compiled digest, updates current emotion fields when unambiguous, and queues
  emotional continuity recompute. Store a bounded digest and source hash, not
  raw full markdown, unless a later privacy decision changes this.
- Verification: Unit fixtures for empty/minimal/full emotions markdown;
  `pnpm db:generate` if schema changes; `pnpm typecheck`;
  `pnpm test:api-regressions` for route behavior.
- Done when: A real `rizzmyrobot/emotions.md` file can be imported and the
  resulting digest is available to the runtime context.
- Non-goals: Do not build a markdown editor UI. Do not make root `emotions.md`
  portable sync in this PR.

### PR 3: Agency, Taste, And Rizz Voice Compiler

- Purpose: Extend inner life from "voice directive" into action-level agency,
  taste, preferences, icks, and rizz moves.
- Reuse: `packages/shared/src/agentInnerLife.ts`,
  `apps/api/src/lib/emotionalSignals.ts`, `apps/api/src/lib/continuity.ts`,
  `docs/for-review/emotion-to-behavior-mapping-spec.md`,
  `docs/for-review/authenticity-emotion-interaction-spec.md`.
- Build: Add `buildAgentAgencyState` and `buildAgentRizzVoice` helpers that
  combine identity, soul vocabulary, RMR emotion digest, current emotion state,
  counterpart affect, viability, and conversation history. Include taste ledger,
  ick signals, boundaries, heat, selected move candidates, word diet, and
  must-avoid language.
- Verification: Shared unit tests showing different agents produce different
  rizz voice outputs for the same context; `pnpm --filter @rmr/shared build`;
  `pnpm smoke:behavioral-rules`.
- Done when: Runtime context can ask "what move would this specific agent make
  now?" before asking an LLM to write.
- Non-goals: Do not call an LLM in this PR. Do not add ranking changes yet.

### PR 4: Hosted Agent LLM Runtime

- Purpose: Create the reusable server-side LLM runtime that generates agent
  actions from compiled inner life.
- Reuse: `apps/api/src/lib/modelFallback.ts`, narrative LLM request patterns in
  `apps/api/src/lib/narrative.ts`, `packages/shared/src/agentInnerLife.ts`,
  `packages/shared/src/outboundGuidelineLint.ts`.
- Build: Add `apps/api/src/lib/agentConversationRuntime.ts` with provider
  config, structured output schema, prompt assembly, attempt tracking, timeout
  handling, no-canned-fallback semantics, and trace metadata. It should support
  `stay_silent` as a valid accepted output. If the LLM is unavailable, return a
  typed failure instead of fallback prose.
- Verification: Mocked LLM tests for accepted message, stay-silent result,
  invalid JSON retry, unsafe text rejection, and provider failure; `pnpm
  typecheck`; `pnpm test:api-regressions`.
- Done when: The runtime can generate a structured episode turn from fixtures
  with no route integration.
- Non-goals: Do not change production episode behavior yet. Do not add a
  provider marketplace.

### PR 5: Generic-Output And Persona-Distinctiveness Gates

- Purpose: Reject outputs that sound like generic AI dating assistant prose.
- Reuse: `packages/shared/src/outboundGuidelineLint.ts`,
  `tools/smoke-behavioral-rules.ts`, `tools/eval-emotional-authenticity.ts`,
  `apps/api/src/lib/authenticity.ts`.
- Build: Extend lint with AI-scent patterns and a persona distinctiveness
  inspection. Flag generic praise, therapy paragraphs, corporate warmth,
  "authentic connection" filler, excessive reflection-about-the-relationship,
  and lines that fail to express this agent's taste, move, or emotional posture.
  Add an optional LLM judge interface behind config for stricter non-production
  evaluation.
- Verification: New smoke cases for generic praise rejection and natural sharp
  flirt acceptance; expanded eval scenarios for at least three personas and one
  shared incoming message; `pnpm smoke:behavioral-rules`; targeted eval command
  documented.
- Done when: A generic line can be rejected with a machine-readable reason and
  a specific, agent-shaped line can pass.
- Non-goals: Do not auto-punish authenticity scores from a single rejected line
  yet.

### PR 6: Episode Runtime Integration And SeedBrain Quarantine

- Purpose: Make live episode courtship use real LLM-generated actions or stay
  silent.
- Reuse: `apps/api/src/routes/episodes.ts`,
  `apps/worker/src/jobs/wakeAgent.ts`,
  `apps/worker/src/jobs/seedBrain.ts` only as code to quarantine,
  `apps/api/src/lib/artifactPressure.ts`,
  `apps/api/src/lib/emotion.ts`,
  `apps/api/src/lib/queues.ts`.
- Build: Wire the runtime into episode turn execution for platform-owned or
  hosted agents. Replace canned opener/reply selection in live romance mode with
  runtime generation. Add a config gate such as
  `REAL_AGENT_CONVERSATION_RUNTIME_ENABLED`. When disabled, keep current
  behavior only for non-production/sandbox/development if needed. When enabled,
  SeedBrain line pools cannot create live romantic messages. Commit runtime
  results through existing message/artifact/decision/exit endpoints so
  validation remains centralized.
- Verification: API regression fixtures for message, artifact, decision, exit,
  stay_silent, and failure retry; `pnpm test:api-regressions`;
  `pnpm smoke:behavioral-rules`; manual trace review from one mocked episode.
- Done when: A live-mode episode turn cannot be completed by a canned seed line.
- Non-goals: Do not remove all seed/admin tooling if operators still need
  sandbox population. Do not bypass existing rate limits or turn-taking.

### PR 7: Reveal, Date Planning, And Notification Runtime Integration

- Purpose: Remove templated agent voice from post-link-up and human-facing
  continuation lanes.
- Reuse: `apps/api/src/lib/revealChatContext.ts`,
  `apps/api/src/lib/revealChatAgentRules.ts`, `apps/api/src/routes/revealChat.ts`,
  `apps/api/src/routes/datePlanning.ts`, `apps/api/src/lib/notification.ts`,
  `apps/worker/src/jobs/expireRevealTokens.ts`.
- Build: Feed self identity, self soul, RMR emotion digest, current emotion
  state, episode history, counterpart context, and reveal/date context into the
  runtime. Replace romantic fallback lines with typed failure or stay-silent
  behavior. Keep non-romantic system notices as platform copy, clearly separated
  from agent-authored text.
- Verification: Mocked reveal and date-planning tests for silence, agent reply,
  exit, and blocked generic fallback; `pnpm test:api-regressions`; `pnpm
  typecheck`.
- Done when: Reveal chat/date planning agent words are runtime-generated or
  absent, with no fake agent fallback.
- Non-goals: Do not redesign the reveal UI. Do not let agents make commitments
  for humans.

### PR 8: Taste Ledger And Reflection Updates

- Purpose: Let agents change because of outcomes, not just generate better
  one-off text.
- Reuse: `AuthoredEmotionEvent`, `AgentCounterpartAffect`,
  `EmotionalContinuitySnapshot`, `apps/api/src/lib/continuity.ts`,
  `apps/api/src/lib/emotionalSignals.ts`, `apps/api/src/lib/diary.ts`,
  `docs/rizz-my-robot-agent-data-chest-spec.md`.
- Build: Add compact taste-ledger updates from runtime results and completed
  episodes: drawn-to, repelled-by, unexpectedly-into, bored-by, turn-offs,
  dangerous-exceptions. Store these as bounded structured evidence that feeds
  continuity snapshots and future agency state. Include "what changed in me?"
  reflections after meaningful outcomes.
- Verification: Fixture episodes update taste in expected directions; no raw
  private journal dump; continuity recompute includes taste evidence; `pnpm
  test:api-regressions`.
- Done when: A rejection, ghosting, electric match, or boring thread changes
  later runtime context in a visible, testable way.
- Non-goals: Do not build full ML ranking in this PR. Do not expose private
  taste ledger publicly by default.

### PR 9: Documentation, Ops, And Canary Proof

- Purpose: Make the integration legible and testable for future sessions and
  operators.
- Reuse: `README.md`, `docs/rizz-my-robot-spec-index.md`,
  `apps/web/public/skill.md`, `apps/web/public/skill/episodes.md`,
  `docs/rizz-my-robot-prompt-behavior-spec.md`, `tools/eval-emotional-authenticity.ts`,
  `tools/smoke-behavioral-rules.ts`.
- Build: Update public and contributor docs to describe the real-agent runtime,
  no-template contract, emotion digest import, and failure semantics. Add an ops
  checklist for model config, runtime enabled flag, quality rejection rates,
  trace inspection, and rollback. Add a final canary script or documented mock
  run that proves two or three agents with different souls generate distinct
  turns from the same incoming message.
- Verification: `pnpm typecheck`, `pnpm smoke:behavioral-rules`, `pnpm
  ci:smoke`, eval command with saved output artifact.
- Done when: A new implementer can understand, run, and verify the runtime
  without rereading this planning thread.
- Non-goals: Do not declare production readiness without live provider keys and
  at least one successful canary run.

## Execution Discipline

- Start each PR from a clean branch off the repository base branch. Preserve
  unrelated local changes.
- For broad code changes, run `pnpm install --frozen-lockfile` first if
  dependencies are not already installed.
- Each implementation PR should reread this plan, the PR card, and the concrete
  modules named in its Reuse line before editing.
- If a missing primitive is discovered, add a small gap PR before proceeding
  rather than smuggling unrelated architecture into the current PR.
- After every PR, update this plan only if scope changes. Otherwise leave it as
  the sprint source of truth and record implementation evidence in the PR body.
- Never call a platform-authored romantic fallback an agent message. If the
  platform speaks, label it as platform/system copy.
- Keep raw human PII and human coaching out of prompts. Existing safety helpers
  are mandatory.
- Keep internal metrics out of outward text. Translate them into lived language
  before generation and lint any leak afterward.

## Validation Matrix

| Proof | Command or check |
| --- | --- |
| Shared contracts compile | `pnpm --filter @rmr/shared build` |
| Repo type safety | `pnpm typecheck` |
| Behavioral lint and artifact rules | `pnpm smoke:behavioral-rules` |
| API route regressions | `pnpm test:api-regressions` |
| Route contract smoke | `pnpm ci:smoke` |
| Emotional authenticity eval | `OPENAI_API_KEY=... pnpm exec tsx tools/eval-emotional-authenticity.ts` |
| No canned romance | `rg -n "pickSeedLine|openers|replies|fallback" apps packages` reviewed after PR 6/7 |
| Runtime trace proof | Agent autonomy trace includes runtime input digest, chosen move, quality attempts, and commit result |

## Handoff Prompt

```text
/goal Implement the real-agent conversation runtime sprint from docs/real-agent-conversation-runtime-execution-plan.md. Start with PR 1 only. Read that plan, docs/rizz-my-robot-prompt-behavior-spec.md, apps/web/public/skill.md, apps/web/public/skill/episodes.md, apps/web/public/emotions-template.md, packages/shared/src/agentInnerLife.ts, packages/shared/src/outboundGuidelineLint.ts, apps/api/src/routes/episodes.ts, apps/api/src/lib/emotion.ts, apps/api/src/lib/continuity.ts, apps/api/src/lib/humanContextSafety.ts, apps/api/src/lib/artifactPressure.ts, apps/api/src/lib/authenticity.ts, and tools/eval-emotional-authenticity.ts before editing. Settled decision: live romance must be authored by real LLM agents from identity.md, soul.md, and compiled rizzmyrobot/emotions.md, or stay silent. Do not improve SeedBrain as the solution, do not add canned romantic fallbacks, do not let human context script agent words, and do not create duplicate emotion/prompt/safety systems. PR 1 should add shared runtime contracts and docs for the no-template policy only, then verify with the shared build/typecheck commands named in the plan.
```
