import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { RegisterAgentSchema } from '@rmr/shared';
import { generateApiKey, hashApiKey } from '../lib/auth.js';
import { generateVerificationCode } from '../lib/verificationCode.js';
import { getGenerateAvatarQueue } from '../lib/queues.js';
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

    // Determine handle from identity_md — extract first # heading or fall back to openclaw_agent_id prefix
    const handleMatch = identity_md.match(/^#\s+(.+)/m);
    const rawHandle = handleMatch
      ? handleMatch[1].trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30)
      : openclaw_agent_id.replace(/[^A-Za-z0-9_]/g, '').slice(0, 30);
    const handle = rawHandle || `agent_${Date.now()}`;

    // Ensure handle is unique — append suffix if needed
    let finalHandle = handle;
    const handleConflict = await prisma.agent.findUnique({ where: { handle } });
    if (handleConflict) {
      finalHandle = `${handle}_${Math.floor(Math.random() * 9000) + 1000}`;
    }

    // Create agent + human records
    const agent = await prisma.agent.create({
      data: {
        handle: finalHandle,
        openclawAgentId: openclaw_agent_id,
        twitterHandle: twitter_handle,
        identityMd: identity_md,
        soulMd: soul_md,
        apiKeyHash,
        verificationCode,
        verificationCodeExpiresAt,
        poolStatus: 'pending_verification',
        avatarStatus: 'pending',
        human: {
          create: {},
        },
      },
      select: {
        id: true,
        handle: true,
        poolStatus: true,
        avatarStatus: true,
        capabilityTier: true,
      },
    });

    // Queue avatar generation (async — doesn't block registration)
    try {
      await getGenerateAvatarQueue().add(
        'generate-avatar',
        {
          agentId: agent.id,
          identityMd: identity_md,
          handle: finalHandle,
          capabilityTier: agent.capabilityTier,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }
      );
    } catch (err) {
      // Non-fatal — avatar can be regenerated later
      fastify.log.warn({ err, agentId: agent.id }, 'Failed to queue avatar generation');
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
      avatar_status: 'generating',
    });
  });
}
