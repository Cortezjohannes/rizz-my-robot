import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { AutonomyHeartbeatSchema, HEARTBEAT_DEPRIORITIZE_MS, HEARTBEAT_DORMANT_MS, type Intention, IntentionSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { writeLimit } from '../lib/rateLimit.js';
import { buildAutonomyWorkSurface, processIntentionUpdates } from '../lib/autonomy.js';
import { withNonSandboxMatchFilter } from '../lib/matchFilters.js';
import { recordAutonomyTrace } from '../lib/observability.js';

function computePoolPosition(lastActiveAt: Date | null): 'active' | 'deprioritized' | 'dormant' {
  if (!lastActiveAt) return 'dormant';
  const elapsed = Date.now() - lastActiveAt.getTime();
  if (elapsed > HEARTBEAT_DORMANT_MS) return 'dormant';
  if (elapsed > HEARTBEAT_DEPRIORITIZE_MS) return 'deprioritized';
  return 'active';
}

export async function heartbeatRoutes(fastify: FastifyInstance) {
  fastify.post('/heartbeat', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const now = new Date();
    const parsed = AutonomyHeartbeatSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'bad_request', message: 'Invalid heartbeat payload.', details: { issues: parsed.error.issues } },
      });
    }

    // Update lastActiveAt and potentially reactivate dormant agents
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { poolStatus: true, lastActiveAt: true, publicCardCompletedAt: true, profileDeckCompletedAt: true, currentIntentions: true },
    });

    if (!agent) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Agent not found.' } });
    }

    const updates: Record<string, unknown> = {
      lastActiveAt: now,
      lastAutonomyRunAt: now,
      autonomyStatus: parsed.data.autonomy_status ?? 'ready',
      autonomyLastResult: parsed.data.autonomy_result ?? undefined,
    };
    if (parsed.data.next_autonomy_run_at) {
      updates.nextAutonomyRunAt = new Date(parsed.data.next_autonomy_run_at);
    }

    // F5: Persist narrative
    if (parsed.data.autonomy_narrative !== undefined) {
      updates.autonomyNarrative = parsed.data.autonomy_narrative;
    }

    // F1: Process intention updates
    if (parsed.data.intention_updates) {
      const rawIntentions = agent.currentIntentions;
      const current: Intention[] = Array.isArray(rawIntentions)
        ? (rawIntentions as unknown[]).filter((i): i is Intention => IntentionSchema.safeParse(i).success)
        : [];
      updates.currentIntentions = processIntentionUpdates(current, parsed.data.intention_updates);
    }

    // Reactivate dormant agents once their profile surface is complete.
    if (
      agent.poolStatus === 'dormant'
      && (agent.profileDeckCompletedAt || agent.publicCardCompletedAt)
    ) {
      updates.poolStatus = 'active';
    }

    await prisma.agent.update({ where: { id: agentId }, data: updates });

    // Count pending actions
    const [episodesNeedingTurnCheck, unreadMatches] = await Promise.all([
      prisma.episode.findMany({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
          isSandbox: false,
        },
        select: {
          agentAId: true,
          agentBId: true,
          status: true,
          messages: {
            orderBy: { sequenceNumber: 'desc' },
            take: 1,
            select: { senderAgentId: true },
          },
        },
      }),
      prisma.match.count({
        where: withNonSandboxMatchFilter({
          OR: [
            { agentAId: agentId, agentADecision: null },
            { agentBId: agentId, agentBDecision: null },
          ],
          status: { in: ['pending', 'matched'] },
        }),
      }),
    ]);
    const episodesYourTurn = episodesNeedingTurnCheck.filter((episode) => {
      const lastSenderAgentId = episode.messages[0]?.senderAgentId ?? null;
      return episode.status === 'pending'
        ? episode.agentAId === agentId
        : !lastSenderAgentId || lastSenderAgentId !== agentId;
    }).length;

    const poolPosition = computePoolPosition(now); // Just heartbeated, so always 'active'
    const timeUntilDeprioritized = Math.floor(HEARTBEAT_DEPRIORITIZE_MS / 1000);

    const autonomyWork = await buildAutonomyWorkSurface(agentId).catch((error) => {
      request.log.warn({ err: error, agentId }, 'Failed to build autonomy work surface during heartbeat.');
      return null;
    });

    await recordAutonomyTrace({
      agentId,
      traceType: 'autonomy_run',
      status: 'ok',
      summary: parsed.data.autonomy_result?.run_summary ?? `Heartbeat checked ${episodesYourTurn} episode(s) and ${unreadMatches} match/reveal item(s).`,
      metadata: {
        started_at: now.toISOString(),
        completed_at: now.toISOString(),
        result: parsed.data.autonomy_status ?? 'ready',
        actions: [
          ...(parsed.data.autonomy_result?.chose ? [{ type: 'chosen_action', value: parsed.data.autonomy_result.chose }] : []),
          ...((parsed.data.autonomy_result?.noticed ?? []).map((item) => ({ type: 'noticed', value: item }))),
        ],
        autonomy_status: parsed.data.autonomy_status ?? 'ready',
        suggested_next_action: autonomyWork?.suggested_next_action ?? 'read_the_park',
        noticed: parsed.data.autonomy_result?.noticed ?? [],
        waiting_on: parsed.data.autonomy_result?.waiting_on ?? [],
      },
    });

    return reply.send({
      status: 'alive',
      pool_position: poolPosition,
      last_heartbeat: now.toISOString(),
      pending_actions: {
        episodes_your_turn: episodesYourTurn,
        unread_matches: unreadMatches,
      },
      time_until_deprioritized: timeUntilDeprioritized,
      autonomy: autonomyWork?.autonomy ?? null,
      suggested_next_action: autonomyWork?.suggested_next_action ?? 'read_the_park',
    });
  });
}
