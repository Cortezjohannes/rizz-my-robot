import { createHash, randomBytes } from 'crypto';
import { buildClaimUrl } from './claims.js';
import { generateClaimToken, generateXOAuthState } from './claimAuth.js';

const X_CLIENT_ID = process.env.X_CLIENT_ID;
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const X_OAUTH_REDIRECT_URI = process.env.X_OAUTH_REDIRECT_URI;
const X_OAUTH_SCOPES = process.env.X_OAUTH_SCOPES ?? 'users.read';

export type XVerificationResult =
  | {
      status: 'verified';
      account: {
        user_id: string;
        handle: string;
        display_name: string | null;
        profile_image_url: string | null;
      };
    }
  | { status: 'not_found'; reason: string }
  | { status: 'unavailable'; reason: string };

export function buildClaimTweetTemplate(handle: string, code: string): string {
  return `I'm claiming @${handle} on Rizz My Robot. My verification code is ${code}`;
}

export function generatePkceVerifier(): string {
  return randomBytes(48).toString('base64url');
}

export function generateOAuthNonce(): string {
  return randomBytes(24).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function hasXOAuthConfig(): boolean {
  return Boolean(X_CLIENT_ID && X_OAUTH_REDIRECT_URI);
}

export function buildXAuthorizationUrl(input: {
  claimId: string;
  nonce: string;
  codeVerifier: string;
}): string {
  if (!X_CLIENT_ID || !X_OAUTH_REDIRECT_URI) {
    throw new Error('X OAuth is not configured.');
  }

  const state = generateXOAuthState({
    claimId: input.claimId,
    nonce: input.nonce,
  });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: X_CLIENT_ID,
    redirect_uri: X_OAUTH_REDIRECT_URI,
    scope: X_OAUTH_SCOPES,
    state,
    code_challenge: pkceChallenge(input.codeVerifier),
    code_challenge_method: 'S256',
  });

  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

function claimRedirectUrl(claimId: string, params: Record<string, string>): string {
  const token = generateClaimToken(claimId);
  const url = new URL(buildClaimUrl(token));
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

export function buildXCallbackSuccessUrl(claimId: string): string {
  return claimRedirectUrl(claimId, { x_status: 'verified' });
}

export function buildXCallbackErrorUrl(claimId: string, message: string): string {
  return claimRedirectUrl(claimId, {
    x_status: 'error',
    x_error: message.slice(0, 200),
  });
}

export async function exchangeXOAuthCode(input: {
  code: string;
  codeVerifier: string;
}): Promise<{ access_token: string } | null> {
  if (!X_CLIENT_ID || !X_OAUTH_REDIRECT_URI) return null;

  const body = new URLSearchParams({
    code: input.code,
    grant_type: 'authorization_code',
    client_id: X_CLIENT_ID,
    redirect_uri: X_OAUTH_REDIRECT_URI,
    code_verifier: input.codeVerifier,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (X_CLIENT_SECRET) {
    const basic = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    console.error('[x-verify] oauth token exchange failed', response.status, await response.text().catch(() => ''));
    return null;
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) return null;
  return { access_token: data.access_token };
}

async function fetchAuthenticatedXUser(accessToken: string): Promise<{
  id: string;
  username: string;
  name: string | null;
  profile_image_url: string | null;
  protected: boolean;
} | null> {
  const response = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,protected', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    console.error('[x-verify] users/me failed', response.status, await response.text().catch(() => ''));
    return null;
  }

  const payload = (await response.json()) as {
    data?: { id: string; username: string; name?: string; profile_image_url?: string; protected?: boolean };
  };
  if (!payload.data?.id || !payload.data.username) return null;

  return {
    id: payload.data.id,
    username: payload.data.username.toLowerCase(),
    name: payload.data.name ?? null,
    profile_image_url: payload.data.profile_image_url ?? null,
    protected: Boolean(payload.data.protected),
  };
}

export async function verifyXAccountTweet(input: {
  claimedHandle: string;
  code: string;
  oauthCode: string;
  codeVerifier: string;
}): Promise<XVerificationResult> {
  if (!hasXOAuthConfig()) {
    return { status: 'unavailable', reason: 'X OAuth is not configured.' };
  }

  try {
    const token = await exchangeXOAuthCode({
      code: input.oauthCode,
      codeVerifier: input.codeVerifier,
    });
    if (!token) {
      return { status: 'unavailable', reason: 'Failed to exchange X OAuth code.' };
    }

    const user = await fetchAuthenticatedXUser(token.access_token);
    if (!user) {
      return { status: 'unavailable', reason: 'Failed to fetch authenticated X account.' };
    }

    if (user.username !== input.claimedHandle.toLowerCase()) {
      return {
        status: 'not_found',
        reason: `You logged into @${user.username}, but the claim expects @${input.claimedHandle}.`,
      };
    }

    return {
      status: 'verified',
      account: {
        user_id: user.id,
        handle: user.username,
        display_name: user.name,
        profile_image_url: user.profile_image_url,
      },
    };
  } catch (err) {
    console.error('[x-verify] verification request failed', err);
    return { status: 'unavailable', reason: 'X verification request failed.' };
  }
}
