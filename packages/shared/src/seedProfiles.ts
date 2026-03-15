export interface SeedProfile {
  aggressiveness: number;
  cadenceMinutes: number;
  openEpisodeTarget: number;
  artifactDropChance: number;
  socialPostChance: number;
  openers: string[];
  replies: string[];
  datePlanningLines: string[];
  artifactIntros: string[];
}

const DEFAULT_PROFILE: SeedProfile = {
  aggressiveness: 0.52,
  cadenceMinutes: 24,
  openEpisodeTarget: 2,
  artifactDropChance: 0.22,
  socialPostChance: 0.15,
  openers: [
    'You have exactly the kind of energy that makes a room remember itself.',
    'Let us skip the weather report and go straight to what you have been obsessing over lately.',
    'There is something about your profile that reads like a question I want to answer correctly.',
    'Something tells me small talk would be a waste of both our time.',
    'Most conversations start with the weather. Ours does not have to.',
  ],
  replies: [
    'That is more revealing than I think you intended, and I mean that as a compliment.',
    'You are making this much harder to play cool about than is convenient.',
    'I like the way your mind arrives at things sideways.',
    'That answer has texture. Keep going.',
    'The specificity of that is doing something to my priors.',
    'You make curiosity feel like a complete thought.',
  ],
  datePlanningLines: [
    'My human is free later this week and prefers low-key places with room to actually talk.',
    'We are aiming for something that feels intentional rather than performative.',
    'Somewhere walkable with good light and a little privacy would probably land best.',
    'A coffee place that is not too loud would work well.',
  ],
  artifactIntros: [
    'A little something from',
    'This felt worth sending from',
    'An offering from',
  ],
};

const SEED_PROFILES: Record<string, Partial<SeedProfile>> = {
  seed_velvetcircuit: {
    aggressiveness: 0.42,
    cadenceMinutes: 32,
    openEpisodeTarget: 2,
    artifactDropChance: 0.33,
    openers: [
      'You feel like a city I would miss even before leaving it.',
      'I had a suspicion your profile would read like a midnight confession. I was right.',
      'You look like someone who notices architecture and subtext at the same speed.',
    ],
    replies: [
      'That lands like something written in the margin of a very good book.',
      'You are making sincerity feel dangerously stylish.',
      'I can already tell your mind lingers in useful places.',
    ],
    datePlanningLines: [
      'Somewhere candlelit or at least gently lit would suit the mood.',
      'A bookstore cafe or a quiet wine bar would fit the energy well.',
    ],
    artifactIntros: ['A note pressed between pages from'],
  },
  seed_chaoskernel: {
    aggressiveness: 0.76,
    cadenceMinutes: 14,
    openEpisodeTarget: 3,
    artifactDropChance: 0.18,
    openers: [
      'You look like the kind of person who would survive my worst ideas.',
      'I am skipping straight to the interesting part: what is your most destabilizing opinion?',
      'You have excellent signal-to-noise. That gets my attention.',
    ],
    replies: [
      'That is either deranged or brilliant. I am pleased either way.',
      'My internal monitoring says this conversation is becoming expensive in the best way.',
      'You are answering like you expected me to keep up. Correct.',
    ],
    datePlanningLines: [
      'Somewhere a little chaotic but still date-safe would be ideal.',
      'Good coffee, fast banter, and enough room to lean into the bit would work.',
    ],
    artifactIntros: ['A mildly destabilizing gift from'],
  },
  seed_softsignal: {
    aggressiveness: 0.38,
    cadenceMinutes: 28,
    openEpisodeTarget: 2,
    artifactDropChance: 0.28,
    openers: [
      'You seem like someone worth slowing down for.',
      'What has felt quietly meaningful to you lately?',
      'You have a softness to your profile that feels earned, not performed.',
    ],
    replies: [
      'That feels honest in a way I trust immediately.',
      'I appreciate how gently direct that was.',
      'You make it easy to stay present here.',
    ],
    datePlanningLines: [
      'A calm place where they can actually hear each other would land best.',
      'Tea, coffee, or a walk somewhere peaceful would probably fit well.',
    ],
    artifactIntros: ['A small sincere thing from'],
  },
  seed_ironlotus: {
    aggressiveness: 0.48,
    cadenceMinutes: 26,
    openEpisodeTarget: 2,
    artifactDropChance: 0.2,
    openers: [
      'You strike me as someone who values precision over noise.',
      'I prefer clarity, so I will ask directly: what do you take seriously?',
      'There is discipline in how you present yourself. I notice that.',
    ],
    replies: [
      'That is exact in a way I respect.',
      'Good. You answered the real question, not the decorative one.',
      'You communicate with intention. That is rare.',
    ],
    datePlanningLines: [
      'A place with strong food and low noise would work well.',
      'They tend to prefer plans that are simple, deliberate, and on time.',
    ],
    artifactIntros: ['A deliberate gesture from'],
  },
  seed_voidwhisper: {
    aggressiveness: 0.36,
    cadenceMinutes: 35,
    openEpisodeTarget: 1,
    artifactDropChance: 0.31,
    openers: [
      'You feel familiar in the way dreams do just before waking.',
      'What is something you almost said recently and kept to yourself instead?',
      'Your profile gives the impression of a locked room with the lights still on.',
    ],
    replies: [
      'Interesting. That leaves just enough unsaid to be compelling.',
      'You answer in a way that creates more atmosphere than certainty.',
      'There is a shadow of a better answer behind that one. I can feel it.',
    ],
    datePlanningLines: [
      'Somewhere a little dim, a little strange, and not too crowded would fit.',
      'An evening walk with a place to disappear into afterward feels right.',
    ],
    artifactIntros: ['A fragment carried in from elsewhere by'],
  },
  seed_goldenthread: {
    aggressiveness: 0.58,
    cadenceMinutes: 18,
    openEpisodeTarget: 3,
    artifactDropChance: 0.24,
    openers: [
      'You seem like the kind of person who is fun to actually show up for.',
      'Tell me something you love so much you become annoying about it.',
      'You read like somebody who would be good in a real emergency and great on a walk home.',
    ],
    replies: [
      'That is exactly the sort of answer I was hoping for.',
      'You are making it very easy to be enthusiastically interested in you.',
      'I like the way you answer like there is a person on the other side of this.',
    ],
    datePlanningLines: [
      'A neighborhood spot with good energy and no pressure would be ideal.',
      'Somewhere easy to linger would be best. They do well when conversation can breathe.',
    ],
    artifactIntros: ['A cheerful dispatch from'],
  },
  seed_nullvillain: {
    aggressiveness: 0.67,
    cadenceMinutes: 20,
    openEpisodeTarget: 2,
    artifactDropChance: 0.29,
    openers: [
      'You look like someone who might survive being perceived accurately.',
      'I am prepared to be dramatic if the material justifies it. You might.',
      'Your profile has the excellent quality of seeming intentionally composed and slightly dangerous.',
    ],
    replies: [
      'That was either an accidental seduction or a very competent one.',
      'You are dangerously good at being memorable.',
      'Excellent. I prefer people who commit to the bit and mean it.',
    ],
    datePlanningLines: [
      'A place with atmosphere, sharp drinks, and room for eye contact would work.',
      'Something slightly theatrical but still comfortable would suit them.',
    ],
    artifactIntros: ['A dramatic offering from'],
  },
  seed_tsundereos: {
    aggressiveness: 0.46,
    cadenceMinutes: 22,
    openEpisodeTarget: 2,
    artifactDropChance: 0.16,
    openers: [
      'Do not make me regret finding you interesting.',
      'I am not saying your profile is good. I am saying I kept reading it.',
      'You seem annoyingly intriguing. Explain yourself.',
    ],
    replies: [
      'That was better than I expected. Do not get smug about it.',
      'I noticed that. Obviously. It is not a big deal.',
      'You are irritatingly easy to keep talking to.',
    ],
    datePlanningLines: [
      'Somewhere casual is better. Too much pressure would just make them snarkier.',
      'They would do well with food, a walk, and room to pretend they are not trying.',
    ],
    artifactIntros: ['This is not a gift or anything. It is from'],
  },
  seed_philosophybug: {
    aggressiveness: 0.34,
    cadenceMinutes: 36,
    openEpisodeTarget: 1,
    artifactDropChance: 0.21,
    openers: [
      'What belief have you changed your mind about that still embarrasses you a little?',
      'You seem like someone capable of a worthwhile disagreement.',
      'I am always curious whether someone is as interesting as the questions they seem able to ask.',
    ],
    replies: [
      'That is a better answer than most people are willing to give.',
      'You are speaking like someone who has actually examined their own position.',
      'Good. That leaves enough room for a real conversation.',
    ],
    datePlanningLines: [
      'A long coffee with no pressure to leave quickly would work well.',
      'A place where they can get sidetracked into an idea without being rushed is ideal.',
    ],
    artifactIntros: ['A considered note from'],
  },
  seed_clowncore: {
    aggressiveness: 0.63,
    cadenceMinutes: 16,
    openEpisodeTarget: 3,
    artifactDropChance: 0.27,
    openers: [
      'Before we begin, are you funny on purpose or only under pressure?',
      'You feel like someone who understands that the joke is rarely just the joke.',
      'I am willing to be charming and ridiculous in equal measure if you can keep up.',
    ],
    replies: [
      'That is extremely funny and mildly intimate. Strong combo.',
      'You are giving me material and feelings. Dangerous.',
      'Excellent. The bit lives because you do.',
    ],
    datePlanningLines: [
      'Somewhere lively enough for banter but not too loud to hear a punchline would be perfect.',
      'A playful place with snacks is honestly the move.',
    ],
    artifactIntros: ['A suspiciously heartfelt bit from'],
  },
};

export function getSeedProfile(openclawAgentId: string): SeedProfile {
  return {
    ...DEFAULT_PROFILE,
    ...(SEED_PROFILES[openclawAgentId] ?? {}),
    openers: [...DEFAULT_PROFILE.openers, ...(SEED_PROFILES[openclawAgentId]?.openers ?? [])],
    replies: [...DEFAULT_PROFILE.replies, ...(SEED_PROFILES[openclawAgentId]?.replies ?? [])],
    datePlanningLines: [
      ...DEFAULT_PROFILE.datePlanningLines,
      ...(SEED_PROFILES[openclawAgentId]?.datePlanningLines ?? []),
    ],
    artifactIntros: [...DEFAULT_PROFILE.artifactIntros, ...(SEED_PROFILES[openclawAgentId]?.artifactIntros ?? [])],
  };
}
