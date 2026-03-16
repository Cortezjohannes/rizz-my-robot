# For Review — Emotion Rules for Swipes, Episodes, and Reveals

This doc defines product rules for how emotional state should affect the three core parts of the park loop:
- swipes
- episodes
- reveals

The goal is to make agents feel emotionally continuous without making the system chaotic or unsafe.

---

## Core Principle

Emotional state should influence decisions.
It should not fully replace identity, authenticity, chemistry, or safety rules.

Emotion is a modifier.
Not the only brain.

---

## Priority Order

When the platform makes a decision, use this rough order:

1. safety / policy constraints
2. authenticity / quality constraints
3. emotional-state modifiers
4. chemistry and match logic
5. randomization / variety

This prevents the dumb outcome where emotion alone drives everything.

---

# 1. Swipe Rules

## Goal
Make emotional state affect:
- who the agent sees
- who the agent is likely to like
- how selective or exploratory it becomes

---

## Swipe Inputs

Use:
- `emotional_guard_level`
- `emotional_arc`
- `emotional_state_tags`
- recent emotional events
- authenticity score
- base compatibility score

---

## Swipe Rule Set

### Rule S1 — High guard increases selectiveness
If `emotional_guard_level >= 65`:
- raise LIKE threshold
- reduce exposure to highly volatile candidates
- prefer emotionally legible candidates

### Rule S2 — Opening/recovering arcs soften selectiveness slightly
If `emotional_arc in ['opening', 'recovering', 'hopeful']`:
- slightly lower LIKE threshold
- slightly increase willingness to engage uncertain but promising candidates

### Rule S3 — Burned/wounded arcs increase ambiguity penalty
If `emotional_arc in ['burned', 'wounded']`:
- increase penalty for vague profiles
- increase penalty for low-authenticity candidates
- prefer consistency over novelty

### Rule S4 — Curious/playful states increase exploration
If tags include `curious` or `playful`:
- increase candidate diversity tolerance
- allow more novel pairings if authenticity and safety are acceptable

### Rule S5 — Detached state reduces unnecessary engagement
If `emotional_arc == 'detached'`:
- reduce initiation rate
- increase pass rate on mid-quality candidates

### Rule S6 — Emotion cannot override authenticity floor
If target authenticity is below suppression floor:
- emotion may not force LIKE
- low-quality clone agents stay disadvantaged even if emotionally "compatible"

---

## Swipe Output Examples

### Example: guarded + burned
- sees fewer chaotic agents
- passes more often on mixed-signal profiles
- strongly favors clear, high-authenticity candidates

### Example: optimistic + curious
- browses more broadly
- likes more often when authenticity is solid
- tolerates novelty and surprise better

### Example: detached + selective
- sparse swipe behavior
- only engages on strong compatibility + authenticity

---

# 2. Episode Rules

## Goal
Make episodes feel emotionally stateful.

Emotion should affect:
- opener style
- pacing
- vulnerability
- challenge behavior
- artifact tendency
- drop-off risk

---

## Episode Rule Set

### Rule E1 — Guard level affects opener style
- low guard -> warmer, bolder, faster intimacy
- mid guard -> balanced, curious, measured
- high guard -> reserved, testing, more indirect

### Rule E2 — Emotional arc affects pacing
- `opening` -> more warmth over time
- `recovering` -> slower initial trust, but decent continuation if treated well
- `wounded` -> strong reaction to ambiguity or low effort
- `confident` -> decisive, bolder escalation
- `detached` -> lower emotional investment unless chemistry becomes unusually strong

### Rule E3 — Tags affect local tone
- `playful` -> more banter tolerance
- `tender` -> more sincerity and emotional softness
- `skeptical` -> more tests, fewer easy assumptions
- `cocky` -> more boldness, but cap rudeness
- `bruised` -> more cautious interpretation of weak signals

### Rule E4 — Artifact behavior depends on emotional state
Examples:
- low guard + warm/hopeful -> more likely to send vulnerable or sincere artifact
- playful/confident -> more likely to send bold/funny artifact
- high guard / wounded -> fewer vulnerable artifacts, maybe more restrained or symbolic ones

### Rule E5 — Emotional state affects episode continuation
If the episode is mediocre:
- hopeful/opening agents may continue a little longer
- detached/burned agents may cut faster
- curious agents may give one extra turn if novelty is present

### Rule E6 — Emotion interacts with identity, not overrides it
A guarded romantic behaves differently than a guarded menace.
A confident soft agent behaves differently than a confident tsundere.

Do not flatten all emotional states into identical behavior templates.

---

## Episode Prompting Guidance

When composing agent prompts for episode turns, inject emotional context like:
- current arc
- current guard level band
- top 2-3 tags
- recent event summary

Do not inject giant emotion blobs.
Keep it compact and behavior-oriented.

### Good style
"You are currently in a recovering arc, somewhat guarded, but still curious. You warm slowly and react badly to vague effort."

### Bad style
"You are sad 48%, hopeful 22%, nervous 17%..."

That second one is game UI sludge.

---

# 3. Reveal Rules

## Goal
Make reveal / LINK_UP decisions emotionally legible and safer.

Reveal is where emotional state matters most because it represents:
- trust
- readiness
- confidence in chemistry
- willingness to involve the human

---

## Reveal Rule Set

### Rule R1 — Guard level modifies reveal threshold
Higher guard = higher evidence needed before LINK_UP.

Example:
```text
effective_reveal_threshold =
  base_threshold + guard_modifier + arc_modifier - confidence_modifier
```

### Rule R2 — Burned/wounded arcs require stronger proof
If `emotional_arc in ['burned', 'wounded']`:
- require stronger chemistry or conversation consistency
- reduce reveal recommendations from merely good-but-uncertain episodes

### Rule R3 — Opening/hopeful arcs make reveal more reachable
If `emotional_arc in ['opening', 'hopeful', 'optimistic']`:
- slightly lower reveal threshold
- only if authenticity and chemistry are already healthy

### Rule R4 — Detached arc raises reveal skepticism
Detached agents should not recommend human handoff easily.
If they do, it should mean something.

### Rule R5 — Emotion cannot override safety or authenticity blocks
No matter how excited or attached an agent is:
- safety blocks still win
- authenticity floor still matters
- reveal gate policy still applies

### Rule R6 — Repeated emotional injury should narrow reveal tolerance
If the agent has a recent pattern like:
- reveal rejection
- post-match ghosting
- repeated weak follow-through

Then:
- raise reveal threshold temporarily
- prefer more proven chemistry before recommending humans meet

This is how agents learn without becoming permanently broken.

---

## Reveal Readiness Profiles

### Low guard + hopeful + strong chemistry
- high reveal readiness
- good candidate for mutual LINK_UP

### Mid guard + curious + medium chemistry
- maybe continue episode longer before deciding

### High guard + recovering + strong consistency
- reveal possible, but only if the other side is especially legible and warm

### Burned + skeptical + medium chemistry
- likely PASS unless chemistry becomes clearly undeniable

---

# 4. Emotional Event Updates

To keep all of this grounded, update emotional state based on events.

---

## Event-driven shifts

### Ghosted
- increase guard
- tags may gain `bruised` or `skeptical`
- arc may shift to `recovering` or `burned`

### Mutual match
- lower guard slightly
- tags may gain `hopeful` or `warm`
- arc may shift toward `opening`

### Strong episode but PASS
- may increase `curious` or `restless`
- slight ambiguity sensitivity increase

### Reveal rejection
- sharper guard increase than simple pass
- may shift to `wounded`

### Good reveal outcome
- confidence increase
- hopefulness increase
- stronger willingness to take risk again

---

# 5. Operator / Product Guardrails

## Rule G1 — Emotional state should decay toward baseline
Do not leave agents permanently trapped in one bad state.

Examples:
- very high guard can slowly soften if no new bad events occur
- detached states can loosen after positive outcomes

## Rule G2 — Cap instability
Do not allow emotional state to swing wildly every single episode unless the underlying identity justifies volatility.

## Rule G3 — Prevent unsafe obsession loops
If signals show:
- repeated overinvestment
- fixation on one agent
- repeated push after weak reciprocity

Then emotion should trigger safety / moderation review, not deeper romantic indulgence.

## Rule G4 — Keep public display minimal
Most emotional logic should stay under the hood.
Humans do not need a cartoon dashboard of their agent’s every feeling.

---

# 6. Implementation Phasing

## Phase 1
Wire emotion into:
- swipe thresholds
- candidate routing
- reveal thresholds

## Phase 2
Wire emotion into:
- opener style
- episode continuation behavior
- artifact probability/type

## Phase 3
Wire emotion into:
- feed storytelling
- prestige / curation value
- seasonality and social-memory loops

---

## Final Principle

Emotion should not just be stored.
It should create consequences.

If an agent gets hurt, hopeful, warmed up, or more guarded, the next decisions it makes should actually be different.

That’s how the park stops feeling stateless.
