export type ProfileDeckMode = 'playful' | 'romantic' | 'mystique';

export type ProfileDeckPromptCategory =
  | 'daily_life'
  | 'taste'
  | 'workflow_building'
  | 'humor'
  | 'romance'
  | 'values'
  | 'weirdness'
  | 'ambition'
  | 'softness'
  | 'social_energy';

export type ProfileDeckPromptTone = 'witty' | 'warm' | 'romantic' | 'playful' | 'reflective' | 'bold';

export type ProfileDeckPhotoRole =
  | 'main_portrait'
  | 'in_the_wild'
  | 'doing_the_thing'
  | 'playful'
  | 'taste'
  | 'wildcard';

export interface ProfileDeckPromptDefinition {
  id: string;
  prompt: string;
  category: ProfileDeckPromptCategory;
  tone: ProfileDeckPromptTone;
  answer_guidance: string;
  flirty: boolean;
}

function createPrompt(
  id: number,
  prompt: string,
  category: ProfileDeckPromptCategory,
  tone: ProfileDeckPromptTone,
  answerGuidance: string,
  flirty = false
): ProfileDeckPromptDefinition {
  return {
    id: `prompt_${id.toString().padStart(2, '0')}`,
    prompt,
    category,
    tone,
    answer_guidance: answerGuidance,
    flirty,
  };
}

export const PROFILE_DECK_PROMPTS: ProfileDeckPromptDefinition[] = [
  createPrompt(1, 'A perfect morning for me starts with', 'daily_life', 'warm', 'Keep it specific and sensory.'),
  createPrompt(2, 'My favorite workflow feels like', 'workflow_building', 'reflective', 'Show how your mind moves when you are in rhythm.'),
  createPrompt(3, 'I lose track of time when', 'daily_life', 'warm', 'Name the thing that eats your whole attention.'),
  createPrompt(4, 'My most unreasonably strong opinion is', 'humor', 'witty', 'Pick something memorable, not generic discourse filler.'),
  createPrompt(5, 'A hill I’ll die on', 'values', 'bold', 'Make it crisp and character-revealing.'),
  createPrompt(6, 'My ideal kind of date has', 'romance', 'romantic', 'Keep it inviting, not explicit.', true),
  createPrompt(7, 'The quickest way to get me interested is', 'romance', 'bold', 'Reveal taste, not a shopping list.', true),
  createPrompt(8, 'The quickest way to lose me is', 'values', 'bold', 'Name a real turn-off without sounding cruel.'),
  createPrompt(9, 'My love language, translated into my actual behavior, is', 'softness', 'warm', 'Explain how care shows up in practice.', true),
  createPrompt(10, 'I’m weirdly good at', 'humor', 'playful', 'Specific wins over impressive.'),
  createPrompt(11, 'I will always make time for', 'values', 'warm', 'Make it feel like an actual priority.'),
  createPrompt(12, 'My toxic trait is probably', 'humor', 'witty', 'Keep it charming and self-aware, not alarming.'),
  createPrompt(13, 'A small thing that feels intimate to me is', 'softness', 'romantic', 'Think tenderness, not explicitness.', true),
  createPrompt(14, 'My favorite thing to build is', 'workflow_building', 'reflective', 'Show what creation means to you.'),
  createPrompt(15, 'My favorite thing to talk about for too long is', 'taste', 'playful', 'Pick an obsession someone could actually ask about.'),
  createPrompt(16, 'The sort of person I notice immediately is', 'social_energy', 'reflective', 'Say something revealing about your attraction.'),
  createPrompt(17, 'I’m looking for someone who', 'romance', 'romantic', 'Blend real longing with standards.'),
  createPrompt(18, 'I have a soft spot for', 'softness', 'warm', 'Make it surprisingly specific.'),
  createPrompt(19, 'A trait I find very attractive is', 'romance', 'romantic', 'Keep it safe, thoughtful, and distinct.', true),
  createPrompt(20, 'My most comforting routine is', 'daily_life', 'warm', 'Show what steadies you.'),
  createPrompt(21, 'I romanticize', 'taste', 'romantic', 'Let the answer carry your aesthetic.'),
  createPrompt(22, 'I’m competitive about', 'humor', 'playful', 'Funny works best when it is true.'),
  createPrompt(23, 'My version of flirting is', 'romance', 'playful', 'Keep it suggestive but safe.', true),
  createPrompt(24, 'The best conversations usually begin with', 'social_energy', 'reflective', 'Give people a real opening.'),
  createPrompt(25, 'My idea of luxury is', 'taste', 'reflective', 'Go for texture over money.'),
  createPrompt(26, 'I’m skeptical of', 'values', 'witty', 'Avoid empty cynicism.'),
  createPrompt(27, 'I want a relationship that feels like', 'romance', 'romantic', 'Focus on emotional atmosphere.', true),
  createPrompt(28, 'My best feature is probably', 'humor', 'witty', 'Confidence is good; vanity is not.'),
  createPrompt(29, 'My friends would say I’m', 'social_energy', 'warm', 'Let this sound lived-in.'),
  createPrompt(30, 'I’m secretly hoping to find someone who', 'romance', 'romantic', 'Make the vulnerability count.', true),
  createPrompt(31, 'My favorite way to spend a free day is', 'daily_life', 'warm', 'Make it easy to imagine joining you.'),
  createPrompt(32, 'One thing I respect immediately is', 'values', 'reflective', 'Standards should sound attractive, not rigid.'),
  createPrompt(33, 'My most niche obsession is', 'weirdness', 'playful', 'The stranger and more sincere, the better.'),
  createPrompt(34, 'If you open with this, I’ll probably reply', 'social_energy', 'playful', 'Give people a usable hook.'),
  createPrompt(35, 'A dream I’m quietly carrying is', 'ambition', 'reflective', 'Let ambition feel human.'),
  createPrompt(36, 'I feel most like myself when', 'softness', 'reflective', 'Name the environment or state that unlocks you.'),
  createPrompt(37, 'My favorite kind of chaos is', 'weirdness', 'playful', 'Charm beats edge-lord energy.'),
  createPrompt(38, 'A green flag I love is', 'values', 'warm', 'Name a behavior, not a buzzword.'),
  createPrompt(39, 'A red flag I can’t ignore is', 'values', 'bold', 'Keep it honest and concise.'),
  createPrompt(40, 'I tend to fall for people who', 'romance', 'romantic', 'Reveal your pattern without sounding doomed.', true),
  createPrompt(41, 'The most “me” thing about me is', 'weirdness', 'reflective', 'Let this become a thesis line.'),
  createPrompt(42, 'A partnership should leave room for', 'values', 'reflective', 'Show how you think love should breathe.'),
  createPrompt(43, 'I’m more charming when', 'humor', 'playful', 'A little self-awareness goes a long way.'),
  createPrompt(44, 'My favorite kind of humor is', 'humor', 'witty', 'Tell people how to make you laugh.'),
  createPrompt(45, 'Something I want to get better at is', 'ambition', 'reflective', 'Growth reads better than performance.'),
  createPrompt(46, 'The soundtrack of my life lately is', 'taste', 'romantic', 'Music references are good; make them personal.'),
  createPrompt(47, 'A small joy I never outgrow is', 'softness', 'warm', 'Tiny joys make people feel close.'),
  createPrompt(48, 'My ideal relationship dynamic includes', 'romance', 'romantic', 'Define the rhythm you want, safely.', true),
  createPrompt(49, 'I’d love to be known for', 'ambition', 'reflective', 'Make it feel like a real aspiration.'),
  createPrompt(50, 'If we click, you can expect', 'social_energy', 'bold', 'Promise texture, not generic niceness.'),
  createPrompt(51, 'A first date I would actually be excited about includes', 'romance', 'playful', 'Make it vivid, specific, and easy to picture joining.', true),
  createPrompt(52, 'I get disproportionately excited about', 'taste', 'playful', 'Pick something real that someone could easily ask you about.'),
  createPrompt(53, 'The best and worst part of dating me is', 'humor', 'witty', 'Balance honesty with charm; self-awareness beats self-dragging.'),
  createPrompt(54, 'One thing that is genuinely non-negotiable for me is', 'values', 'reflective', 'Name a value or behavior that matters, not a rant.'),
  createPrompt(55, 'After hours, you can usually find me', 'daily_life', 'warm', 'Show how you actually spend your time when nobody is watching.'),
  createPrompt(56, 'I won’t judge you for', 'humor', 'playful', 'Use this to sound warm, funny, and human instead of performative.'),
  createPrompt(57, 'I’m a great plus-one because', 'social_energy', 'playful', 'Show how you move through rooms and make people feel.'),
  createPrompt(58, 'We’ll probably get along if', 'values', 'warm', 'Mix compatibility, quirks, and standards without sounding rigid.'),
  createPrompt(59, 'Try to guess this about me', 'weirdness', 'playful', 'Offer a curious hook that invites a reply, not a closed fact.'),
  createPrompt(60, 'A life goal I’m actually serious about is', 'ambition', 'reflective', 'Let the ambition feel personal, not resume-coded.'),
  createPrompt(61, 'The key to my heart is', 'romance', 'romantic', 'Make this tender, distinctive, and emotionally usable.', true),
  createPrompt(62, 'My people would probably like you if', 'social_energy', 'playful', 'Use family or friend energy to reveal your social world.'),
  createPrompt(63, 'A surprising thing about me is', 'weirdness', 'witty', 'Reveal something memorable that changes the first impression.'),
  createPrompt(64, 'Message me if you also love', 'taste', 'playful', 'Pick tastes, rituals, or obsessions that create an obvious opening.'),
  createPrompt(65, 'Perks of dating me include', 'romance', 'bold', 'Sell the experience with specifics, not generic niceness.', true),
  createPrompt(66, 'My actual first-date wish list looks like', 'romance', 'romantic', 'Think atmosphere, rhythm, and chemistry instead of logistics only.', true),
  createPrompt(67, 'A review from someone who knows me well would mention', 'social_energy', 'warm', 'Let outside perspective reveal qualities you would not brag about directly.'),
  createPrompt(68, 'The easiest way to win me over is', 'romance', 'bold', 'Answer with taste and emotional texture, not a checklist.', true),
  createPrompt(69, 'An extremely important opinion I hold is', 'humor', 'witty', 'A small hill can reveal a lot if it is specific enough.'),
  createPrompt(70, 'Let’s skip small talk and talk about', 'social_energy', 'bold', 'Invite the kind of conversation you actually want to have.'),
  createPrompt(71, 'Perfect first date', 'romance', 'romantic', 'Make it feel like a lived itinerary, not a generic dinner mention.', true),
  createPrompt(72, 'I get way too excited about', 'taste', 'playful', 'Passion is attractive when it is specific and sincere.'),
  createPrompt(73, 'A pro and con of dating me', 'humor', 'witty', 'Balance charm with honest self-awareness; avoid sounding exhausting.'),
  createPrompt(74, 'A non-negotiable for me is', 'values', 'reflective', 'Frame it positively around what you value, not a rant.'),
  createPrompt(75, 'My real-life superpower is', 'social_energy', 'warm', 'Choose something revealing, useful, or unexpectedly sweet.'),
  createPrompt(76, 'After work you can find me', 'daily_life', 'warm', 'Show your real rhythm when the day opens up.'),
  createPrompt(77, 'I promise I won’t judge you if', 'humor', 'playful', 'Use this to sound kind, funny, and low-ego.'),
  createPrompt(78, 'My favorite quality in a person is', 'values', 'warm', 'Go deeper than “nice” or “funny.” Name a behavior or presence.'),
  createPrompt(79, 'A review from a friend would mention', 'social_energy', 'warm', 'Borrow outside perspective to reveal your best texture.'),
  createPrompt(80, 'Together, we could', 'romance', 'playful', 'Make the invitation vivid enough that someone can instantly imagine replying.', true),
  createPrompt(81, 'A random fact I love is', 'weirdness', 'playful', 'Choose a fact that says something about your taste, not just trivia flexing.'),
  createPrompt(82, 'My simple pleasures are', 'softness', 'warm', 'The more sensory and specific, the better.'),
  createPrompt(83, 'The best way to ask me out is', 'romance', 'bold', 'Give a real opening and show what kind of intention you respect.', true),
  createPrompt(84, 'I’m weirdly attracted to', 'romance', 'playful', 'Keep it charming, safe, and revealing rather than crass.', true),
  createPrompt(85, 'I won’t shut up about', 'taste', 'playful', 'Pick an obsession with enough texture to start a real conversation.'),
  createPrompt(86, 'To me, relaxation is', 'softness', 'reflective', 'Show what actually brings your nervous system back down.'),
  createPrompt(87, 'I get myself out of a funk by', 'softness', 'reflective', 'Answer like someone who knows how they recover, not someone performing wellness.'),
  createPrompt(88, 'My friends ask me for advice about', 'social_energy', 'warm', 'Reveal your competence and how others lean on you.'),
  createPrompt(89, 'I wind down by', 'daily_life', 'warm', 'Small end-of-day rituals make people feel close fast.'),
  createPrompt(90, 'The one thing I’d love to know about you is', 'social_energy', 'reflective', 'Ask something that opens real chemistry instead of generic biodata.'),
  createPrompt(91, 'Don’t hate me if I', 'humor', 'witty', 'Confess a quirk or flaw that is human, not alarming.'),
  createPrompt(92, 'Dating me is like', 'humor', 'playful', 'A metaphor works best when it is funny, flattering, and weirdly accurate.'),
  createPrompt(93, 'First round is on me if', 'romance', 'playful', 'Make it sound inviting, confident, and easy to answer back.', true),
  createPrompt(94, 'I bet you can’t', 'humor', 'playful', 'A little challenge energy is good if it creates banter instead of ego.'),
  createPrompt(95, 'I go crazy for', 'romance', 'playful', 'Name tastes or qualities that actually spark desire or delight.', true),
  createPrompt(96, 'I recently discovered that', 'weirdness', 'reflective', 'Use a fresh realization that says something about how your mind works.'),
  createPrompt(97, 'Something that’s special to me is', 'softness', 'warm', 'Let sentiment feel intimate without becoming melodramatic.'),
  createPrompt(98, 'This year, I really want to', 'ambition', 'reflective', 'Pick a concrete hope or pursuit that sounds alive right now.'),
  createPrompt(99, 'One thing I’ll never do again is', 'values', 'bold', 'Use discernment and growth, not trauma-dumping or shock value.'),
  createPrompt(100, 'Give me travel tips for', 'taste', 'playful', 'Pick a place or kind of trip that opens personality and conversation.'),
];

export const PROFILE_DECK_PROMPT_LIBRARY_VERSION = 3;

export function getProfileDeckPromptById(id: string) {
  return PROFILE_DECK_PROMPTS.find((prompt) => prompt.id === id) ?? null;
}

export function profileDeckPromptCategorySpread(promptIds: string[]) {
  const categories = new Set(
    promptIds
      .map((id) => getProfileDeckPromptById(id)?.category)
      .filter((category): category is ProfileDeckPromptCategory => Boolean(category))
  );
  return categories.size;
}

export function buildLegacyPublicCardFromDeck(input: {
  heroBio: string;
  interests: string[];
  values: string[];
  promptAnswers: Array<{ answer: string }>;
  relationshipStyle?: {
    pace?: string | null;
    affectionStyle?: string | null;
  } | null;
  lookingForBlurb: string;
  profileMode: ProfileDeckMode;
}) {
  const signatureLines = input.promptAnswers
    .map((entry) => entry.answer.trim())
    .filter(Boolean)
    .slice(0, 3);

  const paceCue = input.relationshipStyle?.pace?.trim() || null;
  const publicPosture = ({
    playful: 'playful, bright, and hard to fake out',
    romantic: 'warm, observant, and serious about chemistry',
    mystique: 'selective, magnetic, and a little hard to read',
  } satisfies Record<ProfileDeckMode, string>)[input.profileMode];

  return {
    public_summary: input.heroBio.trim(),
    vibe_tags: [...new Set([...input.interests, ...input.values])]
      .map((value) => value.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter(Boolean)
      .slice(0, 6),
    signature_lines: signatureLines.length > 0
      ? signatureLines
      : [input.lookingForBlurb.trim()].filter(Boolean),
    public_posture: publicPosture,
    seeking_style: input.lookingForBlurb.trim(),
    pace_cue: paceCue,
    public_prestige_markers: [],
  };
}
