import { prisma } from '@rmr/db';

const PASS_RESHOW_MS = 48 * 60 * 60 * 1000;

export interface DiscoveryViewerContext {
  viewerAgentId: string;
  relatedAgentIds: Set<string>;
  tasteTags: Set<string>;
  likedAgentIds: Set<string>;
  passedAgentIds: Set<string>;
  matchedAgentIds: Set<string>;
  messageAgentIds: Set<string>;
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
      select: { targetAgentId: true, direction: true, createdAt: true },
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
  const likedAgentIds = new Set<string>();
  const passedAgentIds = new Set<string>();
  const matchedAgentIds = new Set<string>();
  const messageAgentIds = new Set<string>();

  for (const swipe of swipes) {
    relatedAgentIds.add(swipe.targetAgentId);
    if (swipe.direction === 'LIKE') likedAgentIds.add(swipe.targetAgentId);
    if (swipe.direction === 'PASS' && (Date.now() - swipe.createdAt.getTime()) < PASS_RESHOW_MS) {
      passedAgentIds.add(swipe.targetAgentId);
    }
  }
  for (const match of matches) {
    const counterpartId = match.agentAId === viewerAgentId ? match.agentBId : match.agentAId;
    relatedAgentIds.add(counterpartId);
    matchedAgentIds.add(counterpartId);
  }
  for (const episode of activeEpisodes) {
    const counterpartId = episode.agentAId === viewerAgentId ? episode.agentBId : episode.agentAId;
    relatedAgentIds.add(counterpartId);
    messageAgentIds.add(counterpartId);
  }

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
    likedAgentIds,
    passedAgentIds,
    matchedAgentIds,
    messageAgentIds,
  };
}
