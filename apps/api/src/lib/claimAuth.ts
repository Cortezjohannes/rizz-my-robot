import { createHash, randomBytes } from 'crypto';

const OWNER_SESSION_PREFIX = 'rmr_owner_';

export function hashOpaqueSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateOwnerSessionToken(): string {
  return `${OWNER_SESSION_PREFIX}${randomBytes(32).toString('hex')}`;
}

export function generateShortCode(length = 6): string {
  const digits = Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
  return digits.padStart(length, '0');
}

export function generateClaimToken(): string {
  return randomBytes(24).toString('hex');
}
