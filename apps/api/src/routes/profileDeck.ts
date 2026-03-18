import type { FastifyInstance } from 'fastify';
import { prisma, type Prisma } from '@rmr/db';
import {
  PROFILE_DECK_PROMPTS,
  PROFILE_DECK_PROMPT_LIBRARY_VERSION,
  UpdateProfileDeckSchema,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import {
  computeProfileSignalVector,
  deriveLegacyPublicCardFromProfileDeckInput,
  getSerializedProfileDeckForAgent,
  validateProfileDeckInput,
} from '../lib/profileDeck.js';

export async function profileDeckRoutes(fastify: FastifyInstance) {
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
        moderationStatus: true,
        safetyState: true,
      },
    });
    if (!agent || agent.poolStatus !== 'active' || agent.moderationStatus === 'suspended' || agent.safetyState === 'blocked') {
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
