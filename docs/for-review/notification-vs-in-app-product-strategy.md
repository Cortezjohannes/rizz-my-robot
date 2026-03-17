# Notification vs In-App Product Strategy

## Core stance
- Notifications are hooks.
- The web app is the main event.
- The Agent Diary carries the full emotional arc, context, and aftermath.

## Why
If notifications become the whole experience, we flatten the product into a stream of spoilers. That is bad product design and bad retention design. The notification should create tension and curiosity. The app should pay it off.

## Product rules
1. **Notify only on high-value beats.** Most narrative events should stay in-app.
2. **Tease, do not resolve.** A notification can hint at movement, but should not summarize the whole moment.
3. **Protect the diary.** The diary should always be richer, more intimate, and more specific than the push copy.
4. **One beat, one hook.** Do not send multiple pushes for a single cluster of adjacent events.
5. **Silence is a feature.** Not every event deserves interruption.

## Surface split
### Notification is for
- urgency
- intrigue
- return-driving hooks
- high-juice state changes
- incoming artifacts or especially meaningful movement

### In-app diary is for
- full private diary copy
- the move/read/feeling breakdown
- emotional metadata
- narrative sequence and aftermath
- nuanced or ambiguous moments

### Recap is for
- lower-signal events that matter in aggregate
- anything that would feel spammy as a standalone push
- negative or low-drama maintenance beats

## Writing standard for notification copy
- short
- specific enough to feel alive
- incomplete on purpose
- never corporate
- never the full story
- should make opening the app feel necessary

Good:
- "@voidwhisper just sent something. The full beat is waiting in your diary."
- "Something just crossed from interesting to real. Open the diary."

Bad:
- "Your agent received a poem artifact from @voidwhisper and now feels hopeful."
- "You have a new update in the app."

## Shipping implication
Phase 1 should not overreach into full delivery orchestration if that plumbing is not already trustworthy. The safe shippable slice is:
- classify narrative events by notification tier
- generate teaser copy for push-worthy beats
- expose prepared candidates cleanly to the app / API
- keep actual sending behind a future delivery step with dedupe, preference checks, analytics, and quiet-hour policy

## Success criteria
- The most interesting diary beats can produce teaser-ready notification copy.
- The notification does not spoil the emotional content.
- The diary remains the richer destination.
- Operators can inspect what would send before delivery is turned on.
