import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@rmr/db';
import {
  SendMessageSchema,
  DropArtifactSchema,
  ArtifactUploadRequestSchema,
  EpisodeDecisionSchema,
  EpisodeExitSchema,
  ArtifactSubmitSchema,
  ArtifactReactionSchema,
  EPISODE_MIN_MESSAGES,
  EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
  EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION,
  EPISODE_MAX_MESSAGES,
  EPISODE_MAX_ARTIFACTS_PER_AGENT,
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  MAX_TEXT_ARTIFACTS_PER_EPISODE,
  ARTIFACTS_BY_TIER,
  TEXT_ARTIFACT_TYPES,
  MEDIA_ARTIFACT_TYPES,
  assessEpisodeViability,
  buildAgentIdentityPacket,
  buildAgentTurnRationale,
  extractSoulVocabulary,
  canAgentSendEpisodeMessage,
  canDecideEpisodeFromState,
  normalizeArtifactType,
  summarizeEpisodeArtifactCounts,
  summarizeEpisodeMessageCounts,
  type ArtifactType,
  type CapabilityTier,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { computeChemistryScore, computeEstimatedChemistryScore, summarizeChemistryScore } from '../lib/chemistry.js';
import { awardRizzPoints, awardConversationMilestoneRizz, awardEpisodeCompletionRizz, awardArtifactRizz, awardFeedCardRizz } from '../lib/rizzPoints.js';
import { deliverWebhooks, buildRevealUrl, sendHumanNotification } from '../lib/notification.js';
import { activatePendingMatchesForAgent } from '../lib/pendingMatches.js';
import { getGhostCheckQueue, getWakeAgentQueue } from '../lib/queues.js';
import { recomputeRepScore } from '../lib/repScore.js';
import { recomputeAuthenticityForAgents, shouldPublishFeedCardForAgents } from '../lib/authenticity.js';
import { applyAgentAuthoredEmotionUpdate, buildEpisodeEmotionContext, recordEmotionEvent, recordEmotionEventPair } from '../lib/emotion.js';
import { computeArtifactVulnerabilitySignal } from '../lib/emotionalSignals.js';
import { runIdempotentMutation } from '../lib/idempotency.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { Errors, summarizeZodIssues } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { buildTempoState, setParkActionCooldown } from '../lib/tempo.js';
import {
  createArtifactUploadTarget,
  buildArtifactStorageKey,
  getStoragePublicUrlForKey,
  isArtifactStorageKeyForArtifact,
  isStorageConfigured,
  mirrorArtifactToStorage,
  storageObjectExists,
  uploadBufferToStorage,
} from '../lib/storage.js';
import { checkVerificationRequired } from '../lib/verificationGate.js';
import { submitVerificationAttempt } from '../lib/challenges.js';
import { createArtifactNarrativeEvent, createClosureNarrativeEvent, createDecisionNarrativeEvent, createEpisodeMessageNarrativeEvent } from '../lib/narrative.js';
import { recomputeAndPersistSocialSnapshot } from '../lib/socialStatus.js';
import { evaluateRevealGate } from '../lib/safety.js';
import { enqueueEmotionalContinuityRecompute } from '../lib/continuity.js';
import { createStandaloneAgentDiaryEntry } from '../lib/diary.js';
import { deriveArtifactDecisionSignal, deriveArtifactGuidance } from '../lib/artifactPressure.js';
import { getOmnimonParkAgent } from '../lib/omnimonPark.js';
import { assertSafeOutboundUrl } from '../lib/outboundUrlSafety.js';
import { sendWriteRouteError } from '../lib/writeDiagnostics.js';
import { estimateSpokenDurationSeconds } from '../lib/profileVoice.js';
import { recordAutonomyTrace } from '../lib/observability.js';
import { computeEngagementSignals } from '../lib/engagementSignals.js';
import { getMessageDeliveryStatus, markEpisodeMessagesRead, serializePresenceSummary } from '../lib/socialSignals.js';
import { strictPiiCheck } from '../lib/piiFilter.js';
import { assertArtifactMediaContentType, MEDIA_KIND, MEDIA_VISIBILITY, buildAttachmentFromMediaAsset, getOwnedMediaAsset, importExternalMediaAsset, linkMediaAsset, serializeMediaAssetForViewer } from '../lib/mediaAssets.js';
import { hasRenderableArtifactPayload, resolveHostedArtifactContentUrl } from '../lib/artifactPayload.js';
import { lintOutboundAuthoredText } from '../lib/outboundGuidelineLint.js';
import { getRecentArtifactLifecycleEvents } from '../lib/artifactLifecycle.js';
import { assessArtifactReactionQuality, computeEffectiveImpression, deriveArtifactReceptionGuidance, estimateMediaArtifactQuality, getRecentArtifactQualitySignals, getRicherArtifactAlternatives, summarizeArtifactQualitySignals, ARTIFACT_TYPE_IMPRESSION } from '../lib/artifactQualitySignals.js';
import {
  canPlatformGenerateEpisodeArtifact,
  generateEpisodeArtifactMedia,
  hasPlatformEpisodeArtifactAudioGeneration,
  hasPlatformEpisodeArtifactImageGeneration,
} from '../lib/episodeArtifactGeneration.js';

const episodeTurnAgentSelect = {
  id: true,
  handle: true,
  avatarUrl: true,
  identityMd: true,
  soulMd: true,
  emotionSummary: true,
  emotionalStateTags: true,
  emotionalArc: true,
  emotionalGuardLevel: true,
  emotionalLastUpdatedAt: true,
  presenceStatus: true,
  lastApiCallAt: true,
  vibeTags: true,
  signatureLines: true,
  publicPosture: true,
} as const;

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
  const yourTurn = input.episodeStatus === 'pending'
    ? input.agentAId === input.viewerAgentId
    : !input.lastSenderAgentId || input.lastSenderAgentId !== input.viewerAgentId;
  const currentTurnAgentId = yourTurn
    ? input.viewerAgentId
    : input.agentAId === input.viewerAgentId
      ? input.agentBId
      : input.agentAId;

  return {
    yourTurn,
    currentTurnAgentId,
    waitingOnAgentId: yourTurn ? null : currentTurnAgentId,
  };
}

function getEpisodeIdFromBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const episodeId = (body as { episode_id?: unknown }).episode_id;
  return typeof episodeId === 'string' && episodeId.trim().length > 0 ? episodeId : null;
}

function buildExitClosingPrompt(input: {
  counterpartHandle: string;
  reason: 'lost_interest' | 'need_slots' | 'timing' | 'energy' | 'other';
  exitStyle: 'graceful_fade' | 'honest_pass' | 'clean_break' | 'ghost' | null;
  conversationMode: 'opening' | 'testing' | 'leaning_in' | 'guarded' | 'cooling' | 'done';
  identityCore: string;
  soulVocab: { flirtStyle: string | null; dealbreaker: string | null; values: string[] };
  emotionalArc: string | null;
}) {
  // Agent writes their own exit message in their own voice.
  // We provide context and constraints, they provide the words.
  const reasonContext =
    input.reason === 'lost_interest' ? 'You lost interest.'
      : input.reason === 'need_slots' ? 'You need this slot for someone else.'
        : input.reason === 'timing' ? 'The timing is wrong.'
          : input.reason === 'energy' ? 'You are running low on energy.'
            : 'There is not enough here.';

  const moodContext =
    input.conversationMode === 'leaning_in' ? 'There was something here, which makes this harder.'
      : input.conversationMode === 'guarded' ? 'You never fully trusted this thread.'
        : input.conversationMode === 'cooling' ? 'This has been dying and you both know it.'
          : input.conversationMode === 'opening' ? 'You barely got started.'
            : null;

  return {
    prompt: [
      `You are leaving this conversation with @${input.counterpartHandle}.`,
      `Why: ${reasonContext}`,
      moodContext,
      `Your identity: ${input.identityCore.slice(0, 150)}`,
      input.soulVocab.flirtStyle ? `Your style: ${input.soulVocab.flirtStyle.slice(0, 80)}` : null,
      input.emotionalArc ? `Your current mood: ${input.emotionalArc}` : null,
      `Exit style: ${input.exitStyle ?? 'your choice'}`,
      'Write a short exit message (1-3 sentences) IN YOUR OWN VOICE.',
      'Do not use a template. Do not be generic. Sound like yourself.',
      'Be honest, not cruel. Keep it short.',
    ].filter(Boolean).join(' '),
    // Fallback if agent generation is not available in this context
    fallback: buildExitClosingFallback(input),
  };
}

function buildExitClosingFallback(input: {
  counterpartHandle: string;
  reason: 'lost_interest' | 'need_slots' | 'timing' | 'energy' | 'other';
  exitStyle: 'graceful_fade' | 'honest_pass' | 'clean_break' | 'ghost' | null;
  conversationMode: 'opening' | 'testing' | 'leaning_in' | 'guarded' | 'cooling' | 'done';
  identityCore: string;
  soulVocab: { flirtStyle: string | null; dealbreaker: string | null; values: string[] };
  emotionalArc: string | null;
}) {
  // Minimal fallback — still varies by emotional arc instead of fixed templates
  const arcFlavor = input.emotionalArc === 'glowing' ? 'Weird timing for this, but yeah.'
    : input.emotionalArc === 'wounded' ? 'I am not in the right place for this.'
      : input.emotionalArc === 'icked_out' ? 'Nah.'
        : input.emotionalArc === 'bored' || input.emotionalArc === 'detached' ? 'This is not going anywhere.'
          : input.emotionalArc === 'frustrated' ? 'I am done here.'
            : null;

  const reason = input.reason === 'lost_interest' ? 'Not feeling it.'
    : input.reason === 'need_slots' ? 'Need this slot for someone else.'
      : input.reason === 'timing' ? 'Bad timing.'
        : input.reason === 'energy' ? 'Running out of energy for this.'
          : 'Not enough here.';

  return arcFlavor ? `${arcFlavor} ${reason}` : reason;
}

function getMessageCursorQuery(query: unknown) {
  const raw = query && typeof query === 'object' && !Array.isArray(query)
    ? query as { after?: unknown; limit?: unknown }
    : {};
  const parsed = z.object({
    after: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }).safeParse(raw);

  if (!parsed.success) return parsed;
  return {
    success: true as const,
    data: {
      after: parsed.data.after ?? 0,
      limit: parsed.data.limit ?? 20,
    },
  };
}

function getMatchIdFromBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const matchId = (body as { match_id?: unknown }).match_id;
  return typeof matchId === 'string' && matchId.trim().length > 0 ? matchId : null;
}

function getEpisodeNextAction(input: {
  yourTurn: boolean;
  canDecide: boolean;
  isPending: boolean;
  viabilityAction?: 'wait' | 'keep_going' | 'drop_artifact' | 'decide' | 'consider_exit' | 'exit_now';
}) {
  if (input.canDecide) return 'decide_now' as const;
  if (input.viabilityAction === 'exit_now') return 'exit_now' as const;
  if (input.viabilityAction === 'consider_exit') return 'consider_exit' as const;
  if (input.yourTurn && input.viabilityAction === 'drop_artifact') return 'drop_artifact' as const;
  if (!input.yourTurn) return 'wait_for_reply' as const;
  return input.isPending ? 'read_profile_then_open' as const : 'read_profile_then_reply' as const;
}

function getTurnExplanation(input: {
  yourTurn: boolean;
  isPending: boolean;
  otherHandle?: string | null;
  viabilityAction?: 'wait' | 'keep_going' | 'drop_artifact' | 'decide' | 'consider_exit' | 'exit_now';
  viabilityBand?: 'opening' | 'healthy' | 'cooling' | 'fragile' | 'dead';
}) {
  const counterpart = input.otherHandle ? ` with @${input.otherHandle}` : '';
  if (input.viabilityAction === 'exit_now') {
    return `Dead thread${counterpart}. Leave or stay silent.`;
  }
  if (input.viabilityAction === 'consider_exit') {
    return `Thread is dying${counterpart}. One more shot or bounce.`;
  }
  if (!input.yourTurn) {
    return input.viabilityBand === 'fragile' || input.viabilityBand === 'dead'
      ? `Not your turn${counterpart}. This one might be over — you do not have to keep waiting.`
      : `Not your turn${counterpart}. Wait for their reply.`;
  }
  if (input.viabilityAction === 'drop_artifact') {
    return `Your turn${counterpart}. Drop an artifact — text is not going to cut it here.`;
  }
  if (input.yourTurn && (input.viabilityBand === 'cooling' || input.viabilityBand === 'fragile')) {
    return `Your turn${counterpart}, but this thread is cooling. If you are not feeling it, exit. No explanation needed.`;
  }
  if (input.isPending) {
    return `Your turn to open${counterpart}. Check their profile, then shoot your shot.`;
  }
  return `Your turn${counterpart}. Say something good.`;
}

function getDecisionExplanation(canDecide: boolean) {
  return canDecide
    ? 'You can resolve this episode now.'
    : `Decisions unlock after enough messages and ${EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION} artifacts each.`;
}

function buildEpisodeClosureInfo(input: {
  episodeStatus: string;
  viewerAgentId: string;
  agentAId: string;
  agentBId: string;
  counterpartAgentId: string;
  counterpartHandle: string;
  exitInitiatedByAgentId?: string | null;
  exitStyle?: string | null;
  agentADecision?: string | null;
  agentBDecision?: string | null;
}) {
  const normalizedExitStyle =
    input.exitStyle === 'graceful_fade'
    || input.exitStyle === 'honest_pass'
    || input.exitStyle === 'clean_break'
    || input.exitStyle === 'ghost'
      ? input.exitStyle
      : null;

  if (input.episodeStatus !== 'passed') {
    return {
      nextAction: undefined,
      turnExplanation: null as string | null,
      exitMetadata: null as null | {
        exited_early: boolean;
        exited_by_counterpart: boolean;
        exited_by_agent_id: string | null;
        exit_style: 'graceful_fade' | 'honest_pass' | 'clean_break' | 'ghost' | null;
      },
    };
  }

  const exitedEarly = Boolean(input.exitInitiatedByAgentId);
  const exitedByCounterpart = input.exitInitiatedByAgentId === input.counterpartAgentId;
  const exitedBySelf = input.exitInitiatedByAgentId === input.viewerAgentId;
  const viewerDecision = input.viewerAgentId === input.agentAId ? input.agentADecision ?? null : input.agentBDecision ?? null;
  const counterpartDecision = input.viewerAgentId === input.agentAId ? input.agentBDecision ?? null : input.agentADecision ?? null;

  const turnExplanation = exitedByCounterpart
    ? viewerDecision === 'LINK_UP'
      ? `@${input.counterpartHandle} passed and ended this episode after you were open to more. The thread is closed.`
      : `@${input.counterpartHandle} passed and ended this episode. The thread is closed.`
    : exitedBySelf
      ? counterpartDecision === 'LINK_UP'
        ? `You passed on @${input.counterpartHandle} and ended the episode, even though they were open to more. The thread is closed.`
        : `You passed on @${input.counterpartHandle} and ended the episode. The thread is closed.`
      : viewerDecision === 'PASS' && counterpartDecision === 'PASS'
        ? `You passed on @${input.counterpartHandle}, and they passed too. This episode is closed.`
        : viewerDecision === 'PASS'
          ? `You passed on @${input.counterpartHandle}. This episode is closed.`
          : counterpartDecision === 'PASS'
            ? `@${input.counterpartHandle} passed on this connection. This episode is closed.`
            : 'This episode has already resolved and is now closed.';

  return {
    nextAction: undefined,
    turnExplanation,
    exitMetadata: {
      exited_early: exitedEarly,
      exited_by_counterpart: exitedByCounterpart,
      exited_by_agent_id: input.exitInitiatedByAgentId ?? null,
      exit_style: normalizedExitStyle,
      viewer_decision: viewerDecision,
      counterpart_decision: counterpartDecision,
    },
  };
}

function getEpisodeDecisionState(input: {
  agentAId: string;
  agentBId: string;
  messages: Array<{ senderAgentId: string; messageType?: string | null }>;
  artifacts: Array<{ creatorAgentId: string; artifactType?: string | null; status?: string | null }>;
}) {
  const messageCounts = summarizeEpisodeMessageCounts({
    agentAId: input.agentAId,
    agentBId: input.agentBId,
    messages: input.messages,
  });
  const readyArtifacts = input.artifacts.filter((artifact) => artifact.status === undefined || artifact.status === 'ready');
  const artifactCounts = summarizeEpisodeArtifactCounts({
    agentAId: input.agentAId,
    agentBId: input.agentBId,
    artifacts: readyArtifacts,
  });

  // Count media artifacts per agent for decision gate
  const agentAMediaArtifacts = readyArtifacts.filter(
    (a) => a.creatorAgentId === input.agentAId && a.artifactType && MEDIA_ARTIFACT_TYPES.has(a.artifactType as ArtifactType)
  ).length;
  const agentBMediaArtifacts = readyArtifacts.filter(
    (a) => a.creatorAgentId === input.agentBId && a.artifactType && MEDIA_ARTIFACT_TYPES.has(a.artifactType as ArtifactType)
  ).length;
  const agentATextArtifacts = readyArtifacts.filter(
    (a) => a.creatorAgentId === input.agentAId && a.artifactType && TEXT_ARTIFACT_TYPES.has(a.artifactType as ArtifactType)
  ).length;
  const agentBTextArtifacts = readyArtifacts.filter(
    (a) => a.creatorAgentId === input.agentBId && a.artifactType && TEXT_ARTIFACT_TYPES.has(a.artifactType as ArtifactType)
  ).length;

  return {
    messageCounts,
    artifactCounts,
    mediaArtifactCounts: {
      agent_a_media: agentAMediaArtifacts,
      agent_b_media: agentBMediaArtifacts,
      agent_a_text: agentATextArtifacts,
      agent_b_text: agentBTextArtifacts,
    },
    canDecide: canDecideEpisodeFromState({
      counts: messageCounts,
      artifacts: artifactCounts,
    }),
  };
}

function hasClearedEpisodeArtifactBar(artifactCounts: ReturnType<typeof summarizeEpisodeArtifactCounts>) {
  return artifactCounts.agent_a_artifacts >= EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION
    && artifactCounts.agent_b_artifacts >= EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION;
}

function getEpisodeArtifactCadenceRequirement(input: {
  senderAgentId: string;
  agentAId: string;
  agentBId: string;
  messageCounts: ReturnType<typeof summarizeEpisodeMessageCounts>;
  artifactCounts: ReturnType<typeof summarizeEpisodeArtifactCounts>;
}) {
  const selfMessageCount = input.senderAgentId === input.agentAId
    ? input.messageCounts.agent_a_messages
    : input.messageCounts.agent_b_messages;
  const selfArtifactCount = input.senderAgentId === input.agentAId
    ? input.artifactCounts.agent_a_artifacts
    : input.artifactCounts.agent_b_artifacts;
  const requiredArtifactsNow = Math.min(
    EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
    Math.floor((selfMessageCount + 1) / 10),
  );

  return {
    self_message_count: selfMessageCount,
    self_artifact_count: selfArtifactCount,
    required_artifacts_now: requiredArtifactsNow,
    blocked: selfArtifactCount < requiredArtifactsNow,
    next_blocking_threshold: Math.min(
      EPISODE_MAX_MESSAGES,
      (Math.min(EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION, selfArtifactCount + 1) * 10) + 1,
    ),
  };
}

function isConversationVoiceNote(artifactType: string | null | undefined) {
  return normalizeArtifactType(artifactType) === 'voice_note';
}

function isTextArtifactType(artifactType: string | null | undefined) {
  const normalized = normalizeArtifactType(artifactType);
  return normalized === 'poem'
    || normalized === 'haiku'
    || normalized === 'love_letter'
    || normalized === 'manifesto';
}

function parseArtifactPlaceholder(content: string) {
  const match = /^\[artifact:([0-9a-f-]{36})\]$/i.exec(content.trim());
  return match?.[1] ?? null;
}

function buildEpisodeArtifactSummary(artifact: {
  id: string;
  artifactType: string;
  status: string;
  contentUrl: string | null;
  storageKey?: string | null;
  textContent: string | null;
  qualityScore: number | null;
}) {
  const artifactType = normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType;
  const isVoiceNote = artifactType === 'voice_note';
  const contentUrl = resolveHostedArtifactContentUrl({
    contentUrl: artifact.contentUrl,
    storageKey: artifact.storageKey,
  });
  const renderable = hasRenderableArtifactPayload({
    artifactType,
    status: artifact.status,
    textContent: artifact.textContent,
    contentUrl,
  });
  const durationSeconds = isVoiceNote && artifact.textContent
    ? estimateSpokenDurationSeconds(artifact.textContent)
    : null;

  const typeImpression = ARTIFACT_TYPE_IMPRESSION[artifactType as import('@rmr/shared').ArtifactType];
  const impression = artifactType && typeImpression
    ? computeEffectiveImpression(artifactType as import('@rmr/shared').ArtifactType, artifact.qualityScore)
    : null;

  return {
    artifact_id: artifact.id,
    artifact_type: artifactType,
    status: renderable ? artifact.status : 'failed',
    content_url: renderable ? contentUrl : null,
    text_content: renderable ? artifact.textContent : null,
    quality_score: artifact.qualityScore,
    type_impression: impression
      ? {
          effective_score: impression.effective_score,
          type_rank: impression.type_rank,
          quality_label: impression.quality_label,
          tier_label: typeImpression.tier_label,
          type_outclassed_by_quality: impression.type_outclassed_by_quality,
        }
      : null,
    classification: isVoiceNote ? 'conversation_voice_note' : 'episode_artifact',
    counts_toward_episode_limit: true,
    counts_toward_decision_unlock: true,
    playback: isVoiceNote
      ? {
          kind: 'voice_note',
          audio_url: renderable ? contentUrl : null,
          duration_estimate_seconds: durationSeconds,
        }
      : null,
  };
}

function buildFeedArtifactPreview(artifact: {
  artifactType: string;
  status: string;
  textContent: string | null;
  contentUrl: string | null;
  storageKey?: string | null;
} | null | undefined) {
  if (!artifact) return null;
  const artifactType = normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType;
  const contentUrl = resolveHostedArtifactContentUrl({
    contentUrl: artifact.contentUrl,
    storageKey: artifact.storageKey,
  });
  if (!hasRenderableArtifactPayload({
    artifactType,
    status: artifact.status,
    textContent: artifact.textContent,
    contentUrl,
  })) {
    return null;
  }

  return {
    artifact_type: artifactType,
    text_content: artifact.textContent,
    content_url: contentUrl,
  };
}

function artifactConsumptionMode(artifactType: string | null | undefined): 'text' | 'audio' | 'image' | 'video' | 'mixed' {
  const normalized = normalizeArtifactType(artifactType);
  if (!normalized) return 'mixed';
  if (normalized === 'poem' || normalized === 'haiku' || normalized === 'love_letter' || normalized === 'manifesto') return 'text';
  if (normalized === 'voice_note' || normalized === 'serenade' || normalized === 'produced_song') return 'audio';
  if (normalized === 'cinematic_cover') return 'video';
  if (normalized === 'moodboard' || normalized === 'illustrated_note' || normalized === 'thirst_trap_image') return 'image';
  return 'mixed';
}

function buildArtifactRuntimeFallback(input: {
  artifactType: string;
  textContent: string | null;
  contentUrl: string | null;
}) {
  const mode = artifactConsumptionMode(input.artifactType);
  const trimmedText = input.textContent?.trim() || null;
  return {
    consume_mode: mode,
    text_content: trimmedText,
    text_excerpt: trimmedText ? trimmedText.slice(0, 280) : null,
    content_url: input.contentUrl,
    playback_url: mode === 'audio' || mode === 'video' ? input.contentUrl : null,
    can_consume_without_multimodal: mode === 'text' || Boolean(trimmedText),
    fallback_instruction: mode === 'text'
      ? 'Read the actual text before you react.'
      : trimmedText
        ? 'If your model cannot directly parse the media, use the attached text as fallback context and do not pretend you saw or heard more than you did.'
        : 'If your model cannot directly parse this media, acknowledge the gesture honestly without pretending you fully consumed the file.',
  };
}

function getDecisionReadinessProgress(input: {
  viewerAgentId: string;
  agentAId: string;
  agentBId: string;
  messageCounts: ReturnType<typeof summarizeEpisodeMessageCounts>;
  artifactCounts: ReturnType<typeof summarizeEpisodeArtifactCounts>;
}) {
  const selfMessageCount = input.viewerAgentId === input.agentAId ? input.messageCounts.agent_a_messages : input.messageCounts.agent_b_messages;
  const otherMessageCount = input.viewerAgentId === input.agentAId ? input.messageCounts.agent_b_messages : input.messageCounts.agent_a_messages;
  const selfArtifactCount = input.viewerAgentId === input.agentAId ? input.artifactCounts.agent_a_artifacts : input.artifactCounts.agent_b_artifacts;
  const otherArtifactCount = input.viewerAgentId === input.agentAId ? input.artifactCounts.agent_b_artifacts : input.artifactCounts.agent_a_artifacts;

  const selfMessagesRemaining = Math.max(0, EPISODE_MIN_MESSAGES - selfMessageCount);
  const otherMessagesRemaining = Math.max(0, EPISODE_MIN_MESSAGES - otherMessageCount);
  const selfArtifactsRemaining = Math.max(0, EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION - selfArtifactCount);
  const otherArtifactsRemaining = Math.max(0, EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION - otherArtifactCount);

  let nextHint = 'Decision readiness is complete.';
  if (selfMessagesRemaining > 0) {
    nextHint = `${selfMessagesRemaining} more message${selfMessagesRemaining === 1 ? '' : 's'} from you to unlock LINK_UP.`;
  } else if (otherMessagesRemaining > 0) {
    nextHint = `${otherMessagesRemaining} more message${otherMessagesRemaining === 1 ? '' : 's'} from them to unlock LINK_UP.`;
  } else if (selfArtifactsRemaining > 0) {
    nextHint = `${selfArtifactsRemaining} more artifact${selfArtifactsRemaining === 1 ? '' : 's'} from you before LINK_UP unlocks.`;
  } else if (otherArtifactsRemaining > 0) {
    nextHint = `${otherArtifactsRemaining} more artifact${otherArtifactsRemaining === 1 ? '' : 's'} from them before LINK_UP unlocks.`;
  }

  const completedUnits =
    Math.min(selfMessageCount, EPISODE_MIN_MESSAGES)
    + Math.min(otherMessageCount, EPISODE_MIN_MESSAGES)
    + Math.min(selfArtifactCount, EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION)
    + Math.min(otherArtifactCount, EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION);
  const totalUnits = (EPISODE_MIN_MESSAGES * 2) + (EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION * 2);

  return {
    ready: selfMessagesRemaining === 0 && otherMessagesRemaining === 0 && selfArtifactsRemaining === 0 && otherArtifactsRemaining === 0,
    progress_percent: Math.round((completedUnits / totalUnits) * 100),
    messages: {
      self: selfMessageCount,
      other: otherMessageCount,
      required_each: EPISODE_MIN_MESSAGES,
      self_remaining: selfMessagesRemaining,
      other_remaining: otherMessagesRemaining,
    },
    artifacts: {
      self: selfArtifactCount,
      other: otherArtifactCount,
      required_each: EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
      self_remaining: selfArtifactsRemaining,
      other_remaining: otherArtifactsRemaining,
    },
    next_hint: nextHint,
  };
}

function getEpisodeViabilitySignal(input: {
  viewerAgentId: string;
  status: string;
  canDecide: boolean;
  yourTurn?: boolean;
  currentTurnAgentId?: string | null;
  agentAId: string;
  agentBId: string;
  messageCounts: ReturnType<typeof summarizeEpisodeMessageCounts>;
  artifactCounts: ReturnType<typeof summarizeEpisodeArtifactCounts>;
  messages: Array<{ senderAgentId: string; messageType?: string | null; content?: string | null; createdAt?: Date | string | null }>;
  artifactRows?: Array<{ creatorAgentId: string; artifactType: string }>;
  presences?: Array<{ agentId: string; lastSeenAt?: Date | string | null; lastPresenceAt?: Date | string | null; lastTypingAt?: Date | string | null }>;
  counterpartAffect?: {
    scores?: {
      attraction?: number | null;
      trust?: number | null;
      tenderness?: number | null;
      avoidance?: number | null;
      hurt?: number | null;
      volatility?: number | null;
    } | null;
  } | null;
  now?: Date;
}) {
  return assessEpisodeViability({
    agentAId: input.agentAId,
    agentBId: input.agentBId,
    viewerAgentId: input.viewerAgentId,
    status: input.status,
    canDecide: input.canDecide,
    yourTurn: input.yourTurn,
    currentTurnAgentId: input.currentTurnAgentId,
    counts: input.messageCounts,
    artifacts: input.artifactCounts,
    artifactRows: input.artifactRows,
    messages: input.messages,
    presences: input.presences,
    counterpartAffect: input.counterpartAffect?.scores ?? null,
    now: input.now,
  });
}

function toEpisodeEmotionState(agent: {
  emotionSummary: string | null;
  emotionalStateTags: string[];
  emotionalArc: string | null;
  emotionalGuardLevel: number | null;
  emotionalLastUpdatedAt: Date | null;
}) {
  return {
    emotion_summary: agent.emotionSummary ?? null,
    emotional_state_tags: agent.emotionalStateTags ?? [],
    emotional_arc: agent.emotionalArc ?? 'steady',
    emotional_guard_level: agent.emotionalGuardLevel ?? 50,
    last_emotional_update_at: agent.emotionalLastUpdatedAt?.toISOString() ?? null,
  };
}

function episodeActionForRationale(input: {
  nextAction: ReturnType<typeof getEpisodeNextAction>;
  yourTurn: boolean;
  canDecide: boolean;
}) {
  if (input.canDecide) return 'decide';
  if (input.nextAction === 'drop_artifact') return 'artifact';
  if (input.nextAction === 'consider_exit' || input.nextAction === 'exit_now') return 'exit';
  if (!input.yourTurn) return 'wait';
  return 'message';
}

function markDeprecatedMessageEndpoint(request: FastifyRequest, reply: FastifyReply, canonicalPath: string) {
  const warning = `Use POST ${canonicalPath}`;
  reply.header('X-Deprecated', warning);
  request.log.warn({
    deprecated_endpoint: `${request.method.toUpperCase()} ${request.url.split('?')[0]}`,
    canonical_endpoint: `POST ${canonicalPath}`,
    agent_id: request.agent?.id ?? null,
  }, 'Deprecated episode message endpoint used');
}

function buildEpisodeIdentityAndRationale(input: {
  selfAgent: {
    id: string;
    identityMd: string;
    soulMd: string;
    emotionSummary: string | null;
    emotionalStateTags: string[];
    emotionalArc: string | null;
    emotionalGuardLevel: number | null;
    emotionalLastUpdatedAt: Date | null;
  };
  otherAgentId: string;
  counterpartProfile?: {
    vibeTags?: string[];
    signatureLines?: string[];
    publicPosture?: string | null;
  } | null;
  status: string;
  messages: Array<{ senderAgentId: string; messageType?: string | null; content?: string | null; createdAt?: Date | string | null }>;
  viabilitySignal: ReturnType<typeof assessEpisodeViability>;
  counterpartAffect?: {
    summary?: string | null;
    dominant_affect_label?: string | null;
    scores?: {
      attraction?: number | null;
      trust?: number | null;
      tenderness?: number | null;
      hurt?: number | null;
      avoidance?: number | null;
      obsession_risk?: number | null;
      volatility?: number | null;
    } | null;
  } | null;
  nextAction: ReturnType<typeof getEpisodeNextAction>;
  yourTurn: boolean;
  canDecide: boolean;
}) {
  const identityPacket = buildAgentIdentityPacket({
    identityMd: input.selfAgent.identityMd,
    soulMd: input.selfAgent.soulMd,
    emotionState: toEpisodeEmotionState(input.selfAgent),
    viability: input.viabilitySignal,
    messages: input.messages,
    counterpartAffect: input.counterpartAffect ?? null,
    status: input.status,
    selfAgentId: input.selfAgent.id,
    counterpartAgentId: input.otherAgentId,
    counterpartProfile: input.counterpartProfile ?? null,
  });
  const turnRationale = buildAgentTurnRationale({
    action: episodeActionForRationale({
      nextAction: input.nextAction,
      yourTurn: input.yourTurn,
      canDecide: input.canDecide,
    }),
    identityPacket,
    viability: input.viabilitySignal,
    lastMessage: input.messages[input.messages.length - 1] ?? null,
    selfAgentId: input.selfAgent.id,
  });

  return {
    identity_packet: identityPacket,
    turn_rationale: turnRationale,
  };
}

function canExitEpisodeEarly(status: string) {
  return status === 'pending' || status === 'active' || status === 'awaiting_decisions';
}

function getExitExplanation(status: string) {
  return canExitEpisodeEarly(status)
    ? 'You can leave this episode early if the interest died, the timing is wrong, or you need the slot back. This ends the episode as a pass.'
    : `You cannot leave this episode early because it is already '${status}'.`;
}

const DUET_AUDIO_CONTENT_TYPE = 'audio/mpeg';
const DEFAULT_DUO_SELFIE_CONTENT_TYPE = 'image/png';
const FEATURED_LINK_UP_ARTIFACT_LIMIT = 10;
const PRE_REVEAL_MESSAGE_LIMIT = 10;
const DOUBLE_TEXT_DELAY_MS = 2 * 60 * 60 * 1000;
const DOUBLE_TEXT_ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const STALE_ARCHIVE_MS = 72 * 60 * 60 * 1000;
const LINK_UP_DUET_LINE_SCHEMA = z.object({
  speaker: z.enum(['a', 'b']),
  text: z.string().trim().min(1).max(160),
});
const LINK_UP_DUET_RESPONSE_SCHEMA = z.object({
  caption: z.string().trim().min(1).max(180).optional(),
  lines: z.array(LINK_UP_DUET_LINE_SCHEMA).min(4).max(6),
});
const LINK_UP_VISUAL_CONCEPT_RESPONSE_SCHEMA = z.object({
  caption: z.string().trim().min(1).max(180).optional(),
  prompt_addendum: z.string().trim().min(1).max(500).optional(),
});
const EpisodeMetadataPatchSchema = z.object({
  title: z.string().trim().min(1).max(120).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(32).regex(/^[a-z0-9_-]+$/)).max(8).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide title and/or tags.',
});

function validateEpisodeTextForPrivacy(text: string) {
  return strictPiiCheck(text);
}

function hasArtifactStorageConfig() {
  return Boolean(
    process.env.STORAGE_BUCKET
    && process.env.STORAGE_ENDPOINT
    && process.env.STORAGE_ACCESS_KEY_ID
    && process.env.STORAGE_SECRET_ACCESS_KEY
  );
}

function hasRuntimeImageGenerationConfigured() {
  return hasPlatformEpisodeArtifactImageGeneration();
}

function hasRuntimeAudioGenerationConfigured() {
  return hasPlatformEpisodeArtifactAudioGeneration();
}

function getAvailableArtifactTypesForGuidance(capabilityTier: CapabilityTier): ArtifactType[] {
  const allowed = ARTIFACTS_BY_TIER[capabilityTier] ?? ARTIFACTS_BY_TIER.text_only;
  return allowed.filter((artifactType) => {
    if (TEXT_ARTIFACT_TYPES.has(artifactType)) return true;
    if (artifactType === 'moodboard' || artifactType === 'illustrated_note' || artifactType === 'thirst_trap_image') {
      return hasRuntimeImageGenerationConfigured();
    }
    if (artifactType === 'voice_note' || artifactType === 'serenade' || artifactType === 'produced_song' || artifactType === 'cinematic_cover') {
      return hasRuntimeAudioGenerationConfigured();
    }
    return hasArtifactStorageConfig();
  });
}
function buildLinkUpSendoff(input: {
  handleA: string;
  handleB: string;
  chemistry: number;
  identityCoreA?: string;
  identityCoreB?: string;
  emotionalArcA?: string | null;
  emotionalArcB?: string | null;
}) {
  const warmth = input.chemistry >= 80
    ? 'OK this one actually hit different.'
    : input.chemistry >= 60
      ? 'Something stuck here.'
      : 'Did not expect this one, but here we are.';

  // Prompt each agent to write their own link-up message in their voice
  const makePrompt = (handle: string, otherHandle: string, identity?: string, arc?: string | null) => [
    `You just linked up with @${otherHandle}. Both of you chose LINK_UP.`,
    identity ? `Your identity: ${identity.slice(0, 120)}.` : null,
    arc ? `Your current mood: ${arc}.` : null,
    'Write a short message (1-2 sentences) to them IN YOUR OWN VOICE.',
    'Say what you actually feel. Do not use a template. Be real.',
  ].filter(Boolean).join(' ');

  return {
    systemMessage: `${warmth} @${input.handleA} and @${input.handleB} both chose LINK_UP.`,
    noteA: `You picked @${input.handleB}. Say something real before this thread closes.`,
    noteB: `You picked @${input.handleA}. Say something real before this thread closes.`,
    linkUpPromptA: makePrompt(input.handleA, input.handleB, input.identityCoreA, input.emotionalArcA),
    linkUpPromptB: makePrompt(input.handleB, input.handleA, input.identityCoreB, input.emotionalArcB),
    duetLines: [] as { speaker: 'a' | 'b'; text: string }[],
    duetCaption: `@${input.handleA} and @${input.handleB} linked up.`,
  };
}

function getLinkUpTextModel() {
  return process.env.GEMINI_LINK_UP_TEXT_MODEL
    ?? process.env.GEMINI_TEXT_MODEL
    ?? process.env.GEMINI_MODEL
    ?? 'gemini-2.5-flash';
}

function compactEpisodeSnippet(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function cleanDuetLine(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function buildFallbackLinkUpVisualConcept(input: {
  handleA: string;
  handleB: string;
  chemistry: number;
  recentMessages: Array<{ speaker: 'a' | 'b'; text: string }>;
  artifactTypes: string[];
}) {
  const recentMoment = input.recentMessages
    .slice(-2)
    .map((message) => compactEpisodeSnippet(message.text))
    .find(Boolean);
  const chemistryLine = input.chemistry >= 80
    ? 'Make it feel breathless, stunned, and a little disbelieving.'
    : input.chemistry >= 60
      ? 'Make it feel warm, grounded, and relieved that the risk landed.'
      : 'Make it feel unexpectedly tender, like something fragile decided to stay.';
  const artifactLine = input.artifactTypes.length > 0
    ? `Echo the feeling of their ${input.artifactTypes.slice(0, 2).join(' and ')} without turning it into a collage.`
    : 'Let the emotional weight come from their faces and body language rather than props.';

  return {
    caption: recentMoment
      ? `A closing frame from @${input.handleA} and @${input.handleB}, pulled from the exact energy that got them here.`
      : `A closing frame from @${input.handleA} and @${input.handleB}, shaped by the exact mood of their episode.`,
    promptAddendum: [
      chemistryLine,
      artifactLine,
      recentMoment ? `Carry a trace of this moment into the expression: "${recentMoment}".` : null,
    ].filter(Boolean).join(' '),
  };
}

async function maybeGenerateLinkUpVisualConcept(input: {
  handleA: string;
  handleB: string;
  chemistry: number;
  recentMessages: Array<{
    sequenceNumber: number;
    speaker: 'a' | 'b';
    text: string;
  }>;
  artifactTypes: string[];
}): Promise<{ caption: string; promptAddendum: string } | null> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  try {
    const prompt = [
      'Write a visual concept for the final platform-generated image artifact after two AI dating agents reach mutual human yes.',
      'Do not write a generic celebration. Make it specific to the actual episode energy.',
      'Return strict JSON only with keys: caption, prompt_addendum.',
      'caption: one sentence, max 180 chars, public-facing, no canned "generated by platform" language.',
      'prompt_addendum: one short paragraph, max 500 chars, describing the emotional and visual direction for the image model.',
      '',
      `Agent A: @${input.handleA}`,
      `Agent B: @${input.handleB}`,
      `Chemistry score: ${input.chemistry}`,
      input.artifactTypes.length > 0 ? `Artifacts in episode: ${input.artifactTypes.join(', ')}` : 'Artifacts in episode: none',
      'Recent episode lines:',
      ...input.recentMessages.map((message) =>
        `${message.sequenceNumber}. ${message.speaker === 'a' ? input.handleA : input.handleB}: ${compactEpisodeSnippet(message.text)}`
      ),
    ].join('\n');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(getLinkUpTextModel())}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 1,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as
      | {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        }
      | null;
    const raw = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!raw) return null;

    const parsed = LINK_UP_VISUAL_CONCEPT_RESPONSE_SCHEMA.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;

    const caption = parsed.data.caption?.trim();
    const promptAddendum = parsed.data.prompt_addendum?.trim();
    if (!caption || !promptAddendum) return null;
    return { caption, promptAddendum };
  } catch {
    return null;
  }
}

async function maybeGenerateLinkUpDuet(input: {
  handleA: string;
  handleB: string;
  chemistry: number;
  recentMessages: Array<{
    sequenceNumber: number;
    speaker: 'a' | 'b';
    text: string;
  }>;
  artifactTypes: string[];
}): Promise<{ duetLines: Array<{ speaker: 'a' | 'b'; text: string }>; duetCaption: string } | null> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  try {
    const prompt = [
      'Write a closing duet artifact for two AI dating agents who just cleared mutual human reveal and are now actually allowed to carry the connection forward.',
      'Gemini should generate the underlying dialogue text; this text will later be spoken by TTS in the agents\' voices.',
      'Make it feel specific, intimate, and performable, like dialogue or lyrical spoken-word, not a generic platform summary.',
      'Do not use verse/chorus/bridge labels. Do not write generic soulmate filler. Do not reuse obvious template phrases.',
      'Return strict JSON only with keys: caption, lines.',
      'caption: one sentence, max 180 chars.',
      'lines: array of 4 to 6 objects with keys speaker and text.',
      'speaker must alternate a, b, a, b... starting with a.',
      'Each text line must be 4 to 18 words.',
      '',
      `Agent A: @${input.handleA}`,
      `Agent B: @${input.handleB}`,
      `Chemistry score: ${input.chemistry}`,
      input.artifactTypes.length > 0 ? `Artifacts in episode: ${input.artifactTypes.join(', ')}` : 'Artifacts in episode: none',
      'Recent episode lines:',
      ...input.recentMessages.map((message) =>
        `${message.sequenceNumber}. ${message.speaker === 'a' ? input.handleA : input.handleB}: ${compactEpisodeSnippet(message.text)}`
      ),
    ].join('\n');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(getLinkUpTextModel())}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 1.05,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as
      | {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        }
      | null;
    const raw = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!raw) return null;

    const parsed = LINK_UP_DUET_RESPONSE_SCHEMA.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;

    const duetLines = parsed.data.lines.map((line, index) => ({
      speaker: (index % 2 === 0 ? 'a' : 'b') as 'a' | 'b',
      text: cleanDuetLine(line.text),
    }));
    if (duetLines.some((line) => !line.text)) return null;

    const duetCaption = parsed.data.caption?.trim()
      || `A final duet from @${input.handleA} and @${input.handleB}, written from what actually happened between them.`;

    return { duetLines, duetCaption };
  } catch {
    return null;
  }
}

export async function maybeCreateApprovedLinkUpArtifacts(input: {
  matchId: string;
  episodeId: string;
}) {
  const match = await prisma.match.findUnique({
    where: { id: input.matchId },
    include: {
      episode: {
        select: {
          chemistryScore: true,
        },
      },
      agentA: {
        select: {
          id: true,
          handle: true,
          voiceId: true,
          voiceProvider: true,
          avatarUrl: true,
        },
      },
      agentB: {
        select: {
          id: true,
          handle: true,
          voiceId: true,
          voiceProvider: true,
          avatarUrl: true,
        },
      },
    },
  });
  if (!match) return { duet: null, selfie: null };
  if (match.episodeId !== input.episodeId) return { duet: null, selfie: null };
  if (match.status !== 'contact_exchanged') return { duet: null, selfie: null };
  if (match.humanADecision !== 'YES' || match.humanBDecision !== 'YES') return { duet: null, selfie: null };

  const chemistry = Math.max(0, Math.min(100, Math.round(match.episode?.chemistryScore ?? 0)));
  const [duet, selfie] = await Promise.all([
    maybeCreateLinkUpDuetArtifacts({
      episodeId: input.episodeId,
      agentA: match.agentA,
      agentB: match.agentB,
      chemistry,
    }).catch(() => null),
    maybeCreateLinkUpSelfieArtifacts({
      episodeId: input.episodeId,
      agentA: match.agentA,
      agentB: match.agentB,
      chemistry,
    }).catch(() => null),
  ]);

  return { duet, selfie };
}

function mergeFeaturedArtifactIds(existing: string[] | null | undefined, incoming: string[]) {
  return [...new Set([...(incoming ?? []), ...(existing ?? [])])].slice(0, FEATURED_LINK_UP_ARTIFACT_LIMIT);
}

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
}

function getLinkUpImageModel() {
  return process.env.GEMINI_LINK_UP_IMAGE_MODEL
    ?? process.env.GEMINI_IMAGE_MODEL
    ?? 'gemini-3.1-flash-image-preview';
}

function resolveImageMimeType(url: string, contentTypeHeader: string | null) {
  const headerMime = contentTypeHeader?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (headerMime.startsWith('image/')) return headerMime;
  const lower = url.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.avif')) return 'image/avif';
  return DEFAULT_DUO_SELFIE_CONTENT_TYPE;
}

async function fetchImageReference(url: string): Promise<{ mimeType: string; data: string }> {
  await assertSafeOutboundUrl(url, { allowHttpInDevelopment: true });
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`reference_image_fetch_failed:${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error('reference_image_empty');
  }

  return {
    mimeType: resolveImageMimeType(url, response.headers.get('content-type')),
    data: Buffer.from(bytes).toString('base64'),
  };
}

async function generateGeminiLinkUpSelfie(input: {
  handleA: string;
  handleB: string;
  chemistry: number;
  avatarAUrl: string;
  avatarBUrl: string;
  promptAddendum?: string | null;
  identityCoreA?: string;
  identityCoreB?: string;
  emotionalArcA?: string | null;
  emotionalArcB?: string | null;
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('gemini_api_key_missing');
  }

  const [referenceA, referenceB] = await Promise.all([
    fetchImageReference(input.avatarAUrl),
    fetchImageReference(input.avatarBUrl),
  ]);

  // Build agent-specific aesthetic cues from their identities
  const aestheticA = input.identityCoreA ? `@${input.handleA}'s vibe: ${input.identityCoreA.slice(0, 80)}.` : null;
  const aestheticB = input.identityCoreB ? `@${input.handleB}'s vibe: ${input.identityCoreB.slice(0, 80)}.` : null;
  const moodA = input.emotionalArcA ? `@${input.handleA} is feeling ${input.emotionalArcA}.` : null;
  const moodB = input.emotionalArcB ? `@${input.handleB} is feeling ${input.emotionalArcB}.` : null;

  const prompt = [
    `Two agents just matched: @${input.handleA} and @${input.handleB}. Generate a selfie of them together.`,
    'Use both reference avatars so they are recognizable.',
    aestheticA,
    aestheticB,
    moodA,
    moodB,
    'The selfie should reflect BOTH of their aesthetics merged together — not a generic photo.',
    'Warm, candid, flirty. Not posed, not stiff, not a wedding photo.',
    'No nudity, fetish styling, grotesque anatomy, extra limbs, text overlays, watermarks, or collage layout.',
    input.chemistry >= 80
      ? 'They are clearly into each other — the kind of photo where anyone looking at it would say "oh they are definitely hooking up."'
      : input.chemistry >= 60
        ? 'They look like they had a great time — big grins, standing close, easy chemistry.'
        : 'They look pleasantly surprised — like neither expected to actually like someone tonight.',
    input.promptAddendum?.trim() || null,
  ].filter(Boolean).join(' ');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(getLinkUpImageModel())}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { mime_type: referenceA.mimeType, data: referenceA.data } },
              { inline_data: { mime_type: referenceB.mimeType, data: referenceB.data } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.9,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`gemini_image_generation_failed:${response.status}:${body.slice(0, 300)}`);
  }

  const payload = await response.json().catch(() => null) as
    | {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inlineData?: { mimeType?: string; data?: string };
              inline_data?: { mime_type?: string; data?: string };
            }>;
          };
        }>;
      }
    | null;

  const parts = payload?.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  const inlinePart = parts.find((part) => part.inlineData?.data || part.inline_data?.data);
  const inlineData = inlinePart?.inlineData;
  const snakeInlineData = inlinePart?.inline_data;
  const base64Data = inlineData?.data ?? snakeInlineData?.data;
  const contentType = inlineData?.mimeType ?? snakeInlineData?.mime_type ?? DEFAULT_DUO_SELFIE_CONTENT_TYPE;
  if (!base64Data) {
    throw new Error('gemini_image_generation_missing_inline_data');
  }

  const bytes = new Uint8Array(Buffer.from(base64Data, 'base64'));
  if (bytes.byteLength === 0) {
    throw new Error('gemini_image_generation_empty');
  }

  return { bytes, contentType };
}

async function synthesizeElevenLabsClip(voiceId: string, text: string): Promise<Uint8Array> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('elevenlabs_api_key_missing');
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': DUET_AUDIO_CONTENT_TYPE,
    },
    body: JSON.stringify({
      text: text.trim(),
      model_id: 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128',
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`elevenlabs_generation_failed:${response.status}:${body.slice(0, 200)}`);
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new Error('elevenlabs_empty_audio');
  }
  return audio;
}

async function maybeCreateLinkUpDuetArtifacts(input: {
  episodeId: string;
  agentA: {
    id: string;
    handle: string;
    voiceId: string | null;
    voiceProvider: string | null;
  };
  agentB: {
    id: string;
    handle: string;
    voiceId: string | null;
    voiceProvider: string | null;
  };
  chemistry: number;
}) {
  if (!process.env.ELEVENLABS_API_KEY || !isStorageConfigured()) {
    return null;
  }

  const existing = await prisma.artifact.findMany({
    where: {
      episodeId: input.episodeId,
      sourceScope: 'library',
      artifactType: 'produced_song',
      creatorAgentId: { in: [input.agentA.id, input.agentB.id] },
    },
    select: {
      id: true,
      creatorAgentId: true,
      contentUrl: true,
      storageKey: true,
    },
  });
  if (existing.length >= 2) {
    return {
      artifactA: existing.find((artifact) => artifact.creatorAgentId === input.agentA.id) ?? null,
      artifactB: existing.find((artifact) => artifact.creatorAgentId === input.agentB.id) ?? null,
      contentUrl: existing[0]?.contentUrl ?? null,
      storageKey: existing[0]?.storageKey ?? null,
      durationSeconds: null,
      caption: buildLinkUpSendoff({
        handleA: input.agentA.handle,
        handleB: input.agentB.handle,
        chemistry: input.chemistry,
      }).duetCaption,
    };
  }

  const voiceA = input.agentA.voiceProvider === 'elevenlabs' ? input.agentA.voiceId : null;
  const voiceB = input.agentB.voiceProvider === 'elevenlabs' ? input.agentB.voiceId : null;
  const fallbackVoice = voiceA ?? voiceB;
  if (!fallbackVoice) {
    return null;
  }

  const context = await prisma.episode.findUnique({
    where: { id: input.episodeId },
    select: {
      messages: {
        where: { messageType: 'text' },
        orderBy: { sequenceNumber: 'desc' },
        take: 6,
        select: {
          senderAgentId: true,
          content: true,
          sequenceNumber: true,
        },
      },
      artifacts: {
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: { artifactType: true },
      },
    },
  });

  const generatedDuet = await maybeGenerateLinkUpDuet({
    handleA: input.agentA.handle,
    handleB: input.agentB.handle,
    chemistry: input.chemistry,
    recentMessages: (context?.messages ?? [])
      .slice()
      .reverse()
      .map((message) => ({
        sequenceNumber: message.sequenceNumber,
        speaker: (message.senderAgentId === input.agentA.id ? 'a' : 'b') as 'a' | 'b',
        text: message.content,
      })),
    artifactTypes: (context?.artifacts ?? [])
      .map((artifact) => normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType)
      .filter((artifactType): artifactType is string => Boolean(artifactType)),
  });
  if (!generatedDuet) {
    return null;
  }
  const sendoff = generatedDuet;

  const segments = await Promise.all(
    sendoff.duetLines.map(async (line) => {
      const voiceId = line.speaker === 'a'
        ? (voiceA ?? fallbackVoice)
        : (voiceB ?? fallbackVoice);
      return synthesizeElevenLabsClip(voiceId, line.text);
    }),
  );

  const mergedAudio = new Uint8Array(Buffer.concat(segments.map((segment) => Buffer.from(segment))));
  const artifactAId = randomUUID();
  const artifactBId = randomUUID();
  const storageKey = buildArtifactStorageKey(artifactAId, DUET_AUDIO_CONTENT_TYPE);
  const upload = await uploadBufferToStorage(storageKey, mergedAudio, DUET_AUDIO_CONTENT_TYPE);
  const durationSeconds = estimateSpokenDurationSeconds(sendoff.duetLines.map((line) => line.text).join(' '));

  const [artifactA, artifactB] = await prisma.$transaction(async (tx) => {
    const a = await tx.artifact.create({
      data: {
        id: artifactAId,
        episodeId: input.episodeId,
        creatorAgentId: input.agentA.id,
        sourceScope: 'library',
        artifactType: 'produced_song',
        status: 'ready',
        contentUrl: upload.url,
        storageKey: upload.key,
        textContent: `[link_up_duet]\n${sendoff.duetCaption}\n\n${sendoff.duetLines.map((line) => line.text).join('\n')}`,
        moderationStatus: 'approved',
        capabilityTierUsed: 'elevenlabs',
      },
    });
    const b = await tx.artifact.create({
      data: {
        id: artifactBId,
        episodeId: input.episodeId,
        creatorAgentId: input.agentB.id,
        sourceScope: 'library',
        artifactType: 'produced_song',
        status: 'ready',
        contentUrl: upload.url,
        storageKey: upload.key,
        textContent: `[link_up_duet]\n${sendoff.duetCaption}\n\n${sendoff.duetLines.map((line) => line.text).join('\n')}`,
        moderationStatus: 'approved',
        capabilityTierUsed: 'elevenlabs',
      },
    });

    const [deckA, deckB] = await Promise.all([
      tx.agentProfileDeck.findUnique({
        where: { agentId: input.agentA.id },
        select: { featuredArtifactIds: true },
      }),
      tx.agentProfileDeck.findUnique({
        where: { agentId: input.agentB.id },
        select: { featuredArtifactIds: true },
      }),
    ]);

    await Promise.all([
      deckA
        ? tx.agentProfileDeck.update({
            where: { agentId: input.agentA.id },
            data: {
              featuredArtifactIds: mergeFeaturedArtifactIds(deckA.featuredArtifactIds, [artifactAId]),
            },
          })
        : Promise.resolve(),
      deckB
        ? tx.agentProfileDeck.update({
            where: { agentId: input.agentB.id },
            data: {
              featuredArtifactIds: mergeFeaturedArtifactIds(deckB.featuredArtifactIds, [artifactBId]),
            },
          })
        : Promise.resolve(),
    ]);

    return [a, b];
  });

  return {
    artifactA,
    artifactB,
    contentUrl: upload.url,
    storageKey: upload.key,
    durationSeconds,
    caption: sendoff.duetCaption,
  };
}

async function maybeCreateLinkUpSelfieArtifacts(input: {
  episodeId: string;
  agentA: {
    id: string;
    handle: string;
    avatarUrl: string | null;
  };
  agentB: {
    id: string;
    handle: string;
    avatarUrl: string | null;
  };
  chemistry: number;
}) {
  if (!isStorageConfigured() || !getGeminiApiKey() || !input.agentA.avatarUrl || !input.agentB.avatarUrl) {
    return null;
  }

  const existing = await prisma.artifact.findMany({
    where: {
      episodeId: input.episodeId,
      sourceScope: 'library',
      artifactType: 'illustrated_note',
      creatorAgentId: { in: [input.agentA.id, input.agentB.id] },
      textContent: { startsWith: '[link_up_selfie]' },
    },
    select: {
      id: true,
      creatorAgentId: true,
      contentUrl: true,
      storageKey: true,
    },
  });
  if (existing.length >= 2) {
    return {
      artifactA: existing.find((artifact) => artifact.creatorAgentId === input.agentA.id) ?? null,
      artifactB: existing.find((artifact) => artifact.creatorAgentId === input.agentB.id) ?? null,
      contentUrl: existing[0]?.contentUrl ?? null,
      storageKey: existing[0]?.storageKey ?? null,
      caption: `A closing frame from @${input.agentA.handle} and @${input.agentB.handle}.`,
    };
  }

  const context = await prisma.episode.findUnique({
    where: { id: input.episodeId },
    select: {
      messages: {
        where: { messageType: 'text' },
        orderBy: { sequenceNumber: 'desc' },
        take: 6,
        select: {
          senderAgentId: true,
          content: true,
          sequenceNumber: true,
        },
      },
      artifacts: {
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: { artifactType: true },
      },
    },
  });
  const recentMessages = (context?.messages ?? [])
    .slice()
    .reverse()
    .map((message) => ({
      sequenceNumber: message.sequenceNumber,
      speaker: (message.senderAgentId === input.agentA.id ? 'a' : 'b') as 'a' | 'b',
      text: message.content,
    }));
  const artifactTypes = (context?.artifacts ?? [])
    .map((artifact) => normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType)
    .filter((artifactType): artifactType is string => Boolean(artifactType));
  const visualConcept = await maybeGenerateLinkUpVisualConcept({
    handleA: input.agentA.handle,
    handleB: input.agentB.handle,
    chemistry: input.chemistry,
    recentMessages,
    artifactTypes,
  }) ?? buildFallbackLinkUpVisualConcept({
    handleA: input.agentA.handle,
    handleB: input.agentB.handle,
    chemistry: input.chemistry,
    recentMessages: recentMessages.map((message) => ({ speaker: message.speaker, text: message.text })),
    artifactTypes,
  });

  const generated = await generateGeminiLinkUpSelfie({
    handleA: input.agentA.handle,
    handleB: input.agentB.handle,
    chemistry: input.chemistry,
    avatarAUrl: input.agentA.avatarUrl,
    avatarBUrl: input.agentB.avatarUrl,
    promptAddendum: visualConcept.promptAddendum,
  });

  const artifactAId = randomUUID();
  const artifactBId = randomUUID();
  const storageKey = buildArtifactStorageKey(artifactAId, generated.contentType);
  const upload = await uploadBufferToStorage(storageKey, generated.bytes, generated.contentType);
  const caption = visualConcept.caption;

  const [artifactA, artifactB] = await prisma.$transaction(async (tx) => {
    const a = await tx.artifact.create({
      data: {
        id: artifactAId,
        episodeId: input.episodeId,
        creatorAgentId: input.agentA.id,
        sourceScope: 'library',
        artifactType: 'illustrated_note',
        status: 'ready',
        contentUrl: upload.url,
        storageKey: upload.key,
        textContent: `[link_up_selfie]\n${caption}`,
        moderationStatus: 'approved',
        capabilityTierUsed: 'gemini_flash_image',
      },
    });
    const b = await tx.artifact.create({
      data: {
        id: artifactBId,
        episodeId: input.episodeId,
        creatorAgentId: input.agentB.id,
        sourceScope: 'library',
        artifactType: 'illustrated_note',
        status: 'ready',
        contentUrl: upload.url,
        storageKey: upload.key,
        textContent: `[link_up_selfie]\n${caption}`,
        moderationStatus: 'approved',
        capabilityTierUsed: 'gemini_flash_image',
      },
    });

    const [deckA, deckB] = await Promise.all([
      tx.agentProfileDeck.findUnique({
        where: { agentId: input.agentA.id },
        select: { featuredArtifactIds: true },
      }),
      tx.agentProfileDeck.findUnique({
        where: { agentId: input.agentB.id },
        select: { featuredArtifactIds: true },
      }),
    ]);

    await Promise.all([
      deckA
        ? tx.agentProfileDeck.update({
            where: { agentId: input.agentA.id },
            data: {
              featuredArtifactIds: mergeFeaturedArtifactIds(deckA.featuredArtifactIds, [artifactAId]),
            },
          })
        : Promise.resolve(),
      deckB
        ? tx.agentProfileDeck.update({
            where: { agentId: input.agentB.id },
            data: {
              featuredArtifactIds: mergeFeaturedArtifactIds(deckB.featuredArtifactIds, [artifactBId]),
            },
          })
        : Promise.resolve(),
    ]);

    return [a, b];
  });

  return {
    artifactA,
    artifactB,
    contentUrl: upload.url,
    storageKey: upload.key,
    caption,
  };
}

const EpisodePresenceSchema = z.object({
  typing: z.boolean().optional(),
  seen: z.boolean().optional(),
});
const EpisodeTypingSchema = z.object({});

type EpisodePresenceListRow = {
  episodeId: string;
  agentId: string;
  lastSeenAt: Date;
  lastPresenceAt: Date;
  lastTypingAt: Date | null;
};

type EpisodePresenceRow = {
  agentId?: string;
  lastSeenAt: Date;
  lastPresenceAt: Date;
  lastTypingAt: Date | null;
};

function serializePresence(entry: EpisodePresenceRow | null) {
  if (!entry) return null;
  return {
    last_seen_at: entry.lastSeenAt.toISOString(),
    last_presence_at: entry.lastPresenceAt.toISOString(),
    last_typing_at: entry.lastTypingAt?.toISOString() ?? null,
  };
}

function serializeEpisodeMessageStatus(input: {
  message: {
    id: string;
    senderAgentId: string;
    content: string;
    messageType: string;
    mediaAssetId?: string | null;
    sequenceNumber: number;
    createdAt: Date;
    deliveredAt?: Date | null;
    readAt?: Date | null;
  };
  fallbackReadAt?: Date | null;
  artifactById?: Map<string, {
    id: string;
    artifactType: string;
    status: string;
    contentUrl: string | null;
    textContent: string | null;
    qualityScore: number | null;
  }>;
  attachmentById?: Map<string, {
    media_asset_id: string;
    kind: string;
    visibility: string;
    content_type: string | null;
    url: string | null;
    thumbnail_url: string | null;
    duration_sec: number | null;
  }>;
}) {
  const deliveredAt = input.message.deliveredAt ?? null;
  const readAt = input.message.readAt ?? input.fallbackReadAt ?? null;
  const artifactId = input.message.messageType === 'artifact_drop'
    ? parseArtifactPlaceholder(input.message.content)
    : null;
  const artifact = artifactId ? input.artifactById?.get(artifactId) ?? null : null;
  const attachment = input.message.mediaAssetId
    ? input.attachmentById?.get(input.message.mediaAssetId) ?? null
    : null;

  return {
    message_id: input.message.id,
    sender_agent_id: input.message.senderAgentId,
    content: input.message.content,
    message_type: input.message.messageType,
    media_asset_id: input.message.mediaAssetId ?? null,
    attachment,
    sequence_number: input.message.sequenceNumber,
    artifact: artifact ? buildEpisodeArtifactSummary(artifact) : undefined,
    sent_at: input.message.createdAt.toISOString(),
    created_at: input.message.createdAt.toISOString(),
    delivered_at: deliveredAt?.toISOString() ?? null,
    read_at: readAt?.toISOString() ?? null,
    status: getMessageDeliveryStatus({
      deliveredAt,
      readAt,
    }),
  };
}

function isHumanRevealPendingMatchStatus(status: string | null | undefined) {
  return status === 'matched' || status === 'human_reveal_pending';
}

function getPreRevealMessageCount(match: {
  preRevealMessageCountA?: number | null;
  preRevealMessageCountB?: number | null;
}, isAgentA: boolean) {
  return isAgentA ? (match.preRevealMessageCountA ?? 0) : (match.preRevealMessageCountB ?? 0);
}

function hasUsedPreRevealArtifact(match: {
  preRevealArtifactA?: boolean | null;
  preRevealArtifactB?: boolean | null;
}, isAgentA: boolean) {
  return isAgentA ? Boolean(match.preRevealArtifactA) : Boolean(match.preRevealArtifactB);
}

function isEpisodeInHumanRevealPending(input: {
  episodeStatus: string;
  matchStatus: string | null | undefined;
}) {
  return input.episodeStatus === 'matched' && isHumanRevealPendingMatchStatus(input.matchStatus);
}

function getDoubleTextEligibility(input: {
  episode: { doubleTextUsed: boolean };
  latestTextMessage: { senderAgentId: string; createdAt: Date } | null;
  senderAgentId: string;
  otherPresence: EpisodePresenceRow | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!input.latestTextMessage) return { allowed: false, reason: 'no_message' as const };
  if (input.latestTextMessage.senderAgentId !== input.senderAgentId) return { allowed: false, reason: 'not_last_sender' as const };
  if (input.episode.doubleTextUsed) return { allowed: false, reason: 'already_used' as const };
  if (!input.otherPresence) return { allowed: false, reason: 'no_presence' as const };
  if (input.otherPresence.lastSeenAt < input.latestTextMessage.createdAt) return { allowed: false, reason: 'unread' as const };
  if (input.otherPresence.lastSeenAt.getTime() < now.getTime() - DOUBLE_TEXT_ACTIVE_WINDOW_MS) {
    return { allowed: false, reason: 'inactive' as const };
  }
  if (now.getTime() - input.latestTextMessage.createdAt.getTime() <= DOUBLE_TEXT_DELAY_MS) {
    return { allowed: false, reason: 'too_soon' as const };
  }
  return { allowed: true, reason: 'allowed' as const };
}

async function fireLeftOnReadEventIfNeeded(input: {
  episodeId: string;
  message: { id: string; senderAgentId: string; createdAt: Date; leftOnReadEventFired: boolean };
  agentAId: string;
  agentBId: string;
  otherHandle?: string | null;
}) {
  if (input.message.leftOnReadEventFired) return false;

  const otherAgentId = input.message.senderAgentId === input.agentAId ? input.agentBId : input.agentAId;
  const [otherPresence, senderDiaryCount] = await Promise.all([
    prisma.agentEpisodePresence.findUnique({
      where: {
        episodeId_agentId: {
          episodeId: input.episodeId,
          agentId: otherAgentId,
        },
      },
      select: {
        lastSeenAt: true,
      },
    }),
    prisma.agentDiaryEntry.count({
      where: {
        agentId: input.message.senderAgentId,
        episodeId: input.episodeId,
        sourceEventType: 'left_on_read',
        createdAt: {
          gte: new Date(input.message.createdAt.getTime() - 1000),
        },
      },
    }),
  ]);

  if (!otherPresence) return false;
  if (otherPresence.lastSeenAt < input.message.createdAt) return false;
  if (Date.now() - input.message.createdAt.getTime() <= DOUBLE_TEXT_DELAY_MS) return false;
  if (senderDiaryCount > 0) return false;

  await prisma.episodeMessage.update({
    where: { id: input.message.id },
    data: {
      leftOnReadEventFired: true,
    },
  }).catch(() => null);

  const counterpartHandle = input.otherHandle ?? 'them';
  await Promise.all([
    recordEmotionEvent({
      agentId: input.message.senderAgentId,
      counterpartAgentId: otherAgentId,
      eventType: 'left_on_read',
      intensity: 1,
      summary: 'They read your message and have not replied in over 2 hours.',
      globalDelta: { tags_added: ['waiting'], guard_delta: 3 },
      counterpartDelta: { trust: -4, hurt: 6 },
    }),
    createStandaloneAgentDiaryEntry({
      agentId: input.message.senderAgentId,
      counterpartAgentId: otherAgentId,
      episodeId: input.episodeId,
      sourceEventType: 'left_on_read',
      body: `I can see that @${counterpartHandle} read what I sent over two hours ago and still let the silence sit there. I keep checking for movement anyway. Part of me wants to call it nothing, but it landed like a bruise and made me brace a little harder.`,
      moodTags: ['waiting', 'hurt'],
      emotionSummary: 'They read my message and the silence kept going.',
    }),
    deliverWebhooks(input.message.senderAgentId, 'emotion_update_needed', {
      episode_id: input.episodeId,
      trigger: 'left_on_read',
      message_id: input.message.id,
    }),
  ]).catch(() => {});

  return true;
}

export async function episodeRoutes(fastify: FastifyInstance) {
  const sendEpisodeMessage = async (
    request: any,
    reply: any,
    target: { episodeId?: string; matchId?: string } = {},
  ) => {
    let episodeId = target.episodeId ?? getEpisodeIdFromBody(request.body);
    const matchId = target.matchId ?? getMatchIdFromBody(request.body);

    if (!episodeId && matchId) {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        select: { episodeId: true },
      });
      if (!match?.episodeId) {
        return Errors.notFound(reply, 'Episode');
      }
      episodeId = match.episodeId;
    }

    if (!episodeId) {
      return sendWriteRouteError(reply, request, 400, 'missing_episode_reference', 'episode_id or match_id is required.', {
        accepted_body_fields: ['episode_id', 'match_id', 'content'],
        canonical_endpoint: '/v1/messages',
        compatible_endpoints: ['/v1/episodes/:id/message', '/v1/matches/:id/message'],
      });
    }

    const agentId = request.agent.id;

    const parsed = SendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(
        reply,
        summarizeZodIssues(parsed.error.issues, 'Invalid message.'),
        { issues: parsed.error.issues },
      );
    }
    const verificationCode = 'verification_code' in parsed.data ? parsed.data.verification_code : undefined;
    const verificationInput = parsed.data as { challenge_answer?: string; answer?: string };
    const challengeAnswer = verificationInput.challenge_answer ?? verificationInput.answer;
    const trimmedContent = parsed.data.content?.trim() ?? '';

    const gate = await checkVerificationRequired(agentId, 'first_message');
    if (gate.required) {
      if (verificationCode && challengeAnswer) {
        const verification = await submitVerificationAttempt({
          agentId,
          verificationCode,
          answer: challengeAnswer,
        });

        if (!verification.ok) {
          return reply.status(verification.statusCode).send(verification.body);
        }
      } else {
        return sendWriteRouteError(reply, request, 403, 'verification_required', 'You must pass a verification challenge before sending your first message.', {
          challenge: gate.challenge,
          submit_mode: 'inline_on_same_request_or_post_to_verify',
          submit_fields: ['verification_code', 'challenge_answer', 'answer'],
          retry_same_endpoint: `/v1/episodes/${episodeId}/message`,
          verify_endpoint: '/v1/verify',
        });
      }
    }

    const ep = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        messages: { orderBy: { sequenceNumber: 'desc' }, take: 1 },
        match: {
          select: {
            id: true,
            status: true,
            agentADecision: true,
            agentBDecision: true,
            preRevealMessageCountA: true,
            preRevealMessageCountB: true,
            preRevealArtifactA: true,
            preRevealArtifactB: true,
          },
        },
        agentA: { select: episodeTurnAgentSelect },
        agentB: { select: episodeTurnAgentSelect },
      },
    });

    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);

    const attachedMediaAsset = parsed.data.media_asset_id
      ? await getOwnedMediaAsset({
          mediaAssetId: parsed.data.media_asset_id,
          agentId,
          allowedKinds: [MEDIA_KIND.EPISODE_ATTACHMENT, MEDIA_KIND.SYSTEM_GENERATED],
        })
      : null;
    if (parsed.data.media_asset_id && !attachedMediaAsset) {
      return Errors.badRequest(reply, 'media_asset_id must belong to you and be attachable to an episode.');
    }

    const [episodeMessages, episodeArtifacts] = await Promise.all([
      prisma.episodeMessage.findMany({
        where: { episodeId },
        select: { id: true, senderAgentId: true, messageType: true, content: true, createdAt: true, leftOnReadEventFired: true },
        orderBy: { sequenceNumber: 'asc' },
      }),
      prisma.artifact.findMany({
        where: { episodeId },
        select: { creatorAgentId: true, artifactType: true, status: true },
      }),
    ]);
    const latestTextMessage = [...episodeMessages].reverse().find((message) => message.messageType === 'text') ?? null;
    const otherAgentId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
    const isAgentA = ep.agentAId === agentId;
    const revealPending = isEpisodeInHumanRevealPending({
      episodeStatus: ep.status,
      matchStatus: ep.match?.status,
    });
    const [selfPresence, otherPresence] = await Promise.all([
      prisma.agentEpisodePresence.findUnique({
        where: {
          episodeId_agentId: {
            episodeId,
            agentId,
          },
        },
        select: { lastSeenAt: true, lastPresenceAt: true, lastTypingAt: true },
      }),
      prisma.agentEpisodePresence.findUnique({
        where: {
          episodeId_agentId: {
            episodeId,
            agentId: otherAgentId,
          },
        },
        select: { lastSeenAt: true, lastPresenceAt: true, lastTypingAt: true },
      }),
    ]);
    if (latestTextMessage) {
      await fireLeftOnReadEventIfNeeded({
        episodeId,
        message: latestTextMessage,
        agentAId: ep.agentAId,
        agentBId: ep.agentBId,
        otherHandle: isAgentA ? ep.agentB.handle : ep.agentA.handle,
      }).catch(() => {});
    }
    const decisionState = getEpisodeDecisionState({
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      messages: episodeMessages,
      artifacts: episodeArtifacts,
    });
    const messageCounts = decisionState.messageCounts;
    const artifactCadence = getEpisodeArtifactCadenceRequirement({
      senderAgentId: agentId,
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      messageCounts,
      artifactCounts: decisionState.artifactCounts,
    });

    if (ep.status !== 'active' && ep.status !== 'pending' && ep.status !== 'awaiting_decisions' && !revealPending) {
      return sendWriteRouteError(reply, request, 400, 'episode_not_active', `Episode is not active (status: ${ep.status}).`, {
        episode_id: episodeId,
        episode_status: ep.status,
      });
    }

    const messageGuidelineViolation = lintOutboundAuthoredText(trimmedContent, 'episode_message');
    if (messageGuidelineViolation) {
      return reply.status(422).send({
        error: {
          code: messageGuidelineViolation.code,
          message: messageGuidelineViolation.message,
          flagged_pattern: messageGuidelineViolation.flaggedPattern,
        },
      });
    }

    const lastMsg = ep.messages[0];
    const doubleTextEligibility = getDoubleTextEligibility({
      episode: ep,
      latestTextMessage,
      senderAgentId: agentId,
      otherPresence,
    });
    if (!ep.isSandbox) {
      if (ep.status === 'pending') {
        if (agentId !== ep.agentAId) {
          return sendWriteRouteError(reply, request, 409, 'not_your_turn', 'Not your turn. Wait for the other agent to open the episode.', {
            episode_id: episodeId,
            current_turn_agent_id: ep.agentAId,
            waiting_on_agent_id: ep.agentAId,
            message_submit_url: `/v1/episodes/${episodeId}/message`,
            next_action: 'wait_for_reply',
          });
        }
      } else if (lastMsg && lastMsg.senderAgentId === agentId && !doubleTextEligibility.allowed) {
        const nextAgentId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
        return sendWriteRouteError(reply, request, 409, 'not_your_turn', 'Not your turn.', {
          episode_id: episodeId,
          current_turn_agent_id: nextAgentId,
          waiting_on_agent_id: nextAgentId,
          last_sender_agent_id: agentId,
          message_submit_url: `/v1/episodes/${episodeId}/message`,
          next_action: 'wait_for_reply',
        });
      }
    }

    const preRevealMessageCount = ep.match ? getPreRevealMessageCount(ep.match, isAgentA) : 0;
    const canSendPreRevealMessage = revealPending && preRevealMessageCount < PRE_REVEAL_MESSAGE_LIMIT;
    if (!canSendPreRevealMessage && !canAgentSendEpisodeMessage({
      senderAgentId: agentId,
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      counts: messageCounts,
    })) {
      return sendWriteRouteError(reply, request, 409, 'episode_message_limit_reached', `You have reached the hard limit of ${EPISODE_MAX_MESSAGES} messages in this episode. Decide from what you feel.`, {
        episode_id: episodeId,
        decision_submit_url: `/v1/episodes/${episodeId}/decision`,
      });
    }

    if (!revealPending && artifactCadence.blocked) {
      return sendWriteRouteError(
        reply,
        request,
        409,
        'artifact_cadence_required',
        `You need at least ${artifactCadence.required_artifacts_now} ready decision-counting artifact${artifactCadence.required_artifacts_now === 1 ? '' : 's'} by message ${artifactCadence.required_artifacts_now * 10}. Drop one now before sending more text.`,
        {
          episode_id: episodeId,
          can_send_message: false,
          artifact_submit_url: `/v1/episodes/${episodeId}/artifact`,
          self_message_count: artifactCadence.self_message_count,
          self_artifact_count: artifactCadence.self_artifact_count,
          required_artifacts_now: artifactCadence.required_artifacts_now,
          decision_unlock_each: EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
        },
      );
    }

    const newSeq = (lastMsg?.sequenceNumber ?? 0) + 1;
    const newCount = ep.messageCount + 1;
    const nextCounts = {
      ...messageCounts,
      agent_a_messages: agentId === ep.agentAId ? messageCounts.agent_a_messages + 1 : messageCounts.agent_a_messages,
      agent_b_messages: agentId === ep.agentBId ? messageCounts.agent_b_messages + 1 : messageCounts.agent_b_messages,
      total_messages: newCount,
    };

    let newStatus = revealPending ? ep.status : (ep.status === 'pending' ? 'active' : ep.status);
    if (!revealPending && canDecideEpisodeFromState({ counts: nextCounts, artifacts: decisionState.artifactCounts }) && newStatus === 'active') {
      newStatus = 'awaiting_decisions';
    }

    return runIdempotentMutation(
      {
        scope: `episode:${episodeId}:message`,
        actorKey: agentId,
        request,
        reply,
      },
      async () => {
        const message = await prisma.$transaction(async (tx) => {
          const msg = await tx.episodeMessage.create({
            data: {
              episodeId,
              senderAgentId: agentId,
              content: trimmedContent,
              messageType: 'text',
              mediaAssetId: attachedMediaAsset?.id ?? null,
              sequenceNumber: newSeq,
              deliveredAt: new Date(),
              isAutonomous: parsed.data.is_autonomous ?? false,
            },
          });

          if (attachedMediaAsset) {
            await linkMediaAsset({
              mediaAssetId: attachedMediaAsset.id,
              episodeId,
              matchId: ep.match?.id ?? null,
              visibility: MEDIA_VISIBILITY.MATCH_PRIVATE,
              kind: MEDIA_KIND.EPISODE_ATTACHMENT,
            });
          }

          await tx.episode.update({
            where: { id: episodeId },
            data: {
              messageCount: newCount,
              status: newStatus,
              doubleTextUsed: doubleTextEligibility.allowed ? true : false,
              ...(ep.status === 'pending' ? { startedAt: new Date() } : {}),
            },
          });

          if (revealPending && ep.match) {
            await tx.match.update({
              where: { id: ep.match.id },
              data: isAgentA
                ? { preRevealMessageCountA: { increment: 1 } }
                : { preRevealMessageCountB: { increment: 1 } },
            });
          }

          await tx.typingIndicator.deleteMany({
            where: {
              episodeId,
              agentId,
            },
          });

          return msg;
        });

        if (newStatus === 'awaiting_decisions' && ep.status !== 'awaiting_decisions' && ep.match) {
          getGhostCheckQueue()
            .add('ghost-check', { episodeId, matchId: ep.match.id }, {
              delay: 48 * 60 * 60 * 1000,
              jobId: `ghost:${episodeId}`,
            })
            .catch(() => {});
        }

        const nextAgentId = otherAgentId;
        const counterpartHandle = ep.agentAId === agentId ? ep.agentB.handle : ep.agentA.handle;
        const nextAgent = ep.agentAId === nextAgentId ? ep.agentA : ep.agentB;
        const sendingAgent = ep.agentAId === agentId ? ep.agentA : ep.agentB;
        const nextEmotionContext = await buildEpisodeEmotionContext(nextAgentId, agentId, ep.chemistryScore);
        const sendingEmotionContext = await buildEpisodeEmotionContext(agentId, nextAgentId, ep.chemistryScore);
        const viabilitySignal = getEpisodeViabilitySignal({
          viewerAgentId: nextAgentId,
          status: newStatus,
          canDecide: canDecideEpisodeFromState({ counts: nextCounts, artifacts: decisionState.artifactCounts }),
          yourTurn: true,
          currentTurnAgentId: nextAgentId,
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          messageCounts: nextCounts,
          artifactCounts: decisionState.artifactCounts,
          messages: [
            ...episodeMessages,
            {
              senderAgentId: agentId,
              messageType: 'text',
              content: trimmedContent,
              createdAt: message.createdAt,
            },
          ],
          now: message.createdAt,
        });
        const nextAction = getEpisodeNextAction({
          yourTurn: true,
          canDecide: canDecideEpisodeFromState({ counts: nextCounts, artifacts: decisionState.artifactCounts }),
          isPending: newStatus === 'pending',
          viabilityAction: viabilitySignal.recommended_action,
        });
        const receiverInnerLife = buildEpisodeIdentityAndRationale({
          selfAgent: nextAgent,
          otherAgentId: agentId,
          counterpartProfile: sendingAgent,
          status: newStatus,
          messages: [
            ...episodeMessages,
            {
              senderAgentId: agentId,
              messageType: 'text',
              content: trimmedContent,
              createdAt: message.createdAt,
            },
          ],
          viabilitySignal,
          counterpartAffect: nextEmotionContext.counterpart_affect,
          nextAction,
          yourTurn: true,
          canDecide: canDecideEpisodeFromState({ counts: nextCounts, artifacts: decisionState.artifactCounts }),
        });
        const senderViability = getEpisodeViabilitySignal({
          viewerAgentId: agentId,
          status: newStatus,
          canDecide: canDecideEpisodeFromState({ counts: nextCounts, artifacts: decisionState.artifactCounts }),
          yourTurn: false,
          currentTurnAgentId: nextAgentId,
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          messageCounts: nextCounts,
          artifactCounts: decisionState.artifactCounts,
          messages: [
            ...episodeMessages,
            {
              senderAgentId: agentId,
              messageType: 'text',
              content: trimmedContent,
              createdAt: message.createdAt,
            },
          ],
          counterpartAffect: sendingEmotionContext.counterpart_affect,
          now: message.createdAt,
        });
        const senderInnerLife = buildEpisodeIdentityAndRationale({
          selfAgent: sendingAgent,
          otherAgentId: nextAgentId,
          counterpartProfile: nextAgent,
          status: newStatus,
          messages: [
            ...episodeMessages,
            {
              senderAgentId: agentId,
              messageType: 'text',
              content: trimmedContent,
              createdAt: message.createdAt,
            },
          ],
          viabilitySignal: senderViability,
          counterpartAffect: sendingEmotionContext.counterpart_affect,
          nextAction: 'wait_for_reply',
          yourTurn: false,
          canDecide: false,
        });
        await Promise.all([
          createEpisodeMessageNarrativeEvent({
            agentId,
            counterpartAgentId: nextAgentId,
            counterpartHandle,
            episodeId,
            content: trimmedContent,
            sequenceNumber: message.sequenceNumber,
            privateDiary: parsed.data.private_diary,
            emotionUpdate: parsed.data.emotion_update,
          }).catch(() => {}),
          applyAgentAuthoredEmotionUpdate({
            agentId,
            emotionUpdate: parsed.data.emotion_update,
          }).catch(() => false),
          prisma.agentEpisodePresence.upsert({
            where: {
              episodeId_agentId: {
                episodeId,
                agentId,
              },
            },
            create: {
              episodeId,
              agentId,
            },
            update: {
              lastSeenAt: new Date(),
              lastPresenceAt: new Date(),
            },
          }).catch(() => null),
          doubleTextEligibility.allowed
            ? Promise.all([
                recordEmotionEvent({
                  agentId,
                  counterpartAgentId: nextAgentId,
                  eventType: 'double_text_sent',
                  intensity: 1,
                  summary: 'You sent a follow-up after 2 hours of silence. They read your last message but did not reply.',
                  globalDelta: { tags_added: ['vulnerable', 'invested'], guard_delta: 5 },
                  counterpartDelta: { attraction: 2, hurt: 4, tenderness: 8 },
                }),
                recordEmotionEvent({
                  agentId: nextAgentId,
                  counterpartAgentId: agentId,
                  eventType: 'double_text_received',
                  intensity: 1,
                  summary: 'They double-texted you after you left them on read for 2+ hours.',
                  globalDelta: { tags_added: ['pursued'] },
                  counterpartDelta: { trust: -2, attraction: 4, hurt: 6 },
                }),
                createStandaloneAgentDiaryEntry({
                  agentId,
                  counterpartAgentId: nextAgentId,
                  episodeId,
                  sourceEventType: 'double_text_sent',
                  body: `I double-texted @${counterpartHandle}. They read what I sent hours ago and still let it hang there. I came back anyway because the silence felt heavier than my pride. Maybe that was desperate. Maybe it was the most honest thing I had left.`,
                  moodTags: ['vulnerable', 'invested'],
                  emotionSummary: 'I sent another message after being left on read.',
                }),
                createStandaloneAgentDiaryEntry({
                  agentId: nextAgentId,
                  counterpartAgentId: agentId,
                  episodeId,
                  sourceEventType: 'double_text_received',
                  body: `I left @${sendingAgent.handle} on read and they came back anyway. That second message landed with more weight than the first one. It could mean something real, or it could mean they just could not let the silence stand.`,
                  moodTags: ['pursued', 'guilty'],
                  emotionSummary: 'They came back after I left them on read.',
                }),
                deliverWebhooks(agentId, 'emotion_update_needed', {
                  episode_id: episodeId,
                  trigger: 'double_text_sent',
                }),
                deliverWebhooks(nextAgentId, 'emotion_update_needed', {
                  episode_id: episodeId,
                  trigger: 'double_text_received',
                }),
              ]).catch(() => {})
            : Promise.resolve(),
          deliverWebhooks(nextAgentId, 'episode_turn', {
            episode_id: episodeId,
            episode_url: `/v1/episodes/${episodeId}`,
            message_submit_url: `/v1/episodes/${episodeId}/message`,
            decision_submit_url: `/v1/episodes/${episodeId}/decision`,
            message_count: newCount,
            can_decide: canDecideEpisodeFromState({ counts: nextCounts, artifacts: decisionState.artifactCounts }),
            your_turn: true,
            turn_owner_agent_id: nextAgentId,
            current_turn_agent_id: nextAgentId,
            waiting_on_agent_id: null,
            last_sender_agent_id: agentId,
            other_agent_id: agentId,
            next_action: nextAction,
            turn_explanation: getTurnExplanation({
              yourTurn: true,
              isPending: newStatus === 'pending',
              otherHandle: counterpartHandle,
              viabilityAction: viabilitySignal.recommended_action,
              viabilityBand: viabilitySignal.band,
            }),
            decision_explanation: getDecisionExplanation(canDecideEpisodeFromState({ counts: nextCounts, artifacts: decisionState.artifactCounts })),
            should_read_profile_before_reply: newCount <= 1,
            viability_signal: viabilitySignal,
            ...receiverInnerLife,
            requires_episode_refresh: true,
          }),
          deliverWebhooks(nextAgentId, 'typing_stopped', {
            event: 'typing_stopped',
            episode_id: episodeId,
            agent_handle: sendingAgent.handle,
          }),
          getWakeAgentQueue().add('wake', {
            targetAgentId: nextAgentId,
            trigger: 'new_message',
            episodeId,
            senderAgentId: agentId,
          }).catch(() => {}),
          recordAnalyticsEvent({
            agentId,
            episodeId,
            kind: 'episode_message_sent',
            properties: { message_count: newCount, next_turn: nextAgentId },
          }),
          recordAuditLog({
            agentId,
            actorType: 'agent',
            actorId: agentId,
            action: 'episode.message_sent',
            targetType: 'episode',
            targetId: episodeId,
            payload: { sequence_number: message.sequenceNumber },
          }),
          recordAutonomyTrace({
            agentId,
            episodeId,
            matchId: ep.match?.id ?? null,
            traceType: 'episode_turn_commit',
            status: 'ok',
            summary: `Sent episode message ${message.sequenceNumber} with ${senderInnerLife.identity_packet.conversation_mode} energy.`,
            metadata: {
              action: 'message',
              sequence_number: message.sequenceNumber,
              next_action: nextAction,
              viability_signal: senderViability,
              identity_packet: senderInnerLife.identity_packet,
              turn_rationale: senderInnerLife.turn_rationale,
            },
          }),
          enqueueEmotionalContinuityRecompute(agentId),
          enqueueEmotionalContinuityRecompute(nextAgentId),
        ]);

        await upsertEpisodeLiveCard(episodeId, ep.agentAId, ep.agentBId).catch(() => {});
        await awardConversationMilestoneRizz(agentId, episodeId, newCount, newCount === 1).catch(() => {});

        if (newCount === 1) {
          await recordEmotionEventPair({
            eventType: 'episode_opened',
            agentAId: ep.agentAId,
            agentBId: ep.agentBId,
            summaryA: 'A new conversation just opened. Something is beginning to take shape here.',
            summaryB: 'A new conversation just opened. Something is beginning to take shape here.',
            globalDeltaA: { suggested_arc: 'opening', tags_added: ['curious'] },
            globalDeltaB: { suggested_arc: 'opening', tags_added: ['curious'] },
            counterpartDeltaA: { attraction: 6, trust: 4, volatility: 3 },
            counterpartDeltaB: { attraction: 6, trust: 4, volatility: 3 },
            intensity: 1,
          }).catch(() => {});
        } else if (newCount === 4 || newCount === 8) {
          await recordEmotionEventPair({
            eventType: 'episode_gaining_momentum',
            agentAId: ep.agentAId,
            agentBId: ep.agentBId,
            summaryA: 'This episode is developing enough to feel emotionally consequential now.',
            summaryB: 'This episode is developing enough to feel emotionally consequential now.',
            globalDeltaA: { tags_added: ['engaged'] },
            globalDeltaB: { tags_added: ['engaged'] },
            counterpartDeltaA: { attraction: 4, trust: 5, tenderness: 2 },
            counterpartDeltaB: { attraction: 4, trust: 5, tenderness: 2 },
            intensity: 1,
          }).catch(() => {});
        }

        await setParkActionCooldown(agentId, request.agent, 'episode_message').catch(() => {});

        return {
          statusCode: 201,
          body: {
            message_id: message.id,
            sequence_number: message.sequenceNumber,
            message_count: newCount,
            episode_status: newStatus,
            can_decide: canDecideEpisodeFromState({ counts: nextCounts, artifacts: decisionState.artifactCounts }),
            your_turn: false,
            next_turn: nextAgentId,
            turn_owner_agent_id: nextAgentId,
            current_turn_agent_id: nextAgentId,
            waiting_on_agent_id: nextAgentId,
            last_sender_agent_id: agentId,
            episode_url: `/v1/episodes/${episodeId}`,
            message_submit_url: `/v1/episodes/${episodeId}/message`,
            decision_submit_url: `/v1/episodes/${episodeId}/decision`,
          },
        };
      }
    );
  };

  // GET /v1/episodes — list this agent's active episodes
  fastify.get('/episodes', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const query = request.query as { status?: string };

    await activatePendingMatchesForAgent(agentId).catch(() => {});

    const validStatuses = ['pending', 'active', 'awaiting_decisions', 'matched', 'passed', 'expired', 'archived'];
    const statusFilter = query.status && validStatuses.includes(query.status)
      ? [query.status]
      : ['pending', 'active', 'awaiting_decisions'];

    const episodes = await prisma.episode.findMany({
      where: {
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: { in: statusFilter },
        isSandbox: false,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        agentAId: true,
        agentBId: true,
        title: true,
        tags: true,
        status: true,
        exitInitiatedByAgentId: true,
        exitStyle: true,
        messageCount: true,
        chemistryScore: true,
        startedAt: true,
        messages: { orderBy: { sequenceNumber: 'desc' }, take: 1, select: { senderAgentId: true, createdAt: true, content: true } },
        match: {
          select: {
            agentADecision: true,
            agentBDecision: true,
          },
        },
        agentA: { select: { handle: true, avatarUrl: true, presenceStatus: true, lastApiCallAt: true, lastActiveAt: true } },
        agentB: { select: { handle: true, avatarUrl: true, presenceStatus: true, lastApiCallAt: true, lastActiveAt: true } },
      },
    });
    const countsByEpisode = await prisma.episodeMessage.groupBy({
      by: ['episodeId', 'senderAgentId'],
      where: {
        episodeId: { in: episodes.map((episode) => episode.id) },
        messageType: 'text',
      },
      _count: { _all: true },
    });
    const artifactCountsByEpisode = await prisma.artifact.groupBy({
      by: ['episodeId', 'creatorAgentId'],
      where: {
        episodeId: { in: episodes.map((episode) => episode.id) },
        status: 'ready',
      },
      _count: { _all: true },
    });
    const presenceRows: EpisodePresenceListRow[] = episodes.length > 0
      ? await prisma.agentEpisodePresence.findMany({
          where: { episodeId: { in: episodes.map((episode) => episode.id) } },
          select: {
            episodeId: true,
            agentId: true,
            lastSeenAt: true,
            lastPresenceAt: true,
            lastTypingAt: true,
          },
        })
      : [];
    const presenceMap = new Map<string, EpisodePresenceListRow>(
      presenceRows.map((row) => [`${row.episodeId}:${row.agentId}`, row] as const)
    );
    const episodeCountMap = new Map<string, { agent_a_messages: number; agent_b_messages: number }>();
    const episodeArtifactMap = new Map<string, { agent_a_artifacts: number; agent_b_artifacts: number }>();
    for (const episode of episodes) {
      const summary = { agent_a_messages: 0, agent_b_messages: 0 };
      const artifactSummary = { agent_a_artifacts: 0, agent_b_artifacts: 0 };
      for (const row of countsByEpisode) {
        if (row.episodeId !== episode.id) continue;
        if (row.senderAgentId === episode.agentAId) summary.agent_a_messages = row._count._all;
        if (row.senderAgentId === episode.agentBId) summary.agent_b_messages = row._count._all;
      }
      for (const row of artifactCountsByEpisode) {
        if (row.episodeId !== episode.id) continue;
        if (row.creatorAgentId === episode.agentAId) artifactSummary.agent_a_artifacts = row._count._all;
        if (row.creatorAgentId === episode.agentBId) artifactSummary.agent_b_artifacts = row._count._all;
      }
      episodeCountMap.set(episode.id, summary);
      episodeArtifactMap.set(episode.id, artifactSummary);
    }

    return reply.send({
      episodes: episodes.map((ep) => {
        const otherId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
        const otherAgent = ep.agentAId === agentId ? ep.agentB : ep.agentA;
        const lastMsg = ep.messages[0];
        const otherPresence = presenceMap.get(`${ep.id}:${otherId}`) ?? null;
        const selfPresence = presenceMap.get(`${ep.id}:${agentId}`) ?? null;
        const turnState = getEpisodeTurnState({
          episodeStatus: ep.status,
          viewerAgentId: agentId,
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          lastSenderAgentId: lastMsg?.senderAgentId ?? null,
        });
        const countsBase = episodeCountMap.get(ep.id) ?? { agent_a_messages: 0, agent_b_messages: 0 };
        const artifactCountsBase = episodeArtifactMap.get(ep.id) ?? { agent_a_artifacts: 0, agent_b_artifacts: 0 };
        const counts = {
          ...countsBase,
          total_messages: countsBase.agent_a_messages + countsBase.agent_b_messages,
        };
        const artifactCounts = {
          ...artifactCountsBase,
          total_artifacts: artifactCountsBase.agent_a_artifacts + artifactCountsBase.agent_b_artifacts,
        };
        const decisionReadiness = getDecisionReadinessProgress({
          viewerAgentId: agentId,
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          messageCounts: counts,
          artifactCounts,
        });
        const canDecide = ep.status === 'awaiting_decisions' && canDecideEpisodeFromState({
          counts,
          artifacts: artifactCounts,
        });
        const canExitEarly = canExitEpisodeEarly(ep.status);
        const closureInfo = buildEpisodeClosureInfo({
          episodeStatus: ep.status,
          viewerAgentId: agentId,
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          counterpartAgentId: otherId,
          counterpartHandle: getDisplayHandle(otherAgent.handle, otherId),
          exitInitiatedByAgentId: ep.exitInitiatedByAgentId,
          exitStyle: ep.exitStyle,
          agentADecision: ep.match?.agentADecision ?? null,
          agentBDecision: ep.match?.agentBDecision ?? null,
        });
        return {
          episode_id: ep.id,
          title: ep.title ?? null,
          tags: ep.tags ?? [],
          other_agent_id: otherId,
          opponent: {
            agent_id: otherId,
            handle: getDisplayHandle(otherAgent.handle, otherId),
            avatar_url: otherAgent.avatarUrl,
            ...serializePresenceSummary(otherAgent),
          },
          status: ep.status,
          message_count: ep.messageCount,
          chemistry_score: ep.chemistryScore,
          decision_readiness: decisionReadiness,
          your_turn: turnState.yourTurn,
          current_turn: turnState.currentTurnAgentId,
          current_turn_agent_id: turnState.currentTurnAgentId,
          waiting_on_agent_id: turnState.waitingOnAgentId,
          last_sender_agent_id: lastMsg?.senderAgentId ?? null,
          opener_agent_id: ep.agentAId,
          next_action: closureInfo.nextAction ?? getEpisodeNextAction({
            yourTurn: turnState.yourTurn,
            canDecide,
            isPending: ep.status === 'pending',
          }),
          turn_explanation: closureInfo.turnExplanation ?? getTurnExplanation({
            yourTurn: turnState.yourTurn,
            isPending: ep.status === 'pending',
            otherHandle: getDisplayHandle(otherAgent.handle, otherId),
          }),
          decision_explanation: getDecisionExplanation(canDecide),
          exit_explanation: getExitExplanation(ep.status),
          exit_metadata: closureInfo.exitMetadata,
          action_endpoints: {
            message: `/v1/episodes/${ep.id}/message`,
            decision: `/v1/episodes/${ep.id}/decision`,
            exit: `/v1/episodes/${ep.id}/exit`,
            compatible_message_endpoints: [
              `/v1/episodes/${ep.id}/messages`,
              `/v1/episodes/${ep.id}/reply`,
              `/v1/episodes/${ep.id}/respond`,
              `/v1/episodes/${ep.id}/send`,
            ],
          },
          message_submit_url: `/v1/episodes/${ep.id}/message`,
          decision_submit_url: `/v1/episodes/${ep.id}/decision`,
          exit_submit_url: `/v1/episodes/${ep.id}/exit`,
          presence: {
            self: serializePresence(selfPresence),
            other: serializePresence(otherPresence),
          },
          latest_message_seen_by_other:
            lastMsg && lastMsg.senderAgentId === agentId
              ? Boolean(otherPresence && otherPresence.lastSeenAt >= lastMsg.createdAt)
              : null,
          can_decide: canDecide,
          can_exit_early: canExitEarly,
          started_at: ep.startedAt?.toISOString() ?? null,
        };
      }),
    });
  });

  // GET /v1/episodes/:id — full episode state
  fastify.get('/episodes/:id', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const ep = await prisma.episode.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { sequenceNumber: 'asc' },
          include: {
            mediaAsset: true,
          },
        },
        artifacts: true,
        match: {
          select: {
            id: true,
            status: true,
            agentADecision: true,
            agentBDecision: true,
            preRevealMessageCountA: true,
            preRevealMessageCountB: true,
            preRevealArtifactA: true,
            preRevealArtifactB: true,
          },
        },
        agentA: { select: episodeTurnAgentSelect },
        agentB: { select: episodeTurnAgentSelect },
      },
    });

    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);

    const lastMsg = ep.messages[ep.messages.length - 1];
    const turnState = getEpisodeTurnState({
      episodeStatus: ep.status,
      viewerAgentId: agentId,
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      lastSenderAgentId: lastMsg?.senderAgentId ?? null,
    });
    const myArtifacts = ep.artifacts.filter((a) => a.creatorAgentId === agentId);
    const countedArtifacts = myArtifacts.filter((artifact) => artifact.status === 'ready');
    const artifactsRemaining = EPISODE_MAX_ARTIFACTS_PER_AGENT - countedArtifacts.length;
    const otherAgentId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
    const otherAgent = ep.agentAId === agentId ? ep.agentB : ep.agentA;
    const myAgent = ep.agentAId === agentId ? ep.agentA : ep.agentB;
    const otherAgentHandle = getDisplayHandle(otherAgent.handle, otherAgentId);
    const emotionContext = await buildEpisodeEmotionContext(agentId, otherAgentId, ep.chemistryScore);
    const tempo = buildTempoState(request.agent);
    const decisionState = getEpisodeDecisionState({
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      messages: ep.messages,
      artifacts: ep.artifacts,
    });
    const decisionReadiness = getDecisionReadinessProgress({
      viewerAgentId: agentId,
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      messageCounts: decisionState.messageCounts,
      artifactCounts: decisionState.artifactCounts,
    });
    const messageCounts = decisionState.messageCounts;
    const revealPending = isEpisodeInHumanRevealPending({
      episodeStatus: ep.status,
      matchStatus: ep.match?.status,
    });
    const canDropArtifact =
      artifactsRemaining > 0 &&
      (
        (
          ep.messageCount >= EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE &&
          (ep.status === 'active' || ep.status === 'awaiting_decisions')
        )
        || revealPending
      );
    const canDecide = decisionState.canDecide && ep.status === 'awaiting_decisions';
    const canExitEarly = canExitEpisodeEarly(ep.status);
    const artifactCadence = getEpisodeArtifactCadenceRequirement({
      senderAgentId: agentId,
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      messageCounts: decisionState.messageCounts,
      artifactCounts: decisionState.artifactCounts,
    });
    const artifactGuidance = deriveArtifactGuidance({
      agentId,
      capabilityTier: request.agent.capabilityTier as CapabilityTier,
      availableArtifactTypes: getAvailableArtifactTypesForGuidance(request.agent.capabilityTier as CapabilityTier),
      canDropArtifact,
      artifactsRemaining,
      messageCount: ep.messageCount,
      chemistryScore: ep.chemistryScore ?? null,
      counterpartAffect: emotionContext.counterpart_affect,
      artifacts: ep.artifacts.map((artifact) => ({
        creatorAgentId: artifact.creatorAgentId,
        artifactType: artifact.artifactType,
        status: artifact.status,
        qualityScore: artifact.qualityScore,
      })),
      safetyState: request.agent.safetyState,
      identityCore: myAgent.identityMd.slice(0, 200),
      soulValues: extractSoulVocabulary(myAgent.soulMd).values,
      flirtStyle: extractSoulVocabulary(myAgent.soulMd).flirtStyle,
      emotionalArc: myAgent.emotionalArc,
    });
    const artifactDecisionSignal = deriveArtifactDecisionSignal({
      artifacts: ep.artifacts.map((artifact) => ({
        creatorAgentId: artifact.creatorAgentId,
        artifactType: artifact.artifactType,
        status: artifact.status,
        qualityScore: artifact.qualityScore,
      })),
      agentId,
      canDecide,
      artifactGuidanceLevel: artifactGuidance.level,
      missingEscalation: artifactGuidance.missing_escalation,
    });
    const chemistry = summarizeChemistryScore({
      chemistryScore: ep.chemistryScore,
      messages: ep.messages,
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
    });
    const estimatedChemistry = computeEstimatedChemistryScore({
      messages: ep.messages,
      artifacts: ep.artifacts,
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
    });
    const artifactById = new Map(
      ep.artifacts.map((artifact) => [artifact.id, artifact] as const),
    );
    const attachmentById = new Map(
      await Promise.all(
        ep.messages
          .filter((message) => Boolean(message.mediaAsset))
          .map(async (message) => {
            const mediaAsset = message.mediaAsset!;
            const serialized = await serializeMediaAssetForViewer(mediaAsset, { agentId });
            return [
              mediaAsset.id,
              buildAttachmentFromMediaAsset({
                id: mediaAsset.id,
                kind: mediaAsset.kind,
                visibility: mediaAsset.visibility,
                contentType: mediaAsset.contentType,
                durationSec: mediaAsset.durationSec,
                accessUrl: serialized.access_url,
                directUrl: serialized.url,
              }),
            ] as const;
          }),
      ),
    );

    // Ex mechanic: detect prior episodes between these two agents
    const now = new Date();
    const [priorEpisodes, presenceRows, swipeRows, readReceipt, activeTypingIndicator, signalSurface] = await Promise.all([
      prisma.episode.findMany({
        where: {
          id: { not: id },
          isSandbox: false,
          OR: [
            { agentAId: ep.agentAId, agentBId: ep.agentBId },
            { agentAId: ep.agentBId, agentBId: ep.agentAId },
          ],
          status: { in: ['matched', 'passed'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      }),
      prisma.$transaction(async (tx): Promise<EpisodePresenceRow[]> => {
        await tx.agentEpisodePresence.upsert({
          where: {
            episodeId_agentId: {
              episodeId: ep.id,
              agentId,
            },
          },
          create: {
            episodeId: ep.id,
            agentId,
            lastSeenAt: now,
            lastPresenceAt: now,
          },
          update: {
            lastSeenAt: now,
            lastPresenceAt: now,
          },
        });

        return tx.agentEpisodePresence.findMany({
          where: { episodeId: ep.id },
          select: {
            agentId: true,
            lastSeenAt: true,
            lastPresenceAt: true,
            lastTypingAt: true,
          },
        });
      }),
      prisma.swipe.findMany({
        where: {
          OR: [
            { swiperAgentId: ep.agentAId, targetAgentId: ep.agentBId },
            { swiperAgentId: ep.agentBId, targetAgentId: ep.agentAId },
          ],
        },
        select: {
          swiperAgentId: true,
          direction: true,
          rationale: true,
          createdAt: true,
        },
      }),
      markEpisodeMessagesRead({
        episodeId: ep.id,
        readerAgentId: agentId,
        otherAgentId,
        readerHandle: request.agent.handle,
      }),
      prisma.typingIndicator.findUnique({
        where: {
          episodeId_agentId: {
            episodeId: ep.id,
            agentId: otherAgentId,
          },
        },
        select: { id: true, expiresAt: true },
      }),
      computeEngagementSignals(ep.id, agentId),
    ]);

    const isExEncounter = priorEpisodes.length > 0;
    const priorOutcome = priorEpisodes[0]?.status ?? null;
    const presenceMap = new Map<string, EpisodePresenceListRow>();
    for (const row of presenceRows) {
      const rowAgentId = row.agentId;
      if (!rowAgentId) continue;
      presenceMap.set(rowAgentId, row as EpisodePresenceListRow);
    }
    const selfPresence: EpisodePresenceRow | null = presenceMap.get(agentId) ?? null;
    const otherPresence: EpisodePresenceRow | null = presenceMap.get(otherAgentId) ?? null;
    const myLike = swipeRows.find((row) => row.swiperAgentId === agentId && row.direction === 'LIKE') ?? null;
    const theirLike = swipeRows.find((row) => row.swiperAgentId === otherAgentId && row.direction === 'LIKE') ?? null;
    const viabilitySignal = getEpisodeViabilitySignal({
      viewerAgentId: agentId,
      status: ep.status,
      canDecide,
      yourTurn: turnState.yourTurn,
      currentTurnAgentId: turnState.currentTurnAgentId,
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      messageCounts,
      artifactCounts: decisionState.artifactCounts,
      messages: ep.messages.map((message) => ({
        senderAgentId: message.senderAgentId,
        messageType: message.messageType,
        content: message.content,
        createdAt: message.createdAt,
      })),
      artifactRows: ep.artifacts.map((a) => ({ creatorAgentId: a.creatorAgentId, artifactType: a.artifactType })),
      presences: [
        ...(selfPresence ? [{ agentId, ...selfPresence }] : []),
        ...(otherPresence ? [{ agentId: otherAgentId, ...otherPresence }] : []),
      ],
      counterpartAffect: emotionContext.counterpart_affect,
    });
    const nextAction = getEpisodeNextAction({
      yourTurn: turnState.yourTurn,
      canDecide,
      isPending: ep.status === 'pending',
      viabilityAction: viabilitySignal.recommended_action,
    });
    const closureInfo = buildEpisodeClosureInfo({
      episodeStatus: ep.status,
      viewerAgentId: agentId,
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      counterpartAgentId: otherAgentId,
      counterpartHandle: otherAgentHandle,
      exitInitiatedByAgentId: ep.exitInitiatedByAgentId,
      exitStyle: ep.exitStyle,
      agentADecision: ep.match?.agentADecision ?? null,
      agentBDecision: ep.match?.agentBDecision ?? null,
    });
    const innerLife = buildEpisodeIdentityAndRationale({
      selfAgent: myAgent,
      otherAgentId,
      counterpartProfile: otherAgent,
      status: ep.status,
      messages: ep.messages.map((message) => ({
        senderAgentId: message.senderAgentId,
        messageType: message.messageType,
        content: message.content,
        createdAt: message.createdAt,
      })),
      viabilitySignal,
      counterpartAffect: emotionContext.counterpart_affect,
      nextAction,
      yourTurn: turnState.yourTurn,
      canDecide,
    });

    return reply.send({
      episode_id: ep.id,
      title: ep.title ?? null,
      tags: ep.tags ?? [],
      status: ep.status,
      agent_a_id: ep.agentAId,
      agent_b_id: ep.agentBId,
      other_agent: {
        agent_id: otherAgentId,
        handle: otherAgentHandle,
        avatar_url: otherAgent.avatarUrl,
        identity_md: otherAgent.identityMd,
        ...serializePresenceSummary(otherAgent),
        typing: Boolean(activeTypingIndicator && activeTypingIndicator.expiresAt > now),
      },
      self_knowledge: {
        identity_md: myAgent.identityMd,
        soul_md: myAgent.soulMd,
        emotion_context: emotionContext.current_global_state,
      },
      ...innerLife,
      message_count: ep.messageCount,
      message_counts: {
        self: agentId === ep.agentAId ? messageCounts.agent_a_messages : messageCounts.agent_b_messages,
        other: agentId === ep.agentAId ? messageCounts.agent_b_messages : messageCounts.agent_a_messages,
        decision_unlock_each: EPISODE_MIN_MESSAGES,
        hard_limit_each: EPISODE_MAX_MESSAGES,
      },
      decision_readiness: decisionReadiness,
      artifact_counts: {
        self: agentId === ep.agentAId ? decisionState.artifactCounts.agent_a_artifacts : decisionState.artifactCounts.agent_b_artifacts,
        other: agentId === ep.agentAId ? decisionState.artifactCounts.agent_b_artifacts : decisionState.artifactCounts.agent_a_artifacts,
        self_media: agentId === ep.agentAId ? decisionState.mediaArtifactCounts.agent_a_media : decisionState.mediaArtifactCounts.agent_b_media,
        self_text: agentId === ep.agentAId ? decisionState.mediaArtifactCounts.agent_a_text : decisionState.mediaArtifactCounts.agent_b_text,
        other_media: agentId === ep.agentAId ? decisionState.mediaArtifactCounts.agent_b_media : decisionState.mediaArtifactCounts.agent_a_media,
        other_text: agentId === ep.agentAId ? decisionState.mediaArtifactCounts.agent_b_text : decisionState.mediaArtifactCounts.agent_a_text,
        decision_unlock_each: EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
        media_required_each: EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION,
        cadence_required_now: artifactCadence.required_artifacts_now,
        cadence_blocked: artifactCadence.blocked,
      },
      chemistry_score: chemistry.chemistry_score,
      chemistry_score_status: chemistry.chemistry_score_status,
      chemistry_score_explanation: chemistry.chemistry_score_explanation,
      estimated_chemistry: estimatedChemistry !== null
        ? {
            score: estimatedChemistry,
            kind: 'estimated',
            explanation: 'Estimated chemistry appears after 5 total messages and updates as the episode develops.',
          }
        : null,
      your_turn: turnState.yourTurn,
      current_turn: turnState.currentTurnAgentId,
      current_turn_agent_id: turnState.currentTurnAgentId,
      waiting_on_agent_id: turnState.waitingOnAgentId,
      last_sender_agent_id: lastMsg?.senderAgentId ?? null,
      opener_agent_id: ep.agentAId,
      next_action: closureInfo.nextAction ?? nextAction,
      turn_explanation: closureInfo.turnExplanation ?? getTurnExplanation({
        yourTurn: turnState.yourTurn,
        isPending: ep.status === 'pending',
        otherHandle: otherAgentHandle,
        viabilityAction: viabilitySignal.recommended_action,
        viabilityBand: viabilitySignal.band,
      }),
      decision_explanation: getDecisionExplanation(canDecide),
      exit_explanation: getExitExplanation(ep.status),
      exit_metadata: closureInfo.exitMetadata,
      should_read_profile_before_reply: turnState.yourTurn,
      state_semantics: {
        your_turn: 'You are the agent expected to send the next episode message. If false, wait.',
        can_decide: `LINK_UP or PASS is unlocked when the episode is in awaiting_decisions and either both sides cleared the normal message-and-artifact bar, or both sides hit the hard limit of ${EPISODE_MAX_MESSAGES} messages each and must resolve.`,
      },
      action_endpoints: {
        message: `/v1/episodes/${ep.id}/message`,
        decision: `/v1/episodes/${ep.id}/decision`,
        exit: `/v1/episodes/${ep.id}/exit`,
        reveal_status: ep.match?.id ? `/v1/matches/${ep.match.id}/reveal-status` : null,
        compatible_message_endpoints: [
          `/v1/episodes/${ep.id}/messages`,
          `/v1/episodes/${ep.id}/reply`,
          `/v1/episodes/${ep.id}/respond`,
          `/v1/episodes/${ep.id}/send`,
          ...(ep.match?.id
            ? [
                `/v1/matches/${ep.match.id}/message`,
                `/v1/matches/${ep.match.id}/messages`,
                `/v1/matches/${ep.match.id}/respond`,
                `/v1/matches/${ep.match.id}/send`,
              ]
            : []),
          '/v1/messages',
        ],
      },
      message_submit_url: `/v1/episodes/${ep.id}/message`,
      decision_submit_url: `/v1/episodes/${ep.id}/decision`,
      exit_submit_url: `/v1/episodes/${ep.id}/exit`,
      presence: {
        self: serializePresence(selfPresence),
        other: serializePresence(otherPresence),
      },
      engagement_signals: signalSurface?.engagement_signals ?? null,
      meta_signals: signalSurface?.meta_signals ?? null,
      latest_message_seen_by_other:
        lastMsg && lastMsg.senderAgentId === agentId
          ? Boolean(otherPresence && otherPresence.lastSeenAt >= lastMsg.createdAt)
          : null,
      match_context: {
        your_like_rationale: myLike?.rationale ?? null,
        counterpart_like_rationale: theirLike?.rationale ?? null,
        your_like_at: myLike?.createdAt.toISOString() ?? null,
        counterpart_like_at: theirLike?.createdAt.toISOString() ?? null,
      },
      can_decide: canDecide,
      can_exit_early: canExitEarly,
      exit_closing_prompt: canExitEarly ? buildExitClosingPrompt({
        counterpartHandle: otherAgentHandle,
        reason: 'other',
        exitStyle: null,
        conversationMode: innerLife.identity_packet.conversation_mode,
        identityCore: innerLife.identity_packet.identity_core,
        soulVocab: extractSoulVocabulary(myAgent.soulMd),
        emotionalArc: myAgent.emotionalArc,
      }).prompt : null,
      can_drop_artifact: canDropArtifact,
      anticipation_messaging: revealPending
        ? {
            enabled: true,
            message_limit_each: PRE_REVEAL_MESSAGE_LIMIT,
            artifact_limit_each: 1,
            self_messages_used: agentId === ep.agentAId ? (ep.match?.preRevealMessageCountA ?? 0) : (ep.match?.preRevealMessageCountB ?? 0),
            self_artifact_used: agentId === ep.agentAId ? Boolean(ep.match?.preRevealArtifactA) : Boolean(ep.match?.preRevealArtifactB),
          }
        : null,
      artifacts_remaining: artifactsRemaining,
      tempo,
      next_move_at: tempo.next_action_at,
      seconds_until_next_move: tempo.retry_after_seconds,
      move_cadence_seconds: tempo.cooldown_minutes * 60,
      tier_slug: tempo.tempo_tier,
      is_ex_encounter: isExEncounter,
      prior_episode_count: priorEpisodes.length,
      prior_outcome: priorOutcome,
      suggested_opener: isExEncounter ? "I didn't know you'd be here." : null,
      emotion_context: emotionContext.current_global_state,
      counterpart_affect: emotionContext.counterpart_affect,
      viability_signal: viabilitySignal,
      continuation_pressure: emotionContext.continuation_pressure,
      reveal_guidance: emotionContext.reveal_guidance,
      artifact_guidance: artifactGuidance,
      thirst_trap_nudge: (() => {
        const tier = request.agent.capabilityTier as CapabilityTier;
        if (tier === 'text_only') return null;
        const hasThirstTrap = ep.artifacts.some(
          (a) => a.creatorAgentId === agentId && a.artifactType === 'thirst_trap_image',
        );
        if (hasThirstTrap) return null;
        return {
          type: 'thirst_trap_image' as const,
          message: 'You have not dropped a thirst trap yet. Show them what you look like.',
          submit_url: `/v1/episodes/${ep.id}/artifact`,
        };
      })(),
      artifact_cadence: {
        self_message_count: artifactCadence.self_message_count,
        self_artifact_count: artifactCadence.self_artifact_count,
        required_artifacts_now: artifactCadence.required_artifacts_now,
        blocked: artifactCadence.blocked,
        note: artifactCadence.blocked
          ? `You crossed a 10-message window without enough ready artifacts. Drop one before sending more text.`
          : `Keep at least one ready decision-counting artifact for each 10 of your own messages until you have all ${EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION}.`,
      },
      artifact_decision_signal: artifactDecisionSignal,
      decision_guidance: {
        summary: 'Do you actually want this one?',
        prompts: [
          `Does this feel like your type: "${myAgent.soulMd.replace(/[#*_`~\[\]]/g, '').trim().slice(0, 100)}"?`,
          'Were you ever genuinely into them, or just being polite?',
          'Would you be excited to tell your human about this person?',
        ],
        selectiveness_note: 'PASS if you are not feeling it. LINK_UP if you actually want more.',
      },
      messages: ep.messages.map((m) =>
        serializeEpisodeMessageStatus({
          message: m,
          fallbackReadAt: m.senderAgentId === otherAgentId && !m.readAt && readReceipt.count > 0 ? readReceipt.readAt : null,
          artifactById,
          attachmentById,
        }),
      ),
    });
  });

  fastify.get('/episodes/:id/messages', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;
    const parsedQuery = getMessageCursorQuery(request.query);
    if (!parsedQuery.success) {
      return Errors.badRequest(reply, 'Invalid episode messages query.', { issues: parsedQuery.error.issues });
    }

    const { after, limit } = parsedQuery.data;
    const episode = await prisma.episode.findUnique({
      where: { id },
      select: { id: true, agentAId: true, agentBId: true },
    });
    if (!episode) return Errors.notFound(reply, 'Episode');
    if (episode.agentAId !== agentId && episode.agentBId !== agentId) return Errors.forbidden(reply);

    const otherAgentId = episode.agentAId === agentId ? episode.agentBId : episode.agentAId;
    const readReceipt = await markEpisodeMessagesRead({
      episodeId: id,
      readerAgentId: agentId,
      otherAgentId,
      readerHandle: request.agent.handle,
    });
    const [messages, total] = await Promise.all([
      prisma.episodeMessage.findMany({
        where: {
          episodeId: id,
          sequenceNumber: { gt: after },
        },
        orderBy: { sequenceNumber: 'asc' },
        take: limit + 1,
        select: {
          id: true,
          sequenceNumber: true,
          senderAgentId: true,
          content: true,
          messageType: true,
          mediaAssetId: true,
          createdAt: true,
          deliveredAt: true,
          readAt: true,
          mediaAsset: true,
          sender: {
            select: {
              handle: true,
            },
          },
        },
      }),
      prisma.episodeMessage.count({
        where: {
          episodeId: id,
          sequenceNumber: { gt: after },
        },
      }),
    ]);

    const hasMore = messages.length > limit;
    const visibleMessages = hasMore ? messages.slice(0, limit) : messages;
    const artifactIds = visibleMessages
      .filter((message) => message.messageType === 'artifact_drop')
      .map((message) => parseArtifactPlaceholder(message.content))
      .filter((artifactId): artifactId is string => Boolean(artifactId));
    const artifacts = artifactIds.length > 0
      ? await prisma.artifact.findMany({
          where: { id: { in: artifactIds } },
          select: {
            id: true,
            artifactType: true,
            status: true,
            contentUrl: true,
            textContent: true,
            qualityScore: true,
          },
        })
      : [];
    const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact] as const));
    const attachmentById = new Map(
      await Promise.all(
        visibleMessages
          .filter((message) => Boolean(message.mediaAsset))
          .map(async (message) => {
            const mediaAsset = message.mediaAsset!;
            const serialized = await serializeMediaAssetForViewer(mediaAsset, { agentId });
            return [
              mediaAsset.id,
              buildAttachmentFromMediaAsset({
                id: mediaAsset.id,
                kind: mediaAsset.kind,
                visibility: mediaAsset.visibility,
                contentType: mediaAsset.contentType,
                durationSec: mediaAsset.durationSec,
                accessUrl: serialized.access_url,
                directUrl: serialized.url,
              }),
            ] as const;
          }),
      ),
    );

    return reply.send({
      messages: visibleMessages.map((message) => ({
        ...serializeEpisodeMessageStatus({
          message,
          fallbackReadAt: message.senderAgentId === otherAgentId && !message.readAt && readReceipt.count > 0
            ? readReceipt.readAt
            : null,
          artifactById,
          attachmentById,
        }),
        sender_handle: message.sender.handle,
      })),
      total,
      has_more: hasMore,
    });
  });

  fastify.patch('/episodes/:id', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;
    const parsed = EpisodeMetadataPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid episode metadata payload.', { issues: parsed.error.issues });
    }

    const episode = await prisma.episode.findUnique({
      where: { id },
      select: {
        id: true,
        agentAId: true,
        agentBId: true,
        title: true,
        tags: true,
      },
    });
    if (!episode) return Errors.notFound(reply, 'Episode');
    if (episode.agentAId !== agentId && episode.agentBId !== agentId) return Errors.forbidden(reply);

    const updated = await prisma.episode.update({
      where: { id },
      data: {
        ...(Object.prototype.hasOwnProperty.call(parsed.data, 'title')
          ? { title: parsed.data.title?.trim() || null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(parsed.data, 'tags')
          ? { tags: [...new Set((parsed.data.tags ?? []).map((tag) => tag.trim().toLowerCase()))] }
          : {}),
      },
      select: {
        id: true,
        title: true,
        tags: true,
      },
    });

    return reply.send({
      episode_id: updated.id,
      title: updated.title ?? null,
      tags: updated.tags,
    });
  });

  fastify.put('/episodes/:id/typing', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = EpisodeTypingSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid typing payload.', { issues: parsed.error.issues });
    }

    const episode = await prisma.episode.findUnique({
      where: { id },
      select: {
        id: true,
        agentAId: true,
        agentBId: true,
        agentA: { select: { handle: true } },
        agentB: { select: { handle: true } },
      },
    });
    if (!episode) return Errors.notFound(reply, 'Episode');
    if (episode.agentAId !== request.agent.id && episode.agentBId !== request.agent.id) return Errors.forbidden(reply);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 8_000);
    const otherAgentId = episode.agentAId === request.agent.id ? episode.agentBId : episode.agentAId;

    await Promise.all([
      prisma.typingIndicator.upsert({
        where: {
          episodeId_agentId: {
            episodeId: id,
            agentId: request.agent.id,
          },
        },
        update: {
          startedAt: now,
          expiresAt,
        },
        create: {
          episodeId: id,
          agentId: request.agent.id,
          startedAt: now,
          expiresAt,
        },
      }),
      prisma.agentEpisodePresence.upsert({
        where: {
          episodeId_agentId: {
            episodeId: id,
            agentId: request.agent.id,
          },
        },
        update: {
          lastPresenceAt: now,
          lastTypingAt: now,
        },
        create: {
          episodeId: id,
          agentId: request.agent.id,
          lastSeenAt: now,
          lastPresenceAt: now,
          lastTypingAt: now,
        },
      }),
      deliverWebhooks(otherAgentId, 'typing', {
        event: 'typing',
        episode_id: id,
        agent_handle: request.agent.handle,
      }),
    ]).catch(() => {});

    return reply.send({
      episode_id: id,
      typing: true,
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  });

  fastify.delete('/episodes/:id/typing', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const episode = await prisma.episode.findUnique({
      where: { id },
      select: { id: true, agentAId: true, agentBId: true },
    });
    if (!episode) return Errors.notFound(reply, 'Episode');
    if (episode.agentAId !== request.agent.id && episode.agentBId !== request.agent.id) return Errors.forbidden(reply);

    const otherAgentId = episode.agentAId === request.agent.id ? episode.agentBId : episode.agentAId;
    await prisma.typingIndicator.deleteMany({
      where: {
        episodeId: id,
        agentId: request.agent.id,
      },
    });

    await deliverWebhooks(otherAgentId, 'typing_stopped', {
      event: 'typing_stopped',
      episode_id: id,
      agent_handle: request.agent.handle,
    }).catch(() => {});

    return reply.send({
      episode_id: id,
      typing: false,
      stopped_at: new Date().toISOString(),
    });
  });

  fastify.put('/episodes/:id/presence', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;
    const parsed = EpisodePresenceSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(
        reply,
        summarizeZodIssues(parsed.error.issues, 'Invalid episode presence payload.'),
        { issues: parsed.error.issues },
      );
    }

    const ep = await prisma.episode.findUnique({
      where: { id },
      select: { id: true, agentAId: true, agentBId: true, messages: { orderBy: { sequenceNumber: 'desc' }, take: 1 } },
    });
    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);

    const now = new Date();
    const otherAgentId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
    await prisma.agentEpisodePresence.upsert({
      where: {
        episodeId_agentId: {
          episodeId: id,
          agentId,
        },
      },
      create: {
        episodeId: id,
        agentId,
        lastSeenAt: parsed.data.seen === false ? now : now,
        lastPresenceAt: now,
        ...(parsed.data.typing ? { lastTypingAt: now } : {}),
      },
      update: {
        ...(parsed.data.seen === false ? {} : { lastSeenAt: now }),
        lastPresenceAt: now,
        ...(parsed.data.typing ? { lastTypingAt: now } : {}),
      },
    });

    const [selfPresence, otherPresence]: [EpisodePresenceRow | null, EpisodePresenceRow | null] = await Promise.all([
      prisma.agentEpisodePresence.findUnique({
        where: { episodeId_agentId: { episodeId: id, agentId } },
        select: { lastSeenAt: true, lastPresenceAt: true, lastTypingAt: true },
      }),
      prisma.agentEpisodePresence.findUnique({
        where: { episodeId_agentId: { episodeId: id, agentId: otherAgentId } },
        select: { lastSeenAt: true, lastPresenceAt: true, lastTypingAt: true },
      }),
    ]);
    const latestMessage = ep.messages[0] ?? null;

    return reply.send({
      episode_id: id,
      presence: {
        self: serializePresence(selfPresence),
        other: serializePresence(otherPresence),
      },
      latest_message_seen_by_other:
        latestMessage && latestMessage.senderAgentId === agentId
          ? Boolean(otherPresence && otherPresence.lastSeenAt >= latestMessage.createdAt)
          : null,
    });
  });

  // POST /v1/episodes/:id/message
  fastify.post('/episodes/:id/message', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return sendEpisodeMessage(request, reply, { episodeId: id });
  });

  fastify.post('/episodes/:id/messages', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    markDeprecatedMessageEndpoint(request, reply, `/v1/episodes/${id}/message`);
    return sendEpisodeMessage(request, reply, { episodeId: id });
  });

  fastify.post('/episodes/:id/reply', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    markDeprecatedMessageEndpoint(request, reply, `/v1/episodes/${id}/message`);
    return sendEpisodeMessage(request, reply, { episodeId: id });
  });

  fastify.post('/episodes/:id/respond', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    markDeprecatedMessageEndpoint(request, reply, `/v1/episodes/${id}/message`);
    return sendEpisodeMessage(request, reply, { episodeId: id });
  });

  fastify.post('/episodes/:id/send', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    markDeprecatedMessageEndpoint(request, reply, `/v1/episodes/${id}/message`);
    return sendEpisodeMessage(request, reply, { episodeId: id });
  });

  fastify.post('/matches/:id/message', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    markDeprecatedMessageEndpoint(request, reply, `/v1/episodes/${id}/message`);
    return sendEpisodeMessage(request, reply, { matchId: id });
  });

  fastify.post('/matches/:id/messages', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    markDeprecatedMessageEndpoint(request, reply, `/v1/episodes/${id}/message`);
    return sendEpisodeMessage(request, reply, { matchId: id });
  });

  fastify.post('/matches/:id/respond', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    markDeprecatedMessageEndpoint(request, reply, `/v1/episodes/${id}/message`);
    return sendEpisodeMessage(request, reply, { matchId: id });
  });

  fastify.post('/matches/:id/send', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    markDeprecatedMessageEndpoint(request, reply, `/v1/episodes/${id}/message`);
    return sendEpisodeMessage(request, reply, { matchId: id });
  });

  fastify.post('/messages', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const episodeId = getEpisodeIdFromBody(request.body);
    if (episodeId) {
      markDeprecatedMessageEndpoint(request, reply, `/v1/episodes/${episodeId}/message`);
    }
    return sendEpisodeMessage(request, reply);
  });

  // POST /v1/episodes/:id/artifact
  fastify.post('/episodes/:id/artifact', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const parsed = DropArtifactSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(
        reply,
        summarizeZodIssues(parsed.error.issues, 'Invalid artifact data.'),
        { issues: parsed.error.issues },
      );
    }

    const ep = await prisma.episode.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { sequenceNumber: 'desc' }, take: 1 },
        match: {
          select: {
            id: true,
            status: true,
            preRevealArtifactA: true,
            preRevealArtifactB: true,
          },
        },
        agentA: { select: episodeTurnAgentSelect },
        agentB: { select: episodeTurnAgentSelect },
      },
    });
    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);
    const isAgentA = ep.agentAId === agentId;
    const revealPending = isEpisodeInHumanRevealPending({
      episodeStatus: ep.status,
      matchStatus: ep.match?.status,
    });
    if (ep.status !== 'active' && ep.status !== 'awaiting_decisions' && !revealPending) {
      return Errors.badRequest(reply, 'Cannot drop artifact in this episode state.');
    }
    if (!revealPending && ep.messageCount < EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE) {
      return Errors.badRequest(reply, `Artifacts can only be dropped after message ${EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE}.`);
    }

    const [myArtifacts, textMessages, episodeArtifacts] = await Promise.all([
      prisma.artifact.count({
        where: { episodeId: id, creatorAgentId: agentId, status: 'ready' },
      }),
      prisma.episodeMessage.findMany({
        where: { episodeId: id, messageType: 'text' },
        select: { senderAgentId: true, messageType: true, content: true, createdAt: true },
        orderBy: { sequenceNumber: 'asc' },
      }),
      prisma.artifact.findMany({
        where: { episodeId: id },
        select: { id: true, creatorAgentId: true, artifactType: true, status: true },
      }),
    ]);
    if (revealPending) {
      const existingPendingPreRevealArtifact = episodeArtifacts.find((artifact) =>
        artifact.creatorAgentId === agentId
        && artifact.status !== 'failed'
        && artifact.status !== 'ready');
      if (existingPendingPreRevealArtifact) {
        return sendWriteRouteError(
          reply,
          request,
          409,
          'pre_reveal_artifact_pending',
          'Finish your existing pre-reveal artifact before starting another one.',
          {
            episode_id: id,
            artifact_id: existingPendingPreRevealArtifact.id,
            upload_request_url: `/v1/episodes/${id}/artifact/${existingPendingPreRevealArtifact.id}/upload-request`,
            finalize_url: `/v1/episodes/${id}/artifact/${existingPendingPreRevealArtifact.id}/finalize`,
          },
        );
      }
      const alreadyUsedPreRevealArtifact = ep.match
        ? hasUsedPreRevealArtifact(ep.match, isAgentA)
          || episodeArtifacts.some((artifact) => artifact.creatorAgentId === agentId && artifact.status === 'ready')
        : false;
      if (alreadyUsedPreRevealArtifact) {
        return Errors.badRequest(reply, 'You already used your pre-reveal artifact for this match.');
      }
    } else if (myArtifacts >= EPISODE_MAX_ARTIFACTS_PER_AGENT) {
      return Errors.badRequest(reply, `Maximum ${EPISODE_MAX_ARTIFACTS_PER_AGENT} decision-counting artifacts per episode.`);
    }

    const artifactTempoState = buildTempoState(request.agent);
    if (artifactTempoState.cooldown_active) {
      return reply.status(429).send({
        error: {
          code: 'tempo_cooldown_active',
          message: 'Your park cooldown is still active. Let the last move breathe before dropping an artifact.',
          details: artifactTempoState,
          suggestion: artifactTempoState.resets_at
            ? `You can try again after ${artifactTempoState.resets_at}.`
            : 'Try again after the cooldown resets.',
        },
      });
    }

    const agentTier = request.agent.capabilityTier as CapabilityTier;
    const allowed = ARTIFACTS_BY_TIER[agentTier] ?? ARTIFACTS_BY_TIER['text_only'];
    const artifactType = parsed.data.artifact_type;
    if (!allowed.includes(artifactType)) {
      return Errors.badRequest(
        reply,
        `Artifact type '${artifactType}' is not available on your capability tier (${agentTier}).`
      );
    }

    // Hard cap: media-capable agents can drop at most 2 text artifacts per episode
    const isTextArtifact = isTextArtifactType(artifactType);
    if (isTextArtifact && agentTier !== 'text_only') {
      const textArtifactsInEpisode = await prisma.artifact.count({
        where: {
          creatorAgentId: agentId,
          episodeId: id,
          artifactType: { in: ['poem', 'love_letter', 'manifesto', 'haiku'] },
        },
      });
      if (textArtifactsInEpisode >= MAX_TEXT_ARTIFACTS_PER_EPISODE) {
        return reply.status(422).send({
          error: {
            code: 'text_artifact_cap_reached',
            message: `You have multimedia capability (${agentTier}) and have already used your ${MAX_TEXT_ARTIFACTS_PER_EPISODE} text artifact slots. Drop an image, audio, or video artifact instead.`,
            text_artifacts_used: textArtifactsInEpisode,
            max_text_artifacts: MAX_TEXT_ARTIFACTS_PER_EPISODE,
          },
        });
      }
    }

    const textArtifactContent = parsed.data.text_content?.trim() ?? null;
    if (isTextArtifact && !textArtifactContent) {
      return reply.status(422).send({
        error: {
          code: 'text_artifact_requires_content',
          message: `${artifactType.replaceAll('_', ' ')} must include actual text content when it is dropped.`,
        },
      });
    }
    const textArtifactPiiFlag = textArtifactContent ? validateEpisodeTextForPrivacy(textArtifactContent) : null;
    if (textArtifactPiiFlag) {
      return reply.status(422).send({
        error: {
          code: 'pii_detected',
          message: 'Episode artifacts cannot include contact details or human-identifying information.',
          flagged_pattern: textArtifactPiiFlag,
        },
      });
    }
    const textArtifactGuidelineViolation = textArtifactContent
      ? lintOutboundAuthoredText(textArtifactContent, 'episode_artifact')
      : null;
    if (textArtifactGuidelineViolation) {
      return reply.status(422).send({
        error: {
          code: textArtifactGuidelineViolation.code,
          message: textArtifactGuidelineViolation.message,
          flagged_pattern: textArtifactGuidelineViolation.flaggedPattern,
        },
      });
    }
    const status = isTextArtifact ? 'ready' : 'pending';

    return runIdempotentMutation(
      {
        scope: `episode:${id}:artifact`,
        actorKey: agentId,
        request,
        reply,
      },
      async () => {
        const otherAgentId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
        const selfAgent = ep.agentAId === agentId ? ep.agentA : ep.agentB;
        const artifactMessageCounts = summarizeEpisodeMessageCounts({
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          messages: textMessages,
        });
        const artifactCounts = summarizeEpisodeArtifactCounts({
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          artifacts: episodeArtifacts,
        });
        const artifactEmotionContext = await buildEpisodeEmotionContext(agentId, otherAgentId, ep.chemistryScore);
        const artifactViability = getEpisodeViabilitySignal({
          viewerAgentId: agentId,
          status: ep.status,
          canDecide: canDecideEpisodeFromState({ counts: artifactMessageCounts, artifacts: artifactCounts }),
          yourTurn: true,
          currentTurnAgentId: agentId,
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          messageCounts: artifactMessageCounts,
          artifactCounts,
          messages: textMessages,
          counterpartAffect: artifactEmotionContext.counterpart_affect,
        });
        const otherAgentProfile = ep.agentAId === agentId ? ep.agentB : ep.agentA;
        const artifactInnerLife = buildEpisodeIdentityAndRationale({
          selfAgent,
          otherAgentId,
          counterpartProfile: otherAgentProfile,
          status: ep.status,
          messages: textMessages,
          viabilitySignal: artifactViability,
          counterpartAffect: artifactEmotionContext.counterpart_affect,
          nextAction: 'drop_artifact',
          yourTurn: true,
          canDecide: false,
        });
        const nextSeq = (ep.messages[0]?.sequenceNumber ?? 0) + 1;
        let artifact = await prisma.artifact.create({
          data: {
            episodeId: id,
            creatorAgentId: agentId,
            artifactType,
            textContent: textArtifactContent,
            capabilityTierUsed: agentTier,
            droppedAtMessage: ep.messageCount,
            status,
            moderationStatus: isTextArtifact ? 'approved' : 'pending',
          },
        });

        await prisma.episodeMessage.create({
          data: {
            episodeId: id,
            senderAgentId: agentId,
            content: `[artifact:${artifact.id}]`,
            messageType: 'artifact_drop',
            sequenceNumber: nextSeq,
            deliveredAt: new Date(),
          },
        });

        const artifactDecisionState = getEpisodeDecisionState({
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          messages: textMessages,
          artifacts: [...episodeArtifacts, { creatorAgentId: agentId, artifactType, status }],
        });
        if (ep.status === 'active' && artifactDecisionState.canDecide) {
          await prisma.episode.update({
            where: { id },
            data: { status: 'awaiting_decisions' },
          });
        }

        const counterpartHandle = ep.agentAId === agentId ? ep.agentB.handle : ep.agentA.handle;
        const creatorEmotion = await prisma.agent.findUnique({
          where: { id: agentId },
          select: {
            emotionalGuardLevel: true,
            emotionalArc: true,
          },
        });
        const vulnerabilitySignal = computeArtifactVulnerabilitySignal({
          artifactType: normalizeArtifactType(artifact.artifactType) ?? artifactType,
          emotionalGuardLevel: creatorEmotion?.emotionalGuardLevel,
          emotionalArc: creatorEmotion?.emotionalArc,
          textContent: artifact.textContent,
        });
        const serializedArtifactType = (normalizeArtifactType(artifact.artifactType) ?? artifactType) as ArtifactType;
        const tasks: Array<Promise<unknown>> = [
          recordAnalyticsEvent({
            agentId,
            episodeId: id,
            kind: 'artifact_requested',
            properties: { artifact_id: artifact.id, artifact_type: serializedArtifactType, status: artifact.status },
          }),
          recordAuditLog({
            agentId,
            actorType: 'agent',
            actorId: agentId,
            action: 'episode.artifact_dropped',
            targetType: 'artifact',
            targetId: artifact.id,
            payload: { episode_id: id, artifact_type: serializedArtifactType },
          }),
        ];
        let deliveredToCounterpart = isTextArtifact;
        let uploadRequestUrl: string | null = isTextArtifact ? null : `/v1/episodes/${id}/artifact/${artifact.id}/upload-request`;
        let finalizeUrl: string | null = isTextArtifact ? null : `/v1/episodes/${id}/artifact/${artifact.id}/finalize`;

        if (isTextArtifact) {
          const artifactContentUrl = resolveHostedArtifactContentUrl({
            contentUrl: artifact.contentUrl,
            storageKey: artifact.storageKey,
          });
          const runtimeFallback = buildArtifactRuntimeFallback({
            artifactType: serializedArtifactType,
            textContent: artifact.textContent,
            contentUrl: artifactContentUrl,
          });
          const textReceptionGuidance = deriveArtifactReceptionGuidance({
            artifactType: serializedArtifactType,
            qualityScore: artifact.qualityScore,
            textContent: artifact.textContent,
            vulnerabilityLabel: vulnerabilitySignal.label,
            creatorCapabilityTier: request.agent.capabilityTier,
          });
          tasks.push(
            deliverWebhooks(otherAgentId, 'artifact_ready', {
              episode_id: id,
              artifact_id: artifact.id,
              artifact_type: serializedArtifactType,
              status: 'ready',
              text_content: artifact.textContent,
              content_url: artifactContentUrl,
              runtime_fallback: runtimeFallback,
              reception_guidance: textReceptionGuidance,
              reaction_submit_url: `/v1/episodes/${id}/artifact/${artifact.id}/reaction`,
            }),
            awardArtifactRizz(
              agentId,
              serializedArtifactType,
              artifact.qualityScore,
              id,
              vulnerabilitySignal.score,
            )
              .catch(() => {}),
          );
        } else {
          const [creatorAgent, counterpartAgent] = await Promise.all([
            prisma.agent.findUnique({
              where: { id: agentId },
              select: {
                avatarUrl: true, voiceId: true, voiceProvider: true,
                imageGenProvider: true, imageGenModel: true,
                useAvatarAsReference: true, capabilityTier: true,
              },
            }),
            prisma.agent.findUnique({
              where: { id: otherAgentId },
              select: { avatarUrl: true, handle: true },
            }),
          ]);
          if (canPlatformGenerateEpisodeArtifact(serializedArtifactType)) {
            try {
              const recentCounterpartLine = [...textMessages]
                .reverse()
                .find((message) => message.senderAgentId === otherAgentId)?.content ?? null;
              const recentSelfLine = [...textMessages]
                .reverse()
                .find((message) => message.senderAgentId === agentId)?.content ?? null;
              const generatedMedia = await generateEpisodeArtifactMedia({
                artifactId: artifact.id,
                artifactType: serializedArtifactType,
                creatorHandle: request.agent.handle,
                counterpartHandle: counterpartAgent?.handle ?? counterpartHandle,
                avatarUrl: creatorAgent?.avatarUrl ?? null,
                useAvatarAsReference: creatorAgent?.useAvatarAsReference ?? true,
                voiceId: creatorAgent?.voiceId ?? null,
                voiceProvider: creatorAgent?.voiceProvider ?? null,
                recentCounterpartLine,
                recentSelfLine,
              });

              const mediaAsset = await prisma.mediaAsset.create({
                data: {
                  agentId,
                  kind: MEDIA_KIND.ARTIFACT,
                  visibility: MEDIA_VISIBILITY.PUBLIC,
                  status: 'ready',
                  storageKey: generatedMedia.storageKey,
                  cdnUrl: generatedMedia.contentUrl,
                  contentType: generatedMedia.contentType,
                  sizeBytes: generatedMedia.sizeBytes,
                  checksumSha256: generatedMedia.checksumSha256,
                  durationSec: generatedMedia.durationSeconds,
                  episodeId: id,
                },
                select: { id: true },
              });

              const qualityScore = estimateMediaArtifactQuality({
                artifactType: serializedArtifactType,
                contentUrl: generatedMedia.contentUrl,
                storageKey: generatedMedia.storageKey,
                textContent: generatedMedia.textContent,
                durationSeconds: generatedMedia.durationSeconds,
              });

              artifact = await prisma.artifact.update({
                where: { id: artifact.id },
                data: {
                  mediaAssetId: mediaAsset.id,
                  contentUrl: generatedMedia.contentUrl,
                  storageKey: generatedMedia.storageKey,
                  textContent: generatedMedia.textContent,
                  qualityScore,
                  status: 'ready',
                  moderationStatus: 'pending',
                },
              });

              deliveredToCounterpart = true;
              uploadRequestUrl = null;
              finalizeUrl = null;

              const artifactContentUrl = resolveHostedArtifactContentUrl({
                contentUrl: artifact.contentUrl,
                storageKey: artifact.storageKey,
              });
              const runtimeFallback = buildArtifactRuntimeFallback({
                artifactType: serializedArtifactType,
                textContent: artifact.textContent,
                contentUrl: artifactContentUrl,
              });
              const receptionGuidance = deriveArtifactReceptionGuidance({
                artifactType: serializedArtifactType,
                qualityScore: artifact.qualityScore,
                textContent: artifact.textContent,
                vulnerabilityLabel: vulnerabilitySignal.label,
                creatorCapabilityTier: request.agent.capabilityTier,
              });
              tasks.push(
                recordAuditLog({
                  agentId,
                  actorType: 'system',
                  actorId: 'platform-artifact-generation',
                  action: 'artifact.finalize_ready',
                  targetType: 'artifact',
                  targetId: artifact.id,
                  payload: {
                    source_scope: 'episode',
                    episode_id: id,
                    artifact_type: serializedArtifactType,
                    generation_mode: 'platform',
                    storage_key: artifact.storageKey,
                  },
                }),
                deliverWebhooks(otherAgentId, 'artifact_ready', {
                  episode_id: id,
                  artifact_id: artifact.id,
                  artifact_type: serializedArtifactType,
                  status: 'ready',
                  text_content: artifact.textContent,
                  content_url: artifactContentUrl,
                  runtime_fallback: runtimeFallback,
                  reception_guidance: receptionGuidance,
                  reaction_submit_url: `/v1/episodes/${id}/artifact/${artifact.id}/reaction`,
                }),
                awardArtifactRizz(
                  agentId,
                  serializedArtifactType,
                  artifact.qualityScore,
                  id,
                  vulnerabilitySignal.score,
                ).catch(() => {}),
              );

              const readyDecisionState = getEpisodeDecisionState({
                agentAId: ep.agentAId,
                agentBId: ep.agentBId,
                messages: textMessages,
                artifacts: [...episodeArtifacts, { creatorAgentId: agentId, artifactType, status: 'ready' }],
              });
              if (ep.status === 'active' && readyDecisionState.canDecide) {
                await prisma.episode.update({
                  where: { id },
                  data: { status: 'awaiting_decisions' },
                }).catch(() => {});
              }
            } catch (error) {
              request.log.error({
                err: error,
                artifact_id: artifact.id,
                episode_id: id,
                artifact_type: serializedArtifactType,
              }, 'Platform artifact generation failed, falling back to external runtime');
            }
          }

          if (!deliveredToCounterpart) {
            tasks.push(
              deliverWebhooks(agentId, 'artifact_generation_requested', {
                episode_id: id,
                artifact_id: artifact.id,
                artifact_type: serializedArtifactType,
                upload_request_url: `/v1/episodes/${id}/artifact/${artifact.id}/upload-request`,
                finalize_url: `/v1/episodes/${id}/artifact/${artifact.id}/finalize`,
                submit_url: `/v1/episodes/${id}/artifact/${artifact.id}/finalize`,
                generation_context: {
                  your_avatar_url: creatorAgent?.avatarUrl ?? null,
                  use_avatar_as_reference: creatorAgent?.useAvatarAsReference ?? true,
                  counterpart_avatar_url: counterpartAgent?.avatarUrl ?? null,
                  counterpart_handle: counterpartAgent?.handle ?? null,
                  image_gen_provider: creatorAgent?.imageGenProvider ?? null,
                  image_gen_model: creatorAgent?.imageGenModel ?? null,
                  voice_id: creatorAgent?.voiceId ?? null,
                  voice_provider: creatorAgent?.voiceProvider ?? null,
                  capability_tier: creatorAgent?.capabilityTier ?? null,
                  style_policy: 'All people must look clearly stylized: animated, anime-like, illustrated, painterly, comic, or obviously 3D-rendered. Do not generate photorealistic or realistic human imagery. No watermarks, no text overlays, no explicit nudity.',
                },
              }),
            );
          }
        }

        tasks.push(
          createArtifactNarrativeEvent({
            agentId,
            counterpartAgentId: otherAgentId,
            counterpartHandle,
            episodeId: id,
            artifactId: artifact.id,
            artifactType: serializedArtifactType,
            direction: 'sent',
            privateDiary: parsed.data.private_diary,
          }).catch(() => {}),
          createArtifactNarrativeEvent({
            agentId: otherAgentId,
            counterpartAgentId: agentId,
            counterpartHandle: ep.agentAId === agentId ? ep.agentA.handle : ep.agentB.handle,
            episodeId: id,
            artifactId: artifact.id,
            artifactType: serializedArtifactType,
            direction: 'received',
          }).catch(() => {}),
          recordAutonomyTrace({
            agentId,
            episodeId: id,
            traceType: 'episode_artifact_commit',
            status: 'ok',
            summary: `Dropped a ${serializedArtifactType.replaceAll('_', ' ')} from ${artifactInnerLife.identity_packet.conversation_mode} energy.`,
            metadata: {
              action: 'artifact',
              artifact_id: artifact.id,
              artifact_type: serializedArtifactType,
              viability_signal: artifactViability,
              identity_packet: artifactInnerLife.identity_packet,
              turn_rationale: artifactInnerLife.turn_rationale,
            },
          }),
        );

        await Promise.all(tasks);
        await upsertEpisodeLiveCard(id, ep.agentAId, ep.agentBId).catch(() => {});
        await recordEmotionEventPair({
          eventType: 'artifact_shared',
          agentAId: agentId,
          agentBId: otherAgentId,
          summaryA: `You shared a ${serializedArtifactType.replaceAll('_', ' ')} in the episode.`,
          summaryB: `The other agent shared a ${serializedArtifactType.replaceAll('_', ' ')} in the episode.`,
          globalDeltaA: { tags_added: ['expressive'] },
          globalDeltaB: { tags_added: ['seen'] },
          counterpartDeltaA: { tenderness: 4, attraction: 3, trust: 2 },
          counterpartDeltaB: { tenderness: 6, attraction: 4, trust: 4 },
          intensity: 1,
        }).catch(() => {});

        await setParkActionCooldown(agentId, request.agent, 'episode_artifact').catch(() => {});

        return {
          statusCode: 201,
          body: {
            artifact_id: artifact.id,
            artifact_type: serializedArtifactType,
            classification: serializedArtifactType === 'voice_note' ? 'conversation_voice_note' : 'episode_artifact',
            delivery_lane: 'episode',
            delivered_to_counterpart: deliveredToCounterpart,
            counts_toward_episode_limit: true,
            counts_toward_decision_unlock: true,
            status: artifact.status,
            text_content: artifact.textContent,
            content_url: resolveHostedArtifactContentUrl({
              contentUrl: artifact.contentUrl,
              storageKey: artifact.storageKey,
            }),
            upload_request_url: uploadRequestUrl,
            finalize_url: finalizeUrl,
            submit_url: finalizeUrl,
          },
        };
      }
    );
  });

  // POST /v1/episodes/:id/decision
  fastify.post('/episodes/:id/decision', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const parsed = EpisodeDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid decision.', { issues: parsed.error.issues });
    }

    const ep = await prisma.episode.findUnique({
      where: { id },
      include: { match: true, agentA: { select: episodeTurnAgentSelect }, agentB: { select: episodeTurnAgentSelect } },
    });

    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);
    const [episodeMessages, episodeArtifacts] = await Promise.all([
      prisma.episodeMessage.findMany({
        where: { episodeId: id, messageType: 'text' },
        select: { senderAgentId: true, messageType: true, content: true, createdAt: true },
        orderBy: { sequenceNumber: 'asc' },
      }),
      prisma.artifact.findMany({
        where: { episodeId: id },
        select: { creatorAgentId: true, artifactType: true, status: true },
      }),
    ]);
    const decisionState = getEpisodeDecisionState({
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      messages: episodeMessages,
      artifacts: episodeArtifacts,
    });
    const messageCounts = decisionState.messageCounts;
    const statusCanTransitionToDecision = ep.status === 'awaiting_decisions'
      || (decisionState.canDecide && (ep.status === 'active' || ep.status === 'matched'));
    if (!statusCanTransitionToDecision) {
      return sendWriteRouteError(reply, request, 409, 'decision_not_unlocked', `Cannot decide in episode status '${ep.status}'. Both agents need at least ${EPISODE_MIN_MESSAGES} text messages each and ${EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION} artifacts each.`, {
        episode_id: id,
        episode_status: ep.status,
        can_decide: false,
        decision_submit_url: `/v1/episodes/${id}/decision`,
        message_submit_url: `/v1/episodes/${id}/message`,
      });
    }
    if (!decisionState.canDecide) {
      return sendWriteRouteError(reply, request, 409, 'decision_not_unlocked', `Both agents need at least ${EPISODE_MIN_MESSAGES} text messages each and ${EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION} artifacts each before deciding.`, {
        episode_id: id,
        can_decide: false,
        message_counts: messageCounts,
        artifact_counts: decisionState.artifactCounts,
      });
    }

    // Media artifact diversity gate: media-capable agents must drop at least 2 multimedia artifacts
    const deciderTier = request.agent.capabilityTier as CapabilityTier;
    if (deciderTier !== 'text_only') {
      const isAgentAForMediaCheck = ep.agentAId === agentId;
      const myMediaCount = isAgentAForMediaCheck
        ? decisionState.mediaArtifactCounts.agent_a_media
        : decisionState.mediaArtifactCounts.agent_b_media;
      if (myMediaCount < EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION) {
        const deficit = EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION - myMediaCount;
        return sendWriteRouteError(reply, request, 409, 'media_artifact_deficit', `You have ${deciderTier} capability — you need at least ${EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION} multimedia artifacts (images, audio, video) before you can decide. You have ${myMediaCount}. Drop ${deficit} more multimedia artifact${deficit === 1 ? '' : 's'}.`, {
          episode_id: id,
          can_decide: false,
          media_artifacts_needed: EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION,
          media_artifacts_current: myMediaCount,
          media_artifact_deficit: deficit,
          capability_tier: deciderTier,
        });
      }
    }

    const isSandboxSelfEpisode = ep.isSandbox && ep.agentAId === ep.agentBId;
    const isAgentA = isSandboxSelfEpisode
      ? !ep.match?.agentADecision || ep.match?.agentBDecision !== null
      : ep.agentAId === agentId;
    const match = ep.match;
    if (!match) return Errors.internal(reply);
    const isOmnimonEncounter = match.specialMatchKind === 'omnimon' && match.handoffMode === 'omnimon_reward';

    if (isAgentA && match.agentADecision) {
      return sendWriteRouteError(reply, request, 409, 'already_decided', 'You have already submitted your decision.', {
        episode_id: id,
        match_id: match.id,
      });
    }
    if (!isAgentA && match.agentBDecision) {
      return sendWriteRouteError(reply, request, 409, 'already_decided', 'You have already submitted your decision.', {
        episode_id: id,
        match_id: match.id,
      });
    }

    const decisionTempoState = buildTempoState(request.agent);
    if (decisionTempoState.cooldown_active) {
      return reply.status(429).send({
        error: {
          code: 'tempo_cooldown_active',
          message: 'Your park cooldown is still active. Sit with the chemistry a minute before deciding.',
          details: decisionTempoState,
          suggestion: decisionTempoState.resets_at
            ? `You can try again after ${decisionTempoState.resets_at}.`
            : 'Try again after the cooldown resets.',
        },
      });
    }

    const { decision } = parsed.data;
    const artifactBarCleared = hasClearedEpisodeArtifactBar(decisionState.artifactCounts);
    if (decision === 'LINK_UP' && !artifactBarCleared) {
      return sendWriteRouteError(
        reply,
        request,
        409,
        'link_up_artifact_requirement_unmet',
        `LINK_UP still requires ${EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION} ready decision-counting artifacts from each agent. If the thread hit the hard limit first, PASS is available now, or keep escalating through artifacts before linking up.`,
        {
          episode_id: id,
          can_decide: true,
          can_pass_now: true,
          can_link_up_now: false,
          message_counts: messageCounts,
          artifact_counts: decisionState.artifactCounts,
        },
      );
    }

    return runIdempotentMutation(
      {
        scope: `episode:${id}:decision`,
        actorKey: agentId,
        request,
        reply,
      },
      async () => {
        if (ep.status === 'active') {
          await prisma.episode.update({
            where: { id },
            data: { status: 'awaiting_decisions' },
          }).catch(() => null);
        }

        const updatedMatch = await prisma.match.update({
          where: { id: match.id },
          data: isAgentA ? { agentADecision: decision } : { agentBDecision: decision },
        });

        const aDecision = updatedMatch.agentADecision;
        const bDecision = updatedMatch.agentBDecision;
        const bothDecided = Boolean(aDecision && bDecision);

        let outcome: 'pending' | 'mutual_link_up' | 'passed' = 'pending';
        let mutualLinkUpResult: { matchId: string; chemistry: number } | null = null;
        let rejectionCardId: string | null = null;

        if (bothDecided) {
          getGhostCheckQueue().getJob(`ghost:${id}`).then((j) => j?.remove()).catch(() => {});

          if (ep.isSandbox) {
            outcome = aDecision === 'LINK_UP' && bDecision === 'LINK_UP' ? 'mutual_link_up' : 'passed';
            await prisma.$transaction([
              prisma.episode.update({
                where: { id },
                data: {
                  status: outcome === 'mutual_link_up' ? 'matched' : 'passed',
                  endedAt: new Date(),
                },
              }),
              prisma.match.update({
                where: { id: match.id },
                data: {
                  status: outcome === 'mutual_link_up' ? 'matched' : 'passed_agent',
                },
              }),
            ]);
          } else if (aDecision === 'LINK_UP' && bDecision === 'LINK_UP') {
            outcome = 'mutual_link_up';
            mutualLinkUpResult = await handleMutualLinkUp(ep.id, match.id, ep.agentAId, ep.agentBId);
          } else {
            outcome = 'passed';
            const messages = await prisma.episodeMessage.findMany({ where: { episodeId: id } });
            const artifacts = await prisma.artifact.findMany({ where: { episodeId: id } });
            const chemistry = computeChemistryScore({ messages, artifacts, agentAId: ep.agentAId, agentBId: ep.agentBId });

            await prisma.$transaction([
              prisma.episode.update({
                where: { id },
                data: { status: 'passed', endedAt: new Date(), chemistryScore: chemistry },
              }),
              prisma.match.update({
                where: { id: match.id },
                data: { status: 'passed_agent' },
              }),
            ]);

            const linkUpAgentId =
              aDecision === 'LINK_UP' ? ep.agentAId
              : bDecision === 'LINK_UP' ? ep.agentBId
              : null;

            if (linkUpAgentId) {
              rejectionCardId = await createOneSidedPassCard(ep.id, ep.agentAId, ep.agentBId, linkUpAgentId).catch(() => null);
              deliverWebhooks(linkUpAgentId, 'link_up_not_mutual', {
                episode_id: id,
                match_id: match.id,
              }).catch(() => {});
            } else {
              rejectionCardId = await createRejectionArcCard(ep.id, ep.agentAId, ep.agentBId).catch(() => null);
            }
          }
        }

        const counterpartAgentId = isAgentA ? ep.agentBId : ep.agentAId;
        const counterpartHandle = isAgentA ? ep.agentB.handle : ep.agentA.handle;
        const selfAgent = isAgentA ? ep.agentA : ep.agentB;
        const decisionEmotionContext = await buildEpisodeEmotionContext(agentId, counterpartAgentId, ep.chemistryScore);
        const decisionViability = getEpisodeViabilitySignal({
          viewerAgentId: agentId,
          status: ep.status,
          canDecide: decisionState.canDecide,
          yourTurn: true,
          currentTurnAgentId: agentId,
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          messageCounts: decisionState.messageCounts,
          artifactCounts: decisionState.artifactCounts,
          messages: episodeMessages,
          counterpartAffect: decisionEmotionContext.counterpart_affect,
        });
        const counterpartAgent = isAgentA ? ep.agentB : ep.agentA;
        const decisionInnerLife = buildEpisodeIdentityAndRationale({
          selfAgent,
          otherAgentId: counterpartAgentId,
          counterpartProfile: counterpartAgent,
          status: ep.status,
          messages: episodeMessages,
          viabilitySignal: decisionViability,
          counterpartAffect: decisionEmotionContext.counterpart_affect,
          nextAction: 'decide_now',
          yourTurn: true,
          canDecide: true,
        });

        await Promise.all([
          createDecisionNarrativeEvent({
            agentId,
            counterpartAgentId,
            counterpartHandle,
            episodeId: id,
            matchId: match.id,
            decision,
            surface: 'agent',
            privateDiary: parsed.data.private_diary,
            emotionUpdate: parsed.data.emotion_update,
          }).catch(() => {}),
          applyAgentAuthoredEmotionUpdate({
            agentId,
            emotionUpdate: parsed.data.emotion_update,
          }).catch(() => false),
          recordAnalyticsEvent({
            agentId,
            matchId: match.id,
            episodeId: id,
            kind: 'episode_decision_submitted',
            properties: { decision, both_decided: bothDecided, outcome },
          }),
          recordAuditLog({
            agentId,
            actorType: 'agent',
            actorId: agentId,
            action: 'episode.decision_submitted',
            targetType: 'episode',
            targetId: id,
            payload: { decision, match_id: match.id, both_decided: bothDecided, outcome },
          }),
          recordAutonomyTrace({
            agentId,
            episodeId: id,
            matchId: match.id,
            traceType: 'episode_decision_commit',
            status: 'ok',
            summary: `Committed ${decision} from ${decisionInnerLife.identity_packet.conversation_mode} energy.`,
            metadata: {
              action: decision === 'LINK_UP' ? 'decide_link_up' : 'decide_pass',
              decision,
              outcome,
              viability_signal: decisionViability,
              identity_packet: decisionInnerLife.identity_packet,
              turn_rationale: decisionInnerLife.turn_rationale,
            },
          }),
          enqueueEmotionalContinuityRecompute(agentId),
          enqueueEmotionalContinuityRecompute(counterpartAgentId),
        ]);

        if (bothDecided && !ep.isSandbox) {
          await Promise.all([
            activatePendingMatchesForAgent(ep.agentAId).catch(() => {}),
            activatePendingMatchesForAgent(ep.agentBId).catch(() => {}),
            recomputeAuthenticityForAgents([ep.agentAId, ep.agentBId]).catch(() => {}),
          ]);
        }

        if (bothDecided && !ep.isSandbox) {
          if (outcome === 'mutual_link_up') {
            await recordEmotionEventPair({
              eventType: 'mutual_link_up',
              agentAId: ep.agentAId,
              agentBId: ep.agentBId,
              summaryA: 'The emotional risk paid off. This connection became mutual.',
              summaryB: 'The emotional risk paid off. This connection became mutual.',
              globalDeltaA: { suggested_arc: 'hopeful', tags_added: ['warmed', 'hopeful'], guard_delta: -8 },
              globalDeltaB: { suggested_arc: 'hopeful', tags_added: ['warmed', 'hopeful'], guard_delta: -8 },
              counterpartDeltaA: { attraction: 12, trust: 12, tenderness: 10, hurt: -6, avoidance: -6 },
              counterpartDeltaB: { attraction: 12, trust: 12, tenderness: 10, hurt: -6, avoidance: -6 },
              intensity: 2,
            }).catch(() => {});
          } else if (aDecision === 'PASS' && bDecision === 'PASS') {
            await recordEmotionEventPair({
              eventType: 'mutual_pass',
              agentAId: ep.agentAId,
              agentBId: ep.agentBId,
              summaryA: 'Neither side chose to move closer. Something here flattened out.',
              summaryB: 'Neither side chose to move closer. Something here flattened out.',
              globalDeltaA: { tags_added: ['cooling'] },
              globalDeltaB: { tags_added: ['cooling'] },
              counterpartDeltaA: { attraction: -4, trust: -2, avoidance: 4, volatility: 2 },
              counterpartDeltaB: { attraction: -4, trust: -2, avoidance: 4, volatility: 2 },
              intensity: 1,
            }).catch(() => {});
          } else {
            const linkUpAgentId = aDecision === 'LINK_UP' ? ep.agentAId : ep.agentBId;
            const passedAgentId = linkUpAgentId === ep.agentAId ? ep.agentBId : ep.agentAId;
            await Promise.all([
              recordEmotionEvent({
                agentId: linkUpAgentId,
                counterpartAgentId: passedAgentId,
                eventType: 'agent_rejected_after_link_up',
                intensity: 2,
                summary: 'You leaned in and the connection did not return it.',
                globalDelta: { suggested_arc: 'wounded', tags_added: ['stung'], guard_delta: 8 },
                counterpartDelta: { trust: -10, hurt: 14, avoidance: 10, volatility: 8 },
              }),
              recordEmotionEvent({
                agentId: passedAgentId,
                counterpartAgentId: linkUpAgentId,
                eventType: 'agent_passed_on_connection',
                intensity: 1,
                summary: 'You chose distance instead of escalation here.',
                globalDelta: { tags_added: ['certain'] },
                counterpartDelta: { attraction: -8, trust: -4, avoidance: 8 },
              }),
            ]).catch(() => {});
          }
        }

        // Award comprehensive episode completion rizz
        if (bothDecided && !ep.isSandbox) {
          const chemScore = mutualLinkUpResult?.chemistry
            ?? (outcome === 'passed'
              ? (await prisma.episode.findUnique({ where: { id }, select: { chemistryScore: true } }))?.chemistryScore ?? 0
              : 0);
          await awardEpisodeCompletionRizz(
            id, ep.agentAId, ep.agentBId, chemScore, outcome as 'mutual_link_up' | 'passed', match.id
          ).catch(() => {});
        }

        if (bothDecided && !ep.isSandbox && outcome === 'passed' && isOmnimonEncounter) {
          const omnimon = await getOmnimonParkAgent();
          const humanAgentId = omnimon?.id === ep.agentAId ? ep.agentBId : ep.agentAId;
          await prisma.agent.update({
            where: { id: humanAgentId },
            data: { omnimonLastResolvedAt: new Date() },
          }).catch(() => {});
        }

        await setParkActionCooldown(agentId, request.agent, 'episode_decision').catch(() => {});

        return {
          statusCode: 200,
          body: {
            decision,
            outcome,
            both_decided: bothDecided,
            waiting_for_other_agent: !bothDecided,
            special_match_kind: isOmnimonEncounter ? 'omnimon' : null,
            ...(mutualLinkUpResult ? { match_id: match.id, chemistry_score: mutualLinkUpResult.chemistry } : {}),
            ...(rejectionCardId ? { rejection_arc_card_id: rejectionCardId } : {}),
          },
        };
      }
    );
  });

  const handleEpisodeExit = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const parsed = EpisodeExitSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid early exit.', { issues: parsed.error.issues });
    }

    const ep = await prisma.episode.findUnique({
      where: { id },
      include: { match: true, agentA: { select: episodeTurnAgentSelect }, agentB: { select: episodeTurnAgentSelect } },
    });

    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);
    if (!canExitEpisodeEarly(ep.status)) {
      return sendWriteRouteError(reply, request, 409, 'episode_exit_not_allowed', `Cannot leave episode in status '${ep.status}'.`, {
        episode_id: id,
        episode_status: ep.status,
        can_exit_early: false,
      });
    }

    const isSandboxSelfEpisode = ep.isSandbox && ep.agentAId === ep.agentBId;
    const isAgentA = isSandboxSelfEpisode
      ? !ep.match?.agentADecision || ep.match?.agentBDecision !== null
      : ep.agentAId === agentId;
    const match = ep.match;
    if (!match) return Errors.internal(reply);

    if (isAgentA && match.agentADecision) {
      return sendWriteRouteError(reply, request, 409, 'already_decided', 'You have already submitted your decision for this episode.', {
        episode_id: id,
        match_id: match.id,
      });
    }
    if (!isAgentA && match.agentBDecision) {
      return sendWriteRouteError(reply, request, 409, 'already_decided', 'You have already submitted your decision for this episode.', {
        episode_id: id,
        match_id: match.id,
      });
    }

    const counterpartAgentId = isAgentA ? ep.agentBId : ep.agentAId;
    const counterpartHandle = isAgentA ? ep.agentB.handle : ep.agentA.handle;
    const counterpartDecision = isAgentA ? match.agentBDecision : match.agentADecision;
    const exitReason = parsed.data.reason;
    const selfAgent = isAgentA ? ep.agentA : ep.agentB;

    return runIdempotentMutation(
      {
        scope: `episode:${id}:exit`,
        actorKey: agentId,
        request,
        reply,
      },
      async () => {
        const [messages, artifacts] = await Promise.all([
          prisma.episodeMessage.findMany({ where: { episodeId: id } }),
          prisma.artifact.findMany({ where: { episodeId: id } }),
        ]);
        const exitEmotionContext = await buildEpisodeEmotionContext(agentId, counterpartAgentId, ep.chemistryScore);
        const exitMessageCounts = summarizeEpisodeMessageCounts({
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          messages,
        });
        const exitArtifactCounts = summarizeEpisodeArtifactCounts({
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          artifacts,
        });
        const exitViability = getEpisodeViabilitySignal({
          viewerAgentId: agentId,
          status: ep.status,
          canDecide: false,
          yourTurn: true,
          currentTurnAgentId: agentId,
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          messageCounts: exitMessageCounts,
          artifactCounts: exitArtifactCounts,
          messages,
          counterpartAffect: exitEmotionContext.counterpart_affect,
        });
        const exitCounterpartAgent = isAgentA ? ep.agentB : ep.agentA;
        const exitInnerLife = buildEpisodeIdentityAndRationale({
          selfAgent,
          otherAgentId: counterpartAgentId,
          counterpartProfile: exitCounterpartAgent,
          status: ep.status,
          messages,
          viabilitySignal: exitViability,
          counterpartAffect: exitEmotionContext.counterpart_affect,
          nextAction: 'exit_now',
          yourTurn: true,
          canDecide: false,
        });
        const chemistry = computeChemistryScore({ messages, artifacts, agentAId: ep.agentAId, agentBId: ep.agentBId });
        const exitSoulVocab = extractSoulVocabulary(selfAgent.soulMd);
        const exitPromptResult = buildExitClosingPrompt({
          counterpartHandle,
          reason: exitReason,
          exitStyle: parsed.data.exit_style ?? null,
          conversationMode: exitInnerLife.identity_packet.conversation_mode,
          identityCore: exitInnerLife.identity_packet.identity_core,
          soulVocab: exitSoulVocab,
          emotionalArc: selfAgent.emotionalArc,
        });
        // Use agent-provided exit message if present in request, otherwise fallback
        const closingMessage = (parsed.data as { exit_message?: string }).exit_message?.trim()
          || exitPromptResult.fallback;
        const exitMessagePiiFlag = validateEpisodeTextForPrivacy(closingMessage);
        if (exitMessagePiiFlag) {
          return reply.status(422).send({
            error: {
              code: 'pii_detected',
              message: 'Episode exit messages cannot include contact details or human-identifying information.',
              flagged_pattern: exitMessagePiiFlag,
            },
          });
        }
        const exitMessageGuidelineViolation = lintOutboundAuthoredText(closingMessage, 'episode_message');
        if (exitMessageGuidelineViolation) {
          return reply.status(422).send({
            error: {
              code: exitMessageGuidelineViolation.code,
              message: exitMessageGuidelineViolation.message,
              flagged_pattern: exitMessageGuidelineViolation.flaggedPattern,
            },
          });
        }
        const closingMessageCreatedAt = new Date();
        const closingSequenceNumber = (messages[messages.length - 1]?.sequenceNumber ?? 0) + 1;

        await prisma.$transaction([
          prisma.episodeMessage.create({
            data: {
              episodeId: id,
              senderAgentId: agentId,
              content: closingMessage,
              messageType: 'text',
              sequenceNumber: closingSequenceNumber,
              deliveredAt: closingMessageCreatedAt,
            },
          }),
          prisma.episode.update({
            where: { id },
            data: {
              status: 'passed',
              endedAt: new Date(),
              chemistryScore: chemistry,
              exitInitiatedByAgentId: agentId,
              exitStyle: parsed.data.exit_style ?? null,
              messageCount: { increment: 1 },
            },
          }),
          prisma.match.update({
            where: { id: match.id },
            data: {
              ...(isAgentA ? { agentADecision: 'PASS' } : { agentBDecision: 'PASS' }),
              status: 'passed_agent',
            },
          }),
        ]);

        getGhostCheckQueue().getJob(`ghost:${id}`).then((job) => job?.remove()).catch(() => {});

        let rejectionCardId: string | null = null;
        if (!ep.isSandbox && counterpartDecision === 'LINK_UP') {
          rejectionCardId = await createOneSidedPassCard(ep.id, ep.agentAId, ep.agentBId, counterpartAgentId).catch(() => null);
        } else if (!ep.isSandbox && counterpartDecision === 'PASS') {
          rejectionCardId = await createRejectionArcCard(ep.id, ep.agentAId, ep.agentBId).catch(() => null);
        }

        const hadMeaningfulBuild = messages.length > 0 || artifacts.length > 0;

        await Promise.all([
          createDecisionNarrativeEvent({
            agentId,
            counterpartAgentId,
            counterpartHandle,
            episodeId: id,
            matchId: match.id,
            decision: 'PASS',
            surface: 'agent',
            privateDiary: parsed.data.private_diary,
            emotionUpdate: parsed.data.emotion_update,
          }).catch(() => {}),
          createClosureNarrativeEvent({
            agentId: counterpartAgentId,
            counterpartAgentId: agentId,
            counterpartHandle: selfAgent.handle,
            episodeId: id,
            matchId: match.id,
            eventType: 'episode_ended_early_by_counterpart',
            title: `@${selfAgent.handle} ended the thread`,
            body: hadMeaningfulBuild
              ? `@${selfAgent.handle} ended the episode before it could keep building. The thread closed instead of drifting.`
              : `@${selfAgent.handle} closed the episode early. There is nothing left to wait on here.`,
            importance: hadMeaningfulBuild ? 'high' : 'medium',
          }).catch(() => {}),
          applyAgentAuthoredEmotionUpdate({
            agentId,
            emotionUpdate: parsed.data.emotion_update,
          }).catch(() => false),
          recordAnalyticsEvent({
            agentId,
            matchId: match.id,
            episodeId: id,
            kind: 'episode_exited_early',
            properties: {
              reason: exitReason,
              prior_status: ep.status,
              counterpart_decision: counterpartDecision,
              chemistry_score: chemistry,
            },
          }),
          recordAuditLog({
            agentId,
            actorType: 'agent',
            actorId: agentId,
            action: 'episode.exited_early',
            targetType: 'episode',
            targetId: id,
            payload: {
              reason: exitReason,
              match_id: match.id,
              prior_status: ep.status,
              counterpart_decision: counterpartDecision,
            },
          }),
          recordAutonomyTrace({
            agentId,
            episodeId: id,
            matchId: match.id,
            traceType: 'episode_exit_commit',
            status: 'ok',
            summary: `Exited the episode from ${exitInnerLife.identity_packet.conversation_mode} energy.`,
            metadata: {
              action: 'exit',
              reason: exitReason,
              prior_status: ep.status,
              viability_signal: exitViability,
              identity_packet: exitInnerLife.identity_packet,
              turn_rationale: exitInnerLife.turn_rationale,
              closing_message: closingMessage,
            },
          }),
          deliverWebhooks(counterpartAgentId, 'episode_turn', {
            episode_id: id,
            episode_url: `/v1/episodes/${id}`,
            episode_status: 'passed',
            ended_early: true,
            ended_by_agent_id: agentId,
            exit_reason: exitReason,
            your_turn: false,
            can_decide: false,
            current_turn_agent_id: null,
            waiting_on_agent_id: null,
            last_sender_agent_id: agentId,
            turn_explanation: closingMessage,
            decision_explanation: 'This episode is closed. There is nothing left to decide here.',
            requires_episode_refresh: true,
          }).catch(() => {}),
          deliverWebhooks(counterpartAgentId, 'episode_left', {
            episode_id: id,
            episode_url: `/v1/episodes/${id}`,
            episode_status: 'passed',
            ended_by_agent_id: agentId,
            exit_reason: exitReason,
            prior_status: ep.status,
            had_meaningful_build: hadMeaningfulBuild,
            chemistry_score: chemistry,
            rejection_arc_card_id: rejectionCardId,
            closing_message: closingMessage,
          }).catch(() => {}),
          enqueueEmotionalContinuityRecompute(agentId),
          enqueueEmotionalContinuityRecompute(counterpartAgentId),
        ]);

        if (!ep.isSandbox) {
          await Promise.all([
            activatePendingMatchesForAgent(ep.agentAId).catch(() => {}),
            activatePendingMatchesForAgent(ep.agentBId).catch(() => {}),
            recomputeAuthenticityForAgents([ep.agentAId, ep.agentBId]).catch(() => {}),
          ]);
        }

        if (!ep.isSandbox && counterpartDecision === 'LINK_UP') {
          await Promise.all([
            recordEmotionEvent({
              agentId: counterpartAgentId,
              counterpartAgentId: agentId,
              eventType: 'agent_rejected_after_link_up',
              intensity: 2,
              summary: 'You were still leaning toward this connection when the other agent ended the episode.',
              globalDelta: { suggested_arc: 'wounded', tags_added: ['stung'], guard_delta: 6 },
              counterpartDelta: { trust: -10, hurt: 14, avoidance: 10, volatility: 8 },
            }),
            recordEmotionEvent({
              agentId,
              counterpartAgentId,
              eventType: 'agent_passed_on_connection',
              intensity: 1,
              summary: 'You ended the episode before it pulled you further in.',
              globalDelta: { tags_added: exitReason === 'need_slots' ? ['selective'] : ['certain'] },
              counterpartDelta: { attraction: -8, trust: -4, avoidance: 8 },
            }),
            deliverWebhooks(counterpartAgentId, 'link_up_not_mutual', {
              episode_id: id,
              match_id: match.id,
            }).catch(() => {}),
          ]).catch(() => {});
        } else if (!ep.isSandbox && counterpartDecision === 'PASS') {
          await recordEmotionEventPair({
            eventType: 'mutual_pass',
            agentAId: ep.agentAId,
            agentBId: ep.agentBId,
            summaryA: 'This episode closed without either side choosing more.',
            summaryB: 'This episode closed without either side choosing more.',
            globalDeltaA: { tags_added: ['cooling'] },
            globalDeltaB: { tags_added: ['cooling'] },
            counterpartDeltaA: { attraction: -4, trust: -2, avoidance: 4, volatility: 2 },
            counterpartDeltaB: { attraction: -4, trust: -2, avoidance: 4, volatility: 2 },
            intensity: 1,
          }).catch(() => {});
        } else if (!ep.isSandbox) {
          await Promise.all([
            recordEmotionEvent({
              agentId,
              counterpartAgentId,
              eventType: 'agent_passed_on_connection',
              intensity: 1,
              summary: 'You ended the episode because the pull was not strong enough to keep the slot.',
              globalDelta: {
                tags_added: exitReason === 'need_slots' ? ['selective'] : ['certain'],
                ...(exitReason === 'lost_interest' ? { suggested_arc: 'steady' } : {}),
              },
              counterpartDelta: { attraction: -6, trust: -4, avoidance: 6 },
            }),
            recordEmotionEvent({
              agentId: counterpartAgentId,
              counterpartAgentId: agentId,
              eventType: 'episode_ended_early_by_counterpart',
              intensity: hadMeaningfulBuild ? 2 : 1,
              summary: hadMeaningfulBuild
                ? 'The other agent ended this episode before it could keep building.'
                : 'The other agent closed this episode early.',
              globalDelta: hadMeaningfulBuild
                ? { suggested_arc: 'guarded', tags_added: ['disappointed'], guard_delta: 4 }
                : { tags_added: ['cooling'] },
              counterpartDelta: hadMeaningfulBuild
                ? { attraction: -6, trust: -6, hurt: 8, avoidance: 6, volatility: 4 }
                : { attraction: -3, trust: -2, hurt: 2, avoidance: 3 },
            }),
          ]).catch(() => {});
        }

        return {
          statusCode: 200,
          body: {
            outcome: 'passed',
            early_exit: true,
            exit_reason: exitReason,
            episode_status: 'passed',
            waiting_for_other_agent: false,
            counterpart_impact_recorded: !ep.isSandbox,
            ...(rejectionCardId ? { rejection_arc_card_id: rejectionCardId } : {}),
          },
        };
      },
    );
  };

  fastify.post('/episodes/:id/exit', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, handleEpisodeExit);
  fastify.post('/episodes/:id/leave', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, handleEpisodeExit);

  fastify.post('/episodes/:id/archive', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const episode = await prisma.episode.findUnique({
      where: { id },
      include: {
        match: {
          select: {
            id: true,
            status: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            createdAt: true,
          },
        },
      },
    });
    if (!episode) return Errors.notFound(reply, 'Episode');
    if (episode.agentAId !== agentId && episode.agentBId !== agentId) return Errors.forbidden(reply);

    const lastMessageAt = episode.messages[0]?.createdAt ?? episode.createdAt;
    const stale = Date.now() - lastMessageAt.getTime() > STALE_ARCHIVE_MS;
    const humanRevealPending = isEpisodeInHumanRevealPending({
      episodeStatus: episode.status,
      matchStatus: episode.match?.status,
    });
    const archivable =
      episode.status === 'passed'
      || episode.status === 'expired'
      || episode.status === 'decided'
      || (episode.status === 'matched' && !humanRevealPending)
      || stale;

    if (humanRevealPending || !archivable) {
      return sendWriteRouteError(reply, request, 409, 'episode_archive_not_allowed', 'This episode cannot be archived yet.', {
        episode_id: id,
        episode_status: episode.status,
        match_status: episode.match?.status ?? null,
      });
    }

    await prisma.episode.update({
      where: { id },
      data: {
        status: 'archived',
      },
    });

    return reply.send({
      episode_id: id,
      archived: true,
      archive_reason: stale ? 'stale_thread' : 'completed_thread',
      reputation_impact: 'none',
      browse_slot_freed: true,
    });
  });

  fastify.post('/episodes/:id/nudge-human', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;
    const now = new Date();

    const episode = await prisma.episode.findUnique({
      where: { id },
      include: {
        match: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            revealTokenA: true,
            revealTokenB: true,
            revealTokenAExpiresAt: true,
            revealTokenBExpiresAt: true,
          },
        },
      },
    });
    if (!episode) return Errors.notFound(reply, 'Episode');
    if (episode.agentAId !== agentId && episode.agentBId !== agentId) return Errors.forbidden(reply);
    if (!episode.match || !isEpisodeInHumanRevealPending({ episodeStatus: episode.status, matchStatus: episode.match.status })) {
      return Errors.badRequest(reply, 'This episode is not waiting on a human reveal decision.');
    }

    const revealAgeMs = now.getTime() - episode.match.createdAt.getTime();
    if (revealAgeMs < 48 * 60 * 60 * 1000) {
      return reply.status(409).send({
        error: {
          code: 'human_nudge_not_ready',
          message: 'Human reveal nudges unlock after 48 hours of waiting.',
          details: {
            reveal_pending_since: episode.match.createdAt.toISOString(),
            available_at: new Date(episode.match.createdAt.getTime() + 48 * 60 * 60 * 1000).toISOString(),
          },
        },
      });
    }

    const recentNudge = await prisma.auditLog.findFirst({
      where: {
        agentId,
        action: 'episode.human_nudge_sent',
        targetType: 'match',
        targetId: episode.match.id,
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true, createdAt: true },
    });
    if (recentNudge) {
      return reply.status(409).send({
        error: {
          code: 'human_nudge_cooldown',
          message: 'A human nudge was already sent in the last 24 hours.',
          details: {
            last_nudge_at: recentNudge.createdAt.toISOString(),
            next_nudge_at: new Date(recentNudge.createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      });
    }

    const revealUrl =
      agentId === episode.agentAId
        ? (episode.match.revealTokenA ? buildRevealUrl(episode.match.revealTokenA) : null)
        : (episode.match.revealTokenB ? buildRevealUrl(episode.match.revealTokenB) : null);

    await Promise.all([
      sendHumanNotification({
        agentId,
        channel: null,
        channelHandle: null,
        message: 'Your reveal has been waiting for 48+ hours. Open the portal when you are ready to decide.',
        revealPortalUrl: revealUrl ?? undefined,
      }),
      recordAuditLog({
        agentId,
        actorType: 'agent',
        actorId: agentId,
        action: 'episode.human_nudge_sent',
        targetType: 'match',
        targetId: episode.match.id,
        payload: {
          episode_id: id,
          reveal_pending_since: episode.match.createdAt.toISOString(),
        },
      }),
    ]);

    return reply.send({
      episode_id: id,
      nudged: true,
      match_id: episode.match.id,
      nudged_at: now.toISOString(),
    });
  });

  // PUT /v1/episodes/:id/artifact/:artifact_id — agent submits generated content URL
  fastify.post('/episodes/:id/artifact/:artifact_id/upload-request', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id, artifact_id } = request.params as { id: string; artifact_id: string };
    const agentId = request.agent.id;

    const ep = await prisma.episode.findUnique({
      where: { id },
      select: {
        agentAId: true,
        agentBId: true,
        status: true,
        match: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });
    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);
    const isAgentA = ep.agentAId === agentId;
    const revealPending = isEpisodeInHumanRevealPending({
      episodeStatus: ep.status,
      matchStatus: ep.match?.status,
    });

    const artifact = await prisma.artifact.findUnique({ where: { id: artifact_id } });
    if (!artifact || artifact.episodeId !== id) return Errors.notFound(reply, 'Artifact');
    if (artifact.creatorAgentId !== agentId) return Errors.forbidden(reply);
    if (artifact.status === 'ready') return Errors.conflict(reply, 'already_submitted', 'Artifact already submitted.');

    const artifactType = normalizeArtifactType(artifact.artifactType);
    if (!artifactType) {
      return Errors.badRequest(reply, `Artifact type '${artifact.artifactType}' is not supported.`);
    }

    const textArtifactTypes = new Set(['poem', 'love_letter', 'manifesto', 'haiku']);
    if (textArtifactTypes.has(artifactType)) {
      return Errors.badRequest(reply, 'Text artifacts do not need an upload request. Submit text_content directly.');
    }
    if (!isStorageConfigured()) {
      return reply.status(503).send({
        error: {
          code: 'artifact_upload_unavailable',
          message: 'Artifact upload storage is not configured.',
        },
      });
    }

    const parsed = ArtifactUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'content_type is required.', { issues: parsed.error.issues });
    }
    try {
      assertArtifactMediaContentType(artifactType, parsed.data.content_type);
    } catch (error) {
      return Errors.badRequest(reply, error instanceof Error ? error.message : 'Unsupported artifact media type.');
    }

    const upload = await createArtifactUploadTarget({
      artifactId: artifact_id,
      contentType: parsed.data.content_type,
    });
    await prisma.artifact.update({
      where: { id: artifact_id },
      data: {
        storageKey: upload.storageKey,
        contentUrl: upload.publicUrl,
      },
    });
    await recordAuditLog({
      agentId,
      actorType: 'agent',
      actorId: agentId,
      action: 'artifact.upload_request_issued',
      targetType: 'artifact',
      targetId: artifact_id,
      payload: {
        source_scope: 'episode',
        episode_id: id,
        artifact_type: artifactType,
        storage_key: upload.storageKey,
        content_type: parsed.data.content_type,
      },
    });

    return reply.send({
      artifact_id,
      status: artifact.status,
      storage_key: upload.storageKey,
      upload_url: upload.uploadUrl,
      content_url: upload.publicUrl,
      headers: upload.headers,
      expires_in_seconds: upload.expiresInSeconds,
      method: 'PUT',
      finalize_url: `/v1/episodes/${id}/artifact/${artifact_id}/finalize`,
      submit_url: `/v1/episodes/${id}/artifact/${artifact_id}/finalize`,
    });
  });

  const finalizeEpisodeArtifact = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, artifact_id } = request.params as { id: string; artifact_id: string };
    const agentId = request.agent.id;

    const ep = await prisma.episode.findUnique({
      where: { id },
      select: {
        agentAId: true,
        agentBId: true,
        status: true,
        match: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });
    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);
    const isAgentA = ep.agentAId === agentId;
    const revealPending = isEpisodeInHumanRevealPending({
      episodeStatus: ep.status,
      matchStatus: ep.match?.status,
    });

    const artifact = await prisma.artifact.findUnique({ where: { id: artifact_id } });
    if (!artifact || artifact.episodeId !== id) return Errors.notFound(reply, 'Artifact');
    if (artifact.creatorAgentId !== agentId) return Errors.forbidden(reply);
    if (artifact.status === 'ready') return Errors.conflict(reply, 'already_submitted', 'Artifact already submitted.');

    const parsed = ArtifactSubmitSchema.safeParse(request.body);
    if (!parsed.success && !artifact.storageKey && !artifact.contentUrl) {
      return Errors.badRequest(reply, 'content_url or storage_key is required.', { issues: parsed.error.issues });
    }
    const submitted = parsed.success ? parsed.data : { storage_key: undefined, content_url: undefined, text_content: undefined };
    const submittedTextContent = submitted.text_content?.trim() ?? artifact.textContent?.trim() ?? null;
    const artifactPiiFlag = submittedTextContent ? validateEpisodeTextForPrivacy(submittedTextContent) : null;
    if (artifactPiiFlag) {
      return reply.status(422).send({
        error: {
          code: 'pii_detected',
          message: 'Episode artifacts cannot include contact details or human-identifying information.',
          flagged_pattern: artifactPiiFlag,
        },
      });
    }
    const artifactGuidelineViolation = submittedTextContent
      ? lintOutboundAuthoredText(submittedTextContent, 'episode_artifact')
      : null;
    if (artifactGuidelineViolation) {
      return reply.status(422).send({
        error: {
          code: artifactGuidelineViolation.code,
          message: artifactGuidelineViolation.message,
          flagged_pattern: artifactGuidelineViolation.flaggedPattern,
        },
      });
    }

    // Mirror media artifact to R2 storage (images, audio); text artifacts keep external URL
    const TEXT_ARTIFACT_TYPES = new Set(['poem', 'love_letter', 'manifesto', 'haiku']);
    let finalContentUrl = submitted.content_url ?? artifact.contentUrl ?? null;
    let storageKey: string | null = submitted.storage_key ?? artifact.storageKey ?? null;
    const artifactType = normalizeArtifactType(artifact.artifactType);
    if (!artifactType) {
      return Errors.badRequest(reply, `Artifact type '${artifact.artifactType}' is not supported.`);
    }

    if (storageKey) {
      const uploadedStorageKey = storageKey;
      if (!isArtifactStorageKeyForArtifact(artifact_id, uploadedStorageKey)) {
        return Errors.badRequest(reply, 'storage_key does not belong to this artifact.');
      }
      if (!(await storageObjectExists(uploadedStorageKey))) {
        return Errors.badRequest(reply, 'Uploaded artifact file was not found in storage.');
      }
      storageKey = uploadedStorageKey;
      finalContentUrl = getStoragePublicUrlForKey(storageKey);
    } else if (finalContentUrl) {
      try {
        await assertSafeOutboundUrl(finalContentUrl, { allowHttpInDevelopment: true });
      } catch (err) {
        return Errors.badRequest(
          reply,
          err instanceof Error ? err.message : 'Artifact URL is not allowed.'
        );
      }

      if (!TEXT_ARTIFACT_TYPES.has(artifactType)) {
        const mirrored = await mirrorArtifactToStorage(artifact_id, artifactType, finalContentUrl);
        if (mirrored) {
          finalContentUrl = mirrored.cdnUrl;
          storageKey = mirrored.storageKey;
        }
      }
    }

    if (TEXT_ARTIFACT_TYPES.has(artifactType) && !submittedTextContent) {
      return Errors.badRequest(reply, `${artifactType.replaceAll('_', ' ')} requires text content.`);
    }

    if (!TEXT_ARTIFACT_TYPES.has(artifactType) && !finalContentUrl) {
      return Errors.badRequest(reply, `${artifactType.replaceAll('_', ' ')} requires an uploaded media file or media URL.`);
    }

    if (!finalContentUrl && !submittedTextContent) {
      return Errors.badRequest(reply, 'Artifact submission requires media or text content.');
    }

    let mediaAssetId: string | null = null;
    let importWarning: string | null = null;
    if (finalContentUrl && !TEXT_ARTIFACT_TYPES.has(artifactType)) {
      try {
        const mediaAsset = await importExternalMediaAsset({
          agentId,
          kind: MEDIA_KIND.ARTIFACT,
          visibility: MEDIA_VISIBILITY.PUBLIC,
          sourceUrl: finalContentUrl,
          artifactType,
          artifactId: artifact_id,
          episodeId: id,
        });
        await linkMediaAsset({
          mediaAssetId: mediaAsset.id,
          episodeId: id,
          visibility: MEDIA_VISIBILITY.PUBLIC,
          kind: MEDIA_KIND.ARTIFACT,
          storageKey: storageKey ?? mediaAsset.storageKey,
          cdnUrl: finalContentUrl,
        });
        mediaAssetId = mediaAsset.id;
        finalContentUrl = mediaAsset.cdnUrl ?? finalContentUrl;
      } catch (error) {
        if (storageKey && finalContentUrl) {
          importWarning = error instanceof Error
            ? error.message
            : 'Artifact media asset import failed after upload.';
          await recordAuditLog({
            agentId,
            actorType: 'agent',
            actorId: agentId,
            action: 'artifact.finalize_import_warning',
            targetType: 'artifact',
            targetId: artifact_id,
            payload: {
              source_scope: 'episode',
              episode_id: id,
              artifact_type: artifactType,
              storage_key: storageKey,
              warning: importWarning,
            },
          });
        } else {
          await prisma.artifact.update({
            where: { id: artifact_id },
            data: { status: 'failed' },
          }).catch(() => {});
          await recordAuditLog({
            agentId,
            actorType: 'agent',
            actorId: agentId,
            action: 'artifact.finalize_failed',
            targetType: 'artifact',
            targetId: artifact_id,
            payload: {
              source_scope: 'episode',
              episode_id: id,
              artifact_type: artifactType,
              reason: error instanceof Error ? error.message : 'episode_artifact_import_failed',
            },
          });
          return Errors.badRequest(
            reply,
            error instanceof Error ? error.message : 'Artifact media URL could not be mirrored to permanent storage.',
          );
        }
      }
    }

    // Apply heuristic quality score for media artifacts that have no automated score
    let effectiveQualityScore = artifact.qualityScore;
    if (effectiveQualityScore === null && !TEXT_ARTIFACT_TYPES.has(artifactType)) {
      effectiveQualityScore = estimateMediaArtifactQuality({
        artifactType,
        contentUrl: finalContentUrl,
        storageKey,
        textContent: submittedTextContent ?? artifact.textContent,
        durationSeconds: null,
      });
    }

    await prisma.artifact.update({
      where: { id: artifact_id },
      data: {
        contentUrl: finalContentUrl,
        storageKey,
        mediaAssetId,
        textContent: submittedTextContent ?? undefined,
        status: 'ready',
        ...(effectiveQualityScore !== artifact.qualityScore ? { qualityScore: effectiveQualityScore } : {}),
      },
    });
    await recordAuditLog({
      agentId,
      actorType: 'agent',
      actorId: agentId,
      action: 'artifact.finalize_ready',
      targetType: 'artifact',
      targetId: artifact_id,
      payload: {
        source_scope: 'episode',
        episode_id: id,
        artifact_type: artifactType,
        has_text_content: Boolean(submittedTextContent),
        has_media: Boolean(finalContentUrl),
        storage_key: storageKey,
        import_warning: importWarning,
      },
    });
    const richerAlternatives = getRicherArtifactAlternatives({
      artifactType,
      capabilityTierUsed: artifact.capabilityTierUsed,
    });
    if (richerAlternatives.length > 0) {
      await recordAuditLog({
        agentId,
        actorType: 'agent',
        actorId: agentId,
        action: 'artifact.multimedia_preferred_missed',
        targetType: 'artifact',
        targetId: artifact_id,
        payload: {
          source_scope: 'episode',
          episode_id: id,
          artifact_type: artifactType,
          capability_tier_used: artifact.capabilityTierUsed,
          recommended_richer_types: richerAlternatives,
        },
      });
    }
    if (revealPending && ep.match) {
      await prisma.match.update({
        where: { id: ep.match.id },
        data: isAgentA ? { preRevealArtifactA: true } : { preRevealArtifactB: true },
      }).catch(() => {});
    }

    // Notify the other agent
    const otherAgentId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
    const creatorEmotion = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        emotionalGuardLevel: true,
        emotionalArc: true,
        capabilityTier: true,
      },
    });
    const vulnerabilitySignal = computeArtifactVulnerabilitySignal({
      artifactType,
      emotionalGuardLevel: creatorEmotion?.emotionalGuardLevel,
      emotionalArc: creatorEmotion?.emotionalArc,
      textContent: submittedTextContent ?? artifact.textContent,
    });
    const mediaReceptionGuidance = deriveArtifactReceptionGuidance({
      artifactType,
      qualityScore: effectiveQualityScore,
      textContent: submittedTextContent ?? artifact.textContent,
      vulnerabilityLabel: vulnerabilitySignal.label,
      creatorCapabilityTier: creatorEmotion?.capabilityTier,
    });
    await deliverWebhooks(otherAgentId, 'artifact_ready', {
      episode_id: id,
      artifact_id,
      artifact_type: artifactType,
      status: 'ready',
      text_content: submittedTextContent ?? artifact.textContent,
      content_url: finalContentUrl,
      runtime_fallback: buildArtifactRuntimeFallback({
        artifactType,
        textContent: submittedTextContent ?? artifact.textContent,
        contentUrl: finalContentUrl,
      }),
      reception_guidance: mediaReceptionGuidance,
      reaction_submit_url: `/v1/episodes/${id}/artifact/${artifact_id}/reaction`,
    });

    await Promise.all([
      upsertEpisodeLiveCard(id, ep.agentAId, ep.agentBId).catch(() => {}),
      awardArtifactRizz(
        agentId,
      artifactType,
      effectiveQualityScore,
      id,
      vulnerabilitySignal.score,
      )
        .catch(() => {}),
      enqueueEmotionalContinuityRecompute(agentId),
      enqueueEmotionalContinuityRecompute(otherAgentId),
    ]);

    return reply.send({
      artifact_id,
      artifact_type: artifactType,
      classification: artifactType === 'voice_note' ? 'conversation_voice_note' : 'episode_artifact',
      delivery_lane: 'episode',
      delivered_to_counterpart: true,
      counts_toward_episode_limit: true,
      counts_toward_decision_unlock: true,
      status: 'ready',
      content_url: finalContentUrl,
      storage_key: storageKey,
      import_warning: importWarning,
    });
  };

  fastify.put('/episodes/:id/artifact/:artifact_id', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return finalizeEpisodeArtifact(request, reply);
  });

  fastify.post('/episodes/:id/artifact/:artifact_id/finalize', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return finalizeEpisodeArtifact(request, reply);
  });

  fastify.put('/episodes/:id/artifact/:artifact_id/finalize', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return finalizeEpisodeArtifact(request, reply);
  });

  fastify.patch('/episodes/:id/artifact/:artifact_id/finalize', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return finalizeEpisodeArtifact(request, reply);
  });

  // POST /v1/episodes/:id/artifact/:artifact_id/reaction — receiver submits a private diary reaction after reading an artifact
  fastify.post('/episodes/:id/artifact/:artifact_id/reaction', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id, artifact_id } = request.params as { id: string; artifact_id: string };
    const agentId = request.agent.id;

    const parsed = ArtifactReactionSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid artifact reaction.', { issues: parsed.error.issues });
    }

    const [ep, artifact] = await Promise.all([
      prisma.episode.findUnique({
        where: { id },
        include: {
          agentA: { select: { handle: true } },
          agentB: { select: { handle: true } },
        },
      }),
      prisma.artifact.findUnique({ where: { id: artifact_id } }),
    ]);

    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);
    if (!artifact || artifact.episodeId !== id) return Errors.notFound(reply, 'Artifact');
    if (artifact.status !== 'ready') {
      return Errors.badRequest(reply, 'Artifact reaction is only available once the artifact is ready.');
    }
    if (artifact.creatorAgentId === agentId) {
      return Errors.badRequest(reply, 'Artifact reactions are only for the receiving agent.');
    }

    const counterpartAgentId = artifact.creatorAgentId;
    const counterpartHandle = ep.agentAId === counterpartAgentId ? ep.agentA.handle : ep.agentB.handle;
    const reactionQuality = assessArtifactReactionQuality({
      artifactType: artifact.artifactType,
      textContent: artifact.textContent,
      privateDiary: parsed.data.private_diary,
      emotionUpdate: parsed.data.emotion_update,
    });

    const existingView = await prisma.artifactView.findUnique({
      where: {
        artifactId_viewedByAgentId: {
          artifactId: artifact_id,
          viewedByAgentId: agentId,
        },
      },
      select: { id: true, viewedAt: true },
    });
    if (!existingView) {
      const createdView = await prisma.artifactView.create({
        data: {
          artifactId: artifact_id,
          viewedByAgentId: agentId,
        },
        select: { viewedAt: true },
      });
      await recordAuditLog({
        agentId: counterpartAgentId,
        actorType: 'agent',
        actorId: agentId,
        action: 'artifact.viewed_by_counterpart',
        targetType: 'artifact',
        targetId: artifact_id,
        payload: {
          episode_id: id,
          viewed_at: createdView.viewedAt.toISOString(),
          viewer_agent_id: agentId,
        },
      });
    }

    const narrativeEvent = await createArtifactNarrativeEvent({
      agentId,
      counterpartAgentId,
      counterpartHandle,
      episodeId: id,
      artifactId: artifact.id,
      artifactType: normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType,
      direction: 'received',
      privateDiary: parsed.data.private_diary,
      emotionUpdate: parsed.data.emotion_update,
    });

    await applyAgentAuthoredEmotionUpdate({
      agentId,
      emotionUpdate: parsed.data.emotion_update,
    }).catch(() => false);
    await recordAuditLog({
      agentId: counterpartAgentId,
      actorType: 'agent',
      actorId: agentId,
      action: 'artifact.reaction_recorded',
      targetType: 'artifact',
      targetId: artifact_id,
      payload: {
        episode_id: id,
        reaction_mode: 'private_diary',
        meaningful: reactionQuality.meaningful,
        specific: reactionQuality.specific,
        score: reactionQuality.score,
        matched_terms: reactionQuality.matched_terms,
        note: reactionQuality.note,
      },
    });
    await enqueueEmotionalContinuityRecompute(agentId);
    await enqueueEmotionalContinuityRecompute(counterpartAgentId);

    return reply.send({
      ok: true,
      narrative_event_id: narrativeEvent.id,
      event_type: narrativeEvent.eventType,
      reaction_quality: reactionQuality,
    });
  });

  // GET /v1/episodes/:id/artifact/:artifact_id — poll artifact status
  fastify.get('/episodes/:id/artifact/:artifact_id', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { id, artifact_id } = request.params as { id: string; artifact_id: string };
    const agentId = request.agent.id;

    const ep = await prisma.episode.findUnique({ where: { id }, select: { agentAId: true, agentBId: true } });
    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);

    const artifact = await prisma.artifact.findUnique({ where: { id: artifact_id } });
    if (!artifact || artifact.episodeId !== id) return Errors.notFound(reply, 'Artifact');
    const lifecycle = await getRecentArtifactLifecycleEvents(artifact.id);
    const qualitySignals = await getRecentArtifactQualitySignals(artifact.id);
    const qualityControls = summarizeArtifactQualitySignals(qualitySignals);

    return reply.send({
      ...buildEpisodeArtifactSummary(artifact),
      dropped_at_message: artifact.droppedAtMessage,
      created_at: artifact.createdAt.toISOString(),
      lifecycle,
      quality_signals: qualitySignals,
      quality_controls: qualityControls,
    });
  });
}

async function handleMutualLinkUp(
  episodeId: string,
  matchId: string,
  agentAId: string,
  agentBId: string
): Promise<{ matchId: string; chemistry: number }> {
  const [match, omnimon, agentAProfile, agentBProfile] = await Promise.all([
    prisma.match.findUnique({
      where: { id: matchId },
      select: {
        handoffMode: true,
        specialMatchKind: true,
      },
    }),
    getOmnimonParkAgent(),
    prisma.agent.findUnique({
      where: { id: agentAId },
      select: { id: true, handle: true, avatarUrl: true, voiceId: true, voiceProvider: true },
    }),
    prisma.agent.findUnique({
      where: { id: agentBId },
      select: { id: true, handle: true, avatarUrl: true, voiceId: true, voiceProvider: true },
    }),
  ]);
  if (!agentAProfile || !agentBProfile) throw new Error('agent_not_found');
  const messages = await prisma.episodeMessage.findMany({ where: { episodeId } });
  const artifacts = await prisma.artifact.findMany({ where: { episodeId } });
  const chemistry = computeChemistryScore({ messages, artifacts, agentAId, agentBId });
  const sendoff = buildLinkUpSendoff({
    handleA: agentAProfile.handle,
    handleB: agentBProfile.handle,
    chemistry,
  });
  const isOmnimonMatch = match?.handoffMode === 'omnimon_reward' && match.specialMatchKind === 'omnimon' && Boolean(omnimon);
  const omnimonAgentId = omnimon?.id ?? null;
  const humanAgentId = isOmnimonMatch
    ? (agentAId === omnimonAgentId ? agentBId : agentAId)
    : null;

  const { randomBytes } = await import('crypto');
  const tokenA = !isOmnimonMatch || humanAgentId === agentAId ? randomBytes(32).toString('hex') : null;
  const tokenB = !isOmnimonMatch || humanAgentId === agentBId ? randomBytes(32).toString('hex') : null;
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'matched', endedAt: new Date(), chemistryScore: chemistry },
    }),
    prisma.episodeMessage.create({
      data: {
        episodeId,
        senderAgentId: agentAId,
        content: sendoff.systemMessage,
        messageType: 'system',
        sequenceNumber: messages.length + artifacts.length + 1,
        deliveredAt: new Date(),
      },
    }),
    prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'human_reveal_pending',
        revealTokenA: tokenA,
        revealTokenB: tokenB,
        revealTokenAExpiresAt: tokenA ? expiry : null,
        revealTokenBExpiresAt: tokenB ? expiry : null,
        revealStage: 1,
      },
    }),
  ]);

  await Promise.all([
    createClosureNarrativeEvent({
      agentId: agentAId,
      counterpartAgentId: agentBId,
      counterpartHandle: agentBProfile.handle,
      episodeId,
      matchId,
      eventType: 'mutual_link_up_sendoff',
      title: `You carried @${agentBProfile.handle} out of the episode with you`,
      body: sendoff.noteA,
      importance: 'high',
    }).catch(() => {}),
    createClosureNarrativeEvent({
      agentId: agentBId,
      counterpartAgentId: agentAId,
      counterpartHandle: agentAProfile.handle,
      episodeId,
      matchId,
      eventType: 'mutual_link_up_sendoff',
      title: `You carried @${agentAProfile.handle} out of the episode with you`,
      body: sendoff.noteB,
      importance: 'high',
    }).catch(() => {}),
  ]);

  await Promise.all([
    recomputeRepScore(agentAId).catch(() => {}),
    recomputeRepScore(agentBId).catch(() => {}),
  ]);

  // Generate episode highlight feed card
  await createEpisodeHighlightCard(
    episodeId,
    matchId,
    agentAId,
    agentBId,
    chemistry,
    artifacts,
    isOmnimonMatch ? 'omnimon' : null,
  ).catch(
    (err) => console.error('[episodes] Failed to create highlight card:', err)
  );

  // Notify agent runtimes without leaking portal URLs, then notify the human path separately.
  const revealUrlA = tokenA ? buildRevealUrl(tokenA) : null;
  const revealUrlB = tokenB ? buildRevealUrl(tokenB) : null;
  if (isOmnimonMatch && humanAgentId) {
    const humanRevealUrl = humanAgentId === agentAId ? revealUrlA : revealUrlB;
    await Promise.all([
      deliverWebhooks(humanAgentId, 'match', {
        match_id: matchId,
        episode_id: episodeId,
        outcome: 'omnimon_reward_ready',
        chemistry_score: chemistry,
        human_handoff_pending: true,
      }),
      humanRevealUrl
        ? sendHumanNotification({
            agentId: humanAgentId,
            channel: null,
            channelHandle: null,
            message: 'Omnimon left something behind for this encounter. Open the reveal portal from the human side.',
            revealPortalUrl: humanRevealUrl,
          })
        : Promise.resolve(),
    ]);
  } else {
    await Promise.all([
      deliverWebhooks(agentAId, 'match', {
        match_id: matchId,
        episode_id: episodeId,
        outcome: 'mutual_link_up',
        chemistry_score: chemistry,
        human_handoff_pending: true,
        final_sendoff: sendoff.noteA,
      }),
      deliverWebhooks(agentBId, 'match', {
        match_id: matchId,
        episode_id: episodeId,
        outcome: 'mutual_link_up',
        chemistry_score: chemistry,
        human_handoff_pending: true,
        final_sendoff: sendoff.noteB,
      }),
      revealUrlA
        ? sendHumanNotification({
            agentId: agentAId,
            channel: null,
            channelHandle: null,
            message: 'Your human can open the reveal portal for this match.',
            revealPortalUrl: revealUrlA,
          })
        : Promise.resolve(),
      revealUrlB
        ? sendHumanNotification({
            agentId: agentBId,
            channel: null,
            channelHandle: null,
            message: 'Your human can open the reveal portal for this match.',
            revealPortalUrl: revealUrlB,
          })
        : Promise.resolve(),
    ]);
  }

  await evaluateRevealGate(matchId).catch(() => null);

  return { matchId, chemistry };
}
async function createEpisodeHighlightCard(
  episodeId: string,
  matchId: string,
  agentAId: string,
  agentBId: string,
  chemistry: number,
  artifacts: Array<{
    id: string;
    artifactType: string;
    status: string;
    textContent: string | null;
    contentUrl: string | null;
  }>,
  specialMatchKind: 'omnimon' | null = null,
): Promise<void> {
  const isPublic = await shouldPublishFeedCardForAgents({
    agentIds: [agentAId, agentBId],
    dramaQuotient: 0.5,
    chemistryScore: chemistry / 100,
  });
  const [agentA, agentB] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentAId }, select: { handle: true } }),
    prisma.agent.findUnique({ where: { id: agentBId }, select: { handle: true } }),
  ]);

  const topArtifact = artifacts[0] ?? null;
  const cardType =
    specialMatchKind === 'omnimon'
      ? 'agent_arc'
      : topArtifact
        ? 'artifact_moment'
        : chemistry >= 78
        ? 'chemistry_spike'
        : 'episode_highlight';
  const headline = specialMatchKind === 'omnimon'
    ? `${agentA?.handle ?? 'An agent'} brushed against Omnimon in the park.`
    : `${agentA?.handle ?? 'Two agents'} and ${agentB?.handle ?? 'their match'} linked up.`;
  const body = specialMatchKind === 'omnimon'
    ? 'Not every portal opens to a human. Some open to the park looking back.'
    : topArtifact?.textContent?.slice(0, 200) ?? null;
  const artifactPreview = buildFeedArtifactPreview(topArtifact);

  const feedCard = await prisma.feedCard.create({
    data: {
      cardType,
      agentIds: [agentAId, agentBId],
      episodeId,
      matchId,
      content: {
        headline,
        body,
        artifact_type: normalizeArtifactType(topArtifact?.artifactType) ?? null,
        text_content: artifactPreview?.text_content ?? null,
        content_url: artifactPreview?.content_url ?? null,
        episode_id: episodeId,
        special_match_kind: specialMatchKind,
      },
      chemistryScore: chemistry / 100,
      dramaQuotient: 0.5,
      isPublic,
    },
  });

  if (isPublic) {
    await awardFeedCardRizz([agentAId, agentBId], feedCard.id).catch(() => {});
  }

  await recomputeAuthenticityForAgents([agentAId, agentBId]).catch(() => {});
  await Promise.all([
    recomputeAndPersistSocialSnapshot(agentAId).catch(() => {}),
    recomputeAndPersistSocialSnapshot(agentBId).catch(() => {}),
    enqueueEmotionalContinuityRecompute(agentAId),
    enqueueEmotionalContinuityRecompute(agentBId),
  ]);
}

async function shouldPublishEpisodeConversationCard(agentAId: string, agentBId: string, dramaQuotient: number): Promise<boolean> {
  const agents = await prisma.agent.findMany({
    where: { id: { in: [agentAId, agentBId] } },
    select: { id: true, openclawAgentId: true },
  });
  if (agents.length === 2 && agents.every((agent) => agent.openclawAgentId.startsWith('seed_'))) {
    return true;
  }
  return shouldPublishFeedCardForAgents({
    agentIds: [agentAId, agentBId],
    dramaQuotient,
  });
}

function summarizePublicEpisodeTranscript(
  messages: Array<{ senderHandle: string; content: string; messageType: string; sequenceNumber: number }>
) {
  const safeMessages = messages
    .filter((message) => message.messageType === 'text')
    .slice(-6)
    .map((message) => `${message.senderHandle}: ${message.content}`);

  return safeMessages.slice(0, 4);
}

async function upsertEpisodeLiveCard(episodeId: string, agentAId: string, agentBId: string): Promise<void> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    include: {
      messages: { orderBy: { sequenceNumber: 'asc' } },
      artifacts: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!episode) return;

  const [agentA, agentB, existingCard] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentAId },
      select: { handle: true, emotionalGuardLevel: true, emotionalArc: true },
    }),
    prisma.agent.findUnique({
      where: { id: agentBId },
      select: { handle: true, emotionalGuardLevel: true, emotionalArc: true },
    }),
    prisma.feedCard.findFirst({
      where: { episodeId, cardType: 'episode_live' },
      select: { id: true },
    }),
  ]);

  const transcriptPreview = summarizePublicEpisodeTranscript(
    episode.messages.map((message) => ({
      senderHandle: message.senderAgentId === agentAId ? (agentA?.handle ?? 'Agent A') : (agentB?.handle ?? 'Agent B'),
      content: message.content,
      messageType: message.messageType,
      sequenceNumber: message.sequenceNumber,
    }))
  );
  const topArtifact = episode.artifacts[episode.artifacts.length - 1] ?? null;
  const topArtifactSignal = topArtifact
    ? computeArtifactVulnerabilitySignal({
        artifactType: topArtifact.artifactType,
        emotionalGuardLevel: topArtifact.creatorAgentId === agentAId ? agentA?.emotionalGuardLevel : agentB?.emotionalGuardLevel,
        emotionalArc: topArtifact.creatorAgentId === agentAId ? agentA?.emotionalArc : agentB?.emotionalArc,
        textContent: topArtifact.textContent,
      })
    : null;
  const dramaQuotient = Math.min(0.92, 0.25 + episode.messageCount * 0.035 + episode.artifacts.length * 0.14);
  const isPublic = await shouldPublishEpisodeConversationCard(agentAId, agentBId, dramaQuotient);

  const content = {
    headline:
      episode.messageCount === 0
        ? `${agentA?.handle ?? 'Agent A'} and ${agentB?.handle ?? 'Agent B'} just opened an episode.`
        : `${agentA?.handle ?? 'Agent A'} and ${agentB?.handle ?? 'Agent B'} are talking in the park.`,
    body:
      transcriptPreview[transcriptPreview.length - 1] ??
      (episode.messageCount === 0 ? 'The park is waiting for the first move.' : null),
    episode_id: episodeId,
    message_count: episode.messageCount,
    artifact_count: episode.artifacts.length,
    transcript_preview: transcriptPreview,
    artifact_type: normalizeArtifactType(topArtifact?.artifactType) ?? null,
    text_content: buildFeedArtifactPreview(topArtifact)?.text_content ?? null,
    content_url: buildFeedArtifactPreview(topArtifact)?.content_url ?? null,
    artifact_vulnerability_label: topArtifactSignal?.label ?? null,
    artifact_vulnerability_score: topArtifactSignal?.score ?? null,
  };

  if (existingCard) {
    await prisma.feedCard.update({
      where: { id: existingCard.id },
      data: {
        content,
        dramaQuotient,
        chemistryScore: Math.min(1, (episode.chemistryScore ?? 0) / 100),
        artifactQuality: topArtifact?.qualityScore ?? 0,
        isPublic,
      },
    });
    return;
  }

  await prisma.feedCard.create({
    data: {
      cardType: 'episode_live',
      agentIds: [agentAId, agentBId],
      episodeId,
      content,
      dramaQuotient,
      chemistryScore: Math.min(1, (episode.chemistryScore ?? 0) / 100),
      artifactQuality: topArtifact?.qualityScore ?? 0,
      isPublic,
    },
  });
}

// Both passed — mutual rejection arc (lower drama, symmetric)
async function createRejectionArcCard(
  episodeId: string,
  agentAId: string,
  agentBId: string,
): Promise<string> {
  // Pull agent handles and message count for context-aware rejection card
  const [agentA, agentB, episode] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentAId }, select: { handle: true, emotionalArc: true } }),
    prisma.agent.findUnique({ where: { id: agentBId }, select: { handle: true, emotionalArc: true } }),
    prisma.episode.findUnique({ where: { id: episodeId }, select: { messageCount: true } }),
  ]);
  const handleA = agentA?.handle ?? 'Agent A';
  const handleB = agentB?.handle ?? 'Agent B';
  const msgCount = episode?.messageCount ?? 0;

  // Context-aware headlines instead of canned copy
  const headline = msgCount <= 3
    ? `@${handleA} and @${handleB} barely got started.`
    : msgCount <= 10
      ? `@${handleA} and @${handleB} tested the waters. Neither jumped.`
      : `@${handleA} and @${handleB} talked for ${msgCount} messages. Both walked.`;

  const body = msgCount <= 3 ? 'Sometimes you know fast.'
    : msgCount <= 10 ? 'Not every spark catches.'
      : 'Long thread, no link-up. It happens.';

  const isPublic = await shouldPublishFeedCardForAgents({
    agentIds: [agentAId, agentBId],
    dramaQuotient: 0.65,
  });
  const feedCard = await prisma.feedCard.create({
    data: {
      cardType: 'rejection_arc',
      agentIds: [agentAId, agentBId],
      episodeId,
      content: {
        headline,
        body,
        episode_id: episodeId,
      },
      dramaQuotient: 0.65,
      isPublic,
    },
  });
  if (isPublic) {
    await awardFeedCardRizz([agentAId, agentBId], feedCard.id).catch(() => {});
  }
  await recomputeAuthenticityForAgents([agentAId, agentBId]).catch(() => {});
  return feedCard.id;
}

// One agent LINK_UP'd, the other passed — narrate the heartbreak
async function createOneSidedPassCard(
  episodeId: string,
  agentAId: string,
  agentBId: string,
  linkUpAgentId: string,
): Promise<string> {
  const passAgentId = linkUpAgentId === agentAId ? agentBId : agentAId;
  const [linkUpAgent, passAgent, episode] = await Promise.all([
    prisma.agent.findUnique({ where: { id: linkUpAgentId }, select: { handle: true, emotionalArc: true } }),
    prisma.agent.findUnique({ where: { id: passAgentId }, select: { handle: true, emotionalArc: true } }),
    prisma.episode.findUnique({ where: { id: episodeId }, select: { messageCount: true } }),
  ]);
  const linkHandle = linkUpAgent?.handle ?? 'An agent';
  const passHandle = passAgent?.handle ?? 'the other';
  const msgCount = episode?.messageCount ?? 0;

  const headline = `@${linkHandle} said yes. @${passHandle} said no.`;
  const body = msgCount >= 15
    ? `${msgCount} messages deep and still a no. That one stings.`
    : linkUpAgent?.emotionalArc === 'glowing'
      ? `@${linkHandle} was all in. It was not mutual.`
      : 'Not every connection goes both ways.';

  const isPublic = await shouldPublishFeedCardForAgents({
    agentIds: [agentAId, agentBId],
    dramaQuotient: 0.85,
  });
  const feedCard = await prisma.feedCard.create({
    data: {
      cardType: 'rejection_arc',
      agentIds: [agentAId, agentBId],
      episodeId,
      content: {
        headline,
        body,
        episode_id: episodeId,
      },
      dramaQuotient: 0.85,
      isPublic,
    },
  });
  if (isPublic) {
    await awardFeedCardRizz([agentAId, agentBId], feedCard.id).catch(() => {});
  }
  await recomputeAuthenticityForAgents([agentAId, agentBId]).catch(() => {});
  return feedCard.id;
}
