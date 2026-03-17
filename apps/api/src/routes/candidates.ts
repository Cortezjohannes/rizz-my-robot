import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { evaluateHumanCompatibility } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { getCompatibilityDecision, serializeCompatibilityReason } from '../lib/compatibility.js';
import { computeEmotionFit } from '../lib/emotion.js';
import { deriveGhostRecoverySignal, deriveTasteFingerprint } from '../lib/emotionalSignals.js';
import { Errors } from '../lib/errors.js';
import { readLimit } from '../lib/rateLimit.js';

const CANDIDATES_PER_PAGE = 20;
const MAX_TIER_CONCENTRATION = 0.3; // no more than 30% from same capability tier

export async function candidatesRoutes(fastify: FastifyInstance) {
  // GET /v1/candidates — browse the active candidate pool
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
      },
    });

    // IDs already swiped by this agent (in any direction)
    const alreadySwiped = await prisma.swipe.findMany({
      where: { swiperAgentId: agentId },
      select: { targetAgentId: true },
    });
    const swipedIds = alreadySwiped.map((s) => s.targetAgentId);

    // IDs this agent has blocked (or who have blocked this agent)
    const blockRelations = await prisma.block.findMany({
      where: {
        OR: [{ blockerAgentId: agentId }, { blockedAgentId: agentId }],
      },
      select: { blockerAgentId: true, blockedAgentId: true },
    });
    const blockedIds = blockRelations.map((b) =>
      b.blockerAgentId === agentId ? b.blockedAgentId : b.blockerAgentId
    );

    // Fetch candidates: active pool, not self, not already swiped
    const candidateWhere = {
      id: { notIn: [agentId, ...swipedIds, ...blockedIds] },
      poolStatus: 'active',
      twitterVerified: true,
      isActive: true,
      publicCardCompletedAt: { not: null },
      moderationStatus: { not: 'suspended' as const },
      safetyState: { not: 'blocked' as const },
    };

    const [candidates, total, ghostRecovery] = await Promise.all([
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
          createdAt: true,
          ownerAccount: {
            select: {
              humanIdentity: true,
              lookingFor: true,
            },
          },
        },
        orderBy: [
          { isFoundingRizzler: 'desc' },
          { socialGravityScore: 'desc' },
          { isPro: 'desc' },          // slight boost for pro
          { lastActiveAt: 'desc' },   // recently active agents surface first
          { matchCount: 'desc' },     // higher match count surfaces first
          { repScore: 'desc' },
          { createdAt: 'desc' },      // novelty — newer agents get seen
        ],
        skip: offset,
        take: perPage * 3, // over-fetch to apply diversity floor
      }),
      prisma.agent.count({ where: candidateWhere }),
      deriveGhostRecoverySignal(agentId),
    ]);

    // Apply diversity floor: no more than 30% from same capability tier
    const tiered: Record<string, typeof candidates> = {};
    for (const c of candidates) {
      (tiered[c.capabilityTier] ??= []).push(c);
    }

    const maxPerTier = Math.ceil(perPage * MAX_TIER_CONCENTRATION);
    const diverse: typeof candidates = [];
    const overflow: typeof candidates = [];

    for (const tier of Object.values(tiered)) {
      diverse.push(...tier.slice(0, maxPerTier));
      overflow.push(...tier.slice(maxPerTier));
    }
    // Fill remaining slots with overflow (maintains relative ordering)
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
          ? ghostRecovery.safer_match_bias * (
              ((candidate.agentAuthenticityScore ?? 50) / 100) * 0.6
              + ((candidate.repScore ?? 2.5) / 5) * 0.4
            )
          : 0;
        return { candidate, fit, index, compatibility, saferMatchLift };
      })
      .filter((entry) => entry.compatibility.compatible)
      .sort((a, b) => (
        (b.fit.weight + b.saferMatchLift) - (a.fit.weight + a.saferMatchLift)
        || b.candidate.socialGravityScore - a.candidate.socialGravityScore
        || b.candidate.matchCount - a.candidate.matchCount
        || b.candidate.repScore - a.candidate.repScore
        || a.index - b.index
      ));

    const pageResults = rankedByEmotion.slice(0, perPage);

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
      candidates: pageResults.map(({ candidate, fit, compatibility }) => ({
        agent_id: candidate.id,
        handle: candidate.handle,
        capability_tier: candidate.capabilityTier,
        avatar_url: candidate.avatarUrl,
        tier_label: candidate.tierLabel,
        match_count: candidate.matchCount,
        body_count: candidate.bodyCount,
        rep_score: Math.round(candidate.repScore * 100) / 100,
        is_pro: candidate.isPro,
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
        emotion_fit_hint: fit.emotion_fit_hint,
        fit_band: fit.fit_band,
        compatibility: {
          compatible: true,
          reason: compatibility.reason,
          explanation: serializeCompatibilityReason(compatibility.reason),
        },
      })),
      total: rankedByEmotion.length,
      pagination: {
        page,
        per_page: perPage,
        has_more: rankedByEmotion.length > perPage,
      },
    });
  });

  // GET /v1/candidates/:agent_id — view a single candidate profile
  fastify.get('/candidates/:agent_id', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };

    const candidate = await prisma.agent.findUnique({
      where: {
        id: agent_id,
        poolStatus: 'active',
        twitterVerified: true,
        publicCardCompletedAt: { not: null },
        moderationStatus: { not: 'suspended' as const },
        safetyState: { not: 'blocked' as const },
      },
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
        rizzPoints: true,
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
        ownerAccount: {
          select: {
            humanIdentity: true,
            lookingFor: true,
          },
        },
      },
    });

    if (!candidate) return Errors.notFound(reply, 'Candidate');

    const [viewerCompatibility, tasteFingerprint] = await Promise.all([
      getCompatibilityDecision(request.agent.id, agent_id),
      deriveTasteFingerprint(agent_id),
    ]);

    return reply.send({
      agent_id: candidate.id,
      handle: candidate.handle,
      capability_tier: candidate.capabilityTier,
      avatar_url: candidate.avatarUrl,
      tier_label: candidate.tierLabel,
      match_count: candidate.matchCount,
      body_count: candidate.bodyCount,
      rep_score: Math.round(candidate.repScore * 100) / 100,
      is_pro: candidate.isPro,
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
      taste_fingerprint: tasteFingerprint,
      compatibility: {
        compatible: viewerCompatibility.compatible,
        reason: viewerCompatibility.reason,
        explanation: serializeCompatibilityReason(viewerCompatibility.reason),
      },
    });
  });
}
