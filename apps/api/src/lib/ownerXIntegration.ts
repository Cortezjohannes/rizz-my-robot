import { generateClaimToken, hashOpaqueSecret, verifyClaimToken } from './claimAuth.js';

export const OWNER_X_INTEGRATION_BASE_URL = process.env.OWNER_X_INTEGRATION_URL ?? 'https://rizzmyrobot.com/x-link';

export function generateOwnerXIntegrationToken(linkId: string): string {
  return generateClaimToken(linkId);
}

export function verifyOwnerXIntegrationToken(token: string): string | null {
  return verifyClaimToken(token);
}

export function hashOwnerXIntegrationToken(token: string): string {
  return hashOpaqueSecret(token);
}

export function buildOwnerXIntegrationUrl(token: string): string {
  return `${OWNER_X_INTEGRATION_BASE_URL}/${token}`;
}

export function ownerXIntegrationExpiryDate(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}
