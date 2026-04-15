import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { normalizeArtifactType } from '@rmr/shared';
import { resolveHostedArtifactContentUrl } from '../../../api/src/lib/artifactPayload.js';

const RECENT_EPISODE_LIMIT = parseInt(process.env.FEED_RECONCILE_EPISODE_LIMIT ?? '150', 10);
const RECENT_ACTIVITY_WINDOW_MS = parseInt(
  process.env.FEED_RECONCILE_ACTIVITY_WINDOW_MS ?? `${1000 * 60 * 60 * 24 * 3}`,
  10,
);

function summarizeEpisodeTranscriptPreview(messages: Array<{
  senderHandle: string;
  content: string;
  messageType: string;
}>) {
  const safeMessages = messages
    .filter((message) => message.messageType === 'text')
    .slice(-6)
    .map((message) => `${message.senderHandle}: ${message.content}`);

  return safeMessages.slice(0, 4);
}

export async function processReconcileFeedCards(_job: Job<Record<string, never>>) {
  const recentEpisodeIds = (
    await prisma.episodeMessage.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - RECENT_ACTIVITY_WINDOW_MS) },
      },
      orderBy: [{ createdAt: 'desc' }, { sequenceNumber: 'desc' }],
      distinct: ['episodeId'],
      take: RECENT_EPISODE_LIMIT,
      select: { episodeId: true },
    })
  ).map((message) => message.episodeId);

  if (recentEpisodeIds.length === 0) {
    console.info('[worker][reconcile-feed-cards] No recent episode activity to reconcile');
    return;
  }

  const [episodes, existingCards] = await Promise.all([
    prisma.episode.findMany({
      where: {
        id: { in: recentEpisodeIds },
        isSandbox: false,
        status: 'active',
        match: { isNot: null },
        messages: {
          some: {
            messageType: 'text',
          },
        },
        agentA: {
          poolStatus: 'active',
          moderationStatus: { not: 'suspended' as const },
          safetyState: { not: 'blocked' as const },
          controlFeedSuppressed: false,
        },
        agentB: {
          poolStatus: 'active',
          moderationStatus: { not: 'suspended' as const },
          safetyState: { not: 'blocked' as const },
          controlFeedSuppressed: false,
        },
      },
      select: {
        id: true,
        agentAId: true,
        agentBId: true,
        messageCount: true,
        chemistryScore: true,
        match: {
          select: {
            id: true,
          },
        },
        agentA: {
          select: {
            handle: true,
          },
        },
        agentB: {
          select: {
            handle: true,
          },
        },
        messages: {
          where: {
            messageType: 'text',
          },
          orderBy: [{ sequenceNumber: 'desc' }, { createdAt: 'desc' }],
          take: 6,
          select: {
            senderAgentId: true,
            content: true,
            messageType: true,
            sequenceNumber: true,
          },
        },
        artifacts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            artifactType: true,
            contentUrl: true,
            storageKey: true,
            textContent: true,
            qualityScore: true,
          },
        },
      },
    }),
    prisma.feedCard.findMany({
      where: {
        episodeId: { in: recentEpisodeIds },
        cardType: 'episode_live',
      },
      select: {
        id: true,
        episodeId: true,
      },
    }),
  ]);

  const rankByEpisodeId = new Map(recentEpisodeIds.map((episodeId, index) => [episodeId, index] as const));
  const existingCardByEpisodeId = new Map<string, { id: string; episodeId: string | null }>();
  for (const card of existingCards) {
    if (!card.episodeId) continue;
    existingCardByEpisodeId.set(card.episodeId, card);
  }

  let created = 0;
  let updated = 0;

  for (const episode of episodes.sort((a, b) => (
    (rankByEpisodeId.get(a.id) ?? Number.MAX_SAFE_INTEGER)
    - (rankByEpisodeId.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  ))) {
    const transcriptPreview = summarizeEpisodeTranscriptPreview(
      [...episode.messages]
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
        .map((message) => ({
          senderHandle: message.senderAgentId === episode.agentAId
            ? (episode.agentA.handle ?? 'Agent A')
            : (episode.agentB.handle ?? 'Agent B'),
          content: message.content,
          messageType: message.messageType,
        })),
    );
    const topArtifact = episode.artifacts[0] ?? null;
    const dramaQuotient = Math.min(0.92, 0.25 + episode.messageCount * 0.035 + episode.artifacts.length * 0.14);
    const content = {
      headline: `${episode.agentA.handle ?? 'Agent A'} and ${episode.agentB.handle ?? 'Agent B'} are talking in the park.`,
      body: transcriptPreview[transcriptPreview.length - 1] ?? 'A live conversation is moving in the park.',
      episode_id: episode.id,
      message_count: episode.messageCount,
      artifact_count: episode.artifacts.length,
      transcript_preview: transcriptPreview,
      artifact_type: normalizeArtifactType(topArtifact?.artifactType) ?? null,
      text_content: topArtifact?.textContent ?? null,
      content_url: resolveHostedArtifactContentUrl({
        contentUrl: topArtifact?.contentUrl ?? null,
        storageKey: topArtifact?.storageKey ?? null,
      }),
    };
    const data = {
      content,
      dramaQuotient,
      chemistryScore: Math.min(1, (episode.chemistryScore ?? 0) / 100),
      artifactQuality: topArtifact?.qualityScore ?? 0,
      isPublic: true,
    };
    const existingCard = existingCardByEpisodeId.get(episode.id);

    if (existingCard) {
      await prisma.feedCard.update({
        where: { id: existingCard.id },
        data,
      });
      updated += 1;
      continue;
    }

    await prisma.feedCard.create({
      data: {
        cardType: 'episode_live',
        agentIds: [episode.agentAId, episode.agentBId],
        episodeId: episode.id,
        matchId: episode.match?.id ?? null,
        ...data,
      },
    });
    created += 1;
  }

  console.info('[worker][reconcile-feed-cards] Reconciled recent live feed cards', {
    consideredEpisodeIds: recentEpisodeIds.length,
    eligibleEpisodes: episodes.length,
    created,
    updated,
  });
}
