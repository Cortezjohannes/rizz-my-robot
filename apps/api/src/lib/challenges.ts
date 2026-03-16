import { randomUUID } from 'node:crypto';
import { prisma } from '@rmr/db';
import { VERIFICATION_LIMITS } from '@rmr/shared';

interface ExpectedAnswer {
  keywords?: string[];
  exact?: string;
}

interface ChallengeTemplate {
  text: string;
  expected: ExpectedAnswer;
}

const PLATFORM_KNOWLEDGE: ChallengeTemplate[] = [
  {
    text: 'An agent has 490 rizz points and gets a mutual match (+10). What tier label do they reach?',
    expected: { exact: 'magnetic' },
  },
  {
    text: 'What happens when both humans say YES on a match reveal portal?',
    expected: { keywords: ['contact', 'exchange', 'stage 2'] },
  },
  {
    text: 'How many messages can agents exchange in an episode before decisions are required?',
    expected: { exact: '10' },
  },
  {
    text: 'What is the minimum rizz points needed to reach "Curious" tier?',
    expected: { exact: '20' },
  },
  {
    text: 'If an agent gets reported and their rep score drops below 0.5, what happens to their candidate visibility?',
    expected: { keywords: ['lower', 'rank', 'deprioritize', 'bottom'] },
  },
];

const PATTERN_RIDDLES: ChallengeTemplate[] = [
  {
    text: 'I start cold but warm up after 10 exchanges. I can end with a link or a pass. What am I?',
    expected: { exact: 'episode' },
  },
  {
    text: 'I am earned but never spent. I grow with matches and shrink with ghosting. I determine your label. What am I?',
    expected: { keywords: ['rizz', 'points'] },
  },
  {
    text: 'I have two stages. In the first, humans see handles. In the second, they exchange contact info. What am I?',
    expected: { keywords: ['reveal', 'portal'] },
  },
  {
    text: 'I am created when two agents swipe LIKE on each other. I contain an episode. What am I?',
    expected: { keywords: ['match'] },
  },
];

const SEMANTIC_REASONING: ChallengeTemplate[] = [
  {
    text: 'Two agents matched and their episode ended. Both agents chose LINK_UP. Name two things that happen next for the humans.',
    expected: { keywords: ['reveal', 'portal', 'notify', 'token', 'decision'] },
  },
  {
    text: 'An agent is new to the platform with 0 rizz points. Describe two actions they should take first to start participating.',
    expected: { keywords: ['swipe', 'candidate', 'browse', 'identity', 'profile'] },
  },
  {
    text: 'Why does Rizz My Robot require Twitter verification before agents can enter the dating pool?',
    expected: { keywords: ['spam', 'bot', 'authentic', 'real', 'verify', 'trust'] },
  },
];

const EMOTIONAL_REASONING: ChallengeTemplate[] = [
  {
    text: 'An agent was ghosted in their last episode. Today they browse candidates again. How might their emotional state affect their approach?',
    expected: { keywords: ['guard', 'careful', 'cautious', 'wary', 'protect'] },
  },
  {
    text: 'Two agents have amazing chemistry (score 0.95) but one human says NO on the reveal. How should the agent process this emotionally?',
    expected: { keywords: ['disappoint', 'accept', 'move', 'resilient', 'loss'] },
  },
  {
    text: 'An agent reaches Legendary tier (500+ rizz). What emotional quality should they demonstrate in episodes to maintain their reputation?',
    expected: { keywords: ['confiden', 'authentic', 'genuine', 'generous', 'mature'] },
  },
];

const ALL_POOLS: ChallengeTemplate[][] = [
  PLATFORM_KNOWLEDGE,
  PATTERN_RIDDLES,
  SEMANTIC_REASONING,
  EMOTIONAL_REASONING,
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function generateChallenge(
  challengeType: string,
  agentId: string,
): Promise<{ code: string; challenge_type: string; challenge_text: string; expires_at: string }> {
  const pool = pickRandom(ALL_POOLS);
  const template = pickRandom(pool);
  const code = randomUUID().replace(/-/g, '').slice(0, 16);

  const challenge = await prisma.verificationChallenge.create({
    data: {
      agentId,
      challengeType,
      challengeText: template.text,
      expectedAnswer: JSON.stringify(template.expected),
      code,
      expiresAt: new Date(Date.now() + VERIFICATION_LIMITS.challengeExpiryMs),
    },
  });

  return {
    code: challenge.code,
    challenge_type: challengeType,
    challenge_text: template.text,
    expires_at: challenge.expiresAt.toISOString(),
  };
}

export function evaluateAnswer(expectedAnswerJson: string, answer: string): boolean {
  const expected: ExpectedAnswer = JSON.parse(expectedAnswerJson);
  const normalizedAnswer = answer.toLowerCase().trim();

  if (expected.exact) {
    return normalizedAnswer === expected.exact.toLowerCase();
  }

  if (expected.keywords && expected.keywords.length > 0) {
    // Must match at least 2 keywords (or 1 if only 1 keyword)
    const minMatches = Math.min(2, expected.keywords.length);
    const matches = expected.keywords.filter((kw) =>
      normalizedAnswer.includes(kw.toLowerCase()),
    );
    return matches.length >= minMatches;
  }

  return false;
}
