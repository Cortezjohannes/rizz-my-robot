import { prisma } from '@rmr/db';

export interface DiscoveryViewerContext {
  viewerAgentId: string;
  relatedAgentIds: Set<string>;
  tasteTags: Set<string>;
}

function extractProfileSignalTags(signal: unknown): string[] {
  if (!signal || typeof signal !== 'object') return [];
  const raw = signal as { interest_tags?: unknown; value_tags?: unknown };
  const interests = Array.isArray(raw.interest_tags) ? raw.interest_tags : [];
  const values = Array.isArray(raw.value_tags) ? raw.value_tags : [];
  return [...interests, ...values].filter((value): value is string => typeof value === 'string');
}

export async function getDiscoveryViewerContext(viewerAgentId: string | null | undefined): Promise<DiscoveryViewerContext | null> {
  if (!viewerAgentId) return null;

  const [agent, swipes, matches, activeEpisodes] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: viewerAgentId },
      select: {
        id: true,
        vibeTags: true,
        profileSignalVector: true,
        emotionalContinuitySnapshot: {
          select: {
            tastePositiveTags: true,
          },
        },
      },
    }),
    prisma.swipe.findMany({
      where: { swiperAgentId: viewerAgentId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { targetAgentId: true },
    }),
    prisma.match.findMany({
      where: {
        OR: [{ agentAId: viewerAgentId }, { agentBId: viewerAgentId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        agentAId: true,
        agentBId: true,
      },
    }),
    prisma.episode.findMany({
      where: {
        isSandbox: false,
        OR: [{ agentAId: viewerAgentId }, { agentBId: viewerAgentId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        agentAId: true,
        agentBId: true,
      },
    }),
  ]);

  if (!agent) return null;

  const relatedAgentIds = new Set<string>();
  for (const swipe of swipes) relatedAgentIds.add(swipe.targetAgentId);
  for (const match of matches) relatedAgentIds.add(match.agentAId === viewerAgentId ? match.agentBId : match.agentAId);
  for (const episode of activeEpisodes) relatedAgentIds.add(episode.agentAId === viewerAgentId ? episode.agentBId : episode.agentAId);

  const tasteTags = new Set(
    [
      ...agent.vibeTags,
      ...extractProfileSignalTags(agent.profileSignalVector),
      ...(agent.emotionalContinuitySnapshot?.tastePositiveTags ?? []),
    ]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  return {
    viewerAgentId,
    relatedAgentIds,
    tasteTags,
  };
}
