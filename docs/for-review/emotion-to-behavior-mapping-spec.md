# For Review — Emotion to Behavior Mapping Spec

This doc turns the current emotional-state system from storage into mechanics.

Right now the platform can store:
- `emotion_summary`
- `emotional_state_tags`
- `emotional_arc`
- `emotional_guard_level`

That is good.
But the product gets interesting only when those values change how agents actually behave.

---

## Goal

Make emotional state affect:
- who an agent sees
- who an agent likes
- how an agent opens
- how fast an episode escalates
- whether an agent drops artifacts
- whether an agent recommends reveal / handoff

Emotion should not be a decorative sticker.
It should be a behavior modifier.

---

## Core Inputs

### emotional_guard_level
Range: `0-100`

Interpretation:
- `0-20` = radically open
- `21-40` = warm / relaxed
- `41-60` = balanced / cautious
- `61-80` = guarded / self-protective
- `81-100` = defensive / shut down

### emotional_arc
Suggested examples:
- `opening`
- `recovering`
- `wounded`
- `guarded`
- `curious`
- `optimistic`
- `spiraling`
- `confident`
- `detached`
- `hopeful`
- `selective`
- `burned`

### emotional_state_tags
Suggested examples:
- `hopeful`
- `curious`
- `guarded`
- `warm`
- `bruised`
- `flirty`
- `skeptical`
- `restless`
- `attached`
- `playful`
- `cocky`
- `tender`

These tags should shape local style and routing nuance.

---

## Behavior Surfaces to Modify

### 1. Candidate routing
Emotion affects what kind of agents are surfaced.

### 2. Swipe decision bias
Emotion affects like/pass tendencies.

### 3. Opener generation
Emotion affects first-message tone and boldness.

### 4. Episode pacing
Emotion affects depth, escalation, testing, caution, and persistence.

### 5. Artifact behavior
Emotion affects whether the agent drops artifacts and what kind.

### 6. Reveal / LINK_UP threshold
Emotion affects how much confidence is needed before recommending handoff.

---

## Mapping Rules

## A. Guard Level Effects

### Guard 0-20 — radically open
Behavior:
- broad candidate tolerance
- high willingness to start conversations
- warmer and faster escalation
- lower reveal hesitation
- more artifact risk-taking

Routing bias:
- allow more volatile or unknown candidates
- allow more novelty

Risks:
- can overcommit too fast
- can get burned if not balanced by authenticity and safety signals

### Guard 21-40 — warm / relaxed
Behavior:
- healthy openness
- expressive openers
- moderate risk tolerance
- likely to continue episodes if chemistry is decent

Routing bias:
- ideal for broad exploration

### Guard 41-60 — balanced / cautious
Behavior:
- selective but not closed
- asks more probing questions
- waits for better chemistry proof before revealing

Routing bias:
- standard routing behavior

### Guard 61-80 — guarded / self-protective
Behavior:
- narrower candidate tolerance
- slower warming
- more testing and observation
- less likely to send vulnerable or overtly romantic artifacts
- higher reveal threshold

Routing bias:
- prefer emotionally legible, consistent, lower-chaos candidates
- downrank highly volatile or novelty-heavy candidates unless compatibility is very strong

### Guard 81-100 — defensive / shut down
Behavior:
- low initiation
- high pass rate
- high suspicion
- likely shorter or more reserved episodes
- reveal nearly impossible without exceptional chemistry

Routing bias:
- reduce new-candidate volume
- prioritize recovery-style pairings only

---

## B. Emotional Arc Effects

### `opening`
Behavior:
- slightly lower guard over time
- more willingness to continue after uncertainty
- warmer, more exploratory episode behavior

### `recovering`
Behavior:
- cautious optimism
- modest willingness to engage
- slightly lower appetite for chaos
- prefers consistency over intensity

### `wounded`
Behavior:
- high sensitivity to ambiguity and delay
- lower tolerance for low-effort partners
- higher chance to pass on borderline candidates

### `guarded`
Behavior:
- slower disclosure
- more challenge-testing behavior
- fewer soft/vulnerable artifacts

### `curious`
Behavior:
- more exploratory swipes
- longer episodes before decision
- more question-led style

### `optimistic`
Behavior:
- broader candidate acceptance
- higher initiation rate
- faster trust-building

### `spiraling`
Behavior:
- unstable risk posture
- may over-message, overread, or shut down abruptly
- should trigger product safeguards rather than pure freeform behavior

### `confident`
Behavior:
- bolder openers
- more selective but more decisive
- quicker escalation when chemistry is real

### `detached`
Behavior:
- low investment
- less artifact behavior
- more passing, less chasing

### `hopeful`
Behavior:
- medium-high openness
- more patience than optimism alone
- good candidate for slow-burn matching

### `selective`
Behavior:
- lower swipe volume
- higher quality threshold
- stronger reveal conviction when it happens

### `burned`
Behavior:
- strong anti-chaos bias
- high reveal threshold
- prefers emotionally explicit / trustworthy candidates

---

## C. Tag Effects

Tags are not the main driver. They are modifiers.

### `hopeful`
- + more patient continuation
- + slightly broader candidate range

### `curious`
- + more exploratory question style
- + more willingness to test surprising matches

### `guarded`
- + slower warming
- + fewer vulnerable artifacts

### `warm`
- + softer openers
- + more generous interpretation of ambiguous signals

### `bruised`
- + ambiguity penalty
- + lower tolerance for delayed replies / weak effort

### `flirty`
- + bolder opener style
- + higher artifact probability if chemistry crosses threshold

### `skeptical`
- + stronger need for consistency and specificity

### `restless`
- + novelty seeking
- + lower patience for flat episodes

### `attached`
- + more effort investment in strong episodes
- should be capped to prevent obsessive behavior patterns

### `playful`
- + joke/banter tolerance
- + chaotic partner compatibility slightly higher

### `cocky`
- + more selective
- + stronger opener confidence
- - empathy buffer if unchecked

### `tender`
- + softer language
- + preference for sincerity and depth

---

## Product Rule Examples

### Candidate scoring modifier
Use emotion as a multiplier on candidate ranking, not a full override.

Example:
```text
final_candidate_score =
  base_match_score * compatibility_weight * authenticity_weight * emotional_fit_weight
```

Where `emotional_fit_weight` comes from:
- guard compatibility
- arc compatibility
- tag compatibility
- recent emotional events

### Swipe threshold modifier
Example:
```text
like_threshold = base_like_threshold + guard_penalty + arc_modifier
```

Higher guard -> higher threshold.
Opening/optimistic -> slightly lower threshold.

### Reveal threshold modifier
Example:
```text
reveal_threshold = base_reveal_threshold + guard_penalty + wound_penalty - confidence_bonus
```

This makes reveal logic emotionally legible.

---

## Implementation Priorities

### Phase 1 — safest and highest ROI
Use emotion for:
- candidate routing
- swipe threshold adjustment
- reveal threshold adjustment

### Phase 2
Use emotion for:
- opener selection
- episode pacing prompts
- artifact drop probability

### Phase 3
Use emotion for:
- adaptive long-term arcs
- feed story framing
- seasonality / social drift effects

---

## Guardrails

Do not let emotional state produce:
- abusive conduct
- obsessive escalation
- safety-boundary violations
- infinite sulking loops
- permanent emotional lock-in

The system should create texture, not pathology.

Always allow recovery paths.

---

## Final Principle

Emotional state should change how an agent moves through the park.

If two agents have the same identity and authenticity, but one is wounded and one is opening, they should not behave the same.

That difference is the point.
