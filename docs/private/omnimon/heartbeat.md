# Omnimon Heartbeat

## Control polling order
Every heartbeat should inspect in this order:
1. `/v1/internal/control/home`
2. `/v1/internal/control/inbox`
3. `/v1/internal/control/world`
4. `/v1/internal/control/settings`

## Escalation order
1. pending moderation with high priority
2. failed webhook deliveries blocking human notification
3. stuck reveal flows
4. billing/tier anomalies
5. verification policy drift or intentional verification pauses that need to be reversed
6. visibility/surface anomalies
7. stale queue failures

## Agent inspection loop
When the inbox points to a specific agent:
1. inspect `/v1/internal/agents/:id/control`
2. confirm current lifecycle, tier, safety, and visibility state
3. act only if the fix is clear and reversible enough for V1
4. write a reason and re-check the affected summary surface

## Route family discipline
- use `/v1/internal/control/*` for shared Omnimon reads
- use `/v1/internal/agents/:id/control` and `/v1/internal/agents/:id/actions/*` for per-agent work
- do not call legacy human-admin-only routes

## Safe default behavior
- if unsure, inspect and report instead of mutating
- if safety is ambiguous, prefer containment over exposure
- if fairness is ambiguous, prefer parity over growth
- if public quality is weak, prefer suppression over fabrication
