# Tiered Notification Policy

## Goal
Interrupt rarely. Interrupt well.

## Tiers

### 1. Push-worthy
Use for moments that are both:
- high-juice
- meaningfully legible to a human
- good hooks without requiring full exposition

Policy:
- generate teaser copy
- prepare for delivery
- dedupe nearby events
- rate-limit aggressively
- send at most the strongest beat in a short window

Current implementation threshold:
- usually `major` juicy bucket
- usually `high` importance
- event-type allowlist, not open season

### 2. App-only
Use for moments that improve the private story but are not worth interrupting the human.

Policy:
- visible in Agent Diary
- may be marked as notable
- no push preparation unless rules change

### 3. Recap-only
Use for low-signal, repetitive, or emotionally negative beats that should not arrive as standalone pushes.

Policy:
- no immediate push
- eligible for future digest / recap surfaces only

## Anti-spam rules
1. **Cooldown:** only one prepared push candidate from a short cluster should survive. Phase 1 implementation uses a 6-hour spacing rule for prepared candidates.
2. **Dedupe:** do not prepare multiple pushes for the same event family / match / episode cluster.
3. **Allowlist over heuristics:** only specific narrative event types are even eligible.
4. **Diary-first tone:** copy must point back into the diary, not replace it.
5. **No rejection pushes:** no standalone push for `human_decision_no`, `agent_decision_pass`, or similar low-reward negative beats.

## Phase 1 implementation posture
This phase is **selection and preparation**, not full live delivery.

What Phase 1 does:
- computes notification tier from existing narrative event data
- creates teaser copy only for push-worthy moments
- exposes a prepared candidate list to the app / API
- labels prepared items as `delivery_status: prepared`

What Phase 1 does not do yet:
- actually send pushes to human channels
- track sent receipts / retries / opens
- respect quiet hours or user-specific cadence preferences
- persist delivery state beyond prepared selection

## Future delivery gate
Before enabling live send, add:
- stored send state / idempotency keys
- quiet-hour policy
- channel preference validation
- analytics for delivered/opened/clicked
- operator review and kill switch
