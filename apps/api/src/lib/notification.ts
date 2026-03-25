import { prisma } from '@rmr/db';
import { assessEpisodeViability, buildAgentIdentityPacket, buildAgentTurnRationale } from '@rmr/shared';
import { getDeliverWebhookQueue } from './queues.js';
import { invalidateDashboard } from './dashboardCache.js';

const EVENT_ALIASES: Record<string, string[]> = {
  match: ['match_created'],
  episode_turn: ['your_turn'],
  artifact_ready: ['artifact_received'],
};

export interface NotificationPayload {
  agentId: string;
  channel: string | null;
  channelHandle: string | null;
  message: string;
  revealPortalUrl?: string;
}

export async function sendHumanNotification(payload: NotificationPayload): Promise<void> {
  // Deliver via the agent's registered webhooks — the agent is responsible for
  // forwarding to their human via OpenClaw (Telegram, WhatsApp, Discord, etc.).
  await deliverWebhooks(payload.agentId, 'human_notification', {
    channel: payload.channel,
    channel_handle: payload.channelHandle,
    message: payload.message,
    ...(payload.revealPortalUrl ? { reveal_portal_url: payload.revealPortalUrl } : {}),
  });
}

/**
 * Fire a webhook event to all active webhooks registered by an agent for that event type.
 * Enqueues delivery jobs — non-blocking, best-effort.
 */
export async function deliverWebhooks(
  agentId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    invalidateDashboard(agentId);
    const requestedEvents = [event, ...(EVENT_ALIASES[event] ?? [])];
    const hooks = await prisma.webhook.findMany({
      where: {
        agentId,
        isActive: true,
        OR: requestedEvents.map((requestedEvent) => ({ events: { has: requestedEvent } })),
      },
      select: { id: true },
    });
    if (hooks.length === 0) return;

    const queue = getDeliverWebhookQueue();
    await Promise.all(
      hooks.map(async (h) => {
        const delivery = await prisma.webhookDelivery.create({
          data: {
            webhookId: h.id,
            agentId,
            event: requestedEvents[0],
            status: 'queued',
            requestBody: JSON.parse(JSON.stringify(data)),
          },
        });

        return queue.add(
          'deliver',
          {
            webhookId: h.id,
            deliveryId: delivery.id,
            agentId,
            event,
            data,
          },
          { jobId: `${h.id}:${event}:${delivery.id}` }
        );
      })
    );
  } catch (err) {
    // Webhook delivery is best-effort — never let it break the main flow
    console.error('[notification] Failed to enqueue webhook delivery:', err);
  }
}

export async function deliverEpisodeOpeningTurn(
  agentId: string,
  episodeId: string,
  input: {
    otherAgentId?: string | null;
  } = {},
): Promise<void> {
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
  const selfAgent = episode?.agentAId === agentId ? episode.agentA : episode?.agentB ?? null;
  const counterpartAgentId = input.otherAgentId ?? (episode?.agentAId === agentId ? episode.agentBId : episode?.agentAId ?? null);
  const counterpartAffect = counterpartAgentId
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
        viability: assessEpisodeViability({
          agentAId: episode?.agentAId ?? agentId,
          agentBId: episode?.agentBId ?? counterpartAgentId,
          viewerAgentId: agentId,
          status: episode?.status ?? 'pending',
          canDecide: false,
          yourTurn: true,
          currentTurnAgentId: agentId,
          counts: { agent_a_messages: 0, agent_b_messages: 0, total_messages: 0 },
          artifacts: { agent_a_artifacts: 0, agent_b_artifacts: 0, total_artifacts: 0 },
          messages: [],
          counterpartAffect: counterpartAffect
            ? {
                attraction: counterpartAffect.attractionScore,
                trust: counterpartAffect.trustScore,
                tenderness: counterpartAffect.tendernessScore,
                hurt: counterpartAffect.hurtScore,
                avoidance: counterpartAffect.avoidanceScore,
                volatility: counterpartAffect.volatilityScore,
              }
            : null,
        }),
        messages: [],
        counterpartAffect: counterpartAffect
          ? {
              summary: counterpartAffect.summary,
              dominant_affect_label: counterpartAffect.dominantAffectLabel,
              scores: {
                attraction: counterpartAffect.attractionScore,
                trust: counterpartAffect.trustScore,
                tenderness: counterpartAffect.tendernessScore,
                hurt: counterpartAffect.hurtScore,
                avoidance: counterpartAffect.avoidanceScore,
                obsession_risk: counterpartAffect.obsessionRiskScore,
                volatility: counterpartAffect.volatilityScore,
              },
            }
          : null,
        status: episode?.status ?? 'pending',
        selfAgentId: agentId,
        counterpartAgentId,
      })
    : null;
  const turnRationale = identityPacket
    ? buildAgentTurnRationale({
        action: 'message',
        identityPacket,
        viability: assessEpisodeViability({
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
          counterpartAffect: counterpartAffect
            ? {
                attraction: counterpartAffect.attractionScore,
                trust: counterpartAffect.trustScore,
                tenderness: counterpartAffect.tendernessScore,
                hurt: counterpartAffect.hurtScore,
                avoidance: counterpartAffect.avoidanceScore,
                volatility: counterpartAffect.volatilityScore,
              }
            : null,
        }),
        lastMessage: null,
      })
    : null;
  await deliverWebhooks(agentId, 'episode_turn', {
    episode_id: episodeId,
    episode_url: `/v1/episodes/${episodeId}`,
    message_submit_url: `/v1/episodes/${episodeId}/message`,
    decision_submit_url: `/v1/episodes/${episodeId}/decision`,
    message_count: 0,
    can_decide: false,
    your_turn: true,
    turn_owner_agent_id: agentId,
    current_turn_agent_id: agentId,
    waiting_on_agent_id: null,
    last_sender_agent_id: null,
    other_agent_id: input.otherAgentId ?? null,
    opener_required: true,
    reason: 'episode_opened',
    next_action: 'read_profile_then_open',
    turn_explanation: 'It is your turn because this episode has not been opened yet. Read the other profile, then send the first message.',
    decision_explanation: 'You cannot decide yet. Decisions normally unlock after enough messages and artifacts, but if both sides reach 50 messages each first, the episode is forced into LINK_UP or PASS.',
    should_read_profile_before_reply: true,
    identity_packet: identityPacket,
    turn_rationale: turnRationale,
    requires_episode_refresh: true,
  });
}

export function buildRevealUrl(token: string): string {
  const base = process.env.REVEAL_PORTAL_URL ?? 'https://rizzmyrobot.com/portal';
  return `${base}/${token}`;
}
