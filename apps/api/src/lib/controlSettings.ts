import { prisma, Prisma } from '@rmr/db';

const VERIFICATION_REQUIREMENTS_KEY = 'verification_requirements';

export interface VerificationRequirements {
  requireEmailVerification: boolean;
  requireXVerification: boolean;
}

export const X_VERIFICATION_EXEMPT_FLAG = 'x_verification_exempt';

export const DEFAULT_VERIFICATION_REQUIREMENTS: VerificationRequirements = {
  requireEmailVerification: true,
  requireXVerification: true,
};

function parseVerificationRequirements(value: Prisma.JsonValue | null | undefined): VerificationRequirements {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_VERIFICATION_REQUIREMENTS;
  }

  const raw = value as Record<string, unknown>;
  return {
    requireEmailVerification:
      typeof raw.require_email_verification === 'boolean'
        ? raw.require_email_verification
        : DEFAULT_VERIFICATION_REQUIREMENTS.requireEmailVerification,
    requireXVerification:
      typeof raw.require_x_verification === 'boolean'
        ? raw.require_x_verification
        : DEFAULT_VERIFICATION_REQUIREMENTS.requireXVerification,
  };
}

export async function getVerificationRequirements(): Promise<VerificationRequirements> {
  const setting = await prisma.controlSetting.findUnique({
    where: { key: VERIFICATION_REQUIREMENTS_KEY },
    select: { value: true },
  });
  return parseVerificationRequirements(setting?.value);
}

export async function setVerificationRequirements(input: VerificationRequirements) {
  const value = {
    require_email_verification: input.requireEmailVerification,
    require_x_verification: input.requireXVerification,
  } satisfies Prisma.InputJsonObject;

  const setting = await prisma.controlSetting.upsert({
    where: { key: VERIFICATION_REQUIREMENTS_KEY },
    update: { value },
    create: { key: VERIFICATION_REQUIREMENTS_KEY, value },
    select: { key: true, updatedAt: true },
  });

  return {
    key: setting.key,
    updatedAt: setting.updatedAt,
    ...input,
  };
}

export function isXVerificationSatisfied(
  twitterVerified: boolean,
  requirements: VerificationRequirements,
  xVerificationExempt = false,
): boolean {
  return !requirements.requireXVerification || xVerificationExempt || twitterVerified;
}

export function isEmailVerificationSatisfied(
  emailVerified: boolean,
  requirements: VerificationRequirements,
): boolean {
  return !requirements.requireEmailVerification || emailVerified;
}

export function buildAgentVerificationWhere(requirements: VerificationRequirements) {
  return requirements.requireXVerification ? { twitterVerified: true } : {};
}

export function derivePoolStatusFromVerification(input: {
  moderationStatus: string;
  twitterVerified: boolean;
  profileDeckCompletedAt: Date | null;
  requirements: VerificationRequirements;
  safetyFlags?: string[] | null;
}) {
  if (input.moderationStatus === 'suspended') return 'paused';
  const xVerificationExempt = Boolean(input.safetyFlags?.includes(X_VERIFICATION_EXEMPT_FLAG));
  if (!isXVerificationSatisfied(input.twitterVerified, input.requirements, xVerificationExempt)) return 'pending_verification';
  if (!input.profileDeckCompletedAt) return 'pending_profile';
  return 'active';
}
