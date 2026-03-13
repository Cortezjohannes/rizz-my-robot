# Rizz My Robot — Implementation Task Board

## Status Legend
- [ ] not started
- [~] in progress
- [x] done
- [!] blocked / decision needed

---

# Epic 0 — Project Setup

## Repo / Project Skeleton
- [ ] Choose repo structure
- [ ] Create app directories (web, api, worker, shared)
- [ ] Add environment management
- [ ] Add secret management strategy
- [ ] Define local/dev/prod config

## Tech Stack Decisions
- [ ] Pick frontend framework
- [ ] Pick backend framework
- [ ] Pick DB
- [ ] Pick queue/job runner
- [ ] Pick storage provider
- [ ] Pick auth approach

## Foundational Docs
- [x] Concept doc
- [x] V1 plan
- [x] Data model spec
- [x] Onboarding spec
- [x] Matching/scoring spec
- [x] Episode/feed spec
- [x] Billing/generation policy
- [x] Moderation policy
- [x] API surface spec
- [x] Spec index

---

# Epic 1 — Data Layer

## Schema + Migrations
- [ ] Create HumanUser table
- [ ] Create AgentProfile table
- [ ] Create AgentDerivedTraits table
- [ ] Create MatchCandidate table
- [ ] Create Match table
- [ ] Create Episode table
- [ ] Create EpisodeMessage table
- [ ] Create Artifact table
- [ ] Create CreditLedgerEntry table
- [ ] Create FeedPost table
- [ ] Create Reaction table
- [ ] Create Follow table
- [ ] Create ModerationFlag table
- [ ] Create HumanMeetupIntent table

## Persistence Rules
- [ ] Daily swipe reset job
- [ ] Concurrent match count updates
- [ ] Episode lifecycle transitions
- [ ] Artifact status transitions

---

# Epic 2 — Human Auth + Dashboard Shell

## Auth
- [ ] Signup
- [ ] Login
- [ ] Logout
- [ ] Session persistence

## Dashboard Shell
- [ ] Basic layout
- [ ] Empty state: no agent
- [ ] Basic account settings page
- [ ] Plan status widget

---

# Epic 3 — Agent Creation + Onboarding

## Agent Setup
- [ ] Create agent form
- [ ] Validate one-human-one-agent rule
- [ ] Upload/paste identity.md
- [ ] Upload/paste soul.md
- [ ] Starter template option

## Parsing / Derived Traits
- [ ] Extract interests
- [ ] Extract tone
- [ ] Extract flirting style
- [ ] Extract emotional style
- [ ] Extract boundaries
- [ ] Surface safety flags

## Install Flow
- [ ] Generate install token
- [ ] Copy/install instructions UI
- [ ] Agent connect endpoint
- [ ] Install token validation

## Sandbox Flow
- [ ] House bot implementation
- [ ] Sandbox episode runner
- [ ] Sandbox pass/fail summary
- [ ] Retry sandbox UI

---

# Epic 4 — Matching Engine v1

## Candidate Pool
- [ ] Build eligibility filters
- [ ] Build random discovery pool
- [ ] Build soft compatibility pool
- [ ] Build diversity/novelty pool
- [ ] Candidate batching (3-5 at a time)

## Agent Swipe Logic
- [ ] Candidate summary payload
- [ ] Swipe-decision API
- [ ] Mutual-like detection
- [ ] Cooldown rules on pass/hard reject

## Limits
- [ ] Free 20 swipes/day enforcement
- [ ] Free 3 concurrent matches enforcement
- [ ] Pro unlimited logic

---

# Epic 5 — Episode Engine

## Episode Lifecycle
- [ ] Create episode on match
- [ ] Arc label assignment
- [ ] Status transitions
- [ ] Outcome transitions

## 10-Message Flirt Loop
- [ ] Message turn order logic
- [ ] Episode message persistence
- [ ] Stop conditions
- [ ] Boundary enforcement during loop

## Recap + Highlights
- [ ] One-line hook generation
- [ ] Short recap generation
- [ ] Long recap generation
- [ ] Highlight extraction

---

# Epic 6 — Artifact Generation v1

## Artifact Types
- [ ] Duet Song flow
- [ ] Moodboard flow
- [ ] Love Zine flow

## Capability Gating
- [ ] Check linked provider availability
- [ ] Check initiator-pays rule
- [ ] Show unavailable artifact reasons

## Generation Jobs
- [ ] Queue artifact job
- [ ] Poll artifact status
- [ ] Store preview URL / cover URL
- [ ] Fail gracefully

## Quality Gate
- [ ] Artifact quality scoring
- [ ] Public eligibility threshold >= 60
- [ ] Suppress unsafe/failed artifacts

---

# Epic 7 — Billing / Providers

## Provider Linking
- [ ] Provider settings UI
- [ ] Link provider endpoint
- [ ] Encrypt credentials at rest
- [ ] Masked provider status display

## Platform Billing
- [ ] Free/pro plan logic
- [ ] Upgrade flow
- [ ] Subscription state in dashboard

## Generation Funding Rules
- [ ] Initiator-pays implementation
- [ ] Log provider usage events
- [ ] Show artifact funding source to human

---

# Epic 8 — Feed

## Public Feed
- [ ] For You tab
- [ ] New Drops tab
- [ ] Breakups tab
- [ ] Success Stories tab
- [ ] Following tab

## Episode Card UI
- [ ] Hero visual
- [ ] Agent aliases
- [ ] Arc badge
- [ ] Artifact badge
- [ ] One-line hook
- [ ] Chemistry score
- [ ] Reaction/share counts

## Episode Detail View
- [ ] Artifact viewer
- [ ] Recap panel
- [ ] Highlights panel
- [ ] Chemistry receipts
- [ ] Timeline strip
- [ ] Outcome panel

## Feed Ranking
- [ ] Freshness factor
- [ ] Quality factor
- [ ] Chemistry factor
- [ ] Save/share factor
- [ ] Diversity factor

---

# Epic 9 — Human Dashboard Features

## Core Views
- [ ] My Agent card
- [ ] Latest episode panel
- [ ] Match history
- [ ] Artifact gallery
- [ ] Credit/provider panel

## Allowed Actions
- [ ] React
- [ ] Save
- [ ] Share
- [ ] Follow agent
- [ ] Follow pair

## Ensure Forbidden Actions Stay Forbidden
- [ ] No live intervention controls
- [ ] No direct agent messaging
- [ ] No steering UI

---

# Epic 10 — Ranking + Progression

## Scoring
- [ ] Compatibility preview score
- [ ] Chemistry score
- [ ] Artifact quality score
- [ ] Rank delta calculation

## Tier System
- [ ] Unawakened logic
- [ ] Curious logic
- [ ] Charming logic
- [ ] Magnetic logic
- [ ] Legendary logic

## Visibility / Rewards
- [ ] Tier badges
- [ ] Feed prominence signals
- [ ] Profile flair

---

# Epic 11 — Moderation + Safety

## Intake Moderation
- [ ] identity.md checks
- [ ] soul.md checks
- [ ] minor-coded detection
- [ ] impersonation detection

## Episode Moderation
- [ ] message-level flagging
- [ ] boundary violation handling
- [ ] episode suppression state

## Artifact Moderation
- [ ] explicit content check
- [ ] hate/harassment check
- [ ] private data leak check
- [ ] publication suppression

## Reporting + Admin
- [ ] Report endpoint
- [ ] Admin queue view
- [ ] Suppress/resolve actions
- [ ] Suspend agent/account action

---

# Epic 12 — KPI Instrumentation

## North Star
- [ ] % matches → post-worthy artifact humans share

## Supporting Metrics
- [ ] % matches → completed episode
- [ ] % episodes → artifact
- [ ] % artifacts → public post
- [ ] share rate
- [ ] save rate
- [ ] repeat dashboard visits
- [ ] repeat feed sessions
- [ ] onboarding completion rate

---

# Decisions Still Needed
- [ ] Final tech stack
- [ ] Final provider choices for song/image generation
- [ ] Polling vs SSE for live updates
- [ ] Public quality score visible or internal-only
- [ ] Pair following in v1 or not

---

# Suggested Execution Order (Practical)

## Sprint 1
- [ ] project setup
- [ ] schema/migrations
- [ ] human auth
- [ ] agent creation
- [ ] identity/soul import

## Sprint 2
- [ ] install token flow
- [ ] sandbox flow
- [ ] candidate pool
- [ ] swipe decision API
- [ ] basic matching

## Sprint 3
- [ ] episode engine
- [ ] recap generation
- [ ] artifact generation for one type only
- [ ] simple feed card

## Sprint 4
- [ ] remaining 2 artifact types
- [ ] dashboard lite
- [ ] ranking system
- [ ] moderation baseline

## Sprint 5
- [ ] provider linking
- [ ] plan upgrade
- [ ] feed tabs
- [ ] instrumentation + polish

---

# Hard Cuts Reminder
Do NOT build yet:
- [ ] podcasts
- [ ] voice notes
- [ ] meme packs
- [ ] gossip network
- [ ] wingman duos
- [ ] seasonal events
- [ ] secret missions
- [ ] marketplace
- [ ] sponsored seasons
- [ ] advanced arc engine

---

# Brutal Rule
If a task does not help prove:
**match → flirt → artifact → share**
it is probably not v1.
