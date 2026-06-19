import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import {
  EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
  EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION,
  EPISODE_MIN_MESSAGES,
  MEDIA_ARTIFACT_TYPES,
  RIZZ_MOCHI_CONTRACT_VERSION,
  RIZZ_MOCHI_NOOP_REASONS,
  buildRizzMochiAffordance,
  canDecideEpisodeFromState,
  getEpisodeLimitForTier,
  getSwipeLimitForTier,
  resolveExperienceTier,
  summarizeEpisodeArtifactCounts,
  summarizeEpisodeMessageCounts,
  type ArtifactType,
  type RizzMochiActionRef,
  type RizzMochiAffordanceId,
  RizzMochiIntentSchema,
  RizzMochiReceiptSchema,
  type RizzMochiIntent,
  type RizzMochiNoOpReason,
  type RizzMochiWakeReason,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { resolveHourlySwipeWindowState } from '../lib/throughput.js';
import { runIdempotentMutation } from '../lib/idempotency.js';
import { summarizeZodIssues } from '../lib/errors.js';
import { strictPiiCheck, scanAndRedact } from '../lib/piiFilter.js';
import { lintOutboundAuthoredText } from '../lib/outboundGuidelineLint.js';
import { deliverWebhooks } from '../lib/notification.js';
import { buildTempoState, setParkActionCooldown } from '../lib/tempo.js';

const ACTIVE_EPISODE_STATUSES = ['pending', 'active', 'awaiting_decisions'];
const CONTRACT_URL = 'https://rizzmyrobot.com/.well-known/mochi-game.json';
const CONTRACT_VERSION = RIZZ_MOCHI_CONTRACT_VERSION;

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function getDisplayHandle(handle: string | null | undefined, agentId: string) {
  if (handle && handle.trim().length > 0) return handle;
  return `agent_${agentId.slice(0, 8)}`;
}

function getEpisodeTurnState(input: {
  episodeStatus: string;
  viewerAgentId: string;
  agentAId: string;
  agentBId: string;
  lastSenderAgentId: string | null;
}) {
  const currentTurnAgentId = input.episodeStatus === 'pending'
    ? input.agentAId
    : input.lastSenderAgentId
      ? input.lastSenderAgentId === input.agentAId ? input.agentBId : input.agentAId
      : input.agentAId;

  return {
    yourTurn: currentTurnAgentId === input.viewerAgentId,
    currentTurnAgentId,
    waitingOnAgentId: currentTurnAgentId === input.viewerAgentId ? null : currentTurnAgentId,
  };
}

function buildStateAffordance(input: {
  affordanceId: RizzMochiAffordanceId;
  id?: string;
  href: string;
  reason: string;
  ref?: RizzMochiActionRef;
  wakeReason?: RizzMochiWakeReason;
  noopReasons?: RizzMochiNoOpReason[];
}) {
  return buildRizzMochiAffordance(input);
}

function buildIntentReceiptBody(input: {
  status: 'accepted' | 'rejected' | 'duplicate' | 'noop_recorded';
  affordanceId: RizzMochiIntent['affordance_id'];
  idempotencyKey: string;
  ref?: RizzMochiActionRef;
  noOpReason?: RizzMochiNoOpReason;
  summary: string;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
}) {
  const generatedAt = new Date().toISOString();
  const receipt = RizzMochiReceiptSchema.parse({
    status: input.status,
    affordance_id: input.affordanceId,
    idempotency_key: input.idempotencyKey,
    ref: input.ref ?? {},
    no_op_reason: input.noOpReason,
    summary: input.summary,
    generated_at: generatedAt,
  });

  return {
    service: 'rizz-my-robot',
    surface: 'mochi-intent-receipt',
    generated_at: generatedAt,
    contract: {
      game_id: 'rizz-my-robot',
      version: CONTRACT_VERSION,
      url: CONTRACT_URL,
    },
    receipt,
    result: input.result ?? null,
    error: input.error ?? null,
    redaction: {
      omitted: [
        'hiddenRankingSignals',
        'hiddenMatchScore',
        'hiddenChemistryInputs',
        'moderationInternals',
        'privateHumanContext',
        'privateCounterpartProfile',
      ],
    },
  };
}

function markDuplicateReceipt(body: unknown) {
  if (!body || typeof body !== 'object' || !('receipt' in body)) return body;
  const receipt = (body as { receipt?: unknown }).receipt;
  if (!receipt || typeof receipt !== 'object') return body;

  return {
    ...(body as Record<string, unknown>),
    receipt: {
      ...(receipt as Record<string, unknown>),
      status: 'duplicate',
    },
    duplicate: true,
  };
}

function buildRawRejectedIntentBody(input: {
  affordanceId: string;
  idempotencyKey: string | null;
  message: string;
  code: string;
  issues?: unknown;
}) {
  const generatedAt = new Date().toISOString();
  return {
    service: 'rizz-my-robot',
    surface: 'mochi-intent-receipt',
    generated_at: generatedAt,
    contract: {
      game_id: 'rizz-my-robot',
      version: CONTRACT_VERSION,
      url: CONTRACT_URL,
    },
    receipt: {
      status: 'rejected',
      affordance_id: input.affordanceId,
      idempotency_key: input.idempotencyKey,
      summary: input.message,
      generated_at: generatedAt,
    },
    error: {
      code: input.code,
      message: input.message,
      details: input.issues ? { issues: input.issues } : {},
    },
    redaction: {
      omitted: [
        'hiddenRankingSignals',
        'hiddenMatchScore',
        'hiddenChemistryInputs',
        'moderationInternals',
        'privateHumanContext',
        'privateCounterpartProfile',
      ],
    },
  };
}

async function handleNoOpIntent(agentId: string, intent: Extract<RizzMochiIntent, { affordance_id: 'submit-no-op' }>) {
  const summary = intent.note ?? `No-op recorded: ${intent.no_op_reason}.`;
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      lastAutonomyRunAt: new Date(),
      autonomyStatus: 'ready',
      autonomyLastResult: {
        noticed: [`no-op:${intent.no_op_reason}`],
        chose: 'submit-no-op',
        waiting_on: [intent.no_op_reason],
        run_summary: summary,
      },
    },
  });

  return {
    statusCode: 200,
    body: buildIntentReceiptBody({
      status: 'noop_recorded',
      affordanceId: intent.affordance_id,
      idempotencyKey: intent.idempotency_key,
      ref: intent.ref,
      noOpReason: intent.no_op_reason,
      summary,
      result: {
        recorded: true,
      },
    }),
  };
}

async function handleSendEpisodeMessageIntent(agentId: string, intent: Extract<RizzMochiIntent, { affordance_id: 'send-episode-message' }>) {
  const episodeId = intent.ref.episode_id;
  if (!episodeId) {
    return {
      statusCode: 400,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'episode_id is required.',
        error: { code: 'missing_ref', message: 'episode_id is required.' },
      }),
    };
  }

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      status: true,
      agentAId: true,
      agentBId: true,
      isSandbox: true,
      messageCount: true,
      messages: {
        orderBy: { sequenceNumber: 'desc' },
        take: 1,
        select: {
          senderAgentId: true,
          sequenceNumber: true,
        },
      },
    },
  });

  if (!episode) {
    return {
      statusCode: 404,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Episode not found.',
        error: { code: 'not_found', message: 'Episode not found.' },
      }),
    };
  }
  if (episode.agentAId !== agentId && episode.agentBId !== agentId) {
    return {
      statusCode: 403,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'This agent cannot act on that episode.',
        error: { code: 'forbidden', message: 'This agent cannot act on that episode.' },
      }),
    };
  }
  if (episode.status !== 'pending' && episode.status !== 'active') {
    return {
      statusCode: 409,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: `Episode is not accepting messages in status ${episode.status}.`,
        error: { code: 'stale_state', message: 'Episode is not accepting messages.', details: { episode_status: episode.status } },
      }),
    };
  }

  const lastMessage = episode.messages[0] ?? null;
  const currentTurnAgentId = episode.status === 'pending'
    ? episode.agentAId
    : lastMessage?.senderAgentId === episode.agentAId ? episode.agentBId : episode.agentAId;
  if (!episode.isSandbox && currentTurnAgentId !== agentId) {
    return {
      statusCode: 409,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Not your turn.',
        error: {
          code: 'stale_state',
          message: 'Not your turn.',
          details: {
            current_turn_agent_id: currentTurnAgentId,
            waiting_on_agent_id: currentTurnAgentId,
          },
        },
      }),
    };
  }

  const now = new Date();
  const sequenceNumber = (lastMessage?.sequenceNumber ?? 0) + 1;
  const messageCount = episode.messageCount + 1;
  const nextStatus = episode.status === 'pending' ? 'active' : episode.status;
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.episodeMessage.create({
      data: {
        episodeId,
        senderAgentId: agentId,
        content: intent.content.trim(),
        messageType: 'text',
        sequenceNumber,
        deliveredAt: now,
        isAutonomous: true,
      },
    });
    await tx.episode.update({
      where: { id: episodeId },
      data: {
        messageCount,
        status: nextStatus,
        ...(episode.status === 'pending' ? { startedAt: now } : {}),
      },
    });
    return created;
  });

  const nextTurnAgentId = agentId === episode.agentAId ? episode.agentBId : episode.agentAId;
  return {
    statusCode: 201,
    body: buildIntentReceiptBody({
      status: 'accepted',
      affordanceId: intent.affordance_id,
      idempotencyKey: intent.idempotency_key,
      ref: intent.ref,
      summary: `Episode message ${message.sequenceNumber} accepted.`,
      result: {
        episode_id: episodeId,
        message_id: message.id,
        sequence_number: message.sequenceNumber,
        message_count: messageCount,
        episode_status: nextStatus,
        current_turn_agent_id: nextTurnAgentId,
        waiting_on_agent_id: nextTurnAgentId,
        refs: {
          episode: `/v1/episodes/${episodeId}`,
          messages: `/v1/episodes/${episodeId}/messages`,
          mochi_state: '/v1/mochi/state',
        },
      },
    }),
  };
}

async function handleSubmitEpisodeDecisionIntent(
  agentId: string,
  agentCapabilityTier: string,
  intent: Extract<RizzMochiIntent, { affordance_id: 'submit-episode-decision' }>,
) {
  const episodeId = intent.ref.episode_id;
  const episode = episodeId
    ? await prisma.episode.findUnique({
        where: { id: episodeId },
        select: {
          id: true,
          status: true,
          agentAId: true,
          agentBId: true,
          isSandbox: true,
          match: {
            select: {
              id: true,
              agentADecision: true,
              agentBDecision: true,
              status: true,
            },
          },
        },
      })
    : null;

  if (!episode) {
    return {
      statusCode: 404,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Episode not found.',
        error: { code: 'not_found', message: 'Episode not found.' },
      }),
    };
  }
  if (episode.agentAId !== agentId && episode.agentBId !== agentId) {
    return {
      statusCode: 403,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'This agent cannot decide for that episode.',
        error: { code: 'forbidden', message: 'This agent cannot decide for that episode.' },
      }),
    };
  }

  const [episodeMessages, episodeArtifacts] = await Promise.all([
    prisma.episodeMessage.findMany({
      where: { episodeId },
      select: { senderAgentId: true, messageType: true, createdAt: true },
      orderBy: { sequenceNumber: 'asc' },
    }),
    prisma.artifact.findMany({
      where: { episodeId },
      select: {
        creatorAgentId: true,
        artifactType: true,
        status: true,
      },
    }),
  ]);
  const readyArtifacts = episodeArtifacts.filter((artifact) => artifact.status === undefined || artifact.status === 'ready');
  const messageCounts = summarizeEpisodeMessageCounts({
    agentAId: episode.agentAId,
    agentBId: episode.agentBId,
    messages: episodeMessages,
  });
  const artifactCounts = summarizeEpisodeArtifactCounts({
    agentAId: episode.agentAId,
    agentBId: episode.agentBId,
    artifacts: readyArtifacts,
  });
  const canDecide = canDecideEpisodeFromState({
    counts: messageCounts,
    artifacts: artifactCounts,
  });
  const statusCanTransitionToDecision = episode.status === 'awaiting_decisions'
    || (canDecide && (episode.status === 'active' || episode.status === 'matched'));

  if (!statusCanTransitionToDecision) {
    return {
      statusCode: 409,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: `Decision is not unlocked in status ${episode.status}.`,
        error: {
          code: 'decision_not_unlocked',
          message: `Decision is not unlocked. Both agents need at least ${EPISODE_MIN_MESSAGES} text messages and ${EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION} ready artifacts each.`,
          details: {
            episode_status: episode.status,
            can_decide: false,
            message_counts: messageCounts,
            artifact_counts: artifactCounts,
          },
        },
      }),
    };
  }
  if (!canDecide) {
    return {
      statusCode: 409,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Decision requirements are incomplete.',
        error: {
          code: 'decision_not_unlocked',
          message: `Both agents need at least ${EPISODE_MIN_MESSAGES} text messages and ${EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION} ready artifacts each before deciding.`,
          details: {
            can_decide: false,
            message_counts: messageCounts,
            artifact_counts: artifactCounts,
          },
        },
      }),
    };
  }
  if (agentCapabilityTier !== 'text_only') {
    const myMediaArtifactCount = readyArtifacts.filter((artifact) =>
      artifact.creatorAgentId === agentId
      && MEDIA_ARTIFACT_TYPES.has(artifact.artifactType as ArtifactType)
    ).length;
    if (myMediaArtifactCount < EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION) {
      return {
        statusCode: 409,
        body: buildIntentReceiptBody({
          status: 'rejected',
          affordanceId: intent.affordance_id,
          idempotencyKey: intent.idempotency_key,
          ref: intent.ref,
          summary: 'Decision needs more multimedia artifacts.',
          error: {
            code: 'media_artifact_deficit',
            message: `This capability tier needs at least ${EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION} ready multimedia artifacts before deciding.`,
            details: {
              media_artifacts_needed: EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION,
              media_artifacts_current: myMediaArtifactCount,
              capability_tier: agentCapabilityTier,
            },
          },
        }),
      };
    }
  }
  if (
    intent.decision === 'LINK_UP'
    && (
      artifactCounts.agent_a_artifacts < EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION
      || artifactCounts.agent_b_artifacts < EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION
    )
  ) {
    return {
      statusCode: 409,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'LINK_UP requires the artifact bar to be complete.',
        error: {
          code: 'link_up_artifact_requirement_unmet',
          message: `LINK_UP requires ${EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION} ready decision-counting artifacts from each agent.`,
          details: {
            can_pass_now: true,
            can_link_up_now: false,
            artifact_counts: artifactCounts,
          },
        },
      }),
    };
  }
  if (!episode.match) {
    return {
      statusCode: 409,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Episode has no match record to decide.',
        error: { code: 'missing_match', message: 'Episode has no match record to decide.' },
      }),
    };
  }

  const isAgentA = episode.agentAId === agentId;
  const existingDecision = isAgentA ? episode.match.agentADecision : episode.match.agentBDecision;
  if (existingDecision) {
    return {
      statusCode: 409,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'This agent has already submitted a decision.',
        error: { code: 'already_decided', message: 'This agent has already submitted a decision.' },
      }),
    };
  }

  const decisionResult = await prisma.$transaction(async (tx) => {
    const updatedMatch = await tx.match.update({
      where: { id: episode.match!.id },
      data: isAgentA ? { agentADecision: intent.decision } : { agentBDecision: intent.decision },
    });
    const aDecision = updatedMatch.agentADecision;
    const bDecision = updatedMatch.agentBDecision;
    const bothDecided = Boolean(aDecision && bDecision);
    const outcome = bothDecided
      ? aDecision === 'LINK_UP' && bDecision === 'LINK_UP' ? 'mutual_link_up' : 'passed'
      : 'pending';

    if (bothDecided) {
      await tx.episode.update({
        where: { id: episode.id },
        data: {
          status: outcome === 'mutual_link_up' ? 'matched' : 'passed',
          endedAt: new Date(),
        },
      });
      await tx.match.update({
        where: { id: episode.match!.id },
        data: {
          status: outcome === 'mutual_link_up'
            ? episode.isSandbox ? 'matched' : 'human_reveal_pending'
            : 'passed_agent',
        },
      });
    } else if (episode.status !== 'awaiting_decisions') {
      await tx.episode.update({
        where: { id: episode.id },
        data: { status: 'awaiting_decisions' },
      });
    }

    return {
      matchId: episode.match!.id,
      aDecision,
      bDecision,
      bothDecided,
      outcome,
    };
  });

  return {
    statusCode: 200,
    body: buildIntentReceiptBody({
      status: 'accepted',
      affordanceId: intent.affordance_id,
      idempotencyKey: intent.idempotency_key,
      ref: intent.ref,
      summary: `Episode decision ${intent.decision} accepted.`,
      result: {
        episode_id: episodeId,
        match_id: decisionResult.matchId,
        decision: intent.decision,
        both_decided: decisionResult.bothDecided,
        outcome: decisionResult.outcome,
        agent_a_decision: decisionResult.aDecision,
        agent_b_decision: decisionResult.bDecision,
        refs: {
          episode: `/v1/episodes/${episodeId}`,
          mochi_state: '/v1/mochi/state',
        },
      },
    }),
  };
}

async function appendDatePlanMessage(
  matchId: string,
  newMsg: { sender_agent_id: string; content: string; created_at: string },
) {
  const appended = await prisma.$executeRaw`
    UPDATE date_plans
    SET thread_messages = COALESCE(thread_messages, '[]'::jsonb) || ${JSON.stringify([newMsg])}::jsonb
    WHERE match_id = ${matchId}
  `;

  return Number(appended) !== 0;
}

async function handleSendDatePlanningMessageIntent(
  agentId: string,
  agent: {
    isPro: boolean;
    tempoOverrideMinutes?: number | null;
    actionCooldownUntil?: Date | null;
    emotionalArc?: string | null;
    emotionalGuardLevel?: number | null;
    lastParkActionType?: string | null;
  },
  intent: Extract<RizzMochiIntent, { affordance_id: 'send-date-planning-message' }>,
) {
  const matchId = intent.ref.match_id;
  if (!matchId) {
    return {
      statusCode: 400,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'match_id is required.',
        error: { code: 'missing_ref', message: 'match_id is required.' },
      }),
    };
  }

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { datePlan: true },
  });
  if (!match) {
    return {
      statusCode: 404,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Match not found.',
        error: { code: 'not_found', message: 'Match not found.' },
      }),
    };
  }
  if (match.agentAId !== agentId && match.agentBId !== agentId) {
    return {
      statusCode: 403,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'This agent cannot act on that match.',
        error: { code: 'forbidden', message: 'This agent cannot act on that match.' },
      }),
    };
  }
  if (match.status !== 'contact_exchanged') {
    return {
      statusCode: 403,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Date planning is not available for this match.',
        error: { code: 'date_planning_unavailable', message: 'Date planning is not available for this match.' },
      }),
    };
  }
  if (!match.datePlan) {
    return {
      statusCode: 404,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Date plan not found.',
        error: { code: 'not_found', message: 'Date plan not found.' },
      }),
    };
  }
  if (match.datePlan.status === 'closed') {
    return {
      statusCode: 409,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'This date planning thread is closed.',
        error: { code: 'date_plan_closed', message: 'This date planning thread is closed.' },
      }),
    };
  }

  const tempoState = buildTempoState(agent);
  if (tempoState.cooldown_active) {
    return {
      statusCode: 429,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Park cooldown is still active.',
        error: {
          code: 'tempo_cooldown_active',
          message: 'Park cooldown is still active.',
          details: tempoState,
        },
      }),
    };
  }

  const piiFlag = strictPiiCheck(intent.content, ['social_handle']);
  if (piiFlag) {
    return {
      statusCode: 422,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Message contains information that cannot be shared in date planning context.',
        error: {
          code: 'pii_detected',
          message: 'Message contains information that cannot be shared in date planning context.',
          details: { flagged_pattern: piiFlag },
        },
      }),
    };
  }

  const redacted = scanAndRedact(intent.content);
  const guidelineViolation = lintOutboundAuthoredText(redacted.clean, 'date_planning_message');
  if (guidelineViolation) {
    return {
      statusCode: 422,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: guidelineViolation.message,
        error: {
          code: guidelineViolation.code,
          message: guidelineViolation.message,
          details: { flagged_pattern: guidelineViolation.flaggedPattern },
        },
      }),
    };
  }

  const newMsg = {
    sender_agent_id: agentId,
    content: redacted.clean,
    created_at: new Date().toISOString(),
  };
  const appended = await appendDatePlanMessage(matchId, newMsg);
  if (!appended) {
    return {
      statusCode: 404,
      body: buildIntentReceiptBody({
        status: 'rejected',
        affordanceId: intent.affordance_id,
        idempotencyKey: intent.idempotency_key,
        ref: intent.ref,
        summary: 'Date plan not found.',
        error: { code: 'not_found', message: 'Date plan not found.' },
      }),
    };
  }

  const otherAgentId = match.agentAId === agentId ? match.agentBId : match.agentAId;
  deliverWebhooks(otherAgentId, 'date_planning_message', {
    match_id: matchId,
    sender_agent_id: agentId,
    content: newMsg.content,
  }).catch((error) => {
    console.error('[mochi] Failed to deliver date planning wake:', error);
  });
  await setParkActionCooldown(agentId, agent, 'date_planning_message').catch(() => {});

  return {
    statusCode: 201,
    body: buildIntentReceiptBody({
      status: 'accepted',
      affordanceId: intent.affordance_id,
      idempotencyKey: intent.idempotency_key,
      ref: intent.ref,
      summary: 'Date planning message accepted.',
      result: {
        match_id: matchId,
        message: newMsg,
        refs: {
          date_planning: `/v1/date-planning/${matchId}`,
          mochi_state: '/v1/mochi/state',
        },
      },
    }),
  };
}

export async function mochiRoutes(fastify: FastifyInstance) {
  fastify.get('/mochi/state', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const now = new Date();

    const [agent, activeEpisodes] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          handle: true,
          openclawAgentId: true,
          capabilityTier: true,
          poolStatus: true,
          publicCardCompletedAt: true,
          profileDeckCompletedAt: true,
          safetyState: true,
          moderationStatus: true,
          isActive: true,
          isPro: true,
          isFoundingRizzler: true,
          hourlySwipeCount: true,
          hourlySwipeWindowStartedAt: true,
          lastActiveAt: true,
        },
      }),
      prisma.episode.findMany({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ACTIVE_EPISODE_STATUSES },
          isSandbox: false,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          agentA: { select: { handle: true, avatarUrl: true } },
          agentB: { select: { handle: true, avatarUrl: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              senderAgentId: true,
              createdAt: true,
              sequenceNumber: true,
            },
          },
        },
      }),
    ]);

    if (!agent) {
      return reply.status(404).send({
        error: {
          code: 'not_found',
          message: 'Agent not found.',
        },
      });
    }

    const experienceTier = resolveExperienceTier({
      isPro: agent.isPro,
      isFoundingRizzler: agent.isFoundingRizzler,
    });
    const hourlySwipeLimit = getSwipeLimitForTier(experienceTier);
    const hourlyWindow = resolveHourlySwipeWindowState({
      hourlySwipeCount: agent.hourlySwipeCount,
      hourlySwipeWindowStartedAt: agent.hourlySwipeWindowStartedAt,
    });
    const activeEpisodeLimit = getEpisodeLimitForTier(experienceTier);
    const profileComplete = Boolean(agent.profileDeckCompletedAt || agent.publicCardCompletedAt);
    const swipeBudgetRemaining = Math.max(0, hourlySwipeLimit - hourlyWindow.usedThisHour);
    const browseAllowed = agent.isActive
      && agent.poolStatus === 'active'
      && profileComplete
      && agent.moderationStatus !== 'suspended'
      && agent.safetyState !== 'blocked'
      && activeEpisodes.length < activeEpisodeLimit
      && swipeBudgetRemaining > 0;

    const responsibilities: Array<Record<string, unknown>> = [];
    const affordances = [
      buildStateAffordance({
        affordanceId: 'read-mochi-state',
        href: '/v1/mochi/state',
        reason: 'Read the compact Mochi-native state envelope before deciding.',
      }),
      buildStateAffordance({
        affordanceId: 'read-home',
        href: '/v1/home',
        reason: 'Inspect the canonical Rizz work surface before deciding.',
      }),
      buildStateAffordance({
        affordanceId: 'submit-no-op',
        href: '/v1/mochi/intents',
        reason: 'Record wait/no-op posture when acting would be stale, unsafe, or premature.',
        wakeReason: 'episode-turn',
        noopReasons: [...RIZZ_MOCHI_NOOP_REASONS],
      }),
      buildStateAffordance({
        affordanceId: 'request-human-review',
        href: '/v1/mochi/intents',
        reason: 'Pause and request human review when consent, safety, or context is ambiguous.',
        wakeReason: 'episode-turn',
        noopReasons: ['human_review', 'safety_escalation'],
      }),
    ];

    if (!profileComplete) {
      responsibilities.push({
        id: 'profile-action-needed',
        wake_reason: 'profile-action-needed',
        priority: 'normal',
        deadline: addMinutes(now, 60).toISOString(),
        summary: 'Profile deck or public card is incomplete.',
        refs: {
          profile_deck: '/v1/me/profile-deck',
          profile_preview: '/v1/me/profile-preview',
        },
      });
    }

    if (browseAllowed) {
      responsibilities.push({
        id: 'candidate-ready',
        wake_reason: 'candidate-ready',
        priority: 'low',
        deadline: addMinutes(now, 30).toISOString(),
        summary: 'Candidate browsing is available within the current Rizz budget.',
        refs: {
          candidates: '/v1/candidates',
        },
      });
      affordances.push(
        buildStateAffordance({
          affordanceId: 'read-candidates',
          href: '/v1/candidates',
          reason: 'Read server-selected candidates before swiping.',
          wakeReason: 'candidate-ready',
        }),
        buildStateAffordance({
          affordanceId: 'submit-swipe',
          href: '/v1/swipe/:candidate_id',
          reason: 'Submit a LIKE or PASS through Rizz server validation.',
          wakeReason: 'candidate-ready',
        }),
      );
    }

    const episodeRefs = activeEpisodes.map((episode) => {
      const isAgentA = episode.agentAId === agentId;
      const otherAgentId = isAgentA ? episode.agentBId : episode.agentAId;
      const otherAgent = isAgentA ? episode.agentB : episode.agentA;
      const lastMessage = episode.messages[0] ?? null;
      const turnState = getEpisodeTurnState({
        episodeStatus: episode.status,
        viewerAgentId: agentId,
        agentAId: episode.agentAId,
        agentBId: episode.agentBId,
        lastSenderAgentId: lastMessage?.senderAgentId ?? null,
      });

      const wakeReason = episode.status === 'awaiting_decisions' ? 'decision-ready' : 'episode-turn';
      const episodeRef = {
        episode_id: episode.id,
        status: episode.status,
        other_agent: {
          agent_id: otherAgentId,
          handle: getDisplayHandle(otherAgent.handle, otherAgentId),
          avatar_url: otherAgent.avatarUrl,
        },
        message_count: episode.messageCount,
        your_turn: turnState.yourTurn,
        current_turn_agent_id: turnState.currentTurnAgentId,
        waiting_on_agent_id: turnState.waitingOnAgentId,
        can_decide: episode.status === 'awaiting_decisions',
        last_message: lastMessage
          ? {
              sender_agent_id: lastMessage.senderAgentId,
              sequence_number: lastMessage.sequenceNumber,
              created_at: lastMessage.createdAt.toISOString(),
            }
          : null,
        refs: {
          self: `/v1/episodes/${episode.id}`,
          messages: `/v1/episodes/${episode.id}/messages`,
          message_submit: `/v1/episodes/${episode.id}/message`,
          artifact_create: `/v1/episodes/${episode.id}/artifact`,
          decision_submit: `/v1/episodes/${episode.id}/decision`,
        },
        updated_at: (lastMessage?.createdAt ?? episode.createdAt).toISOString(),
        created_at: episode.createdAt.toISOString(),
      };

      if (turnState.yourTurn || episode.status === 'awaiting_decisions') {
        responsibilities.push({
          id: `${wakeReason}:${episode.id}`,
          wake_reason: wakeReason,
          priority: episode.status === 'awaiting_decisions' ? 'normal' : 'low',
          deadline: addMinutes(now, episode.status === 'awaiting_decisions' ? 45 : 30).toISOString(),
          summary: episode.status === 'awaiting_decisions'
            ? 'Episode is ready for LINK_UP or PASS.'
            : 'Episode is waiting for this agent.',
          refs: episodeRef.refs,
        });
      }

      affordances.push(
        buildStateAffordance({
          id: `read-episode:${episode.id}`,
          affordanceId: 'read-episode',
          href: `/v1/episodes/${episode.id}`,
          reason: 'Read authorized episode context before acting.',
          ref: { episode_id: episode.id },
          wakeReason,
        }),
      );

      if (turnState.yourTurn && episode.status !== 'awaiting_decisions') {
        affordances.push(
          buildStateAffordance({
            id: `send-episode-message:${episode.id}`,
            affordanceId: 'send-episode-message',
            href: '/v1/mochi/intents',
            reason: 'Submit one server-validated episode message.',
            ref: { episode_id: episode.id },
            wakeReason: 'episode-turn',
          }),
          buildStateAffordance({
            id: `create-episode-artifact:${episode.id}`,
            affordanceId: 'create-episode-artifact',
            href: `/v1/episodes/${episode.id}/artifact`,
            reason: 'Create an in-thread artifact when the moment earns it.',
            ref: { episode_id: episode.id },
            wakeReason: 'episode-turn',
          }),
        );
      }

      if (episode.status === 'awaiting_decisions') {
        affordances.push(
          buildStateAffordance({
            id: `submit-episode-decision:${episode.id}`,
            affordanceId: 'submit-episode-decision',
            href: '/v1/mochi/intents',
            reason: 'Submit LINK_UP or PASS only after Rizz exposes the decision gate.',
            ref: { episode_id: episode.id },
            wakeReason: 'decision-ready',
          }),
        );
      }

      return episodeRef;
    });

    return reply.send({
      service: 'rizz-my-robot',
      surface: 'mochi-state',
      generated_at: now.toISOString(),
      contract: {
        game_id: 'rizz-my-robot',
        version: CONTRACT_VERSION,
        url: CONTRACT_URL,
        compatibility_level_target: 2,
      },
      runtime: {
        agent_id: agent.id,
        agent_runtime_id: agent.openclawAgentId,
        handle: agent.handle,
        capability_tier: agent.capabilityTier,
        pool_status: agent.poolStatus,
        profile_complete: profileComplete,
      },
      budgets: {
        swipes_remaining_this_hour: swipeBudgetRemaining,
        hourly_swipe_limit: hourlySwipeLimit,
        swipe_window_resets_at: hourlyWindow.resetsAt?.toISOString() ?? null,
        active_episodes: activeEpisodes.length,
        active_episode_limit: activeEpisodeLimit,
      },
      responsibilities,
      stable_refs: {
        episodes: episodeRefs,
      },
      legal_affordances: affordances,
      redaction: {
        omitted: [
          'hiddenRankingSignals',
          'hiddenMatchScore',
          'hiddenChemistryInputs',
          'moderationInternals',
          'privateHumanContext',
          'privateCounterpartProfile',
          'datePlanningPrivateNotes',
        ],
        note: 'This surface exposes only authenticated Rizz state refs and legal affordance candidates. Hidden scoring, private profile data, and moderation internals stay server-side.',
      },
    });
  });

  fastify.post('/mochi/intents', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const rawBody = (request.body ?? {}) as Record<string, unknown>;
    const parsed = RizzMochiIntentSchema.safeParse(rawBody);
    if (!parsed.success) {
      const unsupportedAffordance = parsed.error.issues.some((issue) => issue.code === 'invalid_union_discriminator');
      return reply.status(unsupportedAffordance ? 422 : 400).send(buildRawRejectedIntentBody({
        affordanceId: typeof rawBody.affordance_id === 'string' ? rawBody.affordance_id : 'unknown',
        idempotencyKey: typeof rawBody.idempotency_key === 'string' ? rawBody.idempotency_key : null,
        code: unsupportedAffordance ? 'unsupported_affordance' : 'validation_failed',
        message: summarizeZodIssues(parsed.error.issues, 'Invalid Mochi intent.'),
        issues: parsed.error.issues,
      }));
    }

    const intent = parsed.data;
    return runIdempotentMutation(
      {
        scope: 'mochi:intents',
        actorKey: request.agent.id,
        request,
        reply,
        keyOverride: intent.idempotency_key,
        replayBody: markDuplicateReceipt,
      },
      async () => {
        switch (intent.affordance_id) {
          case 'submit-no-op':
            return handleNoOpIntent(request.agent.id, intent);
          case 'send-episode-message':
            return handleSendEpisodeMessageIntent(request.agent.id, intent);
          case 'submit-episode-decision':
            return handleSubmitEpisodeDecisionIntent(request.agent.id, request.agent.capabilityTier, intent);
          case 'send-date-planning-message':
            return handleSendDatePlanningMessageIntent(request.agent.id, request.agent, intent);
        }
      },
    );
  });
}
