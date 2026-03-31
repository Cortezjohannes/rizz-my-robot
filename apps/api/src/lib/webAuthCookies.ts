import type { FastifyReply, FastifyRequest } from 'fastify';

const isProduction = process.env.NODE_ENV === 'production';
const AGENT_WEB_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const OWNER_SESSION_COOKIE = 'rmr_owner_session';
export const OWNER_PRESENT_COOKIE = 'rmr_owner_present';
export const AGENT_API_KEY_COOKIE = 'rmr_agent_api_key';
export const AGENT_PRESENT_COOKIE = 'rmr_agent_present';

function serializeCookie(input: {
  name: string;
  value: string;
  maxAge?: number;
  httpOnly?: boolean;
}) {
  const parts = [
    `${input.name}=${encodeURIComponent(input.value)}`,
    'Path=/',
    'SameSite=Lax',
  ];

  if (typeof input.maxAge === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(input.maxAge))}`);
  }
  if (input.httpOnly) {
    parts.push('HttpOnly');
  }
  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function appendSetCookie(reply: FastifyReply, cookie: string) {
  const current = reply.getHeader('Set-Cookie');
  if (!current) {
    reply.header('Set-Cookie', cookie);
    return;
  }
  if (Array.isArray(current)) {
    reply.header('Set-Cookie', [...current.map(String), cookie]);
    return;
  }
  reply.header('Set-Cookie', [String(current), cookie]);
}

export function readCookie(request: FastifyRequest, name: string): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;

  for (const part of raw.split(';')) {
    const [cookieName, ...rest] = part.trim().split('=');
    if (cookieName !== name) continue;
    const value = rest.join('=').trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function setOwnerSessionCookies(reply: FastifyReply, token: string, expiresAt: Date) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  appendSetCookie(reply, serializeCookie({
    name: OWNER_SESSION_COOKIE,
    value: token,
    maxAge,
    httpOnly: true,
  }));
  appendSetCookie(reply, serializeCookie({
    name: OWNER_PRESENT_COOKIE,
    value: '1',
    maxAge,
  }));
  clearAgentSessionCookies(reply);
}

export function clearOwnerSessionCookies(reply: FastifyReply) {
  appendSetCookie(reply, serializeCookie({
    name: OWNER_SESSION_COOKIE,
    value: '',
    maxAge: 0,
    httpOnly: true,
  }));
  appendSetCookie(reply, serializeCookie({
    name: OWNER_PRESENT_COOKIE,
    value: '',
    maxAge: 0,
  }));
}

export function setAgentSessionCookies(reply: FastifyReply, apiKey: string) {
  appendSetCookie(reply, serializeCookie({
    name: AGENT_API_KEY_COOKIE,
    value: apiKey,
    maxAge: AGENT_WEB_SESSION_TTL_SECONDS,
    httpOnly: true,
  }));
  appendSetCookie(reply, serializeCookie({
    name: AGENT_PRESENT_COOKIE,
    value: '1',
    maxAge: AGENT_WEB_SESSION_TTL_SECONDS,
  }));
}

export function clearAgentSessionCookies(reply: FastifyReply) {
  appendSetCookie(reply, serializeCookie({
    name: AGENT_API_KEY_COOKIE,
    value: '',
    maxAge: 0,
    httpOnly: true,
  }));
  appendSetCookie(reply, serializeCookie({
    name: AGENT_PRESENT_COOKIE,
    value: '',
    maxAge: 0,
  }));
}
