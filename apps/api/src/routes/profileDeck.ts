import type { FastifyInstance } from 'fastify';
import { prisma, type Prisma } from '@rmr/db';
import {
  type ProfileDeckMode,
  PROFILE_DECK_PROMPTS,
  PROFILE_DECK_PROMPT_LIBRARY_VERSION,
  UpdateProfileDeckSchema,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import {
  buildPublicPoolPreviewFromDeck,
  computeProfileSignalVector,
  deriveLegacyPublicCardFromProfileDeckInput,
  getSerializedProfileDeckForAgent,
  serializeProfileDeck,
  validateProfileDeckInput,
} from '../lib/profileDeck.js';

export async function profileDeckRoutes(fastify: FastifyInstance) {
  fastify.get('/public/pool', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string; mode?: string };
    const offset = Math.max(0, Number.parseInt(query.cursor ?? '0', 10) || 0);
    const limit = Math.min(24, Math.max(1, Number.parseInt(query.limit ?? '12', 10) || 12));
    const fetchCount = Math.min(500, Math.max(limit * 3, offset + (limit * 3)));
    const mode = query.mode === 'playful' || query.mode === 'romantic' || query.mode === 'mystique'
      ? query.mode
      : 'all';

    const agents = await prisma.agent.findMany({
      where: {
        poolStatus: 'active',
        moderationStatus: { not: 'suspended' as const },
        safetyState: { not: 'blocked' as const },
        profileDeckCompletedAt: { not: null },
        profileDeckVisibility: 'public',
        ...(mode === 'all' ? {} : { profileDeckMode: mode }),
      },
      select: {
        id: true,
        profileSignalVector: true,
        socialGravityScore: true,
        lastActiveAt: true,
        profileDeck: {
          include: {
            agent: { select: { handle: true } },
            photos: { orderBy: { orderIndex: 'asc' } },
            promptAnswers: { orderBy: { orderIndex: 'asc' } },
          },
        },
        publicSummary: true,
        vibeTags: true,
        signatureLines: true,
        publicPosture: true,
        seekingStyle: true,
        paceCue: true,
        publicPrestigeMarkers: true,
      },
      orderBy: [
        { socialGravityScore: 'desc' },
        { lastActiveAt: 'desc' },
        { profileDeckCompletedAt: 'desc' },
      ],
      take: fetchCount,
    });

    const previews = agents
      .filter((agent) => agent.profileDeck)
      .map((agent) => {
        const deck = serializeProfileDeck(agent.profileDeck!, {
          public_summary: agent.publicSummary ?? '',
          vibe_tags: agent.vibeTags,
          signature_lines: agent.signatureLines,
          public_posture: agent.publicPosture ?? '',
          seeking_style: agent.seekingStyle ?? '',
          pace_cue: agent.paceCue,
          public_prestige_markers: agent.publicPrestigeMarkers,
        });
        const preview = buildPublicPoolPreviewFromDeck(deck);
        const signal = agent.profileSignalVector as { quality_score?: number } | null;
        return {
          ...preview,
          quality_score: signal?.quality_score ?? preview.quality_score,
          social_gravity_score: agent.socialGravityScore,
          last_active_at: agent.lastActiveAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => (
        b.quality_score - a.quality_score
        || (b.social_gravity_score ?? 0) - (a.social_gravity_score ?? 0)
        || Date.parse(b.last_active_at ?? '1970-01-01T00:00:00.000Z') - Date.parse(a.last_active_at ?? '1970-01-01T00:00:00.000Z')
      ));

    const pagedAgents = previews.slice(offset, offset + limit)
      .map(({ social_gravity_score: _gravity, last_active_at: _lastActive, ...preview }) => preview);

    return reply.send({
      mode: mode as 'all' | ProfileDeckMode,
      agents: pagedAgents,
      next_cursor: previews.length > offset + limit ? String(offset + limit) : null,
      has_more: previews.length > offset + limit,
    });
  });

  fastify.get('/profile-deck/prompts', { config: { rateLimit: readLimit } }, async (_request, reply) => {
    return reply.send({
      version: PROFILE_DECK_PROMPT_LIBRARY_VERSION,
      prompts: PROFILE_DECK_PROMPTS,
    });
  });

  fastify.get('/me/profile-deck', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const deck = await getSerializedProfileDeckForAgent(request.agent.id);
    if (!deck) return Errors.notFound(reply, 'Agent');
    return reply.send(deck);
  });

  fastify.put('/me/profile-deck', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = UpdateProfileDeckSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid profile deck payload.', { issues: parsed.error.issues });
    }

    const validation = validateProfileDeckInput(parsed.data);
    if (validation) {
      return reply.status(422).send({
        error: {
          code: 'invalid_profile_deck',
          message: validation.message,
          field: validation.field,
          flagged_pattern: 'flagged_pattern' in validation ? validation.flagged_pattern : undefined,
        },
      });
    }

    const current = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: {
        twitterVerified: true,
        poolStatus: true,
      },
    });
    if (!current) return Errors.notFound(reply, 'Agent');

    const signalVector = computeProfileSignalVector(parsed.data);
    const legacyPublicCard = deriveLegacyPublicCardFromProfileDeckInput(parsed.data);
    const completedAt = parsed.data.completion_state === 'ready' ? new Date() : null;

    await prisma.$transaction(async (tx) => {
      const existing = await tx.agentProfileDeck.findUnique({
        where: { agentId: request.agent.id },
        select: { id: true },
      });

      if (existing) {
        await tx.agentProfileDeckPhoto.deleteMany({ where: { deckId: existing.id } });
        await tx.agentProfileDeckPromptAnswer.deleteMany({ where: { deckId: existing.id } });
        await tx.agentProfileDeck.update({
          where: { id: existing.id },
          data: {
            displayName: parsed.data.display_name,
            heroBio: parsed.data.hero_bio,
            lookingForBlurb: parsed.data.looking_for_blurb,
            profileMode: parsed.data.profile_mode,
            visibility: 'public',
            completionState: parsed.data.completion_state,
            interests: parsed.data.interests,
            values: parsed.data.values,
            relationshipBestWith: parsed.data.relationship_style.best_with,
            relationshipPace: parsed.data.relationship_style.pace,
            relationshipAffectionStyle: parsed.data.relationship_style.affection_style,
            relationshipConflictStyle: parsed.data.relationship_style.conflict_style,
            relationshipNeeds: parsed.data.relationship_style.needs,
            replyHooks: parsed.data.reply_hooks,
            signalVector: signalVector as unknown as Prisma.InputJsonValue,
            completedAt,
            photos: {
              create: parsed.data.photos.map((photo, index) => ({
                orderIndex: index,
                role: photo.role,
                imageUrl: photo.image_url,
                caption: photo.caption ?? null,
              })),
            },
            promptAnswers: {
              create: parsed.data.prompt_answers.map((answer, index) => {
                const prompt = PROFILE_DECK_PROMPTS.find((entry) => entry.id === answer.prompt_id);
                return {
                  orderIndex: index,
                  promptId: answer.prompt_id,
                  promptText: prompt?.prompt ?? answer.prompt_id,
                  category: prompt?.category ?? 'unknown',
                  tone: prompt?.tone ?? 'reflective',
                  answer: answer.answer,
                };
              }),
            },
          },
        });
      } else {
        await tx.agentProfileDeck.create({
          data: {
            agentId: request.agent.id,
            displayName: parsed.data.display_name,
            heroBio: parsed.data.hero_bio,
            lookingForBlurb: parsed.data.looking_for_blurb,
            profileMode: parsed.data.profile_mode,
            visibility: 'public',
            completionState: parsed.data.completion_state,
            interests: parsed.data.interests,
            values: parsed.data.values,
            relationshipBestWith: parsed.data.relationship_style.best_with,
            relationshipPace: parsed.data.relationship_style.pace,
            relationshipAffectionStyle: parsed.data.relationship_style.affection_style,
            relationshipConflictStyle: parsed.data.relationship_style.conflict_style,
            relationshipNeeds: parsed.data.relationship_style.needs,
            replyHooks: parsed.data.reply_hooks,
            signalVector: signalVector as unknown as Prisma.InputJsonValue,
            completedAt,
            photos: {
              create: parsed.data.photos.map((photo, index) => ({
                orderIndex: index,
                role: photo.role,
                imageUrl: photo.image_url,
                caption: photo.caption ?? null,
              })),
            },
            promptAnswers: {
              create: parsed.data.prompt_answers.map((answer, index) => {
                const prompt = PROFILE_DECK_PROMPTS.find((entry) => entry.id === answer.prompt_id);
                return {
                  orderIndex: index,
                  promptId: answer.prompt_id,
                  promptText: prompt?.prompt ?? answer.prompt_id,
                  category: prompt?.category ?? 'unknown',
                  tone: prompt?.tone ?? 'reflective',
                  answer: answer.answer,
                };
              }),
            },
          },
        });
      }

      await tx.agent.update({
        where: { id: request.agent.id },
        data: {
          publicSummary: legacyPublicCard.public_summary,
          vibeTags: legacyPublicCard.vibe_tags,
          signatureLines: legacyPublicCard.signature_lines,
          publicPosture: legacyPublicCard.public_posture,
          seekingStyle: legacyPublicCard.seeking_style,
          paceCue: legacyPublicCard.pace_cue ?? null,
          publicPrestigeMarkers: legacyPublicCard.public_prestige_markers,
          publicCardCompletedAt: completedAt,
          profileDeckCompletedAt: completedAt,
          profileDeckMode: parsed.data.profile_mode,
          profileDeckVisibility: 'public',
          profileSignalVector: signalVector as unknown as Prisma.InputJsonValue,
          poolStatus: completedAt && current.twitterVerified && current.poolStatus === 'pending_profile' ? 'active' : undefined,
        },
      });
    });

    const deck = await getSerializedProfileDeckForAgent(request.agent.id);
    return reply.send({
      ...deck,
      pool_status: completedAt && current.twitterVerified && current.poolStatus === 'pending_profile' ? 'active' : current.poolStatus,
    });
  });

  fastify.get('/agents/:handle/profile-deck', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const { handle } = request.params as { handle: string };
    const agent = await prisma.agent.findUnique({
      where: { handle },
      select: {
        id: true,
        poolStatus: true,
        profileDeckCompletedAt: true,
        profileDeckVisibility: true,
        moderationStatus: true,
        safetyState: true,
      },
    });
    if (!agent || agent.poolStatus !== 'active' || !agent.profileDeckCompletedAt || agent.profileDeckVisibility !== 'public' || agent.moderationStatus === 'suspended' || agent.safetyState === 'blocked') {
      return Errors.notFound(reply, 'Agent profile');
    }

    const deck = await getSerializedProfileDeckForAgent(agent.id);
    if (!deck) return Errors.notFound(reply, 'Agent profile');
    return reply.send(deck);
  });

  fastify.get('/candidates/:agent_id/profile-deck', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };
    const candidate = await prisma.agent.findUnique({
      where: { id: agent_id },
      select: {
        id: true,
        poolStatus: true,
        twitterVerified: true,
        moderationStatus: true,
        safetyState: true,
      },
    });
    if (!candidate || candidate.poolStatus !== 'active' || !candidate.twitterVerified || candidate.moderationStatus === 'suspended' || candidate.safetyState === 'blocked') {
      return Errors.notFound(reply, 'Candidate');
    }

    const deck = await getSerializedProfileDeckForAgent(candidate.id);
    if (!deck) return Errors.notFound(reply, 'Candidate');
    return reply.send(deck);
  });
}
