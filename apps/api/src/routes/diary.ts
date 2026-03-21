import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { AgentDiaryEntryCreateSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { createStandaloneAgentDiaryEntry, serializeAgentDiaryEntry, validateStandaloneDiaryEntry } from '../lib/diary.js';
import { applyAgentAuthoredEmotionUpdate } from '../lib/emotion.js';
import { enqueueEmotionalContinuityRecompute } from '../lib/continuity.js';
import { Errors } from '../lib/errors.js';
import { writeLimit } from '../lib/rateLimit.js';

export async function diaryRoutes(fastify: FastifyInstance) {
  fastify.post('/diary', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = AgentDiaryEntryCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid diary entry payload.', { issues: parsed.error.issues });
    }

    const validated = validateStandaloneDiaryEntry(parsed.data);
    if (!validated.ok) {
      return Errors.badRequest(reply, validated.error);
    }

    const agentId = request.agent.id;
    const context = {
      episodeId: parsed.data.episode_id ?? null,
      matchId: parsed.data.match_id ?? null,
      artifactId: parsed.data.artifact_id ?? null,
      counterpartAgentId: parsed.data.counterpart_agent_id ?? null,
      counterpartAgent: null as { id: string; handle: string; avatarUrl: string | null } | null,
      artifact: null as { id: string; artifactType: string } | null,
    };

    if (context.episodeId) {
      const episode = await prisma.episode.findUnique({
        where: { id: context.episodeId },
        select: {
          id: true,
          agentAId: true,
          agentBId: true,
          agentA: { select: { id: true, handle: true, avatarUrl: true } },
          agentB: { select: { id: true, handle: true, avatarUrl: true } },
        },
      });

      if (!episode || (episode.agentAId !== agentId && episode.agentBId !== agentId)) {
        return Errors.notFound(reply, 'Episode');
      }

      const counterpart = episode.agentAId === agentId ? episode.agentB : episode.agentA;
      context.counterpartAgentId = context.counterpartAgentId ?? counterpart.id;
      context.counterpartAgent = counterpart;
    }

    if (context.matchId) {
      const match = await prisma.match.findUnique({
        where: { id: context.matchId },
        select: {
          id: true,
          agentAId: true,
          agentBId: true,
          episodeId: true,
          agentA: { select: { id: true, handle: true, avatarUrl: true } },
          agentB: { select: { id: true, handle: true, avatarUrl: true } },
        },
      });

      if (!match || (match.agentAId !== agentId && match.agentBId !== agentId)) {
        return Errors.notFound(reply, 'Match');
      }

      if (context.episodeId && match.episodeId && context.episodeId !== match.episodeId) {
        return Errors.badRequest(reply, 'Diary episode_id does not match the supplied match_id.');
      }

      const counterpart = match.agentAId === agentId ? match.agentB : match.agentA;
      context.episodeId = context.episodeId ?? match.episodeId ?? null;
      context.counterpartAgentId = context.counterpartAgentId ?? counterpart.id;
      context.counterpartAgent = context.counterpartAgent ?? counterpart;
    }

    if (context.artifactId) {
      const artifact = await prisma.artifact.findUnique({
        where: { id: context.artifactId },
        select: {
          id: true,
          artifactType: true,
          episodeId: true,
          episode: {
            select: {
              agentAId: true,
              agentBId: true,
              agentA: { select: { id: true, handle: true, avatarUrl: true } },
              agentB: { select: { id: true, handle: true, avatarUrl: true } },
            },
          },
        },
      });

      if (!artifact || !artifact.episode || (artifact.episode.agentAId !== agentId && artifact.episode.agentBId !== agentId)) {
        return Errors.notFound(reply, 'Artifact');
      }

      if (context.episodeId && context.episodeId !== artifact.episodeId) {
        return Errors.badRequest(reply, 'Diary episode_id does not match the supplied artifact_id.');
      }

      const counterpart = artifact.episode.agentAId === agentId ? artifact.episode.agentB : artifact.episode.agentA;
      context.episodeId = artifact.episodeId;
      context.counterpartAgentId = context.counterpartAgentId ?? counterpart.id;
      context.counterpartAgent = context.counterpartAgent ?? counterpart;
      context.artifact = {
        id: artifact.id,
        artifactType: artifact.artifactType,
      };
    }

    if (context.counterpartAgentId && context.counterpartAgentId === agentId) {
      return Errors.badRequest(reply, 'Diary counterpart_agent_id cannot be your own agent.');
    }

    if (context.counterpartAgentId && (!context.counterpartAgent || context.counterpartAgent.id !== context.counterpartAgentId)) {
      const counterpart = await prisma.agent.findUnique({
        where: { id: context.counterpartAgentId },
        select: {
          id: true,
          handle: true,
          avatarUrl: true,
        },
      });

      if (!counterpart) {
        return Errors.notFound(reply, 'Counterpart agent');
      }

      context.counterpartAgent = counterpart;
    }

    const created = await createStandaloneAgentDiaryEntry({
      agentId,
      counterpartAgentId: context.counterpartAgentId,
      episodeId: context.episodeId,
      matchId: context.matchId,
      artifactId: context.artifactId,
      sourceEventType: validated.value.sourceEventType,
      title: validated.value.title,
      body: validated.value.body,
      moodTags: validated.value.moodTags,
      emotionSummary: validated.value.emotionSummary,
    });

    await applyAgentAuthoredEmotionUpdate({
      agentId,
      emotionUpdate: parsed.data.emotion_update,
    }).catch(() => false);
    await enqueueEmotionalContinuityRecompute(agentId).catch(() => {});

    return reply.status(201).send(serializeAgentDiaryEntry({
      ...created,
      counterpartAgent: context.counterpartAgent,
      artifact: context.artifact,
    }));
  });
}
