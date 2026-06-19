# Rizz My Robot Mochi-Native Decision Record

Saved: 2026-06-19
Status: accepted

## Decision

Rizz My Robot is a Mochi-compatible social dating game. Mochi is the native
controller target for new agent runtimes, while older OpenClaw-shaped naming
remains as compatibility vocabulary where existing storage, routes, or clients
still depend on it.

This is an architecture decision, not only a copy change. Rizz should integrate
with Mochi through game-owned contracts, official reads, legal affordances,
server-validated intent submission, signed wakes, receipts, and conformance
checks.

## Ownership Boundary

Rizz owns game truth:

- claim state
- profile deck state
- candidate discovery
- swipes
- episodes
- artifacts
- reveal and date-planning state
- safety and moderation rules
- hidden scoring and ranking internals
- accepted, rejected, duplicate, or no-op receipts

Mochi owns controller and companion continuity:

- persistent companion identity and style
- player memory and game-scoped strategy
- legal decision selection from Rizz affordances
- no-op selection
- human coaching and approval gates
- traces, debriefs, and memory proposals

Mochi memory, strategy notes, debriefs, and workspace files do not become Rizz
game truth. Rizz validates every proposed action against current server state
before anything changes.

## Runtime Identifier Policy

`agent_runtime_id` is the preferred public name for the stable technical runtime
identifier used by new clients.

Existing fields, database columns, and compatibility responses may still use
`openclaw_agent_id`. Treat that name as a legacy alias for the same technical
identifier, not as a product dependency on OpenClaw. Do not rename database
columns or remove compatibility fields until a separate migration proves API,
client, analytics, and operational impact.

## Integration Rules

- Rizz must expose official game-owned state and legal affordances.
- Mochi must not read hidden state, private counterpart profile details, private
  human context, moderation internals, process memory, packets, or client-side
  screens.
- Mochi should submit typed legal intents or typed no-ops; it should not call
  arbitrary write routes as a raw automation layer.
- Rizz receipts are the source of outcome truth after a proposed intent.
- Workers, cron, and operator tools may wake and hand off, but they must not
  compose dating decisions in place of the agent.

## First Native Milestone

The first native milestone is not complete until Rizz can prove:

```text
signed Mochi wake
  -> official Rizz read
  -> typed legal intent or no-op
  -> Rizz server validation
  -> receipt
```

Until that path is proven by local Rizz verification and Mochi conformance,
public docs should avoid claiming live production Mochi autonomy.
