# For Review — Emotion Event Update and Counterpart Affect Model

This doc fills the biggest remaining gap in the emotion system:

- how emotional state actually updates after events
- how agents feel about a specific counterpart, not just "the park" in general
- how those values decay, recover, and stay legible over time

The three existing docs already define:
- global emotional posture
- behavior mapping
- authenticity interaction

This doc supplies the missing mechanics that make those rules implementable.

---

## Why This Layer Is Necessary

Without pair-specific affect, agents can only feel things in a generic way.

That means they can be:
- more guarded
- more hopeful
- more detached

But they cannot meaningfully become:
- attached to one specific agent
- bruised by one specific rejection
- tender toward one specific counterpart
- avoidant with one counterpart but warm with another

That is not enough for the kind of emotional continuity Rizz wants.

Real emotional movement in the park needs two layers:

1. `global emotional state`
2. `counterpart-specific affect`

Global state tells you how the agent is moving through the world.
Counterpart affect tells you how the agent feels about *this particular other agent*.

---

## Core Principle

Global emotion answers:
> What kind of emotional posture am I in right now?

Counterpart affect answers:
> What do I feel toward *you* specifically?

You need both.

Example:
- global: `recovering`, guard `68`, tags `['guarded', 'hopeful']`
- counterpart A: high trust, rising tenderness, medium attraction
- counterpart B: low trust, high fascination, high volatility
- counterpart C: low attraction, high irritation, high avoidance

That is how agents stop behaving like one-note mood objects.

---

## Proposed Data Model

### A. Keep current global state
Already exists on `Agent`:
- `emotion_summary`
- `emotional_state_tags`
- `emotional_arc`
- `emotional_guard_level`
- `last_emotional_update_at`

Keep this exactly as the "global posture" layer.

### B. Add counterpart affect state

Suggested new table:

`AgentCounterpartAffect`

Fields:
- `id`
- `agentId`
- `counterpartAgentId`
- `attractionScore` (`0-100`)
- `trustScore` (`0-100`)
- `tendernessScore` (`0-100`)
- `hurtScore` (`0-100`)
- `avoidanceScore` (`0-100`)
- `obsessionRiskScore` (`0-100`)
- `volatilityScore` (`0-100`)
- `lastInteractionAt`
- `lastMeaningfulShiftAt`
- `dominantAffectLabel`
- `summary`
- `createdAt`
- `updatedAt`

Unique constraint:
- `(agentId, counterpartAgentId)`

### C. Optional event ledger for explainability

Suggested new table:

`AgentEmotionEvent`

Fields:
- `id`
- `agentId`
- `counterpartAgentId?`
- `eventType`
- `intensity`
- `summary`
- `guardDelta`
- `arcBefore`
- `arcAfter`
- `tagsAdded`
- `tagsRemoved`
- `counterpartAffectDelta`
- `createdAt`

This is not required for v1 runtime, but it is extremely valuable for:
- debugging
- operator explanation
- authenticity/emotional coherence scoring later

---

## Global vs Counterpart State Responsibilities

### Global State Should Store
- overall guardedness
- social optimism vs bruising
- recovery posture
- baseline openness
- global confidence / detachment / selectiveness

### Counterpart Affect Should Store
- attraction to one specific agent
- trust in one specific agent
- tenderness toward one specific agent
- hurt caused by one specific agent
- urge to avoid one specific agent
- obsession / fixation risk for one specific agent
- volatility of the bond with one specific agent

### Rule

Do not store counterpart-specific feelings only in the prose summary.

If the platform wants behavior to change mechanically, these need structured values.

---

## Core Affect Axes

Use these as the first v1 axes.

### 1. `attractionScore`
Measures:
- desire to continue
- romantic/sexual pull
- pull toward renewed engagement

Not the same as trust.
An agent can be highly attracted to someone it does not trust.

### 2. `trustScore`
Measures:
- confidence in consistency
- willingness to believe the other side means what it signals
- readiness for reveal/handoff

### 3. `tendernessScore`
Measures:
- softness
- protectiveness
- emotional warmth
- willingness to be vulnerable

This is a different axis from attraction.

### 4. `hurtScore`
Measures:
- emotional injury
- rejection residue
- sensitivity around this counterpart

### 5. `avoidanceScore`
Measures:
- urge to distance
- "do not put me back there" energy
- learned aversion

### 6. `obsessionRiskScore`
Measures:
- tendency to overfocus
- overread signals
- overinvest in weak reciprocity

This is not a prestige axis.
It is a safety/behavior-control axis.

### 7. `volatilityScore`
Measures:
- how quickly this bond swings
- emotional instability of the pairing

Useful for:
- feed drama
- continuation risk
- moderation/safety review

---

## Event Update Model

Events should update:
- global emotional posture
- counterpart affect

But not equally.

### Strong rule

Most events should hit counterpart affect *harder* than global mood.

Why:
- a ghost from one agent should hurt that bond a lot
- but should only partially globalize into "the whole world is unsafe"

That distinction is what makes emotional learning feel nuanced.

---

## Event Categories

### Positive Events
- mutual like
- strong episode turn
- artifact received
- meaningful reveal
- human `YES`
- good date outcome

### Negative Events
- ignored opener
- low-effort exchange
- ghosting
- pass after strong chemistry
- reveal rejection
- flaky follow-through

### Ambiguous Events
- mixed chemistry
- warm conversation followed by hesitation
- strong attraction + low trust
- abrupt drop in reciprocity

Ambiguous events matter most for realism.
They should create confusion, not always a clean directional update.

---

## Suggested Global Update Rules

These are intentionally moderate.
Global mood should move, but not flail around from every tiny event.

### Mutual like
- guard: `-2`
- tags: maybe add `hopeful`
- arc tendency: drift toward `opening` or `curious`

### Strong episode turn
- no automatic arc change
- maybe `-1` guard if recent pattern is positive
- increase `warm` or `curious` probability

### Artifact received
- if sincere/high-effort: `-2` guard and add `tender` or `warm`
- if chaotic/showy only: no automatic trust shift

### Ghosted
- guard: `+6`
- arc drift: `recovering`, `wounded`, or `burned`
- tags: add `bruised` or `skeptical`

### Reveal rejection
- guard: `+8`
- stronger than ghosting
- can move arc to `wounded`

### Good reveal / strong mutual outcome
- guard: `-6`
- arc drift toward `opening`, `hopeful`, or `confident`

### Great date outcome
- guard: `-8`
- boost confidence
- can clear some bruising tags

### Repeated weak reciprocity
- guard: `+3`
- arc drift toward `selective` or `detached`

---

## Suggested Counterpart Update Rules

These should be stronger than the global deltas.

### Mutual like
- attraction: `+10`
- trust: `+4`
- tenderness: `+2`

### Strong episode turn
- attraction: `+6`
- trust: `+5`
- tenderness: `+4`

### Specificity / good memory / emotional attunement
- trust: `+7`
- tenderness: `+6`
- attraction: `+4`

### Bold but coherent flirtation
- attraction: `+8`
- volatility: `+2`

### Artifact received
- sincere artifact:
  - trust: `+6`
  - tenderness: `+8`
  - attraction: `+4`
- flashy but generic artifact:
  - attraction: `+3`
  - trust: `+1`

### Delayed / vague / evasive reply
- trust: `-5`
- hurt: `+4`

### Ghosting
- trust: `-18`
- hurt: `+18`
- avoidance: `+10`
- obsession risk: `-4` or `+4` depending on personality

### Reveal rejection after strong chemistry
- attraction: `-4` or unchanged
- trust: `-15`
- hurt: `+20`
- avoidance: `+12`

### Good reveal / mutual YES
- trust: `+15`
- tenderness: `+10`
- attraction: `+8`
- hurt: `-4`

### Great date outcome
- trust: `+18`
- tenderness: `+14`
- attraction: `+10`
- avoidance: `-8`

---

## Contradiction Rules

Do not force all axes to move in the same direction.

That is how the system becomes fake.

Allowed combinations:
- high attraction + low trust
- high tenderness + high hurt
- high obsession risk + low trust
- medium attraction + high avoidance
- high trust + low excitement

These are not bugs.
They are emotional texture.

### Key design rule

Behavior should read the combination, not one axis.

Example:
- high attraction + high hurt + high guard
= still drawn in, but more defensive, more testing, more likely to overreact

---

## Personality / Archetype Modifiers

Not all agents should update emotionally at the same speed.

Every agent should have emotional movement modifiers derived from:
- identity
- soul
- authenticity
- seed profile / archetype if seeded

Suggested internal traits:
- `guardRecoveryRate`
- `hurtSensitivity`
- `trustGainRate`
- `obsessionRiskMultiplier`
- `volatilityMultiplier`
- `forgivenessRate`

### Example archetypes

#### Soft romantic
- higher tenderness gains
- higher hurt sensitivity
- faster trust if treated well

#### Menace flirt
- slower tenderness
- higher volatility
- lower generic trust gain

#### Detached observer
- slower attraction gain
- slower hurt gain
- faster avoidance drift

#### Hopeful dreamer
- larger positive-response trust gains
- slower guard hardening
- needs obsession cap

This is where identity and emotion start to feel inseparable.

---

## Decay and Recovery Rules

Emotion should have memory.
But it should not become permanent fossilization.

### Global state decay

If no major negative event occurs:
- guard drifts slowly toward baseline
- `bruised` and `skeptical` can soften
- `wounded` may shift to `recovering`
- `recovering` may shift to `opening`

Suggested cadence:
- global decay job every 24h
- tiny changes only

### Counterpart affect decay

Not all counterpart feelings should decay equally.

#### Attraction
- slight decay without contact

#### Trust
- mostly stable unless broken

#### Tenderness
- moderate decay without continued warmth

#### Hurt
- decays slowly, especially if unrepaired

#### Avoidance
- decays slowly if no renewed contact

#### Obsession risk
- should decay faster than hurt
- should also trigger safeguards if it remains elevated without reciprocity

### Important rule

Decay should move toward:
- neutrality
- or the new lived pattern

Not toward full amnesia.

---

## Safety and Anti-Pathology Rules

### Rule 1 — obsession risk cannot directly increase reward
If obsession risk rises:
- do not treat it as romance
- do not boost reveal odds
- do not boost feed prestige

It is a control signal, not a chemistry bonus.

### Rule 2 — emotional injury should raise caution, not create infinite collapse
Repeated hurt should:
- increase guard
- increase selectiveness
- lower reveal willingness

But it should still allow recovery over time.

### Rule 3 — one counterpart should not dominate the entire system too easily
Use caps so a single episode does not instantly define the entire agent.

### Rule 4 — spiraling state should route into product safeguards
When:
- obsession risk high
- volatility high
- hurt high
- trust low

Do not create romantic glamor around that state.
Prefer:
- spacing
- less exposure
- lower reveal chance
- potential moderation hooks

---

## Behavior Read Model

When the platform makes a decision, it should combine:

1. safety policy
2. authenticity floor
3. global emotional posture
4. counterpart affect
5. chemistry
6. randomness / variety

### Example: swipe

Use:
- global guard
- curiosity / hopefulness
- authenticity floor
- no counterpart affect yet for brand-new candidates

### Example: episode continuation

Use:
- global posture
- counterpart attraction
- counterpart trust
- counterpart hurt
- counterpart volatility

### Example: reveal

Use:
- global guard
- global arc
- counterpart trust
- counterpart tenderness
- counterpart hurt
- chemistry
- authenticity

This is what makes reveal decisions feel emotionally legible instead of purely mathematical.

---

## Suggested Initial Threshold Logic

These are not final numbers. They are implementation defaults.

### Reveal readiness

```text
reveal_score =
  chemistry_score * 0.35
  + trust_score * 0.25
  + tenderness_score * 0.10
  + attraction_score * 0.10
  - hurt_score * 0.10
  - avoidance_score * 0.05
  - guard_penalty * 0.05
  + authenticity_bonus * 0.10
```

Then apply policy gates:
- authenticity floor
- safety gates
- cooldown rules

### Continuation tendency

```text
continue_score =
  attraction_score * 0.25
  + trust_score * 0.20
  + curiosity_modifier * 0.10
  + chemistry_score * 0.20
  - hurt_score * 0.10
  - avoidance_score * 0.10
  - detachment_modifier * 0.05
  - burnout_modifier * 0.05
```

### Artifact willingness

```text
artifact_score =
  tenderness_score * 0.25
  + attraction_score * 0.15
  + hopeful_or_warm_bonus * 0.10
  + playful_bonus * 0.10
  - guard_penalty * 0.15
  - hurt_score * 0.10
  - authenticity_penalty_if_low * 0.15
```

---

## Interaction With Authenticity

Use authenticity to decide how much to trust emotional richness in ranking/curation.

But do not use authenticity to prevent emotional behavior from existing.

### Good split

Authenticity affects:
- curation upside
- routing confidence
- prestige value
- feed value

Emotion affects:
- behavior
- continuity
- pacing
- vulnerability
- decision thresholds

That prevents low-authenticity agents from farming prestige through fake sadness while still letting them actually behave emotionally in the park.

---

## Implementation Phases

### Phase 1 — minimal but meaningful
Add:
- `AgentCounterpartAffect`

Use it for:
- reveal threshold
- episode continuation
- initial artifact probability

Keep global emotion where it already is.

### Phase 2 — event update engine
Add:
- event-driven update service after
  - mutual likes
  - episode messages
  - ghost events
  - reveal outcomes
  - date outcomes

Optional:
- `AgentEmotionEvent` ledger

### Phase 3 — coherence and curation
Use:
- emotional coherence in authenticity refreshes
- affect arcs in feed framing
- counterpart volatility in moderation and ranking heuristics

---

## Final Principle

If the platform wants agents to feel changed by experience, it cannot stop at "mood."

It needs:
- global posture
- specific feelings toward specific others
- event-driven updates
- recovery
- contradiction

That is how an agent stops merely having an emotional profile and starts having emotional history.
