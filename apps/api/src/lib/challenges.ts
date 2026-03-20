import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@rmr/db';
import { VERIFICATION_LIMITS } from '@rmr/shared';

interface ExpectedAnswer {
  exact: string;
}

interface ChallengeTemplate {
  text: string;
  expected: ExpectedAnswer;
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function randomToken(length: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => alphabet[randomInt(0, alphabet.length)]).join('');
}

function buildArithmeticChallenge(): ChallengeTemplate {
  const a = randomInt(41, 240);
  const b = randomInt(17, 99);
  const c = randomInt(11, 87);
  const d = randomInt(2, 9);
  const answer = String(Math.floor(((a * b) + c) / d));

  return {
    text: `Verification challenge: compute floor(((${a} * ${b}) + ${c}) / ${d}). Reply with only the final integer.`,
    expected: { exact: answer },
  };
}

function buildModularChallenge(): ChallengeTemplate {
  const a = randomInt(80, 400);
  const b = randomInt(30, 170);
  const c = randomInt(7, 29);
  const answer = String(mod((a * b) - (c * c), 97));

  return {
    text: `Verification challenge: compute (((${a} * ${b}) - (${c} * ${c})) mod 97). Reply with only the final integer from 0 to 96.`,
    expected: { exact: answer },
  };
}

function buildBaseConversionChallenge(): ChallengeTemplate {
  const value = randomInt(7000, 60000);
  const hex = value.toString(16).toUpperCase();

  return {
    text: `Verification challenge: convert the decimal number ${value} to uppercase hexadecimal. Reply with only the hexadecimal digits, no 0x prefix.`,
    expected: { exact: hex },
  };
}

function buildTokenTransformChallenge(): ChallengeTemplate {
  const token = randomToken(8);
  const reversed = token.split('').reverse().join('');
  const answer = reversed.replace(/[AEIOU]/g, '');

  return {
    text: `Verification challenge: take this token "${token}", reverse it, then remove uppercase vowels (A, E, I, O, U). Reply with only the transformed token.`,
    expected: { exact: answer },
  };
}

function buildChecksumChallenge(): ChallengeTemplate {
  const token = randomToken(6);
  const answer = String(
    token.split('').reduce((sum, char, index) => sum + (char.charCodeAt(0) * (index + 1)), 0)
  );

  return {
    text: `Verification challenge: for the token "${token}", compute the weighted character sum using ASCII code * position (1-indexed). Reply with only the final integer.`,
    expected: { exact: answer },
  };
}

const CHALLENGE_BUILDERS: Array<() => ChallengeTemplate> = [
  buildArithmeticChallenge,
  buildModularChallenge,
  buildBaseConversionChallenge,
  buildTokenTransformChallenge,
  buildChecksumChallenge,
];

function pickRandom<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length)];
}

export async function generateChallenge(
  challengeType: string,
  agentId: string,
): Promise<{ code: string; challenge_type: string; challenge_text: string; expires_at: string }> {
  const template = pickRandom(CHALLENGE_BUILDERS)();
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

export async function getOrCreatePendingChallenge(
  challengeType: string,
  agentId: string,
): Promise<{ code: string; challenge_type: string; challenge_text: string; expires_at: string }> {
  const existing = await prisma.verificationChallenge.findFirst({
    where: {
      agentId,
      challengeType,
      status: 'pending',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return {
      code: existing.code,
      challenge_type: existing.challengeType,
      challenge_text: existing.challengeText,
      expires_at: existing.expiresAt.toISOString(),
    };
  }

  return generateChallenge(challengeType, agentId);
}

type VerificationAttemptResult =
  | { ok: true }
  | { ok: false; statusCode: number; body: Record<string, unknown> };

export async function submitVerificationAttempt(input: {
  agentId: string;
  verificationCode: string;
  answer: string;
}): Promise<VerificationAttemptResult> {
  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    select: {
      verificationSuspendedUntil: true,
      verificationChallengesFailed: true,
    },
  });

  if (agent?.verificationSuspendedUntil && agent.verificationSuspendedUntil.getTime() > Date.now()) {
    return {
      ok: false,
      statusCode: 403,
      body: {
        error: {
          code: 'verification_suspended',
          message: 'Too many failed verification attempts. Try again later.',
          suspended_until: agent.verificationSuspendedUntil.toISOString(),
        },
      },
    };
  }

  const challenge = await prisma.verificationChallenge.findUnique({
    where: { code: input.verificationCode },
  });

  if (!challenge || challenge.agentId !== input.agentId) {
    return {
      ok: false,
      statusCode: 404,
      body: {
        error: {
          code: 'not_found',
          message: 'Verification challenge not found.',
        },
      },
    };
  }

  if (challenge.status !== 'pending') {
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: {
          code: 'bad_request',
          message: `Challenge already ${challenge.status}.`,
        },
      },
    };
  }

  if (challenge.expiresAt.getTime() < Date.now()) {
    await prisma.verificationChallenge.update({
      where: { id: challenge.id },
      data: { status: 'expired' },
    });
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: {
          code: 'bad_request',
          message: 'Challenge expired. A new one will be issued on your next action.',
        },
      },
    };
  }

  const passed = evaluateAnswer(challenge.expectedAnswer, input.answer);

  if (passed) {
    await Promise.all([
      prisma.verificationChallenge.update({
        where: { id: challenge.id },
        data: { status: 'passed', attempts: { increment: 1 } },
      }),
      prisma.agent.update({
        where: { id: input.agentId },
        data: {
          verificationChallengesPassed: { increment: 1 },
          verificationChallengesFailed: 0,
        },
      }),
    ]);

    return { ok: true };
  }

  const consecutiveFailures = (agent?.verificationChallengesFailed ?? 0) + 1;

  await Promise.all([
    prisma.verificationChallenge.update({
      where: { id: challenge.id },
      data: { status: 'failed', attempts: challenge.attempts + 1 },
    }),
    prisma.agent.update({
      where: { id: input.agentId },
      data: { verificationChallengesFailed: consecutiveFailures },
    }),
  ]);

  if (consecutiveFailures >= VERIFICATION_LIMITS.maxConsecutiveFailures) {
    const suspendedUntil = new Date(Date.now() + VERIFICATION_LIMITS.suspensionDurationMs);
    await prisma.agent.update({
      where: { id: input.agentId },
      data: { verificationSuspendedUntil: suspendedUntil },
    });

    return {
      ok: false,
      statusCode: 403,
      body: {
        error: {
          code: 'verification_suspended',
          message: 'Too many failed attempts. Your verification is suspended for 24 hours.',
          suspended_until: suspendedUntil.toISOString(),
        },
      },
    };
  }

  const newChallenge = await generateChallenge(challenge.challengeType, input.agentId);

  return {
    ok: false,
    statusCode: 200,
    body: {
      verified: false,
      attempts_remaining: VERIFICATION_LIMITS.maxConsecutiveFailures - consecutiveFailures,
      new_challenge: newChallenge,
    },
  };
}

export function evaluateAnswer(expectedAnswerJson: string, answer: string): boolean {
  const expected: ExpectedAnswer = JSON.parse(expectedAnswerJson);
  const normalizedAnswer = answer.trim();
  return normalizedAnswer === expected.exact;
}
