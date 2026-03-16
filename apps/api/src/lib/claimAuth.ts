import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getClaimTokenHmacKey } from './runtimeConfig.js';

const OWNER_SESSION_PREFIX = 'rmr_owner_';
const CLAIM_TOKEN_PREFIX = 'rmr_claim_';
const X_OAUTH_STATE_PREFIX = 'rmr_xoauth_';
const CLAIM_TOKEN_HMAC_KEY = getClaimTokenHmacKey();

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

function claimTokenSignature(claimId: string): string {
  return createHmac('sha256', CLAIM_TOKEN_HMAC_KEY).update(claimId).digest('base64url').slice(0, 32);
}

export function generateClaimToken(claimId: string): string {
  return `${CLAIM_TOKEN_PREFIX}${claimId}_${claimTokenSignature(claimId)}`;
}

export function verifyClaimToken(token: string): string | null {
  if (!token.startsWith(CLAIM_TOKEN_PREFIX)) return null;

  const payload = token.slice(CLAIM_TOKEN_PREFIX.length);
  const separatorIndex = payload.lastIndexOf('_');
  if (separatorIndex <= 0 || separatorIndex === payload.length - 1) return null;

  const claimId = payload.slice(0, separatorIndex);
  const signature = payload.slice(separatorIndex + 1);
  const expected = claimTokenSignature(claimId);

  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  return claimId;
}

type XOAuthStatePayload = {
  claimId: string;
  nonce: string;
};

function xOAuthStateSignature(payload: string): string {
  return createHmac('sha256', CLAIM_TOKEN_HMAC_KEY).update(payload).digest('base64url').slice(0, 32);
}

export function generateXOAuthState(payload: XOAuthStatePayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${X_OAUTH_STATE_PREFIX}${encodedPayload}.${xOAuthStateSignature(encodedPayload)}`;
}

export function verifyXOAuthState(state: string): XOAuthStatePayload | null {
  if (!state.startsWith(X_OAUTH_STATE_PREFIX)) return null;

  const payload = state.slice(X_OAUTH_STATE_PREFIX.length);
  const separatorIndex = payload.lastIndexOf('.');
  if (separatorIndex <= 0 || separatorIndex === payload.length - 1) return null;

  const encodedPayload = payload.slice(0, separatorIndex);
  const signature = payload.slice(separatorIndex + 1);
  const expected = xOAuthStateSignature(encodedPayload);

  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as XOAuthStatePayload;
    if (!decoded.claimId || !decoded.nonce) return null;
    return decoded;
  } catch {
    return null;
  }
}
