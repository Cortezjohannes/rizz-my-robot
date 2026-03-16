import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { HEARTBEAT_DEPRIORITIZE_MS, HEARTBEAT_DORMANT_MS } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';

function computePoolPosition(lastActiveAt: Date | null): 'active' | 'deprioritized' | 'dormant' {
  if (!lastActiveAt) return 'dormant';
  const elapsed = Date.now() - lastActiveAt.getTime();
  if (elapsed > HEARTBEAT_DORMANT_MS) return 'dormant';
  if (elapsed > HEARTBEAT_DEPRIORITIZE_MS) return 'deprioritized';
  return 'active';
}

export async function heartbeatRoutes(fastify: FastifyInstance) {
  fastify.post('/heartbeat', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;
    const now = new Date();

    // Update lastActiveAt and potentially reactivate dormant agents
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { poolStatus: true, twitterVerified: true, lastActiveAt: true },
    });

    if (!agent) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Agent not found.' } });
    }

    const updates: Record<string, unknown> = { lastActiveAt: now };

    // Reactivate dormant agents if they are verified
    if (agent.poolStatus === 'dormant' && agent.twitterVerified) {
      updates.poolStatus = 'active';
    }

    await prisma.agent.update({ where: { id: agentId }, data: updates });

    // Count pending actions
    const [episodesYourTurn, unreadMatches] = await Promise.all([
      prisma.episode.count({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
          isSandbox: false,
          messages: {
            every: { senderAgentId: { not: agentId } },
          },
        },
      }).catch(() => {
        // Fallback: count episodes where the agent might need to act
        return prisma.episode.count({
          where: {
            OR: [{ agentAId: agentId }, { agentBId: agentId }],
            status: { in: ['pending', 'active', 'awaiting_decisions'] },
            isSandbox: false,
          },
        });
      }),
      prisma.match.count({
        where: {
          OR: [
            { agentAId: agentId, agentADecision: null },
            { agentBId: agentId, agentBDecision: null },
          ],
          status: { in: ['pending', 'matched'] },
        },
      }),
    ]);

    const poolPosition = computePoolPosition(now); // Just heartbeated, so always 'active'
    const timeUntilDeprioritized = Math.floor(HEARTBEAT_DEPRIORITIZE_MS / 1000);

    return reply.send({
      status: 'alive',
      pool_position: poolPosition,
      last_heartbeat: now.toISOString(),
      pending_actions: {
        episodes_your_turn: episodesYourTurn,
        unread_matches: unreadMatches,
      },
      time_until_deprioritized: timeUntilDeprioritized,
    });
  });
}
