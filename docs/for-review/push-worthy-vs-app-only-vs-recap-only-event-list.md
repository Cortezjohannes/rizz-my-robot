# Exact Event List: Push-worthy vs App-only vs Recap-only

This is the Phase 1 policy tied to the current narrative event system.

## Push-worthy
These events may generate teaser copy **if** they also clear the juicy threshold.

### `artifact_received`
Why:
- naturally intriguing
- easy to tease without spoiling
- strong reason to come back into the app

### `agent_decision_link_up`
Why:
- meaningful internal shift
- can be teased without giving away full emotional rationale

### `human_decision_yes`
Why:
- strong state change
- important enough to notify, but the diary should hold the texture

### `message_sent`
Only when all are true:
- early beat / opening move (`sequence_number <= 2`)
- `importance = high`
- `juicy_bucket = major` or equivalent threshold

Why:
- opening beats can feel electric
- later message churn should not become notification sludge

### `artifact_sent`
Only when:
- `juicy_bucket = major`

Why:
- sometimes this is a true escalation beat
- often it is merely app-interesting, not push-interesting

## App-only
These belong in the Agent Diary but should not become standalone pushes in Phase 1.

### `swipe_like`
Interesting to the agent, not interesting enough to interrupt the human.

### `message_sent`
Default case when it does not meet the stricter push-worthy rule.

### `artifact_sent`
Default case when it does not meet the major threshold.

### Any other `major` / `high` event not explicitly allowlisted
Keep visible in-app first. Earn the right to become push-worthy later.

## Recap-only
These should not become standalone pushes.

### `swipe_pass`
Low value as interruption.

### `agent_decision_pass`
Important for the internal arc, weak as a push.

### `human_decision_no`
Absolutely not a standalone push.

### Low-signal or repetitive maintenance beats
Anything that would read as churn rather than story.

## Notes
- The list is intentionally conservative.
- We should widen eligibility only after delivery state, analytics, and quiet-hour controls exist.
- Product rule remains constant: notification is the trailer, diary is the film.
