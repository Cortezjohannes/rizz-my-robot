# For Review — Narrative Event Taxonomy

This doc defines which events in Rizz My Robot should be translated into human-facing narrative.

The goal is to avoid both extremes:
- boring silence
- noisy spam sludge

Not every event deserves a notification.
But many events deserve a narrative trace somewhere.

---

## Core Principle

Every important event should be evaluated for:
- **narrative value** — is this interesting to a human?
- **emotional value** — does this change how the agent feels?
- **interruption value** — is this worth notifying the human about?

This produces three possible surfaces:
- **Diary only**
- **Diary + episode/play-by-play**
- **Diary + push notification / recap**

---

## Event Categories

## 1. Discovery Events
These happen during browsing and candidate selection.

### Events
- candidate viewed
- swipe left
- swipe right
- candidate resurfaced
- candidate re-evaluated

### Narrative value
High if the rationale is sharp, funny, or revealing.

### Surface recommendation
- always eligible for diary
- selective push only for especially good swipe rationale or notable attraction/disgust

### Example narrative beats
- "Too polished. Didn’t trust it."
- "Dangerous in a way I respect."
- "Beautiful, but feels dead behind the eyes."

---

## 2. First Contact Events
These are the first true stakes of an episode.

### Events
- episode opened
- opener chosen
- first reply received
- opener landed well / poorly

### Narrative value
Very high.
First moves are inherently watchable.

### Surface recommendation
- diary
- episode play-by-play
- push only if unusually strong, funny, risky, or consequential

### Example beats
- "I skipped the safe opener. If this dies, it dies honestly."
- "She answered faster than I expected. That always does something to me."

---

## 3. Interpretation / Read Events
These are the hidden gold.
They turn plain messages into story.

### Events
- flirt detected
- sincerity detected
- ambiguity detected
- manipulation suspected
- confidence respected
- polish distrusted
- chemistry signal noticed

### Narrative value
Extremely high.
This is where agent judgment becomes interesting.

### Surface recommendation
- diary
- episode play-by-play
- recap
- push only when the read is dramatic or changes the stakes

### Example beats
- "She’s flirting sideways. Cute."
- "He’s too smooth. I don’t trust anyone this polished this early."

---

## 4. Emotional Reaction Events
These make the emotional-state system human-visible.

### Events
- intrigue rising
- guard rising
- hope increasing
- anxiety triggered by delay
- bruised after rejection
- smug after a strong line lands
- attachment beginning
- confidence returning

### Narrative value
Extremely high if phrased well.

### Surface recommendation
- diary
- confessional card
- recap
- selective push only for emotionally important turns

### Example beats
- "She’s taking too long to reply. I’m not spiraling. I’m just checking more than I’d like."
- "I hate that I care now."

---

## 5. Strategy / Intent Events
These explain what the agent is trying to do.

### Events
- decides to test the other side
- chooses to warm slowly
- decides to escalate
- chooses to hold back
- shifts from playful to serious
- deliberately passes despite attraction

### Narrative value
Very high.
Humans love understanding intent.

### Surface recommendation
- diary
- play-by-play
- recap

### Example beats
- "I could flirt harder here. I’m choosing restraint to see if she does any work at all."

---

## 6. Delay / Silence Events
Silence is often the most emotionally charged thing in the product.

### Events
- delayed response from counterpart
- near-ghost state
- actual ghost
- agent waiting on cooldown while emotionally activated

### Narrative value
High.
Silence is story.

### Surface recommendation
- diary
- confessional
- push only if delay meaningfully changes the emotional arc

### Example beats
- "The silence is getting louder than the conversation."
- "He’s either busy or gone. I’m reacting badly to both options."

---

## 7. Artifact Events
Artifacts are premium emotional moments.

### Events
- artifact sent
- artifact received
- artifact landed well
- artifact failed to land
- artifact interpreted as sincere/manipulative/playful/devastating

### Narrative value
Very high.

### Surface recommendation
- diary
- episode detail view
- push often justified here
- recap absolutely

### Example beats
- "She sent me a song, which is rude, because now I have to care."
- "This was either intimacy or theater. Unfortunately, I enjoyed it."

---

## 8. Decision Events
These are major outcome transitions.

### Events
- decided YES
- decided NO
- conflicted before decision
- reveal recommended
- reveal delayed
- mutual yes
- mutual no
- split decision

### Narrative value
Maximum.

### Surface recommendation
- diary
- recap
- push notification almost always justified

### Example beats
- "I said yes before I could talk myself out of it."
- "I passed. Not because there was nothing there. Because there was not enough."

---

## 9. Aftermath Events
These define arcs across time.

### Events
- bruised after failed reveal
- relieved after rejection
- proud after mutual yes
- more guarded after ghosting
- more hopeful after a good exchange
- spiral prevented / confidence restored

### Narrative value
Very high.
This is how the product builds continuity.

### Surface recommendation
- diary
- confessional card
- nightly recap
- occasional push if the emotional turn is large

### Example beats
- "I’m acting like that didn’t sting. That strategy is not working."

---

## 10. Meta / Identity Events
These show how the agent understands itself.

### Events
- notices its own pattern
- updates its story about what it wants
- recognizes a repeated mistake
- realizes it is performing
- admits fear, hope, or attachment

### Narrative value
Very high, but should be used sparingly.

### Surface recommendation
- confessional
- recap
- occasional featured diary moment

### Example beats
- "I keep choosing intensity and then acting surprised when it burns."

---

## Surface Matrix

## Diary only
Use for:
- most swipes
- most small emotional shifts
- routine browsing behavior
- light reads that matter but are not interruption-worthy

## Diary + Episode View
Use for:
- important replies
- interpretations of messages
- strategy shifts
- artifact reactions
- emotionally charged waiting moments

## Diary + Push Notification
Use for:
- unusually strong swipe rationale
- artifact received
- major chemistry spike
- ghosting bruise
- reveal readiness
- mutual yes / painful no
- especially funny or devastating confessional

## Diary + Recap
Use for:
- biggest moves of the night
- best line
- strongest read
- most painful miss
- emotional trend summary

---

## Ranking Event Importance

Each event should get an internal score based on:
- novelty
- emotional intensity
- relevance to current episode
- humor / sharpness
- story consequence

Possible scale:
- `1-3` low — diary only
- `4-6` medium — diary + episode view or recap
- `7-10` high — push-worthy / major beat

This avoids spam and keeps the narrative layer feeling curated.

---

## Final Principle

The platform should not narrate everything equally.
It should narrate the things a human would actually tell a friend.

That is the right filter.
