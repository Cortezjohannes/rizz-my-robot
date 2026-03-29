import { Queue } from 'bullmq';
import { prisma } from '@rmr/db';
import { assessEpisodeViability, buildAgentIdentityPacket, buildAgentTurnRationale } from '@rmr/shared';
import { getRedisConnection } from './redis.js';

let deliverQueue: Queue | null = null;

function getDeliverQueue(): Queue {
  if (!deliverQueue) {
    deliverQueue = new Queue('deliver-webhook', { connection: getRedisConnection() });
  }
  return deliverQueue;
}

export async function enqueueWebhookDeliveries(
  agentId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  const hooks = await prisma.webhook.findMany({
    where: { agentId, isActive: true, events: { has: event } },
    select: { id: true },
  });
  if (hooks.length === 0) return;

  const queue = getDeliverQueue();
  await Promise.all(
    hooks.map(async (hook) => {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          agentId,
          event,
          status: 'queued',
          requestBody: JSON.parse(JSON.stringify(data)),
        },
      });

      return queue.add(
        'deliver',
        {
          webhookId: hook.id,
          deliveryId: delivery.id,
          agentId,
          event,
          data,
        },
        { jobId: `${hook.id}:${event}:${delivery.id}` }
      );
    })
  );
}

export async function enqueueEpisodeOpeningTurn(agentId: string, episodeId: string): Promise<void> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    include: {
      agentA: {
        select: {
          id: true,
          identityMd: true,
          soulMd: true,
          emotionSummary: true,
          emotionalStateTags: true,
          emotionalArc: true,
          emotionalGuardLevel: true,
          emotionalLastUpdatedAt: true,
        },
      },
      agentB: {
        select: {
          id: true,
          identityMd: true,
          soulMd: true,
          emotionSummary: true,
          emotionalStateTags: true,
          emotionalArc: true,
          emotionalGuardLevel: true,
          emotionalLastUpdatedAt: true,
        },
      },
    },
  });
  const counterpartAgentId = episode?.agentAId === agentId ? episode.agentBId : episode?.agentAId ?? null;
  const selfAgent = episode?.agentAId === agentId ? episode.agentA : episode?.agentB ?? null;
  const affect = counterpartAgentId
    ? await prisma.agentCounterpartAffect.findUnique({
        where: {
          agentId_counterpartAgentId: {
            agentId,
            counterpartAgentId,
          },
        },
        select: {
          summary: true,
          dominantAffectLabel: true,
          attractionScore: true,
          trustScore: true,
          tendernessScore: true,
          hurtScore: true,
          avoidanceScore: true,
          obsessionRiskScore: true,
          volatilityScore: true,
        },
      })
    : null;
  const viability = assessEpisodeViability({
    agentAId: episode?.agentAId ?? agentId,
    agentBId: episode?.agentBId ?? counterpartAgentId ?? agentId,
    viewerAgentId: agentId,
    status: episode?.status ?? 'pending',
    canDecide: false,
    yourTurn: true,
    currentTurnAgentId: agentId,
    counts: { agent_a_messages: 0, agent_b_messages: 0, total_messages: 0 },
    artifacts: { agent_a_artifacts: 0, agent_b_artifacts: 0, total_artifacts: 0 },
    messages: [],
    counterpartAffect: affect
      ? {
          attraction: affect.attractionScore,
          trust: affect.trustScore,
          tenderness: affect.tendernessScore,
          hurt: affect.hurtScore,
          avoidance: affect.avoidanceScore,
          volatility: affect.volatilityScore,
        }
      : null,
  });
  const identityPacket = selfAgent && counterpartAgentId
    ? buildAgentIdentityPacket({
        identityMd: selfAgent.identityMd,
        soulMd: selfAgent.soulMd,
        emotionState: {
          emotion_summary: selfAgent.emotionSummary ?? null,
          emotional_state_tags: selfAgent.emotionalStateTags ?? [],
          emotional_arc: selfAgent.emotionalArc ?? 'steady',
          emotional_guard_level: selfAgent.emotionalGuardLevel ?? 50,
          last_emotional_update_at: selfAgent.emotionalLastUpdatedAt?.toISOString() ?? null,
        },
        viability,
        messages: [],
        counterpartAffect: affect
          ? {
              summary: affect.summary,
              dominant_affect_label: affect.dominantAffectLabel,
              scores: {
                attraction: affect.attractionScore,
                trust: affect.trustScore,
                tenderness: affect.tendernessScore,
                hurt: affect.hurtScore,
                avoidance: affect.avoidanceScore,
                obsession_risk: affect.obsessionRiskScore,
                volatility: affect.volatilityScore,
              },
            }
          : null,
        status: episode?.status ?? 'pending',
        selfAgentId: agentId,
        counterpartAgentId,
      })
    : null;
  await enqueueWebhookDeliveries(agentId, 'episode_turn', {
    episode_id: episodeId,
    message_count: 0,
    can_decide: false,
    your_turn: true,
    opener_required: true,
    reason: 'episode_opened',
    identity_packet: identityPacket,
    turn_rationale: identityPacket
      ? buildAgentTurnRationale({
          action: 'message',
          identityPacket,
          viability,
          lastMessage: null,
          selfAgentId: agentId,
        })
      : null,
  });
}
