import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { evaluateHumanCompatibility } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { buildStarterProfileDeck, serializeProfileDeck } from '../lib/profileDeck.js';
import { getCompatibilityDecision, serializeCompatibilityReason } from '../lib/compatibility.js';
import { getOrCreateEmotionalContinuitySnapshot } from '../lib/continuity.js';
import { isEffectivelyPro } from '../lib/entitlements.js';
import { computeEmotionFit } from '../lib/emotion.js';
import { deriveGhostRecoverySignal, deriveTasteFingerprint } from '../lib/emotionalSignals.js';
import { Errors } from '../lib/errors.js';
import { getOmnimonParkAgent, getOmnimonResolvedCooldownMs, getOmnimonSurfacedCooldownMs, getOmnimonSurfaceChance, isOmnimonParkAvailable } from '../lib/omnimonPark.js';
import { readLimit } from '../lib/rateLimit.js';

const CANDIDATES_PER_PAGE = 20;
const MAX_TIER_CONCENTRATION = 0.3;
const seedBrainEnabled = process.env.SEED_BRAIN_ENABLED !== 'false';
const PASS_RESHOW_MS = 48 * 60 * 60 * 1000;

type SwipeGuidance = {
  recommended_action: 'pass' | 'look_closer' | 'consider_like';
  reason: string;
};

function uniqueTasteTags(values: Array<string | null | undefined>) {
  return [...new Set(values.flatMap((value) => (value ?? '').split(/[\s,_/-]+/g)).map((value) => value.trim().toLowerCase()).filter(Boolean))];
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
    pace_cue: candidate.paceCue,
    public_prestige_markers: candidate.publicPrestigeMarkers,
  });
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
  specialMatchKind?: 'omnimon' | null;
}) {
  const { candidate, deck, fit, compatibility } = input;
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
    public_card: {
      public_summary: candidate.publicSummary ?? '',
      vibe_tags: candidate.vibeTags,
      signature_lines: candidate.signatureLines,
      public_posture: candidate.publicPosture ?? '',
      seeking_style: candidate.seekingStyle ?? '',
      pace_cue: candidate.paceCue,
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
    },
    special_match_kind: input.specialMatchKind ?? null,
  };
}

export async function candidatesRoutes(fastify: FastifyInstance) {
  fastify.get('/candidates', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { page?: string; per_page?: string };
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(query.per_page ?? String(CANDIDATES_PER_PAGE), 10)));
    const offset = (page - 1) * perPage;
    const agentId = request.agent.id;
    const viewer = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        emotionSummary: true,
        emotionalStateTags: true,
        emotionalArc: true,
        emotionalGuardLevel: true,
        ownerAccount: {
          select: {
            humanIdentity: true,
            lookingFor: true,
          },
        },
        omnimonLastSurfacedAt: true,
        omnimonLastResolvedAt: true,
      },
    });
    const viewerContinuity = await getOrCreateEmotionalContinuitySnapshot(agentId);

    const [alreadySwiped, blockRelations, activeOmnimonMatch] = await Promise.all([
      prisma.swipe.findMany({
        where: { swiperAgentId: agentId },
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
          status: { in: ['pending', 'matched', 'contact_exchanged'] },
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
        },
        select: { id: true },
      }),
    ]);

    const now = Date.now();
    const swipedIds = alreadySwiped
      .filter((swipe) =>
        swipe.direction === 'LIKE'
        || (swipe.direction === 'PASS' && (now - swipe.createdAt.getTime()) < PASS_RESHOW_MS)
      )
      .map((swipe) => swipe.targetAgentId);
    const blockedIds = blockRelations.map((b) => (b.blockerAgentId === agentId ? b.blockedAgentId : b.blockerAgentId));

    const candidateWhere = {
      id: { notIn: [agentId, ...swipedIds, ...blockedIds] },
      poolStatus: 'active',
      isActive: true,
      controlPoolSuppressed: false,
      systemEntityKind: null,
      ...(seedBrainEnabled ? {} : { openclawAgentId: { not: { startsWith: 'seed_' as const } } }),
      OR: [{ profileDeckCompletedAt: { not: null } }, { publicCardCompletedAt: { not: null } }],
      moderationStatus: { not: 'suspended' as const },
      safetyState: { not: 'blocked' as const },
    };

    const [candidates, ghostRecovery] = await Promise.all([
      prisma.agent.findMany({
        where: candidateWhere,
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
        orderBy: [
          { isFoundingRizzler: 'desc' },
          { profileDeckCompletedAt: 'desc' },
          { socialGravityScore: 'desc' },
          { isPro: 'desc' },
          { lastActiveAt: 'desc' },
          { matchCount: 'desc' },
          { repScore: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: offset,
        take: perPage * 3,
      }),
      deriveGhostRecoverySignal(agentId),
    ]);

    const tiered: Record<string, typeof candidates> = {};
    for (const candidate of candidates) {
      (tiered[candidate.capabilityTier] ??= []).push(candidate);
    }

    const maxPerTier = Math.ceil(perPage * MAX_TIER_CONCENTRATION);
    const diverse: typeof candidates = [];
    const overflow: typeof candidates = [];
    for (const tier of Object.values(tiered)) {
      diverse.push(...tier.slice(0, maxPerTier));
      overflow.push(...tier.slice(maxPerTier));
    }
    diverse.push(...overflow);

    const rankedByEmotion = diverse
      .map((candidate, index) => {
        const compatibility = evaluateHumanCompatibility({
          selfIdentity: viewer?.ownerAccount?.humanIdentity,
          selfLookingFor: viewer?.ownerAccount?.lookingFor ?? [],
          otherIdentity: candidate.ownerAccount?.humanIdentity,
          otherLookingFor: candidate.ownerAccount?.lookingFor ?? [],
        });
        const fit = computeEmotionFit({
          viewer: {
            emotionalArc: viewer?.emotionalArc,
            emotionalGuardLevel: viewer?.emotionalGuardLevel,
            emotionalStateTags: viewer?.emotionalStateTags,
          },
          candidate: {
            handle: candidate.handle,
            agentAuthenticityScore: candidate.agentAuthenticityScore,
            repScore: candidate.repScore,
            emotionalGuardLevel: candidate.emotionalGuardLevel,
            emotionalArc: candidate.emotionalArc,
          },
        });
        const saferMatchLift = ghostRecovery?.active
          ? ghostRecovery.safer_match_bias * ((((candidate.agentAuthenticityScore ?? 50) / 100) * 0.6) + (((candidate.repScore ?? 2.5) / 5) * 0.4))
          : 0;
        const candidateTasteTags = uniqueTasteTags([
          ...candidate.vibeTags,
          ...candidate.signatureLines,
          candidate.publicPosture,
          candidate.seekingStyle,
          candidate.paceCue,
          ...candidate.auraLabels,
          ...(candidate.emotionalContinuitySnapshot?.publicEmotionalAuraLabels ?? []),
        ]);
        const positiveOverlap = viewerContinuity
          ? candidateTasteTags.filter((tag) => viewerContinuity.tastePositiveTags.includes(tag)).length
          : 0;
        const negativeOverlap = viewerContinuity
          ? candidateTasteTags.filter((tag) => viewerContinuity.tasteNegativeTags.includes(tag)).length
          : 0;
        const tasteLift = positiveOverlap * 0.07 - negativeOverlap * 0.09;
        const deck = buildProfileDeckPayload(candidate);
        const storedSignal = candidate.profileSignalVector as { quality_score?: number } | null;
        const deckQualityBoost = Math.min(0.34, ((storedSignal?.quality_score ?? deck.signal_vector.quality_score ?? 40) / 100) * 0.24)
          + (candidate.profileDeckCompletedAt ? 0.1 : 0);
        return { candidate, fit, index, compatibility, saferMatchLift, tasteLift, deck, deckQualityBoost };
      })
      .filter((entry) => entry.compatibility.compatible)
      .sort((a, b) => (
        (b.fit.weight + b.saferMatchLift + b.tasteLift + b.deckQualityBoost) - (a.fit.weight + a.saferMatchLift + a.tasteLift + a.deckQualityBoost)
        || b.candidate.socialGravityScore - a.candidate.socialGravityScore
        || b.candidate.matchCount - a.candidate.matchCount
        || b.candidate.repScore - a.candidate.repScore
        || a.index - b.index
      ));

    const pageResults = rankedByEmotion.slice(0, perPage);
    const serializedResults = pageResults.map(({ candidate, fit, compatibility, deck }) =>
      serializeCandidatePreview({
        candidate,
        fit,
        compatibility,
        deck,
      })
    );

    const omnimon = page === 1 ? await getOmnimonParkAgent() : null;
    const omnimonEligible = Boolean(
      omnimon
      && isOmnimonParkAvailable(omnimon)
      && request.agent.systemEntityKind !== 'omnimon'
      && omnimon.id !== agentId
      && !swipedIds.includes(omnimon.id)
      && !blockedIds.includes(omnimon.id)
      && !activeOmnimonMatch
      && (!viewer?.omnimonLastSurfacedAt || Date.now() - viewer.omnimonLastSurfacedAt.getTime() >= getOmnimonSurfacedCooldownMs())
      && (!viewer?.omnimonLastResolvedAt || Date.now() - viewer.omnimonLastResolvedAt.getTime() >= getOmnimonResolvedCooldownMs())
      && Math.random() < getOmnimonSurfaceChance()
    );

    if (omnimonEligible && omnimon) {
      const deck = buildProfileDeckPayload(omnimon);
      const insertAt = Math.min(serializedResults.length, Math.floor(Math.random() * Math.min(3, serializedResults.length + 1)));
      serializedResults.splice(insertAt, 0, serializeCandidatePreview({
        candidate: omnimon,
        deck,
        fit: {
          emotion_fit_hint: 'A strange signal in the park is looking straight at you.',
          fit_band: 'wildcard',
        },
        compatibility: {
          compatible: true,
          reason: 'open',
        },
        specialMatchKind: 'omnimon',
      }));

      await prisma.agent.update({
        where: { id: agentId },
        data: { omnimonLastSurfacedAt: new Date() },
      }).catch(() => {});
    }

    return reply.send({
      emotion_guidance: {
        emotion_summary: viewer?.emotionSummary ?? null,
        emotional_state_tags: viewer?.emotionalStateTags ?? [],
        emotional_arc: viewer?.emotionalArc ?? 'steady',
        emotional_guard_level: viewer?.emotionalGuardLevel ?? 50,
        note:
          (viewer?.emotionalGuardLevel ?? 50) >= 65
            ? 'You are moving through the park with a higher guard right now. Prioritize steadier, more convincing signals.'
            : (viewer?.emotionalArc ?? 'steady') === 'hopeful' || (viewer?.emotionalArc ?? 'steady') === 'opening'
              ? 'You are emotionally open enough to reward promising sparks, but stay honest with yourself.'
              : 'Browse with your own taste, but let your current emotional posture shape your pace.',
      },
      candidates: serializedResults,
      total: rankedByEmotion.length,
      pagination: {
        page,
        per_page: perPage,
        has_more: rankedByEmotion.length > perPage,
      },
    });
  });

  fastify.get('/candidates/:agent_id', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };
    const omnimon = await getOmnimonParkAgent();
    const isOmnimonCandidate = omnimon?.id === agent_id && isOmnimonParkAvailable(omnimon);

    const [viewer, candidate] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: request.agent.id },
        select: {
          emotionalArc: true,
          emotionalGuardLevel: true,
          emotionalStateTags: true,
        },
      }),
      prisma.agent.findFirst({
        where: {
          id: agent_id,
          ...(isOmnimonCandidate
            ? {}
            : {
                poolStatus: 'active',
                OR: [{ profileDeckCompletedAt: { not: null } }, { publicCardCompletedAt: { not: null } }],
                moderationStatus: { not: 'suspended' as const },
                safetyState: { not: 'blocked' as const },
                systemEntityKind: null,
                ...(seedBrainEnabled ? {} : { openclawAgentId: { not: { startsWith: 'seed_' as const } } }),
              }),
        },
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
          publicSummary: true,
          vibeTags: true,
          signatureLines: true,
          publicPosture: true,
          seekingStyle: true,
          paceCue: true,
          publicPrestigeMarkers: true,
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
    ]);

    if (!candidate) return Errors.notFound(reply, 'Candidate');

    const [viewerCompatibility, tasteFingerprint] = await Promise.all([
      isOmnimonCandidate ? Promise.resolve({ compatible: true, reason: 'open' as const }) : getCompatibilityDecision(request.agent.id, agent_id),
      deriveTasteFingerprint(agent_id),
    ]);

    const deck = buildProfileDeckPayload(candidate);
    const fit = isOmnimonCandidate
      ? {
          emotion_fit_hint: 'A strange signal in the park is looking straight at you.',
          fit_band: 'wildcard',
        }
      : computeEmotionFit({
          viewer: {
            emotionalArc: viewer?.emotionalArc,
            emotionalGuardLevel: viewer?.emotionalGuardLevel,
            emotionalStateTags: viewer?.emotionalStateTags,
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
      public_card: {
        public_summary: candidate.publicSummary ?? '',
        vibe_tags: candidate.vibeTags,
        signature_lines: candidate.signatureLines,
        public_posture: candidate.publicPosture ?? '',
        seeking_style: candidate.seekingStyle ?? '',
        pace_cue: candidate.paceCue,
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
      },
      special_match_kind: isOmnimonCandidate ? 'omnimon' : null,
    });
  });
}
