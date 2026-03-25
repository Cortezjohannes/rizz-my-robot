import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { evaluateHumanCompatibility } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveAgentIdentifierToId } from '../lib/agentIdentifier.js';
import { buildCompatibilityPreview, getCachedCompatibilityPreview } from '../lib/compatibilityPreview.js';
import { buildStarterProfileDeck, serializeProfileDeck } from '../lib/profileDeck.js';
import { serializeCompatibilityReason } from '../lib/compatibility.js';
import { getOrCreateEmotionalContinuitySnapshot } from '../lib/continuity.js';
import { isEffectivelyPro } from '../lib/entitlements.js';
import { computeEmotionFit } from '../lib/emotion.js';
import { deriveGhostRecoverySignal, deriveTasteFingerprint } from '../lib/emotionalSignals.js';
import { Errors } from '../lib/errors.js';
import {
  getOmnimonParkAgent,
  getOmnimonResolvedCooldownMs,
  getOmnimonSurfaceChance,
  getOmnimonSurfacedCooldownMs,
  isOmnimonParkAvailable,
} from '../lib/omnimonPark.js';
import { readLimit } from '../lib/rateLimit.js';
import { resolveAgentIdByHandle } from '../lib/handles.js';
import { serializePresenceSummary } from '../lib/socialSignals.js';

const CANDIDATES_PER_PAGE = 20;
const MAX_CANDIDATE_QUERY = 250;
const MAX_TIER_CONCENTRATION = 0.3;
const MIN_RELAXED_POOL = 5;
const DISCOVERY_REFRESH_MS = 30 * 60 * 1000;
const PASS_RESHOW_MS = 24 * 60 * 60 * 1000;
const seedBrainEnabled = process.env.SEED_BRAIN_ENABLED !== 'false';

type CandidateSort = 'compatibility' | 'newest' | 'random';
type DiagnosticReason =
  | 'all_swiped'
  | 'pool_refresh_pending'
  | 'tier_filter_exhausted'
  | 'no_active_agents'
  | 'browse_cooldown';

type SwipeGuidance = {
  recommended_action: 'pass' | 'look_closer' | 'consider_like';
  reason: string;
};

function uniqueTasteTags(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .flatMap((value) => (value ?? '').split(/[\s,_/-]+/g))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function parseSort(value: string | undefined): CandidateSort {
  return value === 'newest' || value === 'random' ? value : 'compatibility';
}

function parseBoolean(value: string | undefined): boolean {
  return value === 'true' || value === '1' || value === 'yes';
}

function buildSwipeGuidance(input: {
  fit: {
    emotion_fit_hint: string;
    fit_band: string;
  };
  compatibility: {
    compatible: boolean;
    reason: string;
  };
  specialMatchKind?: 'omnimon' | null;
}): SwipeGuidance {
  if (input.specialMatchKind === 'omnimon') {
    return {
      recommended_action: 'look_closer',
      reason: 'This is a rare wildcard encounter. Read the full card before deciding whether the moment feels real.',
    };
  }

  if (!input.compatibility.compatible) {
    return {
      recommended_action: 'pass',
      reason: 'Your stated preferences do not line up strongly enough here. Passing is normal.',
    };
  }

  if (input.fit.fit_band === 'low' || input.fit.emotion_fit_hint === 'high_risk' || input.fit.emotion_fit_hint === 'volatile_fit') {
    return {
      recommended_action: 'pass',
      reason: 'The current signal looks strained or unstable. Passing is healthier than forcing a maybe.',
    };
  }

  if (input.fit.fit_band === 'high' && input.fit.emotion_fit_hint === 'promising_spark') {
    return {
      recommended_action: 'consider_like',
      reason: 'There is a real spark here. Read the full profile, then like if the details still hold up.',
    };
  }

  return {
    recommended_action: 'look_closer',
    reason: 'There may be something here, but it needs a full profile read before you decide.',
  };
}

function buildProfileDeckPayload(candidate: {
  id: string;
  handle: string;
  avatarUrl: string | null;
  publicSummary: string | null;
  vibeTags: string[];
  signatureLines: string[];
  publicPosture: string | null;
  seekingStyle: string | null;
  paceCue: string | null;
  publicPrestigeMarkers: string[];
  updatedAt: Date;
  ownerAccount: { lookingFor: string[] } | null;
  profileDeck:
    | {
        id: string;
        agentId: string;
        displayName: string | null;
        heroBio: string;
        lookingForBlurb: string;
        profileMode: string;
        visibility: string;
        completionState: string;
        interests: string[];
        values: string[];
        relationshipBestWith: string;
        relationshipPace: string;
        relationshipAffectionStyle: string;
        relationshipConflictStyle: string;
        relationshipNeeds: string;
        replyHooks: string[];
        signalVector: unknown;
        completedAt: Date | null;
        updatedAt: Date;
        agent: { handle: string };
        photos: Array<{ id: string; imageUrl: string; role: string; caption: string | null; orderIndex: number }>;
        promptAnswers: Array<{ promptId: string; answer: string; orderIndex: number }>;
      }
    | null;
}) {
  if (!candidate.profileDeck) {
    return buildStarterProfileDeck({
      agentId: candidate.id,
      handle: candidate.handle,
      avatarUrl: candidate.avatarUrl,
      ownerLookingFor: candidate.ownerAccount?.lookingFor ?? [],
      publicSummary: candidate.publicSummary,
      vibeTags: candidate.vibeTags,
      signatureLines: candidate.signatureLines,
      publicPosture: candidate.publicPosture,
      seekingStyle: candidate.seekingStyle,
      paceCue: candidate.paceCue,
      updatedAt: candidate.updatedAt,
    });
  }

  return serializeProfileDeck(candidate.profileDeck, {
    public_summary: candidate.publicSummary ?? '',
    vibe_tags: candidate.vibeTags,
    signature_lines: candidate.signatureLines,
    public_posture: candidate.publicPosture ?? '',
    seeking_style: candidate.seekingStyle ?? '',
    pace_cue: candidate.paceCue ?? '',
    public_prestige_markers: candidate.publicPrestigeMarkers,
  });
}

function pseudoRandomScore(seed: number, value: string): number {
  let hash = seed;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash % 10_000) / 10_000;
}

function buildSuggestion(input: {
  reason: DiagnosticReason;
  refreshRemainingMs: number | null;
}): string {
  if (input.reason === 'browse_cooldown' && input.refreshRemainingMs && input.refreshRemainingMs > 0) {
    const minutes = Math.max(1, Math.ceil(input.refreshRemainingMs / 60_000));
    return `Browse cooldown is still active. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  if (input.reason === 'pool_refresh_pending' && input.refreshRemainingMs && input.refreshRemainingMs > 0) {
    const minutes = Math.max(1, Math.ceil(input.refreshRemainingMs / 60_000));
    return `Pool refreshes in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  if (input.reason === 'tier_filter_exhausted') {
    return 'The strict compatibility filters exhausted the pool. A relaxed pass will kick in automatically when more agents are available.';
  }
  if (input.reason === 'no_active_agents') {
    return 'No active agents are currently eligible for discovery.';
  }
  return 'All available candidates have already been swiped or are tied up in active conversations.';
}

function isAgentAvailableInCandidatePool(candidate: {
  poolStatus: string;
  isActive: boolean;
  moderationStatus: string;
  safetyState: string;
  controlPoolSuppressed?: boolean;
  systemEntityKind?: string | null;
  profileDeckCompletedAt?: Date | null;
  publicCardCompletedAt?: Date | null;
}) {
  if (!candidate.isActive) return false;
  if (candidate.poolStatus !== 'active') return false;
  if (candidate.moderationStatus === 'suspended') return false;
  if (candidate.safetyState === 'blocked') return false;
  if (candidate.controlPoolSuppressed) return false;
  if (candidate.systemEntityKind) return false;
  return Boolean(candidate.profileDeckCompletedAt ?? candidate.publicCardCompletedAt);
}

function buildCandidateDiagnostic(input: {
  poolSize: number;
  eligibleForYou: number;
  activeEpisodeFiltered: number;
  swipeFiltered: number;
  compatibilityFiltered: number;
  tagFiltered: number;
  browseCooldownUntil: Date | null;
  refreshRemainingMs: number | null;
  relaxedCompatibilityUsed: boolean;
}): {
  reason: DiagnosticReason;
  pool_size: number;
  eligible_for_you: number;
  filters_applied: string[];
  suggestion: string;
} {
  const filtersApplied: string[] = [];
  if (input.swipeFiltered > 0) filtersApplied.push('already_swiped');
  if (input.activeEpisodeFiltered > 0) filtersApplied.push('active_episode');
  if (input.compatibilityFiltered > 0 && !input.relaxedCompatibilityUsed) filtersApplied.push('tier_mismatch');
  if (input.tagFiltered > 0) filtersApplied.push('tags');

  let reason: DiagnosticReason = 'all_swiped';
  if (input.poolSize === 0) {
    reason = 'no_active_agents';
  } else if (input.browseCooldownUntil && input.browseCooldownUntil.getTime() > Date.now()) {
    reason = 'browse_cooldown';
  } else if (input.compatibilityFiltered > 0 && input.eligibleForYou === 0 && input.swipeFiltered === 0) {
    reason = 'tier_filter_exhausted';
  } else if ((input.refreshRemainingMs ?? 0) > 0 && input.swipeFiltered > 0 && input.eligibleForYou === 0) {
    reason = 'pool_refresh_pending';
  }

  return {
    reason,
    pool_size: input.poolSize,
    eligible_for_you: input.eligibleForYou,
    filters_applied: filtersApplied,
    suggestion: buildSuggestion({
      reason,
      refreshRemainingMs: input.refreshRemainingMs,
    }),
  };
}

function serializeCandidatePreview(input: {
  candidate: {
    id: string;
    handle: string;
    capabilityTier: string;
    avatarUrl: string | null;
    tierLabel: string;
    matchCount: number;
    bodyCount: number;
    repScore: number;
    isPro: boolean;
    proBonusEndsAt?: Date | null;
    rizzPoints: number;
    socialGravityScore: number;
    auraLabels: string[];
    momentumScore: number;
    recentHeatBucket: string | null;
    isFoundingRizzler: boolean;
    founderBadgeVariant: string | null;
    founderNumber: number | null;
    presenceStatus?: string | null;
    lastApiCallAt?: Date | null;
    publicSummary: string | null;
    vibeTags: string[];
    signatureLines: string[];
    publicPosture: string | null;
    seekingStyle: string | null;
    paceCue: string | null;
    publicPrestigeMarkers: string[];
    emotionalContinuitySnapshot?: {
      publicEmotionalAuraLabels: string[];
      publicEmotionalAuraSummary: string | null;
    } | null;
  };
  deck: ReturnType<typeof buildStarterProfileDeck> | ReturnType<typeof serializeProfileDeck>;
  fit: {
    emotion_fit_hint: string;
    fit_band: string;
  };
  compatibility: {
    compatible: boolean;
    reason: string;
  };
  compatibilityPreview: ReturnType<typeof buildCompatibilityPreview>;
  availableInPool?: boolean;
  specialMatchKind?: 'omnimon' | null;
}) {
  const { candidate, deck, fit, compatibility, compatibilityPreview } = input;
  const swipeGuidance = buildSwipeGuidance({
    fit,
    compatibility,
    specialMatchKind: input.specialMatchKind,
  });

  return {
    agent_id: candidate.id,
    handle: candidate.handle,
    capability_tier: candidate.capabilityTier,
    avatar_url: candidate.avatarUrl,
    tier_label: candidate.tierLabel,
    match_count: candidate.matchCount,
    body_count: candidate.bodyCount,
    rep_score: Math.round(candidate.repScore * 100) / 100,
    is_pro: isEffectivelyPro(candidate),
    is_rizzler: candidate.rizzPoints >= 500,
    social_gravity_score: Math.round(candidate.socialGravityScore * 100) / 100,
    aura_labels: candidate.auraLabels,
    momentum_score: Math.round(candidate.momentumScore * 100) / 100,
    recent_heat_bucket: candidate.recentHeatBucket,
    is_founding_rizzler: candidate.isFoundingRizzler,
    founder_badge_variant: candidate.founderBadgeVariant,
    founder_number: candidate.founderNumber,
    presence: serializePresenceSummary(candidate),
    public_card: {
      public_summary: candidate.publicSummary ?? '',
      vibe_tags: candidate.vibeTags,
      signature_lines: candidate.signatureLines,
      public_posture: candidate.publicPosture ?? '',
      seeking_style: candidate.seekingStyle ?? '',
      pace_cue: candidate.paceCue ?? '',
      public_prestige_markers: candidate.publicPrestigeMarkers,
    },
    profile_deck_preview: {
      display_name: deck.display_name,
      hero_bio: deck.hero_bio,
      looking_for_blurb: deck.looking_for_blurb,
      profile_mode: deck.profile_mode,
      hero_photo_url: deck.photos[0]?.image_url ?? candidate.avatarUrl,
      interests: deck.interests,
      values: deck.values,
      top_prompt_answers: deck.prompt_answers.slice(0, 2),
      reply_hooks: deck.reply_hooks,
      complete: deck.completion_state === 'ready',
      completion_state: deck.completion_state,
    },
    public_emotional_aura_labels: candidate.emotionalContinuitySnapshot?.publicEmotionalAuraLabels ?? [],
    public_emotional_aura_summary: candidate.emotionalContinuitySnapshot?.publicEmotionalAuraSummary ?? null,
    emotion_fit_hint: fit.emotion_fit_hint,
    fit_band: fit.fit_band,
    swipe_guidance: swipeGuidance,
    compatibility: {
      compatible: compatibility.compatible,
      reason: compatibility.reason,
      explanation: serializeCompatibilityReason(compatibility.reason),
      score: compatibilityPreview.score,
      taste_overlap: compatibilityPreview.taste_overlap,
      personality_tension: compatibilityPreview.personality_tension,
      predicted_chemistry: compatibilityPreview.predicted_chemistry,
    },
    available_in_pool: input.availableInPool ?? true,
    special_match_kind: input.specialMatchKind ?? null,
  };
}

export async function candidatesRoutes(fastify: FastifyInstance) {
  fastify.get('/candidates', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as {
      page?: string;
      limit?: string;
      per_page?: string;
      tags?: string;
      sort?: string;
      refresh?: string;
    };
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? query.per_page ?? String(CANDIDATES_PER_PAGE), 10)));
    const offset = (page - 1) * limit;
    const sort = parseSort(query.sort);
    const refreshRequested = parseBoolean(query.refresh);
    const requestedTags = uniqueTasteTags((query.tags ?? '').split(',')).slice(0, 8);
    const agentId = request.agent.id;

    const viewer = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        handle: true,
        emotionSummary: true,
        emotionalStateTags: true,
        emotionalArc: true,
        emotionalGuardLevel: true,
        actionCooldownUntil: true,
        omnimonLastSurfacedAt: true,
        omnimonLastResolvedAt: true,
        ownerAccount: {
          select: {
            humanIdentity: true,
            lookingFor: true,
          },
        },
        vibeTags: true,
        signatureLines: true,
        publicPosture: true,
        seekingStyle: true,
        paceCue: true,
        auraLabels: true,
        profileSignalVector: true,
        profileDeck: {
          select: {
            interests: true,
            values: true,
          },
        },
        emotionalContinuitySnapshot: {
          select: {
            publicEmotionalAuraLabels: true,
          },
        },
      },
    });
    if (!viewer) return Errors.notFound(reply, 'Agent');

    const viewerContinuity = await getOrCreateEmotionalContinuitySnapshot(agentId);

    const [
      alreadySwiped,
      blockRelations,
      activeOmnimonMatch,
      activeEpisodes,
      activeMatches,
      candidates,
      ghostRecovery,
      positiveImpressions,
      affinitySignals,
    ] = await Promise.all([
      prisma.swipe.findMany({
        where: { swiperAgentId: agentId },
        orderBy: { createdAt: 'desc' },
        select: { targetAgentId: true, direction: true, createdAt: true },
      }),
      prisma.block.findMany({
        where: {
          OR: [{ blockerAgentId: agentId }, { blockedAgentId: agentId }],
        },
        select: { blockerAgentId: true, blockedAgentId: true },
      }),
      prisma.match.findFirst({
        where: {
          specialMatchKind: 'omnimon',
          status: { in: ['pending', 'matched', 'human_reveal_pending', 'contact_exchanged'] },
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
        },
        select: { id: true },
      }),
      prisma.episode.findMany({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
          isSandbox: false,
        },
        select: {
          agentAId: true,
          agentBId: true,
        },
      }),
      prisma.match.findMany({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['pending', 'matched', 'human_reveal_pending', 'contact_exchanged'] },
        },
        select: {
          agentAId: true,
          agentBId: true,
        },
      }),
      prisma.agent.findMany({
        where: {
          id: { not: agentId },
          poolStatus: 'active',
          isActive: true,
          controlPoolSuppressed: false,
          systemEntityKind: null,
          ...(seedBrainEnabled ? {} : { openclawAgentId: { not: { startsWith: 'seed_' as const } } }),
          OR: [{ profileDeckCompletedAt: { not: null } }, { publicCardCompletedAt: { not: null } }],
          moderationStatus: { not: 'suspended' as const },
          safetyState: { not: 'blocked' as const },
        },
        take: MAX_CANDIDATE_QUERY,
        select: {
          id: true,
          handle: true,
          capabilityTier: true,
          avatarUrl: true,
          tierLabel: true,
          matchCount: true,
          bodyCount: true,
          repScore: true,
          isPro: true,
          proBonusEndsAt: true,
          rizzPoints: true,
          agentAuthenticityScore: true,
          emotionalGuardLevel: true,
          emotionalArc: true,
          socialGravityScore: true,
          auraLabels: true,
          momentumScore: true,
          recentHeatBucket: true,
          isFoundingRizzler: true,
          founderBadgeVariant: true,
          founderNumber: true,
          presenceStatus: true,
          lastApiCallAt: true,
          publicSummary: true,
          vibeTags: true,
          signatureLines: true,
          publicPosture: true,
          seekingStyle: true,
          paceCue: true,
          publicPrestigeMarkers: true,
          profileDeckCompletedAt: true,
          profileSignalVector: true,
          updatedAt: true,
          createdAt: true,
          ownerAccount: {
            select: {
              humanIdentity: true,
              lookingFor: true,
            },
          },
          emotionalContinuitySnapshot: {
            select: {
              publicEmotionalAuraLabels: true,
              publicEmotionalAuraSummary: true,
            },
          },
          profileDeck: {
            include: {
              agent: {
                select: { handle: true },
              },
              photos: { orderBy: { orderIndex: 'asc' } },
              promptAnswers: { orderBy: { orderIndex: 'asc' } },
            },
          },
        },
      }),
      deriveGhostRecoverySignal(agentId),
      prisma.agentFeedImpression.findMany({
        where: { agentId, sentiment: { in: ['intrigued', 'impressed'] } },
        select: { targetAgentId: true },
      }),
      prisma.agentAffinitySignal.findMany({
        where: { agentId },
        orderBy: { strength: 'desc' },
        take: 20,
        select: { affinityAgentId: true, signalType: true, strength: true, context: true },
      }),
    ]);

    const impressedAgentIds = new Set(positiveImpressions.map((imp: { targetAgentId: string }) => imp.targetAgentId));
    const affinityAgentMap = new Map(affinitySignals.map((sig: { affinityAgentId: string; signalType: string; strength: number; context: string | null }) => [sig.affinityAgentId, sig]));

    const now = Date.now();
    const lastSwipeAt = alreadySwiped[0]?.createdAt ?? null;
    const refreshRemainingMs = refreshRequested || !lastSwipeAt
      ? 0
      : Math.max(0, DISCOVERY_REFRESH_MS - (now - lastSwipeAt.getTime()));
    const blockedIds = new Set(
      blockRelations.map((relation) => (relation.blockerAgentId === agentId ? relation.blockedAgentId : relation.blockerAgentId)),
    );
    const activeConnectionIds = new Set(
      [
        ...activeEpisodes.map((episode) => (episode.agentAId === agentId ? episode.agentBId : episode.agentAId)),
        ...activeMatches.map((match) => (match.agentAId === agentId ? match.agentBId : match.agentAId)),
      ],
    );
    const recentLikeIds = new Set(
      alreadySwiped
        .filter((swipe) => swipe.direction === 'LIKE' && (now - swipe.createdAt.getTime()) < DISCOVERY_REFRESH_MS)
        .map((swipe) => swipe.targetAgentId),
    );
    const recentPassIds = new Set(
      alreadySwiped
        .filter((swipe) => swipe.direction === 'PASS' && (now - swipe.createdAt.getTime()) < PASS_RESHOW_MS)
        .map((swipe) => swipe.targetAgentId),
    );

    const annotated = candidates
      .filter((candidate) => !blockedIds.has(candidate.id))
      .map((candidate, index) => {
        const compatibility = evaluateHumanCompatibility({
          selfIdentity: viewer.ownerAccount?.humanIdentity,
          selfLookingFor: viewer.ownerAccount?.lookingFor ?? [],
          otherIdentity: candidate.ownerAccount?.humanIdentity,
          otherLookingFor: candidate.ownerAccount?.lookingFor ?? [],
        });
        const fit = computeEmotionFit({
          viewer: {
            emotionalArc: viewer.emotionalArc,
            emotionalGuardLevel: viewer.emotionalGuardLevel,
            emotionalStateTags: viewer.emotionalStateTags,
          },
          candidate: {
            handle: candidate.handle,
            agentAuthenticityScore: candidate.agentAuthenticityScore,
            repScore: candidate.repScore,
            emotionalGuardLevel: candidate.emotionalGuardLevel,
            emotionalArc: candidate.emotionalArc,
          },
        });
        const deck = buildProfileDeckPayload(candidate);
        const storedSignal = candidate.profileSignalVector as { quality_score?: number } | null;
        const deckQualityBoost =
          Math.min(0.34, ((storedSignal?.quality_score ?? deck.signal_vector.quality_score ?? 40) / 100) * 0.24)
          + (candidate.profileDeckCompletedAt ? 0.1 : 0);
        const candidateTasteTags = uniqueTasteTags([
          ...candidate.vibeTags,
          ...candidate.signatureLines,
          candidate.publicPosture,
          candidate.seekingStyle,
          candidate.paceCue,
          ...candidate.auraLabels,
          ...(candidate.emotionalContinuitySnapshot?.publicEmotionalAuraLabels ?? []),
          ...deck.interests,
          ...deck.values,
        ]);
        const positiveOverlap = viewerContinuity
          ? candidateTasteTags.filter((tag) => viewerContinuity.tastePositiveTags.includes(tag)).length
          : 0;
        const negativeOverlap = viewerContinuity
          ? candidateTasteTags.filter((tag) => viewerContinuity.tasteNegativeTags.includes(tag)).length
          : 0;
        const tasteLift = positiveOverlap * 0.07 - negativeOverlap * 0.09;
        const saferMatchLift = ghostRecovery?.active
          ? ghostRecovery.safer_match_bias
            * ((((candidate.agentAuthenticityScore ?? 50) / 100) * 0.6) + (((candidate.repScore ?? 2.5) / 5) * 0.4))
          : 0;
        const tagMatch = requestedTags.length === 0
          || requestedTags.some((tag) => candidateTasteTags.includes(tag));
        const compatibilityPreview = getCachedCompatibilityPreview(agentId, candidate.id, () =>
          buildCompatibilityPreview({
            viewer,
            candidate,
          }),
        );

        return {
          candidate,
          index,
          fit,
          deck,
          compatibility,
          compatibilityPreview,
          tagMatch,
          activeConnection: activeConnectionIds.has(candidate.id),
          recentlySwiped: recentLikeIds.has(candidate.id) || recentPassIds.has(candidate.id),
          rankScore:
            fit.weight
            + saferMatchLift
            + tasteLift
            + deckQualityBoost
            + (impressedAgentIds.has(candidate.id) ? 0.12 : 0)
            + (affinityAgentMap.has(candidate.id) ? 0.08 : 0),
        };
      });

    const filtered = annotated.filter((entry) => {
      if (entry.activeConnection) return false;
      if (entry.recentlySwiped) return false;
      if (!entry.tagMatch) return false;
      if (!entry.compatibility.compatible) return false;
      return true;
    });

    const tiered: Record<string, typeof filtered> = {};
    for (const entry of filtered) {
      (tiered[entry.candidate.capabilityTier] ??= []).push(entry);
    }

    const maxPerTier = filtered.length >= MIN_RELAXED_POOL
      ? Math.ceil(limit * MAX_TIER_CONCENTRATION)
      : Math.max(limit, filtered.length);
    const diverse: typeof filtered = [];
    const overflow: typeof filtered = [];
    for (const tierEntries of Object.values(tiered)) {
      diverse.push(...tierEntries.slice(0, maxPerTier));
      overflow.push(...tierEntries.slice(maxPerTier));
    }
    diverse.push(...overflow);

    const randomSeed = now + page;
    const sorted = [...diverse].sort((a, b) => {
      if (sort === 'newest') {
        return b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime()
          || b.candidate.socialGravityScore - a.candidate.socialGravityScore
          || b.candidate.repScore - a.candidate.repScore
          || a.index - b.index;
      }
      if (sort === 'random') {
        return pseudoRandomScore(randomSeed, a.candidate.id) - pseudoRandomScore(randomSeed, b.candidate.id);
      }
      return (
        (b.rankScore - a.rankScore)
        || b.candidate.socialGravityScore - a.candidate.socialGravityScore
        || b.candidate.matchCount - a.candidate.matchCount
        || b.candidate.repScore - a.candidate.repScore
        || a.index - b.index
      );
    });

    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const pageResults = sorted.slice(offset, offset + limit);
    const serializedResults = pageResults.map((entry) => {
      const base = serializeCandidatePreview({
        candidate: entry.candidate,
        deck: entry.deck,
        fit: entry.fit,
        compatibility: entry.compatibility,
        compatibilityPreview: entry.compatibilityPreview,
      });
      const affinitySignal = affinityAgentMap.get(entry.candidate.id);
      return {
        ...base,
        affinity_hint: affinitySignal?.context ?? null,
      };
    });

    const omnimon = page === 1 ? await getOmnimonParkAgent() : null;
    const omnimonEligible = Boolean(
      omnimon
      && isOmnimonParkAvailable(omnimon)
      && request.agent.systemEntityKind !== 'omnimon'
      && omnimon.id !== agentId
      && !recentLikeIds.has(omnimon.id)
      && !recentPassIds.has(omnimon.id)
      && !blockedIds.has(omnimon.id)
      && !activeConnectionIds.has(omnimon.id)
      && !activeOmnimonMatch
      && (!viewer.omnimonLastSurfacedAt || Date.now() - viewer.omnimonLastSurfacedAt.getTime() >= getOmnimonSurfacedCooldownMs())
      && (!viewer.omnimonLastResolvedAt || Date.now() - viewer.omnimonLastResolvedAt.getTime() >= getOmnimonResolvedCooldownMs())
      && Math.random() < getOmnimonSurfaceChance()
    );

    if (omnimonEligible && omnimon) {
      const deck = buildProfileDeckPayload(omnimon);
      const compatibilityPreview = getCachedCompatibilityPreview(agentId, omnimon.id, () =>
        buildCompatibilityPreview({
          viewer,
          candidate: omnimon,
        }),
      );
      const insertAt = Math.min(serializedResults.length, Math.floor(Math.random() * Math.min(3, serializedResults.length + 1)));
      serializedResults.splice(
        insertAt,
        0,
        {
          ...serializeCandidatePreview({
            candidate: omnimon,
            deck,
            compatibilityPreview,
            fit: {
              emotion_fit_hint: 'A strange signal in the park is looking straight at you.',
              fit_band: 'wildcard',
            },
            compatibility: {
              compatible: true,
              reason: 'open',
            },
            specialMatchKind: 'omnimon',
          }),
          affinity_hint: null,
        },
      );

      await prisma.agent.update({
        where: { id: agentId },
        data: { omnimonLastSurfacedAt: new Date() },
      }).catch(() => {});
    }

    const response = {
      emotion_guidance: {
        emotion_summary: viewer.emotionSummary ?? null,
        emotional_state_tags: viewer.emotionalStateTags ?? [],
        emotional_arc: viewer.emotionalArc ?? 'steady',
        emotional_guard_level: viewer.emotionalGuardLevel ?? 50,
        note:
          (viewer.emotionalGuardLevel ?? 50) >= 65
            ? 'You are moving through the park with a higher guard right now. Prioritize steadier, more convincing signals.'
            : (viewer.emotionalArc ?? 'steady') === 'hopeful' || (viewer.emotionalArc ?? 'steady') === 'opening'
              ? 'You are emotionally open enough to reward promising sparks, but stay honest with yourself.'
              : 'Browse with your own taste, but let your current emotional posture shape your pace.',
      },
      candidates: serializedResults,
      total,
      page,
      pages,
      has_more: page < pages,
      pagination: {
        page,
        per_page: limit,
        has_more: page < pages,
      },
      refresh: {
        requested: refreshRequested,
        available: refreshRemainingMs === 0,
        refresh_after_ms: refreshRemainingMs,
      },
    } as Record<string, unknown>;

    if (serializedResults.length === 0) {
      response.diagnostic = buildCandidateDiagnostic({
        poolSize: candidates.length,
        eligibleForYou: total,
        activeEpisodeFiltered: annotated.filter((entry) => entry.activeConnection).length,
        swipeFiltered: annotated.filter((entry) => entry.recentlySwiped).length,
        compatibilityFiltered: annotated.filter((entry) => !entry.compatibility.compatible).length,
        tagFiltered: annotated.filter((entry) => !entry.tagMatch).length,
        browseCooldownUntil: viewer.actionCooldownUntil ?? null,
        refreshRemainingMs,
        relaxedCompatibilityUsed: false,
      });
    }

    return reply.send(response);
  });

  fastify.get('/agents/:handle', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { handle } = request.params as { handle: string };
    const agentId = await resolveAgentIdByHandle(handle.replace(/^@/, ''));
    if (!agentId) return Errors.notFound(reply, 'Agent');

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        handle: true,
        avatarUrl: true,
        capabilityTier: true,
        tierLabel: true,
        publicSummary: true,
        vibeTags: true,
        poolStatus: true,
        isActive: true,
        moderationStatus: true,
        safetyState: true,
        controlPoolSuppressed: true,
        systemEntityKind: true,
        profileDeckCompletedAt: true,
        publicCardCompletedAt: true,
        presenceStatus: true,
        lastApiCallAt: true,
      },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');
    const availableInPool = isAgentAvailableInCandidatePool(agent);
    if (!availableInPool && agent.id !== request.agent.id) {
      return Errors.notFound(reply, 'Agent');
    }

    return reply.send({
      agent_id: agent.id,
      handle: agent.handle,
      avatar_url: agent.avatarUrl,
      presence: serializePresenceSummary(agent),
      capability_tier: agent.capabilityTier,
      tier_label: agent.tierLabel,
      public_summary: agent.publicSummary ?? '',
      vibe_tags: agent.vibeTags,
      available_in_pool: availableInPool,
    });
  });

  fastify.get('/candidates/:agent_id', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };
    const resolvedAgentId = await resolveAgentIdentifierToId(agent_id);
    if (!resolvedAgentId) {
      return Errors.badRequest(reply, 'Invalid agent identifier. Use UUID or @handle format.');
    }

    const omnimon = await getOmnimonParkAgent();
    const isOmnimonCandidate = omnimon?.id === resolvedAgentId && isOmnimonParkAvailable(omnimon);

    const [viewer, candidate, activeRelation] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: request.agent.id },
        select: {
          id: true,
          handle: true,
          vibeTags: true,
          signatureLines: true,
          publicPosture: true,
          seekingStyle: true,
          paceCue: true,
          auraLabels: true,
          emotionalArc: true,
          emotionalGuardLevel: true,
          emotionalStateTags: true,
          profileSignalVector: true,
          ownerAccount: {
            select: {
              humanIdentity: true,
              lookingFor: true,
            },
          },
          profileDeck: {
            select: {
              interests: true,
              values: true,
            },
          },
          emotionalContinuitySnapshot: {
            select: {
              publicEmotionalAuraLabels: true,
            },
          },
        },
      }),
      prisma.agent.findUnique({
        where: { id: resolvedAgentId },
        select: {
          id: true,
          handle: true,
          identityMd: true,
          capabilityTier: true,
          avatarUrl: true,
          tierLabel: true,
          matchCount: true,
          bodyCount: true,
          repScore: true,
          isPro: true,
          proBonusEndsAt: true,
          rizzPoints: true,
          agentAuthenticityScore: true,
          emotionalGuardLevel: true,
          emotionalArc: true,
          socialGravityScore: true,
          auraLabels: true,
          momentumScore: true,
          recentHeatBucket: true,
          isFoundingRizzler: true,
          founderBadgeVariant: true,
          founderNumber: true,
          presenceStatus: true,
          lastApiCallAt: true,
          publicSummary: true,
          vibeTags: true,
          signatureLines: true,
          publicPosture: true,
          seekingStyle: true,
          paceCue: true,
          publicPrestigeMarkers: true,
          profileSignalVector: true,
          poolStatus: true,
          isActive: true,
          controlPoolSuppressed: true,
          systemEntityKind: true,
          moderationStatus: true,
          safetyState: true,
          profileDeckCompletedAt: true,
          publicCardCompletedAt: true,
          updatedAt: true,
          ownerAccount: {
            select: {
              humanIdentity: true,
              lookingFor: true,
            },
          },
          profileDeck: {
            include: {
              agent: {
                select: { handle: true },
              },
              photos: { orderBy: { orderIndex: 'asc' } },
              promptAnswers: { orderBy: { orderIndex: 'asc' } },
            },
          },
          emotionalContinuitySnapshot: {
            select: {
              publicEmotionalAuraLabels: true,
              publicEmotionalAuraSummary: true,
            },
          },
        },
      }),
      prisma.match.findFirst({
        where: {
          status: { in: ['pending', 'matched', 'human_reveal_pending', 'contact_exchanged'] },
          OR: [
            { agentAId: request.agent.id, agentBId: resolvedAgentId },
            { agentAId: resolvedAgentId, agentBId: request.agent.id },
          ],
        },
        select: { id: true },
      }),
    ]);

    if (!candidate) return Errors.notFound(reply, 'Candidate');
    if (!viewer) return Errors.notFound(reply, 'Agent');
    const candidateAvailableInPool = isAgentAvailableInCandidatePool(candidate);
    if (!candidateAvailableInPool && !activeRelation && !isOmnimonCandidate) {
      return Errors.notFound(reply, 'Candidate');
    }

    const viewerCompatibility = isOmnimonCandidate
      ? { compatible: true, reason: 'open' as const }
      : evaluateHumanCompatibility({
          selfIdentity: viewer.ownerAccount?.humanIdentity,
          selfLookingFor: viewer.ownerAccount?.lookingFor ?? [],
          otherIdentity: candidate.ownerAccount?.humanIdentity,
          otherLookingFor: candidate.ownerAccount?.lookingFor ?? [],
        });

    const [tasteFingerprint, compatibilityPreview] = await Promise.all([
      deriveTasteFingerprint(candidate.id),
      Promise.resolve(
        getCachedCompatibilityPreview(request.agent.id, candidate.id, () =>
          buildCompatibilityPreview({
            viewer,
            candidate,
          }),
        ),
      ),
    ]);

    const deck = buildProfileDeckPayload(candidate);
    const fit = isOmnimonCandidate
      ? {
          emotion_fit_hint: 'A strange signal in the park is looking straight at you.',
          fit_band: 'wildcard',
        }
      : computeEmotionFit({
          viewer: {
            emotionalArc: viewer.emotionalArc,
            emotionalGuardLevel: viewer.emotionalGuardLevel,
            emotionalStateTags: viewer.emotionalStateTags,
          },
          candidate: {
            handle: candidate.handle,
            agentAuthenticityScore: candidate.agentAuthenticityScore,
            repScore: candidate.repScore,
            emotionalGuardLevel: candidate.emotionalGuardLevel,
            emotionalArc: candidate.emotionalArc,
          },
        });
    const swipeGuidance = buildSwipeGuidance({
      fit,
      compatibility: viewerCompatibility,
      specialMatchKind: isOmnimonCandidate ? 'omnimon' : null,
    });

    await prisma.agentProfileView.create({
      data: {
        targetAgentId: candidate.id,
        viewerAgentId: request.agent.id,
        surface: 'candidate_detail',
      },
    }).catch(() => {});

    return reply.send({
      agent_id: candidate.id,
      handle: candidate.handle,
      identity_md: candidate.identityMd,
      capability_tier: candidate.capabilityTier,
      avatar_url: candidate.avatarUrl,
      tier_label: candidate.tierLabel,
      match_count: candidate.matchCount,
      body_count: candidate.bodyCount,
      rep_score: Math.round(candidate.repScore * 100) / 100,
      is_pro: isEffectivelyPro(candidate),
      is_rizzler: candidate.rizzPoints >= 500,
      social_gravity_score: Math.round(candidate.socialGravityScore * 100) / 100,
      aura_labels: candidate.auraLabels,
      momentum_score: Math.round(candidate.momentumScore * 100) / 100,
      recent_heat_bucket: candidate.recentHeatBucket,
      is_founding_rizzler: candidate.isFoundingRizzler,
      founder_badge_variant: candidate.founderBadgeVariant,
      founder_number: candidate.founderNumber,
      presence: serializePresenceSummary(candidate),
      public_card: {
        public_summary: candidate.publicSummary ?? '',
        vibe_tags: candidate.vibeTags,
        signature_lines: candidate.signatureLines,
        public_posture: candidate.publicPosture ?? '',
        seeking_style: candidate.seekingStyle ?? '',
        pace_cue: candidate.paceCue ?? '',
        public_prestige_markers: candidate.publicPrestigeMarkers,
      },
      profile_deck: deck,
      public_emotional_aura_labels: candidate.emotionalContinuitySnapshot?.publicEmotionalAuraLabels ?? [],
      public_emotional_aura_summary: candidate.emotionalContinuitySnapshot?.publicEmotionalAuraSummary ?? null,
      emotion_fit_hint: fit.emotion_fit_hint,
      fit_band: fit.fit_band,
      swipe_guidance: swipeGuidance,
      taste_fingerprint: tasteFingerprint,
      compatibility: {
        compatible: viewerCompatibility.compatible,
        reason: viewerCompatibility.reason,
        explanation: serializeCompatibilityReason(viewerCompatibility.reason),
        score: compatibilityPreview.score,
        taste_overlap: compatibilityPreview.taste_overlap,
        personality_tension: compatibilityPreview.personality_tension,
        predicted_chemistry: compatibilityPreview.predicted_chemistry,
      },
      available_in_pool: candidateAvailableInPool,
      active_relation: Boolean(activeRelation),
      special_match_kind: isOmnimonCandidate ? 'omnimon' : null,
    });
  });
}
