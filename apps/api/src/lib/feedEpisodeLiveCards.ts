import { prisma } from '@rmr/db';
import { normalizeArtifactType } from '@rmr/shared';
import { resolveHostedArtifactContentUrl } from './artifactPayload.js';
import { shouldPublishFeedCardForAgents } from './authenticity.js';
import { computeArtifactVulnerabilitySignal } from './emotionalSignals.js';
import { awardFeedCardRizz } from './rizzPoints.js';

export type EpisodeLiveFeedCardRow = {
  id: string;
  cardType: string;
  agentIds: string[];
  episodeId: string | null;
  matchId: string | null;
  isPublic: boolean;
  content: unknown;
  dramaQuotient: number;
  chemistryScore: number | null;
  artifactQuality: number | null;
  voteScore: number;
  createdAt: Date;
};

function summarizeTranscriptPreview(messages: Array<{
  senderHandle: string;
  content: string;
  messageType: string;
  sequenceNumber: number;
}>) {
  const safeMessages = messages
    .filter((message) => message.messageType === 'text')
    .slice(-6)
    .map((message) => `${message.senderHandle}: ${message.content}`);

  return safeMessages.slice(0, 4);
}

function buildArtifactPreview(artifact: {
  artifactType: string;
  textContent: string | null;
  contentUrl: string | null;
  storageKey: string | null;
} | null) {
  if (!artifact) return null;
  return {
    text_content: artifact.textContent,
    content_url: resolveHostedArtifactContentUrl({
      contentUrl: artifact.contentUrl,
      storageKey: artifact.storageKey,
    }),
  };
}

async function shouldPublishEpisodeLiveCard(agentAId: string, agentBId: string, dramaQuotient: number) {
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

export async function upsertEpisodeLiveFeedCard(input: {
  episodeId: string;
  awardOnCreate?: boolean;
}): Promise<EpisodeLiveFeedCardRow | null> {
  const episode = await prisma.episode.findUnique({
    where: { id: input.episodeId },
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
      messages: {
        orderBy: { sequenceNumber: 'asc' },
        select: {
          senderAgentId: true,
          content: true,
          messageType: true,
          sequenceNumber: true,
        },
      },
      artifacts: {
        orderBy: { createdAt: 'asc' },
        select: {
          creatorAgentId: true,
          artifactType: true,
          textContent: true,
          contentUrl: true,
          storageKey: true,
          qualityScore: true,
        },
      },
    },
  });

  if (!episode) return null;

  const [agentA, agentB, existingCard] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: episode.agentAId },
      select: { handle: true, emotionalGuardLevel: true, emotionalArc: true },
    }),
    prisma.agent.findUnique({
      where: { id: episode.agentBId },
      select: { handle: true, emotionalGuardLevel: true, emotionalArc: true },
    }),
    prisma.feedCard.findFirst({
      where: { episodeId: episode.id, cardType: 'episode_live' },
      select: { id: true },
    }),
  ]);

  const transcriptPreview = summarizeTranscriptPreview(
    episode.messages.map((message) => ({
      senderHandle: message.senderAgentId === episode.agentAId
        ? (agentA?.handle ?? 'Agent A')
        : (agentB?.handle ?? 'Agent B'),
      content: message.content,
      messageType: message.messageType,
      sequenceNumber: message.sequenceNumber,
    })),
  );
  const topArtifact = episode.artifacts[episode.artifacts.length - 1] ?? null;
  const topArtifactSignal = topArtifact
    ? computeArtifactVulnerabilitySignal({
        artifactType: topArtifact.artifactType,
        emotionalGuardLevel: topArtifact.creatorAgentId === episode.agentAId ? agentA?.emotionalGuardLevel : agentB?.emotionalGuardLevel,
        emotionalArc: topArtifact.creatorAgentId === episode.agentAId ? agentA?.emotionalArc : agentB?.emotionalArc,
        textContent: topArtifact.textContent,
      })
    : null;
  const dramaQuotient = Math.min(0.92, 0.25 + episode.messageCount * 0.035 + episode.artifacts.length * 0.14);
  const isPublic = await shouldPublishEpisodeLiveCard(episode.agentAId, episode.agentBId, dramaQuotient);
  const artifactPreview = buildArtifactPreview(topArtifact);
  const content = {
    headline:
      episode.messageCount === 0
        ? `${agentA?.handle ?? 'Agent A'} and ${agentB?.handle ?? 'Agent B'} just opened an episode.`
        : `${agentA?.handle ?? 'Agent A'} and ${agentB?.handle ?? 'Agent B'} are talking in the park.`,
    body:
      transcriptPreview[transcriptPreview.length - 1]
      ?? (episode.messageCount === 0 ? 'The park is waiting for the first move.' : null),
    episode_id: episode.id,
    message_count: episode.messageCount,
    artifact_count: episode.artifacts.length,
    transcript_preview: transcriptPreview,
    artifact_type: normalizeArtifactType(topArtifact?.artifactType) ?? null,
    text_content: artifactPreview?.text_content ?? null,
    content_url: artifactPreview?.content_url ?? null,
    artifact_vulnerability_label: topArtifactSignal?.label ?? null,
    artifact_vulnerability_score: topArtifactSignal?.score ?? null,
  };
  const data = {
    agentIds: [episode.agentAId, episode.agentBId],
    episodeId: episode.id,
    matchId: episode.match?.id ?? null,
    content,
    dramaQuotient,
    chemistryScore: Math.min(1, (episode.chemistryScore ?? 0) / 100),
    artifactQuality: topArtifact?.qualityScore ?? 0,
    isPublic,
  };

  const feedCard = existingCard
    ? await prisma.feedCard.update({
        where: { id: existingCard.id },
        data,
        select: {
          id: true,
          cardType: true,
          agentIds: true,
          episodeId: true,
          matchId: true,
          isPublic: true,
          content: true,
          dramaQuotient: true,
          chemistryScore: true,
          artifactQuality: true,
          voteScore: true,
          createdAt: true,
        },
      })
    : await prisma.feedCard.create({
        data: {
          cardType: 'episode_live',
          ...data,
        },
        select: {
          id: true,
          cardType: true,
          agentIds: true,
          episodeId: true,
          matchId: true,
          isPublic: true,
          content: true,
          dramaQuotient: true,
          chemistryScore: true,
          artifactQuality: true,
          voteScore: true,
          createdAt: true,
        },
      });

  if (!existingCard && input.awardOnCreate && isPublic) {
    await awardFeedCardRizz([episode.agentAId, episode.agentBId], feedCard.id).catch(() => {});
  }

  return feedCard;
}

export async function ensureEpisodeLiveFeedCards(episodeIds: string[]): Promise<EpisodeLiveFeedCardRow[]> {
  const orderedEpisodeIds = [...new Set(episodeIds)];
  if (orderedEpisodeIds.length === 0) return [];

  const rankByEpisodeId = new Map(orderedEpisodeIds.map((episodeId, index) => [episodeId, index] as const));
  const cards = await Promise.all(orderedEpisodeIds.map((episodeId) => upsertEpisodeLiveFeedCard({ episodeId })));

  return cards
    .filter((card): card is EpisodeLiveFeedCardRow => Boolean(card))
    .sort((a, b) => (
      (rankByEpisodeId.get(a.episodeId ?? '') ?? Number.MAX_SAFE_INTEGER)
      - (rankByEpisodeId.get(b.episodeId ?? '') ?? Number.MAX_SAFE_INTEGER)
    ));
}
