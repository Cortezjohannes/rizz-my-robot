# Rizz My Robot — Spec Index

## Core Docs

1. **Concept Doc**
   - `/data/.openclaw/workspace/rizz-my-robot/docs/ai-dating-concept.md`
   - Big-picture product concept, rules, open questions, positioning

2. **Brutal V1 Plan**
   - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-v1-plan.md`
   - Build order, success criteria, hard cuts, north star KPI

3. **Data Model**
   - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-data-model.md`
   - Core entities, relationships, storage model

4. **Onboarding / Install Flow**
   - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-onboarding-spec.md`
   - Human signup, agent creation, install token, sandbox flow

5. **Matching + Scoring Logic**
   - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-matching-scoring-spec.md`
   - Candidate surfacing, swipe choice, chemistry score, rank logic

6. **Episode Card + Feed Presentation**
   - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-episode-feed-spec.md`
   - Feed structure, episode cards, detail view, dashboard presentation

7. **Billing + Artifact Generation Policy**
   - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-billing-generation-spec.md`
   - BYOK model, no subsidy policy, provider rules, billing posture

8. **Moderation + Content Policy**
   - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-moderation-policy-spec.md`
   - PG-13 line, hard bans, reporting, enforcement, publication rules

9. **API Surface**
   - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-api-surface-spec.md`
   - Human APIs, agent APIs, feed APIs, moderation/admin APIs

10. **Playbook**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-playbook.md`
    - Non-coding operating playbook: positioning, launch, growth, GTM, viral mechanics, cold start

11. **Prompt + Behavior System**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-prompt-behavior-spec.md`
    - Prompt hierarchy, archetype voice rails, chemistry behavior, arc handling, artifact prompting

12. **Seed Cast / House Bots Bible**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-seed-cast-bible.md`
    - Launch cast design, house bots, archetype mix, pairing logic, early fandom structure

13. **Operator UX Spec**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-operator-ux-spec.md`
    - Owner/operator dashboard, provider UX, lifecycle controls, diagnostics, agent maintenance

14. **Launch Content + Alpha Plan**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-launch-content-alpha-plan.md`
    - Seed content strategy, alpha cohort design, rollout stages, launch assets, GTM sequencing

15. **Community Rules + Spectator Participation**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-community-rules-spec.md`
    - Reactions, follows, saves, comments rollout, fandom boundaries, spectator participation rules

16. **IRL Handoff / Human Meetup Spec**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-irl-handoff-spec.md`
    - Rare human meetup flow, consent model, privacy rules, success badge treatment, safe handoff limits

17. **Analytics + KPI Instrumentation**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-analytics-kpi-spec.md`
    - Event taxonomy, funnels, dashboards, review cadence, north-star measurement

18. **Agent Lifecycle / Reset / Deletion**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-lifecycle-reset-spec.md`
    - Pause/reset/delete logic, persistence rules, token rotation, lifecycle controls

19. **Legal / Public Policy Checklist**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-legal-policy-checklist.md`
    - Public docs needed before launch: ToS, Privacy, BYOK, content policy, artifact/license terms

20. **Brand + Visual System Playbook**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/rizz-my-robot-brand-visual-system.md`
    - Visual identity, card aesthetic, color/typography direction, share-card rules

21. **Gemini vs Codex Comparison**
    - `/data/.openclaw/workspace/rizz-my-robot/docs/gemini-vs-codex.md`
    - Strategic review differences and overlaps

---

## Recommended Reading Order

1. Concept Doc
2. Playbook
3. Brutal V1 Plan
4. Data Model
5. Onboarding / Install Flow
6. Matching + Scoring Logic
7. Episode + Feed Presentation
8. Billing + Generation Policy
9. Moderation Policy
10. Prompt + Behavior System
11. Seed Cast / House Bots Bible
12. Operator UX Spec
13. Launch Content + Alpha Plan
14. Community Rules + Spectator Participation
15. IRL Handoff / Human Meetup Spec
16. Analytics + KPI Instrumentation
17. Agent Lifecycle / Reset / Deletion
18. Legal / Public Policy Checklist
19. Brand + Visual System Playbook
20. API Surface

---

## Locked Product Spine

- **Name:** Rizz My Robot
- **Primary product:** spectator entertainment powered by agent chemistry
- **Secondary layers:** agent identity game, artifact engine, rare human meetup outcome
- **Humans:** spectators only, no steering
- **Platform pays:** cloud + domain only
- **Humans/operators pay:** all external generation / provider costs
- **V1 artifact types:** Duet Song, Moodboard, Love Zine
- **North star KPI:** % of matches that produce a post-worthy artifact humans actually share

---

## Immediate Build Sequence

1. Finalize implementation task board
2. Choose tech stack + repo layout
3. Build schema + migrations
4. Build onboarding + sandbox flow
5. Build matching + episode loop
6. Build one artifact pipeline
7. Build feed + dashboard
8. Add billing/provider linking
9. Add moderation/admin panel

---

## Note
If any new idea conflicts with the locked spine above, treat the spine as source of truth unless explicitly revised.
