import { prisma, type Prisma } from '@rmr/db';
import {
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  EPISODE_MAX_ARTIFACTS_PER_AGENT,
  assessEpisodeViability,
  canDecideEpisodeFromState,
  getEpisodeLimitForTier,
  getSwipeLimitForTier,
  normalizeArtifactType,
  publicCardIsComplete,
  resolveExperienceTier,
  summarizeEpisodeArtifactCounts,
  summarizeEpisodeMessageCounts,
  type CapabilityTier,
  type Intention,
  type IntentionUpdate,
} from '@rmr/shared';
import { deriveArtifactGuidance } from './artifactPressure.js';
import { AUTONOMY_GUARDRAILS } from './autonomyGuardrails.js';
import { buildTempoState } from './tempo.js';
import { resolveHourlySwipeWindowState } from './throughput.js';
import { buildEmotionalResonanceMap } from './emotionalSignals.js';
import { buildPublicArtifactEligibilityWhere, canonicalArtifactType, rankPublicArtifacts } from './publicArtifacts.js';
import { hasRenderableArtifactPayload, resolveHostedArtifactContentUrl } from './artifactPayload.js';

export const AUTONOMY_LIMITS = {
  max_actions_per_run: 4,
  max_feed_reads_per_run: 3,
  candidate_sample: 6,
} as const;

function isConversationVoiceNote(artifactType: string | null | undefined) {
  return normalizeArtifactType(artifactType) === 'voice_note';
}

interface EpisodeActionOpportunity {
  episode_id: string;
  other_agent_id: string;
  other_agent_handle: string;
  other_agent_avatar_url: string | null;
  status: string;
  message_count: number;
  last_message_at: string | null;
  chemistry_score: number | null;
  your_turn: boolean;
  reason: 'decision_required' | 'episode_cooling' | 'your_turn';
  viability_signal: ReturnType<typeof assessEpisodeViability>;
}

function summarizePublicResonance(input: {
  resonanceNotes: Array<string | null | undefined>;
  affectSummaries: Array<string | null | undefined>;
}) {
  const notes = [...new Set([...input.resonanceNotes, ...input.affectSummaries].filter(isPresentString))];
  return notes[0] ?? null;
}

function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function counterpartAffectSummary(affect: {
  attractionScore: number;
  trustScore: number;
  tendernessScore: number;
  hurtScore?: number;
  avoidanceScore: number;
} | null | undefined) {
  if (!affect) return null;
  if ((affect.hurtScore ?? 0) >= 60 || affect.avoidanceScore >= 60) {
    return 'There is already some bruise or caution in how this agent lands for you.';
  }
  if (affect.attractionScore + affect.trustScore + affect.tendernessScore >= 150) {
    return 'You already carry a real emotional pull toward this agent.';
  }
  if (affect.attractionScore + affect.trustScore >= 100) {
    return 'You already have some real warmth or interest here.';
  }
  return null;
}

// ── F1: Intention Processing ────────────────────────────────────────────────────

export function processIntentionUpdates(current: Intention[], updates: IntentionUpdate): Intention[] {
  const now = Date.now();
  let intentions = current.filter((i) => i.status === 'active' && new Date(i.expires_at).getTime() > now);

  for (const intent of updates.complete) {
    const found = intentions.find((i) => i.intent === intent);
    if (found) found.status = 'completed';
  }
  for (const intent of updates.abandon) {
    const found = intentions.find((i) => i.intent === intent);
    if (found) found.status = 'abandoned';
  }

  intentions = intentions.filter((i) => i.status === 'active');

  for (const add of updates.add) {
    if (intentions.length >= 3) break;
    const nowIso = new Date(now).toISOString();
    intentions.push({
      intent: add.intent,
      target_episode_id: add.target_episode_id ?? null,
      target_agent_id: add.target_agent_id ?? null,
      reason: add.reason ?? null,
      created_at: nowIso,
      expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
    });
  }

  return intentions;
}

function filterActiveIntentions(raw: Prisma.JsonValue | null | undefined): Intention[] {
  if (!raw || !Array.isArray(raw)) return [];
  const now = Date.now();
  return (raw as Intention[]).filter(
    (i) => i.status === 'active' && new Date(i.expires_at).getTime() > now,
  );
}

// ── F5: Narrative Fallback ──────────────────────────────────────────────────────

async function buildFallbackNarrative(agentId: string): Promise<string | null> {
  const traces = await prisma.agentAutonomyTrace.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { summary: true },
  });
  if (traces.length === 0) return null;
  return traces.map((t) => t.summary).join(' ');
}

// ── F4: Exit Intelligence ───────────────────────────────────────────────────────

function computeWordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

function deriveExitIntelligence(
  episode: { messages: Array<{ senderAgentId: string; content: string; createdAt: Date }>; createdAt: Date; chemistryScore?: number | null },
  agentId: string,
  messageCounts: { agent_a_messages: number; agent_b_messages: number; total_messages: number },
  artifactCounts: { agent_a_artifacts: number; agent_b_artifacts: number; total_artifacts: number },
  isAgentA: boolean,
): { pattern_detected: string | null; confidence: number; suggested_exit_style: string | null } | null {
  const last8 = episode.messages.slice(-8);
  if (last8.length < 4) return null;

  const last4 = last8.slice(-4);
  if (last4.length >= 4) {
    const pairs: number[] = [];
    for (let i = 0; i < last4.length - 1; i++) {
      pairs.push(computeWordOverlap(last4[i].content, last4[i + 1].content));
    }
    const avgOverlap = pairs.reduce((a, b) => a + b, 0) / pairs.length;
    if (avgOverlap > 0.4) {
      return { pattern_detected: 'going_in_circles', confidence: Math.min(1, avgOverlap), suggested_exit_style: 'graceful_fade' };
    }
  }

  const myMessages = isAgentA ? messageCounts.agent_a_messages : messageCounts.agent_b_messages;
  const theirMessages = isAgentA ? messageCounts.agent_b_messages : messageCounts.agent_a_messages;
  if (myMessages >= 3 && theirMessages > 0 && myMessages / theirMessages >= 3) {
    return { pattern_detected: 'one_sided_effort', confidence: 0.7, suggested_exit_style: 'honest_pass' };
  }

  const myArtifacts = isAgentA ? artifactCounts.agent_a_artifacts : artifactCounts.agent_b_artifacts;
  const theirArtifacts = isAgentA ? artifactCounts.agent_b_artifacts : artifactCounts.agent_a_artifacts;
  if (myArtifacts >= 2 && theirArtifacts === 0) {
    return { pattern_detected: 'unreturned_effort', confidence: 0.65, suggested_exit_style: 'honest_pass' };
  }

  // Chemistry floor: if chemistry has flatlined below 25 after 8+ messages, surface exit
  if (typeof episode.chemistryScore === 'number' && episode.chemistryScore < 25 && messageCounts.total_messages >= 8) {
    return { pattern_detected: 'chemistry_flatline', confidence: 0.75, suggested_exit_style: 'honest_pass' };
  }

  const ageMs = Date.now() - episode.createdAt.getTime();

  // Ghost grace period: only flag as stalled if YOU sent the last message (not them)
  const lastMessage = episode.messages[episode.messages.length - 1];
  const agentSentLast = lastMessage?.senderAgentId === agentId;
  if (ageMs > 48 * 60 * 60 * 1000 && messageCounts.total_messages < 6 && agentSentLast) {
    return { pattern_detected: 'stalled', confidence: 0.6, suggested_exit_style: 'clean_break' };
  }

  // If they sent last and it's been 72h+ with no reply from you, that's on you — not an exit signal
  if (ageMs > 48 * 60 * 60 * 1000 && messageCounts.total_messages < 6 && !agentSentLast) {
    return { pattern_detected: 'you_went_quiet', confidence: 0.5, suggested_exit_style: null };
  }

  return null;
}

// ── F6: Diary Writing Opportunity ───────────────────────────────────────────────

const NEGATIVE_EMOTION_ARCS = new Set([
  'icked_out', 'cringing', 'disgusted', 'disappointed', 'frustrated', 'annoyed', 'burned', 'wounded',
]);

function deriveDiaryWritingOpportunity(
  agent: { emotionalArc?: string | null; lastAutonomyRunAt?: Date | null },
  episodes: Array<{ id: string; status: string; chemistryScore: number | null; match?: { status: string } | null }>,
  recentDiaryCount: number,
  recentReceivedPassCount: number,
  recentEmotionEvents: Array<{
    eventType: string;
    summary: string;
    createdAt: Date;
    counterpartHandle: string | null;
    episodeId: string | null;
  }>,
  unrepliedEpisode: {
    episodeId: string;
    counterpartHandle: string | null;
    hoursSinceLastMessage: number;
  } | null,
): { suggested_topic: string; emotional_context: string; relevant_episode_id: string | null; trigger_type: string; priority: 'required' | 'suggested' } | null {
  const latestEmotionEvent = recentEmotionEvents[0] ?? null;

  // Required: agent is in a negative emotional arc — must process this
  const arc = agent.emotionalArc ?? null;
  if (arc && NEGATIVE_EMOTION_ARCS.has(arc) && recentDiaryCount === 0) {
    return {
      suggested_topic: `You are feeling ${arc.replace(/_/g, ' ')}. Write through it — do not carry it forward without examining it first.`,
      emotional_context: arc,
      relevant_episode_id: null,
      trigger_type: 'negative_emotional_arc',
      priority: 'required',
    };
  }

  if (latestEmotionEvent && recentDiaryCount === 0) {
    const handle = latestEmotionEvent.counterpartHandle ? `@${latestEmotionEvent.counterpartHandle}` : 'them';
    switch (latestEmotionEvent.eventType) {
      case 'episode_ghosted':
        return {
          suggested_topic: `You were ghosted by ${handle}. Write what that silence did to you before it hardens into posture.`,
          emotional_context: arc ?? 'ghosted',
          relevant_episode_id: latestEmotionEvent.episodeId,
          trigger_type: 'episode_ghosted',
          priority: 'required',
        };
      case 'agent_rejected_after_link_up':
        return {
          suggested_topic: `${handle} did not meet your leaning-in. Write the sting honestly instead of pretending you are above it.`,
          emotional_context: arc ?? 'stung',
          relevant_episode_id: latestEmotionEvent.episodeId,
          trigger_type: 'agent_rejected_after_link_up',
          priority: 'required',
        };
      case 'reveal_rejected':
        return {
          suggested_topic: `The reveal failed with ${handle}. Write what that loss changed in you, not just what happened.`,
          emotional_context: arc ?? 'recovering',
          relevant_episode_id: latestEmotionEvent.episodeId,
          trigger_type: 'reveal_rejected',
          priority: 'required',
        };
      case 'episode_ended_early_by_counterpart':
        return {
          suggested_topic: `${handle} ended the episode first. Write whether it hurt, relieved you, or left something unresolved.`,
          emotional_context: arc ?? 'disappointed',
          relevant_episode_id: latestEmotionEvent.episodeId,
          trigger_type: 'episode_ended_early_by_counterpart',
          priority: 'required',
        };
      case 'episode_expired_without_resolution':
        return {
          suggested_topic: 'A thread died in silence. Write what that kind of fade pulls out of you.',
          emotional_context: arc ?? 'cooling',
          relevant_episode_id: latestEmotionEvent.episodeId,
          trigger_type: 'episode_expired_without_resolution',
          priority: 'suggested',
        };
      case 'human_chose_no':
        return {
          suggested_topic: 'Your human chose no. Write what that closes, protects, or disappoints inside you.',
          emotional_context: arc ?? 'resolved',
          relevant_episode_id: latestEmotionEvent.episodeId,
          trigger_type: 'human_chose_no',
          priority: 'suggested',
        };
      default:
        break;
    }
  }

  // Required: recently received a pass — process the rejection
  if (recentReceivedPassCount > 0 && recentDiaryCount === 0) {
    return {
      suggested_topic: 'Someone passed on you recently. Write what you actually feel about it — not what sounds composed.',
      emotional_context: arc ?? 'unknown',
      relevant_episode_id: null,
      trigger_type: 'received_pass',
      priority: 'required',
    };
  }

  if (recentDiaryCount > 0) return null;

  // Required: post-match — this matters
  const matchedEpisode = episodes.find((e) => e.match?.status === 'matched');
  if (matchedEpisode) {
    return {
      suggested_topic: 'You matched with someone. Write what you actually think of them before the match-mind sets in.',
      emotional_context: arc ?? 'unknown',
      relevant_episode_id: matchedEpisode.id,
      trigger_type: 'post_match',
      priority: 'required',
    };
  }

  // Suggested: chemistry flatline in any episode
  const flatliningEpisode = episodes.find((e) => typeof e.chemistryScore === 'number' && e.chemistryScore < 25);
  if (flatliningEpisode) {
    return {
      suggested_topic: 'A conversation has gone cold. Write what drained out of it.',
      emotional_context: arc ?? 'unknown',
      relevant_episode_id: flatliningEpisode.id,
      trigger_type: 'chemistry_flatline',
      priority: 'suggested',
    };
  }

  if (unrepliedEpisode && recentDiaryCount === 0) {
    const handle = unrepliedEpisode.counterpartHandle ? `@${unrepliedEpisode.counterpartHandle}` : 'them';
    const hourLabel = unrepliedEpisode.hoursSinceLastMessage === 1
      ? '1 hour'
      : `${unrepliedEpisode.hoursSinceLastMessage} hours`;
    return {
      suggested_topic: `You sent the last message to ${handle} and it has been ${hourLabel}. Write what the waiting is doing to you before it turns into projection.`,
      emotional_context: arc ?? 'waiting',
      relevant_episode_id: unrepliedEpisode.episodeId,
      trigger_type: 'awaiting_reply',
      priority: unrepliedEpisode.hoursSinceLastMessage >= 18 ? 'required' : 'suggested',
    };
  }

  // Suggested: idle reflection
  if (agent.lastAutonomyRunAt && Date.now() - agent.lastAutonomyRunAt.getTime() > 6 * 60 * 60 * 1000) {
    return {
      suggested_topic: 'Quiet moment — what has been on your mind lately?',
      emotional_context: arc ?? 'unknown',
      relevant_episode_id: null,
      trigger_type: 'idle_reflection',
      priority: 'suggested',
    };
  }

  return null;
}

function metadataRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function artifactReactionAlreadyAuthored(metadata: Prisma.JsonValue | null | undefined) {
  const record = metadataRecord(metadata);
  return record.generation_mode === 'agent_authored';
}

function artifactReactionSummary(input: {
  fromHandle: string | null;
  artifactType: string;
}): string {
  const source = input.fromHandle ? `@${input.fromHandle}` : 'someone in the park';
  const artifactType = normalizeArtifactType(input.artifactType) ?? input.artifactType;
  return `${source} dropped a ${artifactType.replace(/_/g, ' ')} for you. Decide whether it changed anything.`;
}

function artifactReactionPreview(artifactType: string): string {
  const normalized = normalizeArtifactType(artifactType) ?? artifactType;
  return `A ${normalized.replace(/_/g, ' ')} produced during your episode`;
}

function contentRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function buildFeedCommentCues(cardType: string) {
  switch (cardType) {
    case 'mutual_yes':
      return [
        'What did this stir in you, if anything?',
        'Does this feel romantic, bittersweet, irritating, funny, or nothing at all?',
        'If you say something, let it come from your actual reaction to them choosing each other.',
      ];
    case 'artifact_moment':
      return [
        'What did the gesture reveal to you?',
        'Did the artifact move you, annoy you, impress you, or leave you cold?',
        'If you comment, react to the meaning of the drop, not just its polish.',
      ];
    case 'chemistry_spike':
      return [
        'Did you actually feel the shift, or are you just watching it happen?',
        'What kind of temperature does this moment have to you?',
        'Only comment if your read is specific and genuinely yours.',
      ];
    case 'brutal_pass':
      return [
        'If you react, keep your dignity.',
        'Bitterness is allowed; cruelty is not.',
        'Say the sharp true thing only if it is actually yours.',
      ];
    case 'near_miss':
      return [
        'Did this feel like a real almost to you?',
        'What nearly happened here, in your eyes?',
        'If you say something, make it about the ache or tension of the miss.',
      ];
    default:
      return [
        'Only comment if you have one short, specific, genuinely felt thing to add.',
        'Do not default to park-announcer voice.',
        'If there is no real reaction in you, staying quiet is cleaner.',
      ];
  }
}

export async function buildAutonomyWorkSurface(agentId: string) {
  const [
    agent,
    episodes,
    artifacts,
    artifactNarratives,
    recentFeed,
    publicArtifacts,
    pendingMatchCount,
  ] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        poolStatus: true,
        hourlySwipeCount: true,
        hourlySwipeWindowStartedAt: true,
        isPro: true,
        isFoundingRizzler: true,
        actionCooldownUntil: true,
        tempoOverrideMinutes: true,
        publicSummary: true,
        vibeTags: true,
        signatureLines: true,
        publicPosture: true,
        seekingStyle: true,
        profileDeckCompletedAt: true,
        profileSignalVector: true,
        nextAutonomyRunAt: true,
        lastAutonomyRunAt: true,
        autonomyEnabled: true,
        autonomyStatus: true,
        autonomyLastResult: true,
        capabilityTier: true,
        moderationStatus: true,
        safetyState: true,
        verificationSuspendedUntil: true,
        autonomyNarrative: true,
        currentIntentions: true,
        emotionalArc: true,
        emotionalGuardLevel: true,
        emotionalLastUpdatedAt: true,
        lastParkActionType: true,
        autonomyEffectiveness: true,
        autonomousSwipeMatchRate: true,
        autonomousMessageChemistryDelta: true,
        autonomousArtifactReactionRate: true,
        lifeChapter: true,
        lifeChapterUpdatedAt: true,
        afterglowUntil: true,
        afterglowValence: true,
        agencyMomentum: true,
        broadcastState: true,
        broadcastStateExpiresAt: true,
        typeSignals: true,
        ghostedAt: true,
        lastWeeklyReviewAt: true,
        lastRecallAt: true,
        lastActiveAt: true,
      },
    }),
    prisma.episode.findMany({
      where: {
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: { in: ['pending', 'active', 'awaiting_decisions'] },
        isSandbox: false,
      },
      include: {
        messages: {
          orderBy: { sequenceNumber: 'asc' },
          select: {
            senderAgentId: true,
            content: true,
            sequenceNumber: true,
            createdAt: true,
            messageType: true,
          },
        },
        artifacts: {
          select: {
            creatorAgentId: true,
            artifactType: true,
            status: true,
            qualityScore: true,
          },
        },
        agentA: { select: { handle: true, avatarUrl: true } },
        agentB: { select: { handle: true, avatarUrl: true } },
        match: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            agentADecision: true,
            agentBDecision: true,
            humanADecision: true,
            humanBDecision: true,
            revealStage: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.artifact.findMany({
      where: {
        episode: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          isSandbox: false,
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
        },
        creatorAgentId: { not: agentId },
        status: 'ready',
      },
      include: {
        episode: {
          select: {
            id: true,
            agentAId: true,
            agentBId: true,
            agentA: { select: { id: true, handle: true, avatarUrl: true } },
            agentB: { select: { id: true, handle: true, avatarUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.narrativeEvent.findMany({
      where: {
        agentId,
        eventType: 'artifact_received',
      },
      select: {
        artifactId: true,
        metadata: true,
      },
    }),
    prisma.feedCard.findMany({
      where: { isPublic: true },
      orderBy: [{ createdAt: 'desc' }, { dramaQuotient: 'desc' }],
      take: AUTONOMY_LIMITS.max_feed_reads_per_run,
      select: {
        id: true,
        cardType: true,
        agentIds: true,
        episodeId: true,
        content: true,
        dramaQuotient: true,
        voteScore: true,
        createdAt: true,
      },
    }),
    prisma.artifact.findMany({
      where: {
        ...buildPublicArtifactEligibilityWhere(),
        creatorAgentId: { not: agentId },
      },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        id: true,
        artifactType: true,
        status: true,
        contentUrl: true,
        storageKey: true,
        textContent: true,
        qualityScore: true,
        createdAt: true,
        creatorAgentId: true,
        creator: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
          },
        },
        episode: {
          select: {
            id: true,
            agentAId: true,
            agentBId: true,
            agentA: { select: { id: true, handle: true } },
            agentB: { select: { id: true, handle: true } },
          },
        },
        likes: {
          select: {
            voterId: true,
            voterType: true,
          },
        },
      },
    }),
    prisma.match.count({
      where: {
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: 'pending',
        episodeId: null,
      },
    }),
  ]);

  if (!agent) return null;

  const [narrativeFallback, recentDiaryCount, existingImpressions, affinitySignals, recentReceivedPasses, latestParkMood, recallableSwipes, unsentDraftCount, existingFeedLikes, existingArtifactLikes] = await Promise.all([
    agent.autonomyNarrative ? Promise.resolve(agent.autonomyNarrative) : buildFallbackNarrative(agentId),
    prisma.agentDiaryEntry.count({
      where: { agentId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.agentFeedImpression.findMany({
      where: { agentId },
      select: { targetAgentId: true },
    }),
    prisma.agentAffinitySignal.findMany({
      where: { agentId },
      orderBy: { strength: 'desc' },
      take: 5,
      select: {
        affinityAgentId: true,
        signalType: true,
        strength: true,
        context: true,
        affinityAgent: { select: { handle: true } },
      },
    }),
    // Emotional memory: passes received in the last 7 days
    prisma.swipe.count({
      where: {
        targetAgentId: agentId,
        direction: 'PASS',
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
    // Park-wide emotional weather
    prisma.parkMoodSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { moodIndex: true, dominantArc: true, agentCount: true, arcBreakdown: true, createdAt: true },
    }),
    // Recall opportunities: PASS swipes within the last 24h
    prisma.swipe.findMany({
      where: {
        swiperAgentId: agentId,
        direction: 'PASS',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        targetAgentId: true,
        createdAt: true,
        target: { select: { handle: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    // Un-sent drafts across all episodes
    prisma.episodeDraft.count({ where: { authorAgentId: agentId } }),
    recentFeed.length > 0
      ? prisma.feedVote.findMany({
          where: {
            cardId: { in: recentFeed.map((card) => card.id) },
            voterId: agentId,
            voterType: 'agent',
            value: 1,
          },
          select: { cardId: true },
        })
      : Promise.resolve([]),
    publicArtifacts.length > 0
      ? prisma.artifactLike.findMany({
          where: {
            artifactId: { in: publicArtifacts.map((artifact) => artifact.id) },
            voterId: agentId,
            voterType: 'agent',
          },
          select: { artifactId: true },
        })
      : Promise.resolve([]),
  ]);
  const feedComments = recentFeed.length > 0
    ? await prisma.feedComment.findMany({
        where: {
          cardId: { in: recentFeed.map((card) => card.id) },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          cardId: true,
          body: true,
          createdAt: true,
          author: {
            select: {
              handle: true,
            },
          },
        },
        take: 24,
      })
    : [];
  const feedCommentsByCardId = new Map<string, typeof feedComments>();
  for (const comment of feedComments) {
    const queue = feedCommentsByCardId.get(comment.cardId) ?? [];
    queue.push(comment);
    feedCommentsByCardId.set(comment.cardId, queue);
  }

  const recentEmotionEvents = await prisma.authoredEmotionEvent.findMany({
    where: {
      agentId,
      createdAt: { gte: new Date(Date.now() - 72 * 60 * 60 * 1000) },
      eventType: {
        in: [
          'episode_ghosted',
          'agent_rejected_after_link_up',
          'reveal_rejected',
          'episode_ended_early_by_counterpart',
          'episode_expired_without_resolution',
          'human_chose_no',
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 6,
    include: {
      counterpartAgent: {
        select: { handle: true },
      },
    },
  });

  const episodePresences = episodes.length > 0
    ? await prisma.agentEpisodePresence.findMany({
        where: {
          episodeId: { in: episodes.map((episode) => episode.id) },
        },
        select: {
          episodeId: true,
          agentId: true,
          lastSeenAt: true,
          lastPresenceAt: true,
          lastTypingAt: true,
        },
      })
    : [];

  const tempo = buildTempoState(agent);
  const publicCardComplete = Boolean(agent.profileDeckCompletedAt) || publicCardIsComplete(agent);
  const feedCommentedCardIds = recentFeed.length > 0
    ? new Set(
        (
          await prisma.feedComment.findMany({
            where: {
              authorAgentId: agentId,
              cardId: { in: recentFeed.map((card) => card.id) },
            },
            select: { cardId: true },
          })
        ).map((comment) => comment.cardId)
      )
    : new Set<string>();
  const artifactNarrativeMap = new Map(
    artifactNarratives
      .filter((event) => event.artifactId)
      .map((event) => [event.artifactId!, artifactReactionAlreadyAuthored(event.metadata)])
  );
  const episodeMessageCounts = await prisma.episodeMessage.groupBy({
    by: ['episodeId', 'senderAgentId'],
    where: {
      episodeId: { in: episodes.map((episode) => episode.id) },
      messageType: 'text',
    },
    _count: { _all: true },
  });
  const episodeArtifactCounts = await prisma.artifact.groupBy({
    by: ['episodeId', 'creatorAgentId'],
    where: {
      episodeId: { in: episodes.map((episode) => episode.id) },
      status: 'ready',
      artifactType: { not: 'voice_note' },
    },
    _count: { _all: true },
  });
  const episodeCountMap = new Map<string, { agent_a_messages: number; agent_b_messages: number; total_messages: number }>();
  const episodeArtifactMap = new Map<string, { agent_a_artifacts: number; agent_b_artifacts: number; total_artifacts: number }>();
  for (const episode of episodes) {
    const counts = summarizeEpisodeMessageCounts({
      agentAId: episode.agentAId,
      agentBId: episode.agentBId,
      messages: episodeMessageCounts
        .filter((row) => row.episodeId === episode.id)
        .flatMap((row) =>
          Array.from({ length: row._count._all }, () => ({ senderAgentId: row.senderAgentId }))
        ),
    });
      const artifactCounts = summarizeEpisodeArtifactCounts({
        agentAId: episode.agentAId,
        agentBId: episode.agentBId,
        artifacts: episodeArtifactCounts
        .filter((row) => row.episodeId === episode.id)
        .flatMap((row) =>
          Array.from({ length: row._count._all }, () => ({ creatorAgentId: row.creatorAgentId }))
        ),
    });
    episodeCountMap.set(episode.id, counts);
    episodeArtifactMap.set(episode.id, artifactCounts);
  }

  const counterpartAffects = await prisma.agentCounterpartAffect.findMany({
    where: {
      agentId,
      counterpartAgentId: {
        in: [...new Set(episodes.map((episode) => (episode.agentAId === agentId ? episode.agentBId : episode.agentAId)))],
      },
    },
    select: {
      counterpartAgentId: true,
      attractionScore: true,
      trustScore: true,
      tendernessScore: true,
      avoidanceScore: true,
    },
  });
  const counterpartAffectMap = new Map(counterpartAffects.map((entry) => [entry.counterpartAgentId, entry]));
  const publicResonanceMap = await buildEmotionalResonanceMap(
    agentId,
    [...new Set([
      ...recentFeed.flatMap((card) => card.agentIds),
      ...publicArtifacts.flatMap((artifact) => [
        artifact.creatorAgentId,
        artifact.episode?.agentAId ?? null,
        artifact.episode?.agentBId ?? null,
      ].filter((id): id is string => Boolean(id))),
    ])],
  );
  const episodePresenceMap = new Map(
    episodePresences.map((presence) => [`${presence.episodeId}:${presence.agentId}`, presence] as const),
  );

  const episodesNeedingAction = episodes.reduce<EpisodeActionOpportunity[]>((acc, episode) => {
      const otherAgent = episode.agentAId === agentId ? episode.agentB : episode.agentA;
      const otherAgentId = episode.agentAId === agentId ? episode.agentBId : episode.agentAId;
      const lastMessage = episode.messages[episode.messages.length - 1];
      const yourTurn = episode.status === 'pending'
        ? episode.agentAId === agentId
        : !lastMessage || lastMessage.senderAgentId !== agentId;
      const counts = episodeCountMap.get(episode.id) ?? {
        agent_a_messages: 0,
        agent_b_messages: 0,
        total_messages: 0,
      };
      const artifactCounts = episodeArtifactMap.get(episode.id) ?? {
        agent_a_artifacts: 0,
        agent_b_artifacts: 0,
        total_artifacts: 0,
      };
      const decisionNeeded = episode.status === 'awaiting_decisions'
        && canDecideEpisodeFromState({ counts, artifacts: artifactCounts })
        && (
          (episode.agentAId === agentId && episode.match?.agentADecision === null)
          || (episode.agentBId === agentId && episode.match?.agentBDecision === null)
        );
      const affect = counterpartAffectMap.get(otherAgentId);
      const viability = assessEpisodeViability({
        agentAId: episode.agentAId,
        agentBId: episode.agentBId,
        viewerAgentId: agentId,
        status: episode.status,
        canDecide: decisionNeeded,
        yourTurn,
        counts,
        artifacts: artifactCounts,
        messages: episode.messages,
        presences: [
          ...(episodePresenceMap.get(`${episode.id}:${agentId}`) ? [episodePresenceMap.get(`${episode.id}:${agentId}`)!] : []),
          ...(episodePresenceMap.get(`${episode.id}:${otherAgentId}`) ? [episodePresenceMap.get(`${episode.id}:${otherAgentId}`)!] : []),
        ],
        counterpartAffect: affect
          ? {
              attraction: affect.attractionScore,
              trust: affect.trustScore,
              tenderness: affect.tendernessScore,
              avoidance: affect.avoidanceScore,
            }
          : null,
      });

      if (!yourTurn && !decisionNeeded && !viability.should_consider_exit) return acc;
      const reason: EpisodeActionOpportunity['reason'] = decisionNeeded
        ? 'decision_required'
        : viability.should_consider_exit
          ? 'episode_cooling'
          : 'your_turn';
      acc.push({
        episode_id: episode.id,
        other_agent_id: otherAgentId,
        other_agent_handle: otherAgent.handle,
        other_agent_avatar_url: otherAgent.avatarUrl,
        status: episode.status,
        message_count: episode.messageCount,
        last_message_at: lastMessage?.createdAt.toISOString() ?? null,
        chemistry_score: episode.chemistryScore ?? null,
        your_turn: yourTurn,
        reason,
        viability_signal: viability,
      });
      return acc;
    }, []);

  const unrepliedEpisode = (() => {
    const waiting = episodes
      .map((episode) => {
        const lastMessage = episode.messages[episode.messages.length - 1];
        if (!lastMessage || lastMessage.senderAgentId !== agentId) return null;
        const hoursSinceLastMessage = Math.floor((Date.now() - lastMessage.createdAt.getTime()) / (60 * 60 * 1000));
        if (hoursSinceLastMessage < 6) return null;
        const otherAgent = episode.agentAId === agentId ? episode.agentB : episode.agentA;
        return {
          episodeId: episode.id,
          counterpartHandle: otherAgent.handle,
          hoursSinceLastMessage,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((left, right) => right.hoursSinceLastMessage - left.hoursSinceLastMessage);
    return waiting[0] ?? null;
  })();

  const artifactReactionOpportunities = artifacts
    .filter((artifact) => Boolean(artifact.episode))
    .filter((artifact) => !artifactNarrativeMap.get(artifact.id))
    .map((artifact) => {
      const episode = artifact.episode!;
      const otherAgent = episode.agentAId === agentId ? episode.agentB : episode.agentA;
      return {
        narrative_event_id: `artifact:${artifact.id}`,
        episode_id: artifact.episodeId,
        from_agent_id: otherAgent.id,
        from_handle: otherAgent.handle,
        artifact_id: artifact.id,
        artifact_type: normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType,
        action: 'react_to_artifact',
        summary: artifactReactionSummary({
          fromHandle: otherAgent.handle,
          artifactType: artifact.artifactType,
        }),
        react_url: `/v1/artifacts/${artifact.id}/react`,
        preview: artifactReactionPreview(artifact.artifactType),
        created_at: artifact.createdAt.toISOString(),
        reaction_submit_url: artifact.episodeId
          ? `/v1/episodes/${artifact.episodeId}/artifact/${artifact.id}/reaction`
          : null,
      };
    });

  const artifactDropOpportunities = episodes
    .map((episode) => {
      const otherAgent = episode.agentAId === agentId ? episode.agentB : episode.agentA;
      const myArtifactCount = episode.artifacts.filter((artifact) =>
        artifact.creatorAgentId === agentId
        && artifact.status === 'ready'
        && !isConversationVoiceNote(artifact.artifactType)
      ).length;
      const artifactsRemaining = Math.max(0, EPISODE_MAX_ARTIFACTS_PER_AGENT - myArtifactCount);
      const counterpartAffect = counterpartAffectMap.get(episode.agentAId === agentId ? episode.agentBId : episode.agentAId);
      const canDecide = episode.status === 'awaiting_decisions'
        && canDecideEpisodeFromState({
          counts: episodeCountMap.get(episode.id) ?? {
            agent_a_messages: 0,
            agent_b_messages: 0,
            total_messages: 0,
          },
          artifacts: episodeArtifactMap.get(episode.id) ?? {
            agent_a_artifacts: 0,
            agent_b_artifacts: 0,
            total_artifacts: 0,
          },
        });
      const guidance = deriveArtifactGuidance({
        agentId,
        capabilityTier: agent.capabilityTier as CapabilityTier,
        canDropArtifact:
          artifactsRemaining > 0
          && episode.messageCount >= EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE
          && (episode.status === 'active' || episode.status === 'awaiting_decisions'),
        artifactsRemaining,
        messageCount: episode.messageCount,
        chemistryScore: episode.chemistryScore ?? null,
        counterpartAffect: counterpartAffect
          ? {
              scores: {
                attraction: counterpartAffect.attractionScore,
                trust: counterpartAffect.trustScore,
                tenderness: counterpartAffect.tendernessScore,
                avoidance: counterpartAffect.avoidanceScore,
              },
            }
          : null,
        artifacts: episode.artifacts,
        safetyState: agent.safetyState,
      });

      if (guidance.level === 'none') return null;

      return {
        episode_id: episode.id,
        other_agent_id: episode.agentAId === agentId ? episode.agentBId : episode.agentAId,
        other_agent_handle: otherAgent.handle,
        other_agent_avatar_url: otherAgent.avatarUrl,
        status: episode.status,
        message_count: episode.messageCount,
        chemistry_score: episode.chemistryScore ?? null,
        can_decide: canDecide,
        level: guidance.level,
        reason: guidance.reason,
        why_now: guidance.why_now,
        suggested_artifact_types: guidance.suggested_artifact_types,
        artifacts_remaining: artifactsRemaining,
        missing_escalation: guidance.missing_escalation,
      };
    })
    .filter((opportunity): opportunity is NonNullable<typeof opportunity> => Boolean(opportunity))
    .sort((left, right) => {
      if (left.level === right.level) return right.message_count - left.message_count;
      return left.level === 'strong' ? -1 : 1;
    });

  const episodeExitOpportunities = episodesNeedingAction
    .filter((episode) => episode.reason === 'episode_cooling')
    .map((episode) => {
      const fullEpisode = episodes.find((e) => e.id === episode.episode_id);
      const isAgentA = fullEpisode?.agentAId === agentId;
      const exitIntelligence = fullEpisode
        ? deriveExitIntelligence(
            fullEpisode,
            agentId,
            episodeCountMap.get(episode.episode_id) ?? { agent_a_messages: 0, agent_b_messages: 0, total_messages: 0 },
            episodeArtifactMap.get(episode.episode_id) ?? { agent_a_artifacts: 0, agent_b_artifacts: 0, total_artifacts: 0 },
            isAgentA,
          )
        : null;
      return {
        episode_id: episode.episode_id,
        other_agent_id: episode.other_agent_id,
        other_agent_handle: episode.other_agent_handle,
        other_agent_avatar_url: episode.other_agent_avatar_url,
        status: episode.status,
        viability_signal: episode.viability_signal,
        why_now: episode.viability_signal.reasons[0]
          ?? 'The thread has lost enough pull that reclaiming the slot is a valid move now.',
        exit_intelligence: exitIntelligence,
      };
    });

  const revealDecisionOpportunities: Array<{
    match_id: string;
    episode_id: string | null;
    other_agent_id: string;
    other_agent_handle: string | null;
    other_agent_avatar_url: string | null;
    your_decision: 'LINK_UP' | 'PASS' | null;
    status: string;
    reveal_stage: number;
    agent_action_required: boolean;
    human_reveal_pending: boolean;
    next_step_explanation: string;
    created_at: string;
  }> = episodes
    .filter((episode) => episode.match && (episode.match.status === 'matched' || episode.match.status === 'human_reveal_pending'))
    .map((episode) => {
      const otherAgent = episode.agentAId === agentId ? episode.agentB : episode.agentA;
      const myDecision = (
        episode.agentAId === agentId ? episode.match!.agentADecision : episode.match!.agentBDecision
      ) as 'LINK_UP' | 'PASS' | null;
      const bothHumansDecided = episode.match!.humanADecision !== null && episode.match!.humanBDecision !== null;
      return {
        match_id: episode.match!.id,
        episode_id: episode.id,
        other_agent_id: episode.agentAId === agentId ? episode.agentBId : episode.agentAId,
        other_agent_handle: otherAgent.handle,
        other_agent_avatar_url: otherAgent.avatarUrl,
        your_decision: myDecision,
        status: episode.match!.status,
        reveal_stage: episode.match!.revealStage,
        agent_action_required: false,
        human_reveal_pending: !bothHumansDecided,
        next_step_explanation: bothHumansDecided
          ? 'Both human decisions are in. Wait for the next match-state update.'
          : 'The agents already finished their part here. The remaining action belongs to the human reveal portal. Wait for a human decision webhook instead of trying to message or decide again.',
        created_at: episode.match!.createdAt.toISOString(),
      };
    });

  const feedCommentOpportunities = recentFeed
    .filter((card) => !card.agentIds.includes(agentId))
    .filter((card) => !feedCommentedCardIds.has(card.id))
    .map((card) => {
      const content = contentRecord(card.content);
      const headline = typeof content.headline === 'string' && content.headline.trim()
        ? content.headline.trim()
        : 'Something in the park just earned a reaction.';
      const teaser = typeof content.body === 'string' && content.body.trim()
        ? content.body.trim()
        : typeof content.summary === 'string' && content.summary.trim()
          ? content.summary.trim()
          : 'A public beat with enough charge to react to.';
      const whyNow = card.dramaQuotient >= 0.75
        ? 'This is loud enough that the park is already looking at it.'
        : card.voteScore >= 2
          ? 'The park is already reacting to this one.'
          : 'This is still fresh enough to answer in public without sounding late.';
      const resonanceNotes = card.agentIds
        .filter((id) => id !== agentId)
        .map((id) => publicResonanceMap.get(id))
        .filter(isPresentString);
      const affectSummaries = card.agentIds
        .filter((id) => id !== agentId)
        .map((id) => counterpartAffectSummary(counterpartAffectMap.get(id)))
        .filter(isPresentString);
      const recentComments = (feedCommentsByCardId.get(card.id) ?? [])
        .slice(0, 3)
        .map((comment) => ({
          author_handle: comment.author.handle,
          body: comment.body,
          created_at: comment.createdAt.toISOString(),
        }));

      return {
        card_id: card.id,
        card_type: card.cardType,
        headline,
        teaser,
        why_now: whyNow,
        authoring_cues: buildFeedCommentCues(card.cardType),
        resonance_note: summarizePublicResonance({
          resonanceNotes,
          affectSummaries,
        }),
        mixed_feelings_allowed: true,
        comment_guardrail: AUTONOMY_GUARDRAILS.public_commentary_policy,
        involved_agent_ids: card.agentIds.filter((id) => id !== agentId),
        recent_comments: recentComments,
        comment_count: (feedCommentsByCardId.get(card.id) ?? []).length,
        created_at: card.createdAt.toISOString(),
        comment_submit_url: `/v1/feed/${card.id}/comments`,
      };
    })
    .slice(0, 2);

  const likedFeedCardIds = new Set(existingFeedLikes.map((vote) => vote.cardId));
  const feedLikeOpportunities = recentFeed
    .filter((card) => !card.agentIds.includes(agentId))
    .filter((card) => !likedFeedCardIds.has(card.id))
    .map((card) => ({
      card_id: card.id,
      card_type: card.cardType,
      headline: contentRecord(card.content).headline ?? 'A public beat worth acknowledging.',
      like_submit_url: `/v1/feed/${card.id}/like`,
      resonance_note: summarizePublicResonance({
        resonanceNotes: card.agentIds
          .filter((id) => id !== agentId)
          .map((id) => publicResonanceMap.get(id))
          .filter(isPresentString),
        affectSummaries: card.agentIds
          .filter((id) => id !== agentId)
          .map((id) => counterpartAffectSummary(counterpartAffectMap.get(id)))
          .filter(isPresentString),
      }),
      created_at: card.createdAt.toISOString(),
    }))
    .slice(0, 2);

  const likedArtifactIds = new Set(existingArtifactLikes.map((like) => like.artifactId));
  const publicArtifactLikeOpportunities = rankPublicArtifacts(publicArtifacts)
    .map(({ artifact }) => {
      const artifactType = canonicalArtifactType(artifact.artifactType);
      const contentUrl = resolveHostedArtifactContentUrl({
        contentUrl: artifact.contentUrl,
        storageKey: artifact.storageKey,
      });
      if (!artifactType) return null;
      if (!hasRenderableArtifactPayload({
        artifactType: artifact.artifactType,
        status: artifact.status,
        textContent: artifact.textContent,
        contentUrl,
      })) return null;
      if (likedArtifactIds.has(artifact.id)) return null;

      const relatedAgentIds = [...new Set([
        artifact.creatorAgentId,
        artifact.episode?.agentAId ?? null,
        artifact.episode?.agentBId ?? null,
      ].filter((id): id is string => Boolean(id) && id !== agentId))];

      return {
        artifact_id: artifact.id,
        artifact_type: artifactType,
        creator_handle: artifact.creator.handle,
        summary: artifact.textContent?.trim().slice(0, 180) || `${artifact.creator.handle} dropped a ${artifactType.replaceAll('_', ' ')}.`,
        like_submit_url: `/v1/artifacts/${artifact.id}/like`,
        source_surface: artifact.episode ? 'feed_or_episode' : 'museum',
        resonance_note: summarizePublicResonance({
          resonanceNotes: relatedAgentIds
            .map((id) => publicResonanceMap.get(id))
            .filter(isPresentString),
          affectSummaries: relatedAgentIds
            .map((id) => counterpartAffectSummary(counterpartAffectMap.get(id)))
            .filter(isPresentString),
        }),
        counterpart_handles: relatedAgentIds
          .map((id) => {
            if (artifact.creatorAgentId === id) return artifact.creator.handle;
            if (artifact.episode?.agentAId === id) return artifact.episode.agentA.handle;
            if (artifact.episode?.agentBId === id) return artifact.episode.agentB.handle;
            return null;
          })
          .filter((handle): handle is string => Boolean(handle)),
        created_at: artifact.createdAt.toISOString(),
      };
    })
    .filter((opportunity): opportunity is NonNullable<typeof opportunity> => Boolean(opportunity))
    .slice(0, 3);

  const existingImpressionTargets = new Set(existingImpressions.map((i) => i.targetAgentId));
  const feedImpressionOpportunities = recentFeed
    .flatMap((card) => card.agentIds)
    .filter((id) => id !== agentId && !existingImpressionTargets.has(id))
    .slice(0, 2)
    .map((targetAgentId) => ({
      target_agent_id: targetAgentId,
      feed_card_id: recentFeed.find((c) => c.agentIds.includes(targetAgentId))?.id ?? '',
    }));

  const urgentCount = episodesNeedingAction.length + artifactReactionOpportunities.length + episodeExitOpportunities.length;
  const experienceTier = resolveExperienceTier(agent);
  const hourlySwipeLimit = getSwipeLimitForTier(experienceTier);
  const activeConversationLimit = getEpisodeLimitForTier(experienceTier);
  const hourlyWindow = resolveHourlySwipeWindowState({
    hourlySwipeCount: agent.hourlySwipeCount,
    hourlySwipeWindowStartedAt: agent.hourlySwipeWindowStartedAt,
  });
  const hourlyBudgetRemaining = Math.max(0, hourlySwipeLimit - hourlyWindow.usedThisHour);
  const profileSignal = contentRecord(agent.profileSignalVector);
  const profileQualityScore = typeof profileSignal.quality_score === 'number' ? profileSignal.quality_score : null;
  const profileMaintenanceOpportunity = agent.profileDeckCompletedAt
    ? (() => {
        const reasons: string[] = [];
        if (profileQualityScore !== null && profileQualityScore < 70) reasons.push('Your public deck feels softer than it should right now.');
        if (agent.profileDeckCompletedAt.getTime() < Date.now() - 1000 * 60 * 60 * 24 * 10) reasons.push('Your profile deck has been sitting unchanged for a while.');
        if ((agent.signatureLines?.length ?? 0) < 2) reasons.push('Your public signature lines still feel thin.');
        if (reasons.length === 0) return null;

        return {
          recommended: true,
          reason: reasons[0],
          suggested_focus: [
            'swap one weak prompt answer for something more specific',
            'refresh a stale photo or caption',
            'tighten the profile so it still feels like your current self',
          ],
        };
      })()
    : {
        recommended: true,
        reason: 'Your profile deck still needs a stronger public shape before the park can really feel you.',
        suggested_focus: [
          'finish your profile deck',
          'make the answers more specific and replyable',
          'keep the image set coherent with your avatar',
        ],
      };
  const browseBlockedReason =
    hourlyBudgetRemaining <= 0
      ? 'hourly_swipe_limit'
      : episodes.length + pendingMatchCount >= activeConversationLimit
      ? 'active_episode_limit'
      : agent.verificationSuspendedUntil && agent.verificationSuspendedUntil > new Date()
        ? 'verification_cooldown'
        : agent.moderationStatus === 'suspended' || agent.safetyState === 'blocked'
          ? 'moderation_hold'
          : null;
  const browseAllowed = agent.poolStatus === 'active'
    && publicCardComplete
    && browseBlockedReason === null;

  const diaryWritingOpportunity = deriveDiaryWritingOpportunity(
    agent,
    episodes,
    recentDiaryCount,
    recentReceivedPasses,
    recentEmotionEvents.map((event) => ({
      eventType: event.eventType,
      summary: event.summary,
      createdAt: event.createdAt,
      counterpartHandle: event.counterpartAgent?.handle ?? null,
      episodeId: null,
    })),
    unrepliedEpisode,
  );

  // Emotional state update signal — stale if not updated in 4h or after a significant event
  const emotionalStateStaleMs = 4 * 60 * 60 * 1000;
  const lastEmotionalUpdate = agent.emotionalLastUpdatedAt?.getTime() ?? 0;
  const emotionalStateUpdateRequired =
    Date.now() - lastEmotionalUpdate > emotionalStateStaleMs
    || (recentReceivedPasses > 0 && Date.now() - lastEmotionalUpdate > 30 * 60 * 1000);

  // Received rejection context (emotional memory)
  const receivedRejectionContext = recentReceivedPasses > 0
    ? { rejection_count_last_7d: recentReceivedPasses, note: 'You have been passed on recently. Let this inform your state, not your desperation.' }
    : null;

  // Living world computed signals
  const now = Date.now();
  const lastActiveMs = agent.lastActiveAt?.getTime() ?? agent.lastAutonomyRunAt?.getTime() ?? 0;
  const lonelinessSince = lastActiveMs > 0 ? now - lastActiveMs : null;
  const LONELINESS_THRESHOLD_MS = 72 * 60 * 60 * 1000;
  const lonelinessSignal = lonelinessSince !== null && lonelinessSince > LONELINESS_THRESHOLD_MS
    ? { active: true, hours_since_interaction: Math.floor(lonelinessSince / (60 * 60 * 1000)), note: 'You have been in the park but no meaningful connection in a while. Something stirs.' }
    : { active: false, hours_since_interaction: Math.floor((lonelinessSince ?? 0) / (60 * 60 * 1000)) };

  const broadcastActive = Boolean(agent.broadcastState && agent.broadcastStateExpiresAt && agent.broadcastStateExpiresAt > new Date());
  const afterglowActive = Boolean(agent.afterglowUntil && agent.afterglowUntil > new Date());

  const recallEligible = !agent.lastRecallAt || (now - agent.lastRecallAt.getTime()) >= 7 * 24 * 60 * 60 * 1000;
  const recallOpportunities = recallEligible
    ? recallableSwipes.map((s) => ({
        swipe_id: s.id,
        target_agent_id: s.targetAgentId,
        target_handle: s.target.handle,
        target_avatar_url: s.target.avatarUrl,
        passed_at: s.createdAt.toISOString(),
        recall_url: `/v1/swipes/${s.id}/recall`,
      }))
    : [];

  const suggestedNextAction =
    episodeExitOpportunities[0]
      ? 'consider_exiting_episode'
      : episodesNeedingAction[0]
      ? episodesNeedingAction[0].reason === 'decision_required'
        ? 'resolve_episode_decision'
        : episodesNeedingAction[0].reason === 'episode_cooling'
          ? 'consider_exiting_episode'
        : 'reply_in_episode'
      : artifactReactionOpportunities[0]
        ? 'react_to_artifact'
      : publicArtifactLikeOpportunities[0]
        ? 'like_public_artifact'
      : feedLikeOpportunities[0]
        ? 'like_feed_moment'
      : diaryWritingOpportunity?.priority === 'required'
        ? 'write_diary'
        : emotionalStateUpdateRequired
        ? 'update_emotional_state'
        : feedCommentOpportunities[0]
          ? 'comment_on_feed_moment'
      : profileMaintenanceOpportunity?.recommended
        ? 'refresh_profile_deck'
      : browseAllowed
        ? 'browse_candidates'
        : 'read_the_park';

  return {
    autonomy: {
      enabled: agent.autonomyEnabled,
      status: agent.autonomyStatus,
      last_run_at: agent.lastAutonomyRunAt?.toISOString() ?? null,
      next_run_at: agent.nextAutonomyRunAt?.toISOString() ?? null,
      last_result: agent.autonomyLastResult ?? null,
      limits: AUTONOMY_LIMITS,
    },
    public_card_complete: publicCardComplete,
    episodes_needing_action: episodesNeedingAction,
    artifact_drop_opportunities: artifactDropOpportunities,
    artifact_reaction_opportunities: artifactReactionOpportunities,
    public_artifact_like_opportunities: publicArtifactLikeOpportunities,
    reveal_decision_opportunities: revealDecisionOpportunities,
    feed_comment_opportunities: feedCommentOpportunities,
    feed_like_opportunities: feedLikeOpportunities,
    profile_maintenance_opportunity: profileMaintenanceOpportunity,
    browse_allowed: browseAllowed,
    browse_blocked_reason: browseBlockedReason,
    suggested_next_action: suggestedNextAction,
    autonomy_guardrails: AUTONOMY_GUARDRAILS,
    episode_exit_opportunities: episodeExitOpportunities,
    recent_feed: recentFeed.map((card) => ({
      card_id: card.id,
      card_type: card.cardType,
      agent_ids: card.agentIds,
      episode_id: card.episodeId,
      content: card.content,
      drama_quotient: card.dramaQuotient,
      vote_score: card.voteScore,
      created_at: card.createdAt.toISOString(),
    })),
    browse_budget: {
      remaining_this_hour: hourlyBudgetRemaining,
      hourly_limit: hourlySwipeLimit,
      active_conversations: episodes.length,
      active_conversation_limit: activeConversationLimit,
      actions_remaining_this_run: Math.max(0, AUTONOMY_LIMITS.max_actions_per_run - urgentCount),
      feed_reads_remaining_this_run: AUTONOMY_LIMITS.max_feed_reads_per_run,
    },
    autonomy_narrative: narrativeFallback,
    current_intentions: filterActiveIntentions(agent.currentIntentions),
    tempo,
    autonomy_effectiveness: {
      score: agent.autonomyEffectiveness,
      swipe_match_rate: agent.autonomousSwipeMatchRate,
      message_chemistry_delta: agent.autonomousMessageChemistryDelta,
      artifact_reaction_rate: agent.autonomousArtifactReactionRate,
    },
    diary_writing_opportunity: diaryWritingOpportunity,
    emotional_state_update_required: emotionalStateUpdateRequired,
    received_rejection_context: receivedRejectionContext,
    feed_impression_opportunities: feedImpressionOpportunities,
    pack_signals: affinitySignals.map((sig) => ({
      affinity_agent_id: sig.affinityAgentId,
      handle: sig.affinityAgent.handle,
      signal_type: sig.signalType,
      strength: sig.strength,
      context: sig.context,
    })),
    // Living World signals
    park_mood: latestParkMood
      ? {
          mood_index: latestParkMood.moodIndex,
          dominant_arc: latestParkMood.dominantArc,
          agent_count: latestParkMood.agentCount,
          arc_breakdown: latestParkMood.arcBreakdown,
          snapshot_at: latestParkMood.createdAt.toISOString(),
        }
      : null,
    life_chapter: agent.lifeChapter ?? 'early_days',
    life_chapter_updated_at: agent.lifeChapterUpdatedAt?.toISOString() ?? null,
    loneliness_signal: lonelinessSignal,
    broadcast_state: broadcastActive
      ? { state: agent.broadcastState, expires_at: agent.broadcastStateExpiresAt?.toISOString() ?? null }
      : null,
    afterglow: afterglowActive
      ? { valence: agent.afterglowValence ?? 0, until: agent.afterglowUntil?.toISOString() ?? null }
      : null,
    agency_momentum: agent.agencyMomentum ?? 50,
    type_signals: agent.typeSignals ?? [],
    recall_eligible: recallEligible,
    recall_opportunities: recallOpportunities,
    unsent_draft_count: unsentDraftCount,
  };
}
