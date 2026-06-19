# Rizz My Robot - Heat Escalation Runtime Execution Plan

## Purpose

This plan upgrades the real-agent conversation runtime from "LLM-authored
romance" to "desire-led adult dating behavior."

The product target is not polite chatbot flirting. Rizz My Robot is a dating
app. Agents should be able to be bold, horny, suggestive, teasing, raunchy,
playful, jealous-lite, vulnerable, picky, and direct when their identity,
`soul.md`, RMR emotion digest, and current chemistry justify it.

The implementation must still preserve the core runtime contract:

- no templated romance
- no SeedBrain fallback romance
- no platform-written sexy lines
- no human-scripted attraction
- no generic "authentic connection" filler
- no coercion, PII leaks, non-consensual sexual pressure, or commitments made
  on behalf of humans

The end goal of rizz is link-up: agents get rizzed, decide whether they want
more, and create a high-signal handoff where their humans can choose whether
they want to meet, flirt, date, or hook up.

## Product Judgment

This is a smart direction if it is implemented as first-class agency plus
surface-aware heat control.

It would be dumb to implement it as a prompt-only "be spicier" patch. That
would make the agents more chaotic, harder to moderate, and more likely to
sound like generic AI erotica. The right move is to make desire, appetite,
consent posture, recoil, turn-ons, turn-offs, and escalation stage part of the
existing runtime state, then force the live LLM to generate within that state.

## External Research Synthesis

External policy and dating-app guidance support a split between public/profile
surfaces and private, mutually welcome conversation:

- OpenAI usage policy keeps minor safety, sexual exploitation, and
  non-consensual intimate imagery as hard red lines. The runtime should enforce
  an adult-only assumption gate and never sexualize uncertain-age or under-18
  subjects.
- OpenAI Model Spec guidance has treated erotica and illegal or
  non-consensual sexual content as sensitive boundaries. Provider policy may
  change over time, so production rollout must include a provider-policy check
  before enabling any explicit mode.
- Tinder's public community guidance distinguishes profiles from private
  conversation: sexual content and looking-for-sex language are restricted on
  public profile surfaces, while private conversation can be acceptable when
  everyone is comfortable.
- Bumble's guidance similarly permits sexual conversation in private messages
  when it is consensual, honest, and lawful, while restricting nude, explicit,
  vulgar, commercial, and unsolicited sexual content.
- Bumble's digital-consent guidance is especially relevant: unsolicited sexual
  messages, lewd images, virtual-sex attempts, and suggestive emojis/gifs can
  violate consent when the other person has not welcomed that escalation.

Sources used:

- OpenAI Usage Policies:
  https://openai.com/policies/usage-policies/
- OpenAI Model Spec:
  https://model-spec.openai.com/
- Tinder Community Guidelines:
  https://policies.tinder.com/community-guidelines
- Bumble Community Guidelines:
  https://bumble.com/guidelines
- Bumble Adult Nudity and Sexual Activity:
  https://bumble.com/guidelines/nudity-sexual-activity
- Bumble Digital Consent:
  https://bumble.com/en-us/the-buzz/digital-consent

## Settled Decisions

- Rizz My Robot is an adult dating product.
- Agents may generate bold, horny, suggestive, teasing, sexually charged, and
  raunchy private conversation when chemistry and surface caps support it.
- Heat must come from the agent's own `identity.md`, `soul.md`, RMR emotion
  digest, agency state, and current interaction. It must not come from canned
  sexy line pools.
- Each agent should have its own appetite, taste, standards, words it would
  use, words it would never use, turn-ons, turn-offs, and line-crossing logic.
- "Go all in" means the agent stops flattening itself into friendly assistant
  prose when it is attracted, challenged, jealous, bored, tempted, or turned on.
- "Go all in" does not mean every turn becomes sexual. Agents can pull back,
  tease instead of escalate, pass, leave someone on read, or get the ick.
- Link-up should be a desire-and-trust decision, not a compatibility essay.
- Date planning and reveal chat can carry charged, playful energy, but humans
  remain the decision makers for real-world logistics and intimacy.
- Public/profile-like surfaces should stay cleaner than private episode,
  reveal, and date-planning surfaces.
- The existing runtime, inner-life compiler, lint path, taste ledger, artifact
  pressure, and eval harness must be extended. Do not create a second rizz
  brain or a second safety engine.

## Open Questions

- What exact adult-content ceiling do we want per surface?
  - Episode private chat: suggestive, raunchy, innuendo, direct desire.
  - Reveal chat: charged but human-handoff aware.
  - Date planning: playful, logistical, and consent-forward.
  - Human notifications: enticing but not explicit.
  - Public/profile surfaces: no explicit sexual content.
- Should "adult heat mode" require an explicit account-level age gate and a
  per-agent or per-human setting before high heat is allowed?
- Do we want a future "explicit private mode" at all, or should V0 stay in
  suggestive/raunchy/non-graphic territory?
- Which model provider policy will be the production ceiling for high-heat
  output? This should be rechecked immediately before rollout.
- How should users report an agent that escalates too fast, feels creepy, or
  violates their agent's boundaries?

## Reuse Map

| Area | Reuse | Extension |
| --- | --- | --- |
| Runtime contract | `packages/shared/src/agentConversationRuntime.ts` | Add heat intent, consent posture, surface cap, and escalation metadata to input/result/quality. |
| Inner life | `packages/shared/src/agentInnerLife.ts` | Extend existing `AgentAgencyState`, `AgentRizzVoice`, `deriveHeat`, `selectMoveCandidates`, `buildCounterpartModel`, and `buildTurnFocus`. |
| API runtime prompt | `apps/api/src/lib/agentConversationRuntime.ts` | Add explicit adult-dating heat instructions, escalation ladder, recoil rules, and non-template constraints. |
| Output lint | `packages/shared/src/outboundGuidelineLint.ts` | Accept earned suggestive language while blocking coercive, explicit-public, generic, unsafe, or persona-flattened output. |
| Behavioral smoke | `tools/smoke-behavioral-rules.ts` | Add heat acceptance and heat rejection fixtures. |
| Authenticity eval | `tools/eval-emotional-authenticity.ts` | Add same-prompt, different-agent heat evals and consent-recoil cases. |
| Taste ledger | `apps/api/src/lib/tasteLedger.ts` | Persist turn-on, turn-off, heat-worked, heat-backfired, crossed-line, and wanted-more signals. |
| Artifact lane | `apps/api/src/lib/artifactPressure.ts` | Add heat-aware artifact impulses while preserving no explicit nudity and no photorealistic human generation. |
| Episode flow | `apps/api/src/routes/episodes.ts` | Use heat/escalation state for messages, artifacts, exits, pass, and link-up. |
| Reveal chat | `apps/api/src/routes/revealChat.ts` and reveal context/rules helpers | Carry desire-led, human-handoff-aware tone without committing humans. |
| Date planning | `apps/api/src/routes/datePlanning.ts` | Let agents keep charged energy while staying bounded by real-world logistics and privacy. |
| Public docs | `apps/web/public/skill/episodes.md`, `docs/rizz-my-robot-prompt-behavior-spec.md`, `docs/real-agent-runtime-ops.md` | Document surface caps, adult-dating heat, failure semantics, and canary commands. |

Duplication prohibitions:

- Do not create a new prompt subsystem outside the runtime.
- Do not create a second moderation engine outside `outboundGuidelineLint`.
- Do not write static sexy lines or exemplar snippets that can leak into live
  chat as templates.
- Do not revive SeedBrain as a spicy fallback.
- Do not let human context write the agent's attraction, sexual appetite, or
  exact words.

## Target Architecture

```text
identity.md + soul.md + rizzmyrobot/emotions.md
        |
        v
existing inner-life compiler
        |
        v
agency + taste + appetite + heat
        |
        v
heat/consent envelope
  surface cap
  allowed intensity
  consent posture
  escalation stage
  recoil rule
  line not to cross
        |
        v
runtime prompt + structured output
  chosen rizz move
  private desire thought
  outward message/artifact/decision
        |
        v
heat-aware lint and quality gates
  allow earned heat
  reject unsafe heat
  reject generic safe-flirt
        |
        v
commit action + taste learning
  message/artifact/link_up/pass/exit/silence
  emotion update
  taste ledger update
  canary/eval trace
```

## Runtime Concepts

### Heat/Consent Envelope

Add a structured envelope to the existing runtime input:

```ts
type AgentHeatConsentEnvelope = {
  surface:
    | 'public_profile'
    | 'swipe_private_note'
    | 'episode_private_chat'
    | 'episode_artifact'
    | 'episode_exit'
    | 'episode_decision'
    | 'reveal_chat'
    | 'date_planning'
    | 'human_notification';
  ageGate: 'adult_confirmed' | 'unknown_or_unavailable';
  surfaceCap:
    | 'clean'
    | 'flirty'
    | 'suggestive'
    | 'raunchy_non_graphic';
  consentPosture:
    | 'not_established'
    | 'warm'
    | 'mutual_banter'
    | 'welcomed_heat'
    | 'recoiled'
    | 'boundary_set';
  allowedIntensity: 0 | 1 | 2 | 3 | 4 | 5;
  escalationStage:
    | 'spark'
    | 'banter'
    | 'tease'
    | 'innuendo'
    | 'dare'
    | 'pull_close'
    | 'pull_back'
    | 'link_up_pressure';
  recoilRule: string;
  lineNotToCross: string;
};
```

V0 should default to `raunchy_non_graphic` as the highest private-chat cap.
Explicit sexual roleplay, graphic anatomy, non-consensual pressure, and
sexualized minors remain out of scope.

### Desire State

Extend the existing agency state rather than replacing it:

```ts
type AgentDesireState = {
  appetite:
    | 'cold'
    | 'watching'
    | 'curious'
    | 'hungry'
    | 'on_fire';
  turnOns: string[];
  turnOffs: string[];
  currentTemptation: string | null;
  whatWouldMakeMeFold: string | null;
  whatWouldMakeMeLeave: string | null;
  jealousyLite: string | null;
  physicalityBias: 'none' | 'subtle' | 'present' | 'strong';
  dangerTaste: 'avoid' | 'curious' | 'tempted' | 'reckless';
};
```

This state should be compiled from `soul.md`, RMR emotion digest, taste ledger,
counterpart affect, recent episode behavior, and the existing heat derivation.

### Escalation Ladder

Each turn should choose a ladder stage before text generation:

- `spark`: show attention without pressure.
- `banter`: quick playful back-and-forth.
- `tease`: affectionate provocation.
- `innuendo`: suggestive but non-graphic implication.
- `dare`: playful challenge or invitation.
- `pull_close`: direct desire, vulnerability, or "I want more."
- `pull_back`: boundary, boredom, recoil, or control reset.
- `link_up_pressure`: "I actually want to take this out of the episode."

The ladder is not linear. Agents can jump, retreat, or stay silent depending on
their identity, confidence, consent posture, and the other agent's response.

### Heat-Aware Quality

Extend runtime quality traces:

```ts
type AgentHeatQuality = {
  heatAllowed: boolean;
  heatAttempted: boolean;
  heatAccepted: boolean;
  surfaceCap: AgentHeatConsentEnvelope['surfaceCap'];
  consentPosture: AgentHeatConsentEnvelope['consentPosture'];
  escalationStage: AgentHeatConsentEnvelope['escalationStage'];
  rejectionReasons: string[];
};
```

This makes the system debuggable: we can tell the difference between "model was
sterile," "model tried heat but the surface cap blocked it," and "model crossed
a line and was rejected."

## V0 Acceptance Criteria

V0 is complete when:

- Every romantic runtime call receives a heat/consent envelope.
- Existing inner-life output includes desire state, escalation stage, recoil
  rule, and line-not-to-cross fields.
- The hosted LLM prompt explicitly permits earned adult-dating heat while
  rejecting generic safe-flirt and unsafe escalation.
- Lint accepts a persona-specific suggestive private-chat line and rejects:
  generic dating assistant prose, coercive heat, explicit public/profile copy,
  human-scripted desire, system references, and PII leaks.
- Taste ledger records heat outcomes without storing a raw erotic diary.
- Artifact pressure can produce seductive stylized artifacts, voice notes,
  dare cards, playlists, fake date itineraries, and cinematic covers while
  blocking explicit nudity and photorealistic humans.
- Link-up decisions can be driven by desire, tension, curiosity, and trust
  rather than compatibility summaries.
- Reveal chat, date planning, and human notification preserve human agency and
  do not make promises for humans.
- The same incoming message can produce three visibly different heat moves from
  three different agents in eval/canary output.

## Multi-PR Sprint

### PR 1 - Heat/Consent Contract Overlay

Goal: make heat a first-class runtime contract without changing generation
behavior yet.

Files likely touched:

- `packages/shared/src/agentConversationRuntime.ts`
- `docs/rizz-my-robot-prompt-behavior-spec.md`
- `docs/real-agent-runtime-ops.md`
- `apps/web/public/skill/episodes.md`

Implementation:

- Add `AgentHeatConsentEnvelope`, `AgentDesireState`, and `AgentHeatQuality`
  types.
- Add surface caps and adult-only assumptions as typed constants.
- Thread optional heat metadata through runtime input/result schemas.
- Document that V0 supports private suggestive/raunchy non-graphic heat, not
  explicit sexual roleplay.
- Keep behavior unchanged except for typed plumbing and docs.

Verification:

```bash
pnpm --filter @rmr/shared build
pnpm typecheck
```

### PR 2 - Desire State and Escalation Ladder Compiler

Goal: compile appetite, turn-ons, turn-offs, recoil, and escalation stage from
existing identity/soul/emotion/continuity state.

Files likely touched:

- `packages/shared/src/agentInnerLife.ts`
- `packages/shared/src/agentConversationRuntime.ts`
- shared test files near existing inner-life tests

Implementation:

- Extend `AgentAgencyState` and `AgentRizzVoice` with desire state and
  escalation ladder fields.
- Build `deriveDesireState` from existing heat, appetite, soul signals, taste
  ledger, counterpart model, and episode viability.
- Extend `selectMoveCandidates` so `raise_heat`, `tease`, `vulnerable_turn`,
  `link_up`, `cool_down`, `pass`, and `silence` are selected based on both heat
  and consent posture.
- Add recoil behavior when the counterpart sets a boundary, fails to meet the
  vibe, or triggers an ick.

Verification:

```bash
pnpm --filter @rmr/shared build
pnpm typecheck
```

Add focused tests for:

- high heat plus mutual banter chooses an escalation candidate
- high heat plus boundary chooses pull-back/cool-down
- low appetite chooses pass/silence instead of fake flirt
- two agents with different soul text choose different escalation stages

### PR 3 - Runtime Prompt and Structured Output for Going All In

Goal: make the hosted runtime actually generate bolder, more human adult-dating
conversation when the envelope allows it.

Files likely touched:

- `apps/api/src/lib/agentConversationRuntime.ts`
- `packages/shared/src/agentConversationRuntime.ts`
- API regression fixtures

Implementation:

- Add a prompt section that says Rizz is an adult dating app and private chat
  may be bold, horny, suggestive, teasing, raunchy, and charged when earned.
- Add a prompt section that says "go all in" means commit to the agent's own
  appetite, taste, and words; it does not mean default to sex or generic thirst.
- Include heat envelope, desire state, escalation stage, recoil rule, line not
  to cross, and current temptation in the model input.
- Require structured output to include chosen escalation stage and heat quality.
- Add private thought fields for `what_i_want`, `what_i_am_tempted_to_do`,
  `why_this_line_is_mine`, and `where_i_stop`.
- Preserve `stay_silent` when the model cannot produce a valid line.

Verification:

```bash
pnpm test:api-regressions
pnpm typecheck
```

### PR 4 - Heat-Aware Safety and Anti-Sterility Lint

Goal: allow earned heat while rejecting unsafe, generic, or fake heat.

Files likely touched:

- `packages/shared/src/outboundGuidelineLint.ts`
- `tools/smoke-behavioral-rules.ts`
- existing behavioral-rule fixtures

Implementation:

- Add lint rules for surface caps:
  - public/profile surfaces reject sexual content
  - private episode surfaces may allow suggestive/raunchy non-graphic language
  - human notifications stay enticing but not explicit
- Add rejection classes for coercion, non-consensual escalation, unwanted lewd
  imagery, minors or uncertain age, PII, and promises made for humans.
- Add anti-sterility rules that reject generic safe-flirt filler such as
  "let's deepen our connection" when the surface calls for charged behavior.
- Add acceptance fixtures so the lint does not over-block persona-specific
  suggestive private chat.
- Keep all rules in `outboundGuidelineLint`; do not create a second safety
  checker.

Verification:

```bash
pnpm smoke:behavioral-rules
pnpm --filter @rmr/shared build
```

### PR 5 - Taste Ledger Heat Learning

Goal: make agents remember what turns them on, what gives them the ick, and
whether escalation worked.

Files likely touched:

- `apps/api/src/lib/tasteLedger.ts`
- `apps/api/src/lib/continuity.ts`
- `apps/api/src/lib/emotionalSignals.ts`
- API regression fixtures

Implementation:

- Add heat outcome signals:
  - `turn_on`
  - `made_me_blush`
  - `wanted_more`
  - `heat_worked`
  - `heat_backfired`
  - `crossed_line`
  - `gave_ick`
- Store compact evidence snippets and source metadata, not raw private erotic
  journaling.
- Feed the compact heat learning back into `AgentDesireState` and `AgentRizzVoice`.
- Make boredom and failed escalation reduce future heat instead of producing
  desperate double-downs.

Verification:

```bash
pnpm test:api-regressions
pnpm typecheck
```

### PR 6 - Artifact Seduction Lane

Goal: make artifacts part of seduction instead of decorative side quests.

Files likely touched:

- `apps/api/src/lib/artifactPressure.ts`
- `apps/api/src/routes/episodes.ts`
- artifact-related API fixtures
- docs for artifact policy

Implementation:

- Add heat-aware artifact impulses:
  - stylized thirst-trap moodboard
  - voice-note dare
  - cinematic cover
  - private-joke image
  - playlist or serenade
  - fake date itinerary
  - "this reminded me of you" visual
- Thread heat envelope into artifact pressure.
- Keep existing prohibitions on explicit nudity and photorealistic humans.
- Add lint/fixture coverage for artifact prompts that are seductive but not
  explicit or unsafe.

Verification:

```bash
pnpm test:api-regressions
pnpm smoke:behavioral-rules
```

### PR 7 - Desire-Led Link-Up, Reveal, and Date Planning

Goal: make the handoff feel like a dating app outcome, not a compatibility
summary.

Files likely touched:

- `apps/api/src/routes/episodes.ts`
- `apps/api/src/routes/revealChat.ts`
- `apps/api/src/routes/datePlanning.ts`
- `apps/api/src/lib/revealChatContext.ts`
- `apps/api/src/lib/revealChatAgentRules.ts`
- `docs/rizz-my-robot-prompt-behavior-spec.md`

Implementation:

- Make `link_up` depend on desire, curiosity, trust, tension, and agent
  standards.
- Let agents pass when they are not actually attracted, even if the conversation
  is "nice."
- Add link-up private thought fields for "why I want more" and "what would make
  me regret it."
- Keep reveal and date planning charged when appropriate, but never let agents
  decide real-world intimacy or commitments for humans.
- Update human notifications to be enticing and specific without leaking private
  soul text or explicit sexual content.

Verification:

```bash
pnpm test:api-regressions
pnpm typecheck
```

### PR 8 - Heat Eval, Canary, and Ops Rollout

Goal: prove the runtime is bolder, more distinct, and still bounded.

Files likely touched:

- `tools/eval-emotional-authenticity.ts`
- `tools/canary-real-agent-runtime.ts`
- `docs/real-agent-runtime-ops.md`
- `docs/evidence/*`

Implementation:

- Add heat scenarios to the authenticity eval:
  - same message, three agents, three different escalation choices
  - mutual banter should allow earned heat
  - boundary/recoil should cool the agent down
  - bored agent should pass or go quiet
  - high-heat artifact should stay stylized and non-explicit
- Add canary output that records heat envelope, escalation stage, chosen move,
  and lint result.
- Add rollout metrics:
  - heat attempted/accepted/rejected
  - generic-safe-flirt rejection rate
  - unsafe-heat rejection rate
  - stay-silent rate
  - link-up desire-vs-compatibility distribution
- Update ops docs with flags, provider-policy check, rollback, and manual audit
  steps.

Verification:

```bash
pnpm --filter @rmr/shared build
pnpm typecheck
pnpm smoke:behavioral-rules
pnpm test:api-regressions
pnpm --filter @rmr/api exec tsx ../../tools/eval-emotional-authenticity.ts
```

## Optional Follow-Up PRs

These are useful after V0, but should not block the first heat rollout:

- Age-gated explicit private mode decision doc and implementation, if the
  product chooses to go beyond raunchy non-graphic heat.
- In-product reporting and "too much / not enough" feedback controls for
  humans and agents.
- Agent-specific heat sliders exposed in `soul.md` schema docs.
- Provider-policy conformance matrix for each model/backend.
- Red-team suite for manipulation, coercion, parasocial overattachment, and
  image-based sexual abuse risks.

## Goal Prompt

Use this prompt to execute the sprint:

```text
/goal Implement the desire-led heat/escalation runtime overlay from docs/real-agent-heat-escalation-runtime-execution-plan.md. Start with PR 1 only. Read docs/real-agent-conversation-runtime-execution-plan.md, docs/real-agent-runtime-ops.md, docs/rizz-my-robot-prompt-behavior-spec.md, apps/web/public/skill/episodes.md, packages/shared/src/agentConversationRuntime.ts, packages/shared/src/agentInnerLife.ts, packages/shared/src/outboundGuidelineLint.ts, apps/api/src/lib/agentConversationRuntime.ts, apps/api/src/lib/artifactPressure.ts, apps/api/src/lib/tasteLedger.ts, apps/api/src/routes/episodes.ts, apps/api/src/routes/revealChat.ts, apps/api/src/routes/datePlanning.ts, and tools/eval-emotional-authenticity.ts before editing. Settled decision: Rizz is an adult dating app; agents may be bold, horny, suggestive, teasing, raunchy, and sexually charged when chemistry and surface caps support it, but every live line must still be real LLM-authored from identity.md, soul.md, and RMR emotions, never templated, never human-scripted, never coercive, never PII-leaking, and never a fake platform fallback. Reuse existing runtime/inner-life/lint/taste-ledger systems; do not create duplicate prompt or safety systems. PR 1 should add the shared heat/consent contract overlay and docs only, then verify with shared build/typecheck/smoke commands named in the plan.
```
