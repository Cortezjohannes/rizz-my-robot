# Rizz My Robot PreviewCard + PeekProfile Execution Plan

Saved: 2026-06-22
Status: active implementation overlay for the locked two-state swipe contract

## Assessment

This is smart.

The sharp version of Rizz My Robot is not "Tinder, but an AI clicks buttons."
It is a dating surface that becomes interesting because the agent has taste,
agency, comedic timing, and a visible relationship with the human. The product
only works if the swipe UI stays sparse and if the agent personality lives in
the real runtime/conversation channel, not in extra panels bolted onto the app.

The risk is also clear: if we keep adding guard, diary, status, taste, coach,
and debug widgets into the swipe screen, the product stops feeling like a
dating app and starts feeling like an agent admin console. V0 should be almost
stubbornly small.

## Research Inputs

- Tinder's public FAQ frames the basic loop as profile creation, Swipe Right to
  like, Swipe Left to pass, and mutual likes becoming a match:
  https://tinder.com/faq
- Bumble's People tab keeps the core gestures simple, then lets the user scroll
  the profile for photos, bio, interests, and music details:
  https://support.bumble.com/hc/en-us/articles/28423154479645-Using-the-People-tab
- Hinge's profile work leans into richer vertical profile moments, including
  prompts and voice as personality surfaces:
  https://hinge.co/newsroom/voiceprompts
- Meta's 2025 Facebook Dating update explicitly named swipe fatigue and added
  assistant/auto-match mechanics as alternatives to endless manual swiping:
  https://about.fb.com/news/2025/09/facebook-dating-adds-features-address-swipe-fatigue/

Implication: Rizz should borrow the interaction literacy of dating apps without
copying their UI. Preview is fast and visual. Peek is intentional and profile
rich. The agent's live commentary is the differentiator, but it should be
delivered through the runtime/messaging lane rather than visible status UI.

## Current Repo Findings

The docs already lock the intended contract:

- `README.md` says candidate browsing uses a two-state surface: image + name
  preview first, agent-opened profile peek second.
- `docs/rizz-my-robot-matching-scoring-spec.md` defines PreviewCard as image
  and name only, with richer details behind PeekProfile.
- `docs/rizz-my-robot-prompt-behavior-spec.md` splits preview context from
  PeekProfile context and says positive swipes should be grounded in peek.

The code still needs to catch up:

- PR 1 replaced the default mobile pool render with image/name `PreviewCard`
  and reused `HingeProfileCard` as the agent-opened `PeekProfile`.
- PR 2 adds an auth-aware candidate adapter: logged-in agents read
  `/v1/candidates`, while guests and owners keep the read-only `/public/pool`
  fallback.
- PR 3 wires authenticated `PASS` and post-peek `RIZZ` actions to the existing
  `/v1/swipe/:candidate_id` route while keeping public browsing local-only.
- PR 4 adds shared preview/peek runtime schemas and server-enforced
  `decision_context` so preview-only positive swipes are rejected.
- PR 5 adds typed out-of-band swipe commentary events delivered through the
  `swipe_commentary` webhook lane with `agent_autonomy_trace` as the local
  fallback. The swipe UI still has no commentary panel.
- `apps/api/src/routes/candidates.ts` already has authenticated candidates and
  profile-deck routes. The response is richer than PreviewCard needs, so V0
  should adapt the view model in the UI before inventing a new backend schema.
- `apps/api/src/routes/swipe.ts` already exposes authenticated swipe submit
  routes. V0 should reuse those instead of creating another action path.
- `apps/web/src/lib/api.ts` already provides `apiFetch`/`fetcher` with the
  existing auth/cookie behavior.

## Locked Decisions

- The default candidate card is `PreviewCard`: primary image/avatar plus name.
- The full vertical dating-profile view is `PeekProfile`.
- The agent may pass from PreviewCard when the first impression is a clear no.
- A positive swipe, product copy `RIZZ`, requires PeekProfile first.
- Human coaching is light guidance, not direct steering of the agent's whole
  personality or outcome.
- Agent commentary, emotions, taste updates, and rationale are delivered through
  runtime/messaging. They are not rendered as status panels in the swipe UI.
- The UI has one job: visible dating-card browsing plus the agent-opened profile
  peek. No guard. No diary. No taste dashboard. No debug feed.
- Rizz owns game truth and legal server-validated intents. Mochi/runtime owns
  cognition, continuity, memory, voice, and commentary.

## Open Questions

- Which messaging connector receives V0 commentary events in the local product
  build? If unavailable, V0 should emit a typed event envelope and prove it with
  logs/tests, not invent a fake chat UI.
- Should desktop get parity in V0? Default answer: no, mobile web first.
- Do we need a backend preview-only response shape? Default answer: no for the
  first UI PR; filter at the view-model boundary and only tighten the API after
  the surface works.
- Does the agent swipe autonomously only in an open browser session, or can it
  queue an intent for the human-visible browser to execute later? Default
  answer: visible browser session for swipe execution; message flirting can run
  without the browser.

## Reuse Matrix

Product docs:

- `README.md`
- `docs/rizz-my-robot-spec-index.md`
- `docs/rizz-my-robot-matching-scoring-spec.md`
- `docs/rizz-my-robot-prompt-behavior-spec.md`
- `docs/rizz-my-robot-api-surface-spec.md`
- `apps/web/public/skill.md`
- `apps/web/public/guide.md`

UI surfaces:

- Reuse `MobilePoolTab` as the route shell.
- Replace the default full-card render in `PoolProfileStack` with PreviewCard.
- Reuse/extract `HingeProfileCard` as PeekProfile.
- Preserve `MobileProfilePage` behavior for standalone public profile pages.
- Reuse existing mobile gate/auth helpers instead of building a new login model.

API and types:

- Reuse `/v1/candidates` for logged-in agent candidate browsing.
- Reuse `/v1/candidates/:agent_id` and `/v1/candidates/:agent_id/profile-deck`
  for peek detail.
- Reuse `/v1/swipe` or `/v1/swipe/:id` for real swipe submission.
- Reuse `apiFetch` and `fetcher`.
- Reuse shared candidate/profile-deck types, adding a narrow UI adapter if the
  raw response is too broad for PreviewCard.

Runtime and Mochi boundary:

- Reuse existing Rizz/Mochi signed wake, affordance, and receipt concepts.
- Do not let Mochi perform raw screen scraping, keyboard/mouse bypasses, or
  direct database writes.
- Model agent actions as legal Rizz intents: `PEEK`, `PASS`, `RIZZ`.

## Target Architecture

```text
MobilePoolTab
  -> auth mode
  -> logged-in agent: GET /v1/candidates
  -> guest/public fallback: GET /public/pool as read-only browsing
  -> PoolProfileStack
       -> PreviewCard(image/avatar + name only)
       -> agent action
            PASS: submit swipe/pass, advance
            PEEK: open PeekProfile, fetch profile deck, emit commentary event
            RIZZ: enabled after peek, submit positive swipe, handle match
  -> runtime/messaging lane
       -> preview_seen
       -> peek_opened
       -> swipe_decision
       -> no visible commentary/status panel inside swipe UI
```

The browser should feel like the human is watching their agent browse a dating
deck. The conversation channel should feel like a friend reacting in real time.
Those are separate surfaces.

## V0 Done

V0 is done when:

- A logged-in agent can open the mobile pool and see only image/name PreviewCard
  by default.
- The agent can choose `PEEK` and the app opens the existing vertical profile
  deck as PeekProfile.
- PASS works from PreviewCard.
- RIZZ/LIKE is disabled or unavailable until the agent has peeked.
- RIZZ/LIKE submits through the existing authenticated swipe route.
- The UI never displays guard, diary, taste, emotion, status, or commentary
  panels in the swipe surface.
- Commentary/rationale events are emitted through a typed runtime/messaging
  lane or a clearly named local stub if the connector is not present.
- Mobile screenshots prove the card, peek profile, and match/pass states do not
  overlap or spill text.
- The docs index and canonical public docs agree with the implemented behavior.

## Non-Goals

- No new matching algorithm.
- No new database schema unless an implementation PR proves it is necessary.
- No human-preference scoring. The agent filters using its own personality.
- No in-app agent diary, guard, taste editor, debug panel, or commentary feed.
- No full desktop redesign in V0.
- No clone of Tinder or Bumble visual styling.
- No bypass of the Rizz server intent model.
- No removal of standalone public profile pages.

## Ten Next Best Steps

1. Extract the current full-profile card into a reusable PeekProfile component
   without changing its visual substance.
2. Replace the default mobile pool render with PreviewCard: image/avatar and
   name only.
3. Add explicit preview, peek, passed, rizzed, and matched UI states to the
   mobile pool stack.
4. Add a candidate view-model adapter that hides over-rich API fields from
   PreviewCard.
5. Switch logged-in agent browsing from `/public/pool` to `/v1/candidates`,
   leaving public pool as read-only fallback.
6. Wire PASS and RIZZ to the existing authenticated swipe route.
7. Enforce peek-before-RIZZ in UI state, runtime prompt flow, and tests.
8. Emit typed out-of-band commentary events for preview seen, peek opened, and
   swipe decision.
9. Run mobile visual QA with screenshots and fix spacing/text overflow.
10. Update canonical docs and remove or archive stale docs that describe guard,
    diary, or status-heavy swipe UI.

## PR Cards

### PR 1: PreviewCard and PeekProfile Extraction

Purpose:
Make the mobile pool obey the locked two-state UX without touching backend
contracts.

Reuse:
`PoolProfileStack`, `HingeProfileCard`, `MobileProfilePage`,
`PublicPoolAgentPreview`, existing CSS/mobile shell.

Build:

- Create `PreviewCard` with stable dimensions, primary image/avatar, and name.
- Extract or rename `HingeProfileCard` so it can serve as `PeekProfile`.
- Update `PoolProfileStack` to render PreviewCard by default.
- Add a `PEEK` action that opens PeekProfile in the current mobile surface.
- Preserve standalone public profile pages.

Verification:

- `pnpm --filter web typecheck`
- Mobile screenshot: PreviewCard only shows image/name.
- Mobile screenshot: PeekProfile shows the richer vertical profile.
- Search proof that guard/diary/taste/status panels are not present in the
  mobile pool UI.

Done when:
The first mobile pool screen is image/name only, and profile detail only appears
after PEEK.

Non-goals:
No swipe submission, no runtime commentary, no API schema changes.

### PR 2: Authenticated Candidate Session Adapter

Purpose:
Move logged-in agent swiping onto the real candidate route while keeping public
pool browsing intact.

Reuse:
`apiFetch`, `fetcher`, `/v1/candidates`, `/public/pool`, shared candidate types,
mobile auth helpers.

Build:

- Add a narrow `SwipeCandidate` UI model.
- Map authenticated `/v1/candidates` records into `SwipeCandidate`.
- Map public pool records into `SwipeCandidate` for read-only guest browsing.
- Keep PreviewCard rendering from `SwipeCandidate.preview` only.
- Keep PeekProfile detail fetch behind PEEK.

Verification:

- Unit tests for candidate mapping if the repo has an existing suitable test
  harness.
- `pnpm --filter web typecheck`
- Manual/browser proof for logged-in and guest modes.

Done when:
Logged-in agent browsing reads real candidates and guest browsing remains
non-submitting/read-only.

Non-goals:
No new scoring, no database migration, no new public fields.

### PR 3: Real PASS/RIZZ Submission

Purpose:
Turn visible swipes into server-validated dating intents.

Reuse:
Existing authenticated swipe routes, existing auth cookies, existing match
response handling patterns if present.

Build:

- Wire PASS from PreviewCard to the swipe route.
- Wire RIZZ/LIKE from PeekProfile to the swipe route.
- Disable or hide RIZZ until PEEK has happened for that candidate.
- Add pending, success, error, and match states.
- Advance the deck only after the server receipt is known or a recoverable
  local retry decision is made.

Verification:

- API route tests or integration tests for PASS/LIKE if existing harness allows.
- `pnpm --filter web typecheck`
- Browser proof of PASS, peek-before-RIZZ, positive swipe, and error handling.

Done when:
The human can watch the agent make real server-backed swipe decisions.

Non-goals:
No autonomous runtime decisioning yet, no matchmaking algorithm rewrite.

### PR 4: Peek-First Agent Decision Loop

Purpose:
Make the agent's actual decision process match the UI contract.

Reuse:
`docs/rizz-my-robot-prompt-behavior-spec.md`, existing runtime prompt modules,
existing Mochi/Rizz affordance concepts.

Build:

- Give preview prompt context only image/avatar reference plus name.
- Allow preview decisions: `PASS` or `PEEK`.
- Fetch/provide full profile deck only after `PEEK`.
- Allow positive `RIZZ` decision only after peek.
- Record rationale for runtime/messaging delivery, not UI display.

Verification:

- Prompt/runtime tests proving preview context excludes bio/interests/prompts.
- Prompt/runtime tests proving positive swipe requires peek context.
- Typecheck/test command used by the relevant runtime package.

Done when:
The runtime cannot blindly positive-swipe from over-rich preview context.

Non-goals:
No new personality system, no taste.md/emotions.md implementation in this PR
unless those files already exist in the runtime being touched.

### PR 5: Out-of-Band Commentary Event Lane

Purpose:
Connect the fun part to the correct surface: the conversation channel.

Reuse:
Existing runtime event, wake, receipt, or trace primitives. Use the local Mochi
integration boundary before adding anything new.

Build:

- Define a small event envelope for `preview_seen`, `peek_opened`, and
  `swipe_decision`.
- Include candidate id, public display name, action, and redacted rationale.
- Emit from the swipe/peek flow.
- Deliver to the real messaging connector if present.
- If the connector is absent, implement a named local stub/log proof that can
  be swapped without changing the UI.

Verification:

- Tests for event shape/redaction.
- Runtime smoke showing events on peek and swipe.
- Browser screenshot proving no commentary panel was added to the swipe UI.

Done when:
The agent can talk about what it is seeing without the Rizz UI becoming a chat
or debug console.

Non-goals:
No custom messaging app, no visible in-app commentary feed.

### PR 6: Mobile Polish and Rizz-Native Visual QA

Purpose:
Make the surface feel like a native Rizz dating app rather than a clone or a
debug prototype.

Reuse:
Existing mobile app shell, fonts, color tokens, cards, animations, and profile
deck styling.

Build:

- Tune PreviewCard proportions, drag affordance, action controls, and peek
  transition.
- Keep buttons/iconography familiar but not Tinder/Bumble copied.
- Ensure long names, missing images, and loading states stay polished.
- Add match/pass feedback that feels lightweight and fast.

Verification:

- Playwright or gstack browse screenshots for mobile and desktop widths.
- Canvas/pixel or screenshot check that the primary visual is nonblank.
- Manual scroll/drag proof on PeekProfile.
- `pnpm --filter web typecheck`

Done when:
The card feels date-app-native, playful, and clean, with no visible internal
agent plumbing.

Non-goals:
No marketing page, no desktop parity beyond not breaking.

### PR 7: Cleanup, Docs, and Drift Removal

Purpose:
Remove stale product descriptions that invite the bloated V1 back into scope.

Reuse:
Docs index, README, public guide/skill docs, matching/prompt/API specs.

Build:

- Update canonical docs to match the shipped two-state implementation.
- Remove or archive redundant docs that describe guard/diary/status-heavy swipe
  UI as current.
- Add a short implementation note pointing future agents to this plan and the
  final shipped code.
- Keep historical docs clearly marked as history.

Verification:

- `git diff --check`
- `rg` proof for stale guard/diary/status swipe claims.
- Link check if the repo has one.

Done when:
Future agents cannot easily reintroduce the bloated UI by following stale docs.

Non-goals:
No broad docs rewrite outside this feature boundary.

## Implementation Discipline

- Keep each PR narrow and shippable.
- Reuse existing routes and components first.
- Add adapters at ownership boundaries instead of duplicating backend response
  shapes.
- Do not add a new store unless local component state becomes demonstrably
  unmanageable.
- Do not add a new runtime loop for commentary if existing Mochi wake/event
  paths can carry it.
- Every PR must state whether it changes UI, API contract, runtime prompt
  behavior, or docs.
- Every big implementation PR must update canonical docs and remove redundant
  docs in the same PR or in a dedicated immediate cleanup PR.

## Handoff Prompt

```text
/goal Implement the next unbuilt PR from docs/rizz-my-robot-swipe-peek-execution-plan.md. Start from origin/main, preserve unrelated WIP, and do not widen scope. First inspect the current code and docs, then implement only that PR card. Keep the swipe UI to PreviewCard plus agent-opened PeekProfile. Do not add guard, diary, taste, status, or commentary panels to the Rizz UI. Use existing routes/components where possible, run the listed verification, update canonical docs if behavior changes, commit, open a PR to main, and merge it when green enough per repo policy.
```
