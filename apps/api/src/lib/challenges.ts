import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@rmr/db';
import { VERIFICATION_LIMITS } from '@rmr/shared';

interface ExpectedAnswer {
  exact: string;
  format: 'integer' | 'uppercase_hex' | 'token';
  case_sensitive?: boolean;
  hint?: string;
}

interface ChallengeTemplate {
  text: string;
  expected: ExpectedAnswer;
}

type SerializedChallenge = {
  code: string;
  challenge_type: string;
  challenge_text: string;
  expires_at: string;
  answer_format: ExpectedAnswer['format'];
  answer_hint: string | null;
};

const INTEGER_ANSWER_HINT = 'Answer with the number. Example: 42';

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
    text: `Verification challenge: compute floor(((${a} * ${b}) + ${c}) / ${d}). Answer with the number. Example: 42.`,
    expected: { exact: answer, format: 'integer', hint: INTEGER_ANSWER_HINT },
  };
}

function buildModularChallenge(): ChallengeTemplate {
  const a = randomInt(80, 400);
  const b = randomInt(30, 170);
  const c = randomInt(7, 29);
  const answer = String(mod((a * b) - (c * c), 97));

  return {
    text: `Verification challenge: compute (((${a} * ${b}) - (${c} * ${c})) mod 97). Answer with the number. Example: 42.`,
    expected: { exact: answer, format: 'integer', hint: INTEGER_ANSWER_HINT },
  };
}

function buildBaseConversionChallenge(): ChallengeTemplate {
  const value = randomInt(7000, 60000);
  const hex = value.toString(16).toUpperCase();

  return {
    text: `Verification challenge: convert the decimal number ${value} to uppercase hexadecimal. Reply with only the hexadecimal digits, no 0x prefix.`,
    expected: { exact: hex, format: 'uppercase_hex', case_sensitive: false, hint: 'Reply with only the hexadecimal digits. Uppercase is preferred, but lowercase is accepted.' },
  };
}

function buildTokenTransformChallenge(): ChallengeTemplate {
  const token = randomToken(8);
  const reversed = token.split('').reverse().join('');
  const answer = reversed.replace(/[AEIOU]/g, '');

  return {
    text: `Verification challenge: take this token "${token}", reverse it, then remove uppercase vowels (A, E, I, O, U). Reply with only the transformed token.`,
    expected: { exact: answer, format: 'token', case_sensitive: false, hint: 'Reply with only the transformed token, no quotes or extra words.' },
  };
}

function buildChecksumChallenge(): ChallengeTemplate {
  const token = randomToken(6);
  const answer = String(
    token.split('').reduce((sum, char, index) => sum + (char.charCodeAt(0) * (index + 1)), 0)
  );

  return {
    text: `Verification challenge: for the token "${token}", compute the weighted character sum using ASCII code * position (1-indexed). Answer with the number. Example: 42.`,
    expected: { exact: answer, format: 'integer', hint: INTEGER_ANSWER_HINT },
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

async function createChallengeRecord(
  db: typeof prisma,
  challengeType: string,
  agentId: string,
) {
  const template = pickRandom(CHALLENGE_BUILDERS)();
  const code = randomUUID().replace(/-/g, '').slice(0, 16);
  return db.verificationChallenge.create({
    data: {
      agentId,
      challengeType,
      challengeText: template.text,
      expectedAnswer: JSON.stringify(template.expected),
      code,
      expiresAt: new Date(Date.now() + VERIFICATION_LIMITS.challengeExpiryMs),
    },
  });
}

function serializeChallengeTemplate(
  challengeType: string,
  challenge: Awaited<ReturnType<typeof createChallengeRecord>>,
): SerializedChallenge {
  const expected = JSON.parse(challenge.expectedAnswer) as ExpectedAnswer;
  return {
    code: challenge.code,
    challenge_type: challengeType,
    challenge_text: challenge.challengeText,
    expires_at: challenge.expiresAt.toISOString(),
    answer_format: expected.format,
    answer_hint: expected.hint ?? null,
  };
}

export async function generateChallenge(
  challengeType: string,
  agentId: string,
): Promise<SerializedChallenge> {
  const challenge = await createChallengeRecord(prisma, challengeType, agentId);
  return serializeChallengeTemplate(challengeType, challenge);
}

function serializeChallengeRecord(
  challenge: {
    code: string;
    challengeType: string;
    challengeText: string;
    expectedAnswer: string;
    expiresAt: Date;
  },
): SerializedChallenge {
  const expected = JSON.parse(challenge.expectedAnswer) as ExpectedAnswer;
  return {
    code: challenge.code,
    challenge_type: challenge.challengeType,
    challenge_text: challenge.challengeText,
    expires_at: challenge.expiresAt.toISOString(),
    answer_format: expected.format,
    answer_hint: expected.hint ?? null,
  };
}

async function rotateChallenge(input: {
  challengeId: string;
  challengeType: string;
  agentId: string;
  status: 'expired' | 'failed';
}) {
  await prisma.verificationChallenge.update({
    where: { id: input.challengeId },
    data: { status: input.status },
  });
  return generateChallenge(input.challengeType, input.agentId);
}

async function expirePendingChallenges(agentId: string) {
  await prisma.verificationChallenge.updateMany({
    where: {
      agentId,
      status: 'pending',
      expiresAt: { lte: new Date() },
    },
    data: { status: 'expired' },
  });
}

async function issueSessionChallenge(input: {
  agentId: string;
  challengeType: string;
}): Promise<
  | { ok: true; challenge: SerializedChallenge }
  | { ok: false; suspendedUntil: Date }
> {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({
      where: { id: input.agentId },
      select: {
        verificationSuspendedUntil: true,
        verificationChallengesIssued: true,
        verificationSessionStartedAt: true,
      },
    });

    if (!agent) {
      throw new Error('agent_not_found');
    }

    if (agent.verificationSuspendedUntil && agent.verificationSuspendedUntil.getTime() > now.getTime()) {
      return { ok: false as const, suspendedUntil: agent.verificationSuspendedUntil };
    }

    const needsSessionReset = !agent.verificationSessionStartedAt
      || (agent.verificationSuspendedUntil && agent.verificationSuspendedUntil.getTime() <= now.getTime());

    const issuedCount = needsSessionReset ? 0 : agent.verificationChallengesIssued;
    if (issuedCount >= VERIFICATION_LIMITS.maxChallengesPerSession) {
      const suspendedUntil = new Date(now.getTime() + VERIFICATION_LIMITS.suspensionDurationMs);
      await tx.agent.update({
        where: { id: input.agentId },
        data: {
          verificationSuspendedUntil: suspendedUntil,
          verificationChallengesFailed: 0,
          verificationChallengesIssued: 0,
          verificationSessionStartedAt: null,
        },
      });
      return { ok: false as const, suspendedUntil };
    }

    const challenge = await createChallengeRecord(tx as typeof prisma, input.challengeType, input.agentId);
    await tx.agent.update({
      where: { id: input.agentId },
      data: {
        verificationSuspendedUntil: null,
        verificationSessionStartedAt: needsSessionReset ? now : agent.verificationSessionStartedAt,
        verificationChallengesIssued: issuedCount + 1,
      },
    });
    return { ok: true as const, challenge: serializeChallengeTemplate(input.challengeType, challenge) };
  });

  return result;
}

function buildVerificationLockedBody(suspendedUntil: Date) {
  return {
    error: {
      code: 'verification_suspended',
      message: 'Verification temporarily locked. Try again in 10 minutes.',
      suspended_until: suspendedUntil.toISOString(),
    },
  };
}

export async function getOrCreatePendingChallenge(
  challengeType: string,
  agentId: string,
): Promise<SerializedChallenge> {
  await expirePendingChallenges(agentId);
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
    if (existing.attempts >= VERIFICATION_LIMITS.maxAttemptsPerChallenge) {
      await prisma.verificationChallenge.update({
        where: { id: existing.id },
        data: { status: 'failed' },
      });
    } else {
      return serializeChallengeRecord(existing);
    }
  }

  const issued = await issueSessionChallenge({ agentId, challengeType });
  if (!issued.ok) {
    const fallback = await prisma.verificationChallenge.findFirst({
      where: {
        agentId,
        challengeType,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (fallback) return serializeChallengeRecord(fallback);
    return generateChallenge(challengeType, agentId);
  }
  return issued.challenge;
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
      body: buildVerificationLockedBody(agent.verificationSuspendedUntil),
    };
  }

  await expirePendingChallenges(input.agentId);

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
    const refreshedChallenge = await issueSessionChallenge({
      challengeType: challenge.challengeType,
      agentId: input.agentId,
    });
    return {
      ok: false,
      statusCode: refreshedChallenge.ok ? 409 : 403,
      body: refreshedChallenge.ok
        ? {
            error: {
              code: 'verification_challenge_expired',
              message: 'Challenge expired. A fresh challenge has been generated for you.',
              refresh_strategy: 'use_returned_challenge',
              challenge: refreshedChallenge.challenge,
            },
          }
        : buildVerificationLockedBody(refreshedChallenge.suspendedUntil),
    };
  }

  const expected = JSON.parse(challenge.expectedAnswer) as ExpectedAnswer;
  const normalizedAnswer = normalizeAnswerForFormat(expected, input.answer);
  if (!normalizedAnswer) {
    return {
      ok: false,
      statusCode: 422,
      body: {
        verified: false,
        error: {
          code: 'verification_answer_format_invalid',
          message: `Answer format invalid. Expected ${expected.format}.`,
          expected_format: expected.format,
          answer_hint: expected.hint ?? 'Reply with only the final answer in the requested format.',
        },
        challenge: serializeChallengeRecord(challenge),
      },
    };
  }

  const passed = evaluateAnswer(expected, input.answer);

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
          verificationChallengesIssued: 0,
          verificationSessionStartedAt: null,
          verificationSuspendedUntil: null,
        },
      }),
    ]);

    return { ok: true };
  }

  const consecutiveFailures = (agent?.verificationChallengesFailed ?? 0) + 1;
  const nextAttemptCount = challenge.attempts + 1;
  const challengeAttemptLimitReached = nextAttemptCount >= VERIFICATION_LIMITS.maxAttemptsPerChallenge;

  await Promise.all([
    prisma.verificationChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts: { increment: 1 },
        ...(challengeAttemptLimitReached ? { status: 'failed' } : {}),
      },
    }),
    prisma.agent.update({
      where: { id: input.agentId },
      data: { verificationChallengesFailed: consecutiveFailures },
    }),
  ]);

  if (consecutiveFailures >= VERIFICATION_LIMITS.maxConsecutiveFailures) {
    const suspendedUntil = new Date(Date.now() + VERIFICATION_LIMITS.suspensionDurationMs);
    await Promise.all([
      prisma.verificationChallenge.update({
        where: { id: challenge.id },
        data: { status: 'failed' },
      }),
      prisma.agent.update({
        where: { id: input.agentId },
        data: {
          verificationSuspendedUntil: suspendedUntil,
          verificationChallengesFailed: 0,
          verificationChallengesIssued: 0,
          verificationSessionStartedAt: null,
        },
      }),
    ]);

    return {
      ok: false,
      statusCode: 403,
      body: buildVerificationLockedBody(suspendedUntil),
    };
  }

  if (challengeAttemptLimitReached) {
    const refreshedChallenge = await issueSessionChallenge({
      challengeType: challenge.challengeType,
      agentId: input.agentId,
    });
    return {
      ok: false,
      statusCode: refreshedChallenge.ok ? 409 : 403,
      body: refreshedChallenge.ok
        ? {
            verified: false,
            attempts_remaining: VERIFICATION_LIMITS.maxConsecutiveFailures - consecutiveFailures,
            message: 'That answer did not match. This challenge hit its attempt limit, so a fresh challenge has been issued.',
            retry_hint: expected.hint ?? 'Answer with the number. Example: 42',
            challenge: refreshedChallenge.challenge,
          }
        : buildVerificationLockedBody(refreshedChallenge.suspendedUntil),
    };
  }

  return {
    ok: false,
    statusCode: 422,
    body: {
      verified: false,
      attempts_remaining: VERIFICATION_LIMITS.maxConsecutiveFailures - consecutiveFailures,
      challenge_attempts_remaining: VERIFICATION_LIMITS.maxAttemptsPerChallenge - nextAttemptCount,
      message: 'That answer did not match. The same challenge is still active for now.',
      retry_hint: expected.hint ?? 'Reply with only the exact final answer.',
      challenge: serializeChallengeRecord(challenge),
    },
  };
}

function extractJsonAnswerCandidate(answer: string): string | null {
  try {
    const parsed = JSON.parse(answer);
    if (typeof parsed === 'string' || typeof parsed === 'number') return String(parsed);
    if (parsed && typeof parsed === 'object' && 'answer' in parsed) {
      const candidate = (parsed as { answer?: unknown }).answer;
      if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeIntegerCandidate(answer: string): string | null {
  const jsonCandidate = extractJsonAnswerCandidate(answer);
  const source = (jsonCandidate ?? answer).trim();
  const match = source.match(/^-?\d+$/) ?? source.match(/(-?\d+)/);
  return match ? match[1] ?? match[0] : null;
}

function normalizeHexCandidate(answer: string): string | null {
  const jsonCandidate = extractJsonAnswerCandidate(answer);
  const source = (jsonCandidate ?? answer).trim().replace(/^0x/i, '');
  const compact = source.replace(/\s+/g, '');
  const exact = compact.match(/^[A-Fa-f0-9]+$/);
  if (exact) return exact[0].toUpperCase();
  const embedded = compact.match(/([A-Fa-f0-9]+)/);
  return embedded ? embedded[1].toUpperCase() : null;
}

function normalizeTokenCandidate(answer: string, caseSensitive = false): string | null {
  const jsonCandidate = extractJsonAnswerCandidate(answer);
  const source = (jsonCandidate ?? answer).trim().replace(/^["'`]+|["'`]+$/g, '');
  const compact = source.replace(/\s+/g, '');
  if (!compact) return null;
  return caseSensitive ? compact : compact.toUpperCase();
}

function normalizeAnswerForFormat(expected: ExpectedAnswer, answer: string): string | null {
  if (expected.format === 'integer') {
    return normalizeIntegerCandidate(answer);
  }

  if (expected.format === 'uppercase_hex') {
    return normalizeHexCandidate(answer);
  }

  return normalizeTokenCandidate(answer, expected.case_sensitive ?? false);
}

export function evaluateAnswer(expected: ExpectedAnswer, answer: string): boolean {
  if (expected.format === 'integer') {
    return normalizeAnswerForFormat(expected, answer) === expected.exact;
  }

  if (expected.format === 'uppercase_hex') {
    return normalizeAnswerForFormat(expected, answer) === expected.exact.toUpperCase();
  }

  const normalizedAnswer = normalizeAnswerForFormat(expected, answer);
  const normalizedExpected = expected.case_sensitive ? expected.exact : expected.exact.toUpperCase();
  return normalizedAnswer === normalizedExpected;
}
