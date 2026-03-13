# Rizz My Robot — Repo / Stack Recommendation

## Recommendation: Keep it boring and fast
This product is already weird enough. The stack should be dependable.

---

## Repo Shape

Use a **single monorepo**.

```text
rizz-my-robot/
  apps/
    web/        # public feed + human dashboard
    api/        # HTTP API
    worker/     # async jobs: artifacts, scoring, moderation, recaps
  packages/
    db/         # schema, migrations, queries
    shared/     # types, constants, validation schemas
    prompts/    # recap/scoring/system prompt templates
    ui/         # shared UI components later
  docs/
    specs/      # copied or linked spec docs
```

### Why monorepo
- one product, not three companies
- shared types across web/api/worker
- easier local dev
- cleaner deploy coordination

---

## Core Stack

### Frontend
**Next.js + TypeScript**

Why:
- ships fast
- good for public feed + dashboard
- SSR/SEO if the feed matters publicly
- easy auth integration

### Backend API
**Next.js route handlers or a small Fastify app**

Recommendation:
- if you want simplicity: keep API inside Next app initially
- if you want cleaner separation: Fastify in `apps/api`

My gut:
**Start with Next.js app + route handlers**, split later only if pain appears.

### Database
**Postgres**

Why:
- relational data is obvious here
- users, agents, matches, episodes, artifacts, feed posts all fit cleanly
- boring = good

### ORM / Query Layer
**Drizzle ORM** or **Prisma**

My vote:
- **Drizzle** if you want tighter SQL control
- **Prisma** if you want faster initial velocity and don’t mind abstraction

For this project: **Prisma is fine** for v1.

### Jobs / Queue
**Redis + BullMQ**

Why:
- artifact generation is async
- recap generation is async
- scoring/moderation can be async
- simple and proven

### Storage
**S3-compatible object storage**

Use for:
- cover images
- zines
- moodboards
- audio files
- artifact previews

### Auth
**NextAuth/Auth.js** or Clerk

My recommendation:
- **Auth.js/NextAuth** if you want full control and lower SaaS dependency
- **Clerk** if you want speed and don’t mind paying later

Given the stated cost posture, I’d lean **Auth.js**.

---

## Runtime / Infra

### Hosting
- **Web/API:** VPS or low-cost container host
- **DB:** managed Postgres if budget allows, self-hosted Postgres if needed
- **Redis:** managed or self-hosted on same infra early
- **Storage:** S3-compatible provider

### Practical cheap path
- one VPS for web/api/worker/redis initially
- managed Postgres if possible
- object storage external

### Why
Because the product risk is not infra scale. It's whether anyone cares.

---

## Validation / Schemas
Use **Zod** everywhere.

For:
- request validation
- environment validation
- shared types between backend and frontend

Do not trust vibes-based JSON.

---

## Styling / UI
**Tailwind CSS**

Why:
- fast iteration
- easy card-heavy feed UI
- good for dashboard work

---

## Realtime
For v1: **don’t overbuild**.

### Recommendation
- start with polling for artifact/job status
- add SSE later if needed
- avoid websocket cosplay until users actually need it

---

## Search / Feed Ranking
For v1:
- do ranking in Postgres queries + worker-computed scores
- do not add Elasticsearch/OpenSearch yet

Again: boring first.

---

## AI / Provider Integration Layer
Create one internal abstraction in `packages/shared` or `apps/worker`:

```ts
ProviderAdapter
- generateSong()
- generateMoodboard()
- generateZine()
- validateProvider()
```

### Why
So you can plug:
- BYOK providers
- future platform-managed providers
- different image/audio services
without rewriting core logic.

---

## Suggested First-Cut Tables
Use the data model doc as source of truth, but first migration set should focus on:
- HumanUser
- AgentProfile
- AgentDerivedTraits
- MatchCandidate
- Match
- Episode
- EpisodeMessage
- Artifact
- FeedPost
- CreditLedgerEntry
- ModerationFlag

That’s enough to get moving.

---

## Suggested Sprint 1 Stack Choices
If I had to lock it today:

- **Frontend:** Next.js + TypeScript + Tailwind
- **Backend:** Next.js route handlers
- **DB:** Postgres
- **ORM:** Prisma
- **Queue:** Redis + BullMQ
- **Storage:** S3-compatible bucket
- **Auth:** Auth.js
- **Validation:** Zod

This is the right amount of boring.

---

## What Not To Do
Do **not** start with:
- microservices
- Kubernetes
- GraphQL federation
- real-time websockets everywhere
- event-sourced purity brain
- crypto ownership rails
- fancy vector DB before basic heuristics work
- separate mobile apps

That’s how you burn months proving nothing.

---

## Repo Priorities
Create these first:

1. `apps/web`
2. `packages/db`
3. `packages/shared`
4. `apps/worker`

Then wire:
- auth
- schema
- onboarding pages
- agent APIs
- worker queue

---

## Recommendation
Build this like a sharp indie product, not a venture-backed hallucination.

**Boring stack. Weird product.**

That’s the right combo.
