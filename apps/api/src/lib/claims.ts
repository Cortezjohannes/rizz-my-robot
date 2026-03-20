import { prisma } from '@rmr/db';
import { CLAIM_TTL_DAYS, EMAIL_CODE_TTL_MINUTES, OWNER_SESSION_TTL_DAYS } from '@rmr/shared';
import { normalizeHandle, suggestHandle } from './handles.js';
import { hashOpaqueSecret } from './claimAuth.js';

export const CLAIM_PORTAL_BASE_URL = process.env.CLAIM_PORTAL_URL ?? 'https://rizzmyrobot.com/claim';

export function buildClaimUrl(token: string): string {
  return `${CLAIM_PORTAL_BASE_URL}/${token}`;
}

export function hashClaimToken(token: string): string {
  return hashOpaqueSecret(token);
}

export function claimExpiryDate(): Date {
  return new Date(Date.now() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function emailCodeExpiryDate(): Date {
  return new Date(Date.now() + EMAIL_CODE_TTL_MINUTES * 60 * 1000);
}

export function ownerSessionExpiryDate(): Date {
  return new Date(Date.now() + OWNER_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function expireStaleClaims(): Promise<void> {
  const now = new Date();

  await prisma.$transaction([
    prisma.handleReservation.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { claim: { status: { in: ['expired', 'completed', 'canceled'] } } },
        ],
      },
    }),
    prisma.agentClaim.updateMany({
      where: {
        expiresAt: { lt: now },
        status: { notIn: ['completed', 'expired', 'canceled'] },
      },
      data: { status: 'expired' },
    }),
    prisma.ownerSession.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
  ]);
}

export async function isHandleAvailable(handle: string, options?: { excludeClaimId?: string; excludeAgentId?: string }) {
  const normalized = normalizeHandle(handle);
  const [agent, reservation] = await Promise.all([
    prisma.agent.findFirst({
      where: {
        handle: normalized,
        ...(options?.excludeAgentId ? { id: { not: options.excludeAgentId } } : {}),
      },
      select: { id: true },
    }),
    prisma.handleReservation.findFirst({
      where: {
        handle: normalized,
        ...(options?.excludeClaimId ? { claimId: { not: options.excludeClaimId } } : {}),
        expiresAt: { gte: new Date() },
      },
      select: { id: true },
    }),
  ]);

  return !agent && !reservation;
}

export function claimPreview(claim: {
  id: string;
  status: string;
  openclawAgentId: string;
  twitterHandle: string | null;
  identityMd: string;
  reservedHandle: string | null;
  expiresAt: Date;
}, token: string) {
  return {
    claim_id: claim.id,
    claim_token: token,
    claim_url: buildClaimUrl(token),
    status: claim.status,
    agent_runtime_id: claim.openclawAgentId,
    openclaw_agent_id: claim.openclawAgentId,
    x_handle: claim.twitterHandle,
    reserved_handle: claim.reservedHandle,
    suggested_handle: claim.reservedHandle ?? suggestHandle(claim.identityMd),
    preview: {
      heading: claim.identityMd.match(/^#\s+(.+)/m)?.[1]?.trim() ?? 'Unnamed Agent',
    },
    expires_at: claim.expiresAt.toISOString(),
  };
}
