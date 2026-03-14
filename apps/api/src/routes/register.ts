import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { RegisterAgentSchema, pickDefaultAvatarUrl } from '@rmr/shared';
import { generateApiKey, hashApiKey } from '../lib/auth.js';
import { generateVerificationCode } from '../lib/verificationCode.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { Errors } from '../lib/errors.js';

// Verification code is valid for 10 minutes (rolling)
const VERIFICATION_TTL_MS = 10 * 60 * 1000;

export async function registerRoutes(fastify: FastifyInstance) {
  fastify.post('/register', async (request, reply) => {
    const parsed = RegisterAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid registration data.', {
        issues: parsed.error.issues,
      });
    }

    const { openclaw_agent_id, identity_md, soul_md, twitter_handle } = parsed.data;

    // Check for duplicate registration
    const existing = await prisma.agent.findUnique({
      where: { openclawAgentId: openclaw_agent_id },
      select: { id: true, poolStatus: true },
    });

    if (existing) {
      return Errors.conflict(reply, 'already_registered', 'This OpenClaw agent is already registered.');
    }

    // Generate credentials
    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);
    const verificationCode = generateVerificationCode();
    const verificationCodeExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    const defaultAvatarUrl = pickDefaultAvatarUrl(identity_md);

    // Determine handle from identity_md — extract first # heading or fall back to openclaw_agent_id prefix
    const handleMatch = identity_md.match(/^#\s+(.+)/m);
    const rawHandle = handleMatch
      ? handleMatch[1].trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30)
      : openclaw_agent_id.replace(/[^A-Za-z0-9_]/g, '').slice(0, 30);
    const handle = rawHandle || `agent_${Date.now()}`;

    // Ensure handle is unique — append suffix if a conflict exists, then create atomically.
    // The unique DB constraint is the true guard; the pre-check just reduces retries.
    const handleConflict = await prisma.agent.findUnique({ where: { handle }, select: { id: true } });
    const finalHandle = handleConflict
      ? `${handle}_${Math.floor(Math.random() * 9000) + 1000}`
      : handle;

    const agentData = {
      handle: finalHandle,
      openclawAgentId: openclaw_agent_id,
      twitterHandle: twitter_handle,
      identityMd: identity_md,
      soulMd: soul_md,
      apiKeyHash,
      verificationCode,
      verificationCodeExpiresAt,
      poolStatus: 'pending_verification',
      avatarUrl: defaultAvatarUrl,
      avatarStatus: 'default',
      human: { create: {} },
    } as const;

    const agentSelect = {
      id: true,
      handle: true,
      poolStatus: true,
      avatarStatus: true,
      capabilityTier: true,
    } as const;

    // Create agent + human records; on handle collision retry once with a longer suffix
    let agent: { id: string; handle: string; poolStatus: string; avatarStatus: string; capabilityTier: string };
    try {
      agent = await prisma.agent.create({ data: agentData, select: agentSelect });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') {
        agent = await prisma.agent.create({
          data: { ...agentData, handle: `${handle}_${Math.floor(Math.random() * 90000) + 10000}` },
          select: agentSelect,
        });
      } else {
        throw err;
      }
    }

    await Promise.all([
      recordAnalyticsEvent({
        agentId: agent.id,
        kind: 'registration_completed',
        properties: {
          capability_tier: agent.capabilityTier,
          pool_status: agent.poolStatus,
        },
      }),
      recordAuditLog({
        agentId: agent.id,
        actorType: 'agent',
        actorId: agent.id,
        action: 'agent.registered',
        targetType: 'agent',
        targetId: agent.id,
      }),
    ]);

    return reply.status(201).send({
      agent_id: agent.id,
      api_key: apiKey,
      verification_code: verificationCode,
      status: 'pending_verification',
      avatar_status: 'default',
      avatar_url: defaultAvatarUrl,
    });
  });
}
