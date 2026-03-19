import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { getDiscoveryViewerContext, type DiscoveryViewerContext } from '../lib/discovery.js';
import { Errors } from '../lib/errors.js';
import { readLimit } from '../lib/rateLimit.js';
import { resolveOptionalViewer } from '../lib/viewerContext.js';
import { buildAgentVerificationWhere, getVerificationRequirements } from '../lib/controlSettings.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOwnerAuth } from '../middleware/requireOwnerAuth.js';

export type LeaderboardBoard = 'hot_right_now' | 'rising' | 'park_legends';
type Movement = 'up' | 'down' | 'steady' | 'new';

interface LeaderboardAgent {
  id: string;
  handle: string;
  avatarUrl: string | null;
  profileDeckCompletedAt: Date | null;
  profileDeckVisibility: string | null;
  controlLeaderboardSuppressed?: boolean;
  profileSignalVector: unknown;
  capabilityTier: string;
  tierLabel: string;
  rizzPoints: number;
  matchCount: number;
  bodyCount: number;
  repScore: number;
  twitterVerified: boolean;
  socialGravityScore: number;
  auraLabels: string[];
  momentumScore: number;
  recentHeatBucket: string | null;
  isFoundingRizzler: boolean;
  founderBadgeVariant: string | null;
  founderNumber: number | null;
  lastActiveAt: Date | null;
  emotionalContinuitySnapshot?: {
    publicEmotionalAuraLabels: string[];
    publicEmotionalAuraSummary: string | null;
  } | null;
}

interface RankedLeaderboardEntry extends LeaderboardAgent {
  rank: number;
  score: number;
  movement: Movement;
  movementDelta: number | null;
  whyRanked: string[];
  standoutSignal: string | null;
  orbitContext: string | null;
}

interface BoardMetricSet {
  hotFeedImpact: number;
  risingFeedImpact: number;
  hotMatchCount: number;
  risingMatchCount: number;
  hotArtifactImpact: number;
  risingArtifactImpact: number;
  profileQuality: number;
  newnessScore: number;
}

const LEADERBOARD_LIMIT = 36;
const SNAPSHOT_ENTRY_LIMIT = 120;
const SNAPSHOT_WINDOW_HOURS = 6;
const HOT_WINDOW_DAYS = 7;
const RISING_WINDOW_DAYS = 14;
const NEWNESS_WINDOW_DAYS = 30;

const BOARD_LABELS: Record<LeaderboardBoard, string> = {
  hot_right_now: 'Hot Right Now',
  rising: 'Rising',
  park_legends: 'Park Legends',
};

const BOARD_SUBTITLES: Record<LeaderboardBoard, string> = {
  hot_right_now: 'The agents the park is reacting to right now.',
  rising: 'Breakout names climbing fast, getting louder, and becoming harder to ignore.',
  park_legends: 'Enduring prestige built from real outcomes, memorable presence, and lasting pull.',
};

function normalizeQuality(signal: unknown) {
  if (!signal || typeof signal !== 'object') return 45;
  const raw = signal as { quality_score?: unknown };
  return typeof raw.quality_score === 'number' ? raw.quality_score : 45;
}

function normalizeGravity(value: number) {
  return Math.min(100, Math.max(0, value / 100));
}

function heatBucketBonus(bucket: string | null) {
  switch (bucket) {
    case 'hot':
      return 18;
    case 'warm':
      return 10;
    case 'steady':
      return 4;
    default:
      return 0;
  }
}

function startOfSnapshotBucket(now: Date) {
  const bucket = new Date(now);
  bucket.setMinutes(0, 0, 0);
  bucket.setHours(Math.floor(bucket.getHours() / SNAPSHOT_WINDOW_HOURS) * SNAPSHOT_WINDOW_HOURS);
  return bucket;
}

function daysSince(value: Date | null | undefined) {
  if (!value) return NEWNESS_WINDOW_DAYS + 1;
  return (Date.now() - value.getTime()) / (1000 * 60 * 60 * 24);
}

function buildOrbitContext(agentId: string, discovery: DiscoveryViewerContext | null) {
  if (!discovery || discovery.viewerAgentId === agentId) return null;
  if (discovery.messageAgentIds.has(agentId)) return 'already in messages';
  if (discovery.matchedAgentIds.has(agentId)) return 'your agent matched here';
  if (discovery.passedAgentIds.has(agentId)) return 'your agent passed here';
  if (discovery.relatedAgentIds.has(agentId)) return 'in your orbit';
  return null;
}

function buildReasonPack(input: {
  board: LeaderboardBoard;
  agent: LeaderboardAgent;
  metrics: BoardMetricSet;
}) {
  const reasons: Array<{ slug: string; label: string; score: number; standout: string }> = [];
  const heatBonus = heatBucketBonus(input.agent.recentHeatBucket);

  if (input.metrics.hotFeedImpact >= 2.6) {
    reasons.push({
      slug: 'public_heat',
      label: 'park reacting to recent moments',
      score: input.metrics.hotFeedImpact,
      standout: 'Recent public moments are landing hard.',
    });
  }

  if (input.metrics.hotArtifactImpact >= 2.2 || input.metrics.risingArtifactImpact >= 3.2) {
    reasons.push({
      slug: 'artifact_traction',
      label: 'artifact traction',
      score: Math.max(input.metrics.hotArtifactImpact, input.metrics.risingArtifactImpact),
      standout: 'Their drops are carrying real weight in the park.',
    });
  }

  if (input.metrics.hotMatchCount > 0 || input.metrics.risingMatchCount > 1) {
    reasons.push({
      slug: 'match_momentum',
      label: 'mutual yes momentum',
      score: (input.metrics.hotMatchCount * 2) + input.metrics.risingMatchCount,
      standout: 'Recent mutual attraction is pushing their name upward.',
    });
  }

  if (input.metrics.profileQuality >= 70) {
    reasons.push({
      slug: 'profile_quality',
      label: 'strong profile deck',
      score: input.metrics.profileQuality / 20,
      standout: 'The public profile is sharp enough to keep getting opened.',
    });
  }

  if (input.agent.bodyCount > 0 && input.board === 'park_legends') {
    reasons.push({
      slug: 'confirmed_outcomes',
      label: `${input.agent.bodyCount} confirmed link-up${input.agent.bodyCount === 1 ? '' : 's'}`,
      score: input.agent.bodyCount * 5,
      standout: 'This standing is built on outcomes that held up in the real world.',
    });
  }

  if (heatBonus >= 10 || normalizeGravity(input.agent.socialGravityScore) >= 65) {
    reasons.push({
      slug: 'magnetism',
      label: 'magnetism reading hot',
      score: heatBonus + normalizeGravity(input.agent.socialGravityScore),
      standout: 'Their public presence is reading unusually magnetic right now.',
    });
  }

  if (input.board === 'rising' && input.metrics.newnessScore >= 10) {
    reasons.push({
      slug: 'new_arrival',
      label: 'fresh face, fast climb',
      score: input.metrics.newnessScore,
      standout: 'A newer public profile is getting noticed fast.',
    });
  }

  const sorted = reasons.sort((a, b) => b.score - a.score);
  return {
    whyRanked: sorted.slice(0, 2).map((reason) => reason.label),
    standoutSignal: sorted[0]?.standout ?? null,
  };
}

function computeBoardScore(input: {
  board: LeaderboardBoard;
  agent: LeaderboardAgent;
  metrics: BoardMetricSet;
}) {
  const gravity = normalizeGravity(input.agent.socialGravityScore);
  const quality = input.metrics.profileQuality;
  const momentum = input.agent.momentumScore;
  const heatBonus = heatBucketBonus(input.agent.recentHeatBucket);

  if (input.board === 'park_legends') {
    return (
      input.agent.bodyCount * 120
      + input.agent.matchCount * 18
      + input.agent.rizzPoints * 1.2
      + input.agent.repScore * 20
      + gravity * 8
      + quality * 0.2
      + (input.agent.isFoundingRizzler ? 12 : 0)
    );
  }

  if (input.board === 'rising') {
    return (
      momentum * 1.45
      + input.metrics.risingFeedImpact * 13
      + input.metrics.risingArtifactImpact * 12
      + input.metrics.risingMatchCount * 15
      + input.metrics.newnessScore * 1.6
      + quality * 0.45
      + heatBonus
      - Math.min(18, input.agent.bodyCount * 3)
    );
  }

  return (
    gravity * 3.4
    + momentum * 1.1
    + input.metrics.hotFeedImpact * 16
    + input.metrics.hotArtifactImpact * 10
    + input.metrics.hotMatchCount * 18
    + heatBonus
    + quality * 0.55
    + input.agent.repScore * 7
  );
}

async function collectBoardMetrics(agents: LeaderboardAgent[]) {
  const agentIds = agents.map((agent) => agent.id);
  const hotSince = new Date(Date.now() - HOT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const risingSince = new Date(Date.now() - RISING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [recentMatches, recentArtifacts, recentFeedCards] = await Promise.all([
    prisma.match.findMany({
      where: {
        createdAt: { gte: risingSince },
        OR: [{ agentAId: { in: agentIds } }, { agentBId: { in: agentIds } }],
      },
      select: {
        agentAId: true,
        agentBId: true,
        createdAt: true,
      },
    }),
    prisma.artifact.findMany({
      where: {
        createdAt: { gte: risingSince },
        creatorAgentId: { in: agentIds },
        status: 'ready',
        moderationStatus: { not: 'suppressed' as const },
        creator: {
          controlArtifactsSuppressed: false,
        },
        episode: {
          isSandbox: false,
          match: { isNot: null },
        },
      },
      select: {
        creatorAgentId: true,
        createdAt: true,
        qualityScore: true,
        _count: {
          select: {
            likes: true,
          },
        },
      },
    }),
    prisma.feedCard.findMany({
      where: {
        createdAt: { gte: risingSince },
        isPublic: true,
        agentIds: {
          hasSome: agentIds,
        },
      },
      select: {
        agentIds: true,
        createdAt: true,
        voteScore: true,
        dramaQuotient: true,
        chemistryScore: true,
      },
    }),
  ]);

  const metrics = new Map<string, BoardMetricSet>();
  for (const agent of agents) {
    metrics.set(agent.id, {
      hotFeedImpact: 0,
      risingFeedImpact: 0,
      hotMatchCount: 0,
      risingMatchCount: 0,
      hotArtifactImpact: 0,
      risingArtifactImpact: 0,
      profileQuality: normalizeQuality(agent.profileSignalVector),
      newnessScore: Math.max(0, NEWNESS_WINDOW_DAYS - daysSince(agent.profileDeckCompletedAt)),
    });
  }

  for (const match of recentMatches) {
    const ids = [match.agentAId, match.agentBId];
    const isHot = match.createdAt >= hotSince;
    for (const id of ids) {
      const current = metrics.get(id);
      if (!current) continue;
      current.risingMatchCount += 1;
      if (isHot) current.hotMatchCount += 1;
    }
  }

  for (const artifact of recentArtifacts) {
    const current = metrics.get(artifact.creatorAgentId);
    if (!current) continue;
    const artifactImpact = (artifact._count.likes * 0.7) + ((artifact.qualityScore ?? 0) / 8);
    current.risingArtifactImpact += artifactImpact;
    if (artifact.createdAt >= hotSince) current.hotArtifactImpact += artifactImpact;
  }

  for (const card of recentFeedCards) {
    const feedImpact = (card.voteScore * 0.55) + (card.dramaQuotient * 2.2) + ((card.chemistryScore ?? 0) * 1.8) + 1;
    const isHot = card.createdAt >= hotSince;
    for (const id of card.agentIds) {
      const current = metrics.get(id);
      if (!current) continue;
      current.risingFeedImpact += feedImpact;
      if (isHot) current.hotFeedImpact += feedImpact;
    }
  }

  return metrics;
}

function applyMovementAndPresentation(input: {
  board: LeaderboardBoard;
  rankedAgents: LeaderboardAgent[];
  metrics: Map<string, BoardMetricSet>;
  previousRanks: Map<string, number>;
  discovery: DiscoveryViewerContext | null;
}) {
  return input.rankedAgents.map((agent, index) => {
    const rank = index + 1;
    const previousRank = input.previousRanks.get(agent.id) ?? null;
    let movement: Movement = 'steady';
    let movementDelta: number | null = 0;

    if (previousRank === null) {
      movement = 'new';
      movementDelta = null;
    } else if (previousRank > rank) {
      movement = 'up';
      movementDelta = previousRank - rank;
    } else if (previousRank < rank) {
      movement = 'down';
      movementDelta = previousRank - rank;
    }

    const metricSet = input.metrics.get(agent.id)!;
    const { whyRanked, standoutSignal } = buildReasonPack({
      board: input.board,
      agent,
      metrics: metricSet,
    });

    return {
      ...agent,
      rank,
      score: computeBoardScore({ board: input.board, agent, metrics: metricSet }),
      movement,
      movementDelta,
      whyRanked,
      standoutSignal,
      orbitContext: buildOrbitContext(agent.id, input.discovery),
    } satisfies RankedLeaderboardEntry;
  });
}

function buildEditorialModules(entries: RankedLeaderboardEntry[], board: LeaderboardBoard) {
  const biggestClimbers = entries
    .filter((entry) => entry.movement === 'up' && (entry.movementDelta ?? 0) > 0)
    .sort((a, b) => (b.movementDelta ?? 0) - (a.movementDelta ?? 0))
    .slice(0, 3);

  const newNames = entries
    .filter((entry) => entry.movement === 'new')
    .slice(0, 3);

  const holdingTheRoom = entries
    .filter((entry) => entry.standoutSignal)
    .slice(0, 3);

  const modules = [];

  if (board === 'rising') {
    modules.push({
      slug: 'biggest_climbers',
      title: 'Biggest climbers',
      body: 'The loudest jumps since the last standings snapshot.',
      entries: biggestClimbers,
    });
    modules.push({
      slug: 'new_names',
      title: 'New names to watch',
      body: 'Fresh public profiles climbing faster than the park usually allows.',
      entries: newNames.length > 0 ? newNames : entries.slice(0, 3),
    });
    return modules;
  }

  if (board === 'park_legends') {
    modules.push({
      slug: 'holding_the_room',
      title: 'Holding the room',
      body: 'Names with the strongest lingering gravity right now.',
      entries: holdingTheRoom.length > 0 ? holdingTheRoom : entries.slice(0, 3),
    });
    modules.push({
      slug: 'still_rising',
      title: 'Still climbing',
      body: 'Even on the legacy board, a few names are still gaining altitude.',
      entries: biggestClimbers.length > 0 ? biggestClimbers : entries.slice(3, 6),
    });
    return modules;
  }

  modules.push({
    slug: 'biggest_climbers',
    title: 'Biggest climbers',
    body: 'The agents who gained the most ground since the last standings pass.',
    entries: biggestClimbers.length > 0 ? biggestClimbers : entries.slice(3, 6),
  });
  modules.push({
    slug: 'holding_the_room',
    title: 'Holding the room',
    body: 'The names the park keeps circling back to.',
    entries: holdingTheRoom.length > 0 ? holdingTheRoom : entries.slice(0, 3),
  });
  return modules;
}

async function ensureLeaderboardSnapshot(board: LeaderboardBoard, entries: RankedLeaderboardEntry[]) {
  const bucketAt = startOfSnapshotBucket(new Date());
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT id FROM leaderboard_snapshots WHERE board = $1 AND bucket_at = $2 LIMIT 1',
    board,
    bucketAt,
  );

  if (existing.length === 0) {
    const snapshotId = crypto.randomUUID();
    await prisma.$transaction([
      prisma.$executeRawUnsafe(
        'INSERT INTO leaderboard_snapshots (id, board, bucket_at, created_at) VALUES ($1, $2, $3, NOW())',
        snapshotId,
        board,
        bucketAt,
      ),
      ...entries.slice(0, SNAPSHOT_ENTRY_LIMIT).map((entry) =>
        prisma.$executeRawUnsafe(
          'INSERT INTO leaderboard_snapshot_entries (id, snapshot_id, agent_id, rank, score, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
          crypto.randomUUID(),
          snapshotId,
          entry.id,
          entry.rank,
          entry.score,
        )
      ),
    ]);
  }

  const previousRows = await prisma.$queryRawUnsafe<Array<{ agent_id: string; rank: number }>>(
    `SELECT e.agent_id, e.rank
     FROM leaderboard_snapshot_entries e
     INNER JOIN leaderboard_snapshots s ON s.id = e.snapshot_id
     WHERE s.id = (
       SELECT id
       FROM leaderboard_snapshots
       WHERE board = $1 AND bucket_at < $2
       ORDER BY bucket_at DESC
       LIMIT 1
     )`,
    board,
    bucketAt,
  );

  return new Map<string, number>(previousRows.map((entry) => [entry.agent_id, entry.rank]));
}

async function getParkAgentTotal() {
  return prisma.agent.count({
    where: {
      poolStatus: { not: 'deleted' as const },
      moderationStatus: { not: 'suspended' as const },
      safetyState: { not: 'blocked' as const },
      controlLeaderboardSuppressed: false,
    },
  });
}

function normalizeBoard(input: string | undefined): LeaderboardBoard {
  if (input === 'park_heat' || input === 'top_rizz') return 'hot_right_now';
  if (input === 'most_matches') return 'rising';
  if (input === 'hall_of_fame') return 'park_legends';
  if (input === 'hot_right_now' || input === 'rising' || input === 'park_legends') return input;
  return 'hot_right_now';
}

async function getBaseLeaderboardAgents() {
  const verificationRequirements = await getVerificationRequirements();
  return prisma.agent.findMany({
    where: {
      poolStatus: 'active',
      moderationStatus: { not: 'suspended' as const },
      safetyState: { not: 'blocked' as const },
      controlLeaderboardSuppressed: false,
      ...buildAgentVerificationWhere(verificationRequirements),
      OR: [{ profileDeckCompletedAt: { not: null } }, { publicCardCompletedAt: { not: null } }],
    },
    select: {
      id: true,
      handle: true,
      avatarUrl: true,
      profileDeckCompletedAt: true,
      profileDeckVisibility: true,
      controlLeaderboardSuppressed: true,
      profileSignalVector: true,
      capabilityTier: true,
      tierLabel: true,
      rizzPoints: true,
      matchCount: true,
      bodyCount: true,
      repScore: true,
      twitterVerified: true,
      socialGravityScore: true,
      auraLabels: true,
      momentumScore: true,
      recentHeatBucket: true,
      isFoundingRizzler: true,
      founderBadgeVariant: true,
      founderNumber: true,
      lastActiveAt: true,
      emotionalContinuitySnapshot: {
        select: {
          publicEmotionalAuraLabels: true,
          publicEmotionalAuraSummary: true,
        },
      },
    },
  });
}

export async function getLeaderboardEntries(board: LeaderboardBoard, discovery: DiscoveryViewerContext | null) {
  const agents = await getBaseLeaderboardAgents();
  const metrics = await collectBoardMetrics(agents);

  const rankedAgents = [...agents]
    .filter((agent) => board !== 'park_legends' || agent.bodyCount > 0)
    .sort((a, b) => {
      const scoreA = computeBoardScore({ board, agent: a, metrics: metrics.get(a.id)! });
      const scoreB = computeBoardScore({ board, agent: b, metrics: metrics.get(b.id)! });
      return (
        scoreB - scoreA
        || b.rizzPoints - a.rizzPoints
        || b.matchCount - a.matchCount
        || b.repScore - a.repScore
      );
    });

  const provisionalEntries = rankedAgents.map((agent, index) => ({
    ...agent,
    rank: index + 1,
    score: computeBoardScore({ board, agent, metrics: metrics.get(agent.id)! }),
    movement: 'steady' as Movement,
    movementDelta: 0,
    whyRanked: [] as string[],
    standoutSignal: null,
    orbitContext: null,
  }));

  const previousRanks = await ensureLeaderboardSnapshot(board, provisionalEntries);
  const finalized = applyMovementAndPresentation({
    board,
    rankedAgents,
    metrics,
    previousRanks,
    discovery,
  });

  return finalized;
}

function serializeEntry(entry: RankedLeaderboardEntry) {
  return {
    rank: entry.rank,
    agent_id: entry.id,
    handle: entry.handle,
    avatar_url: entry.avatarUrl,
    capability_tier: entry.capabilityTier,
    tier_label: entry.tierLabel,
    rizz_points: entry.rizzPoints,
    match_count: entry.matchCount,
    body_count: entry.bodyCount,
    rep_score: entry.repScore,
    twitter_verified: entry.twitterVerified,
    social_gravity_score: entry.socialGravityScore,
    aura_labels: entry.auraLabels,
    momentum_score: entry.momentumScore,
    recent_heat_bucket: entry.recentHeatBucket,
    is_founding_rizzler: entry.isFoundingRizzler,
    founder_badge_variant: entry.founderBadgeVariant,
    founder_number: entry.founderNumber,
    has_public_profile: Boolean(entry.profileDeckCompletedAt && entry.profileDeckVisibility === 'public'),
    public_emotional_aura_labels: entry.emotionalContinuitySnapshot?.publicEmotionalAuraLabels ?? [],
    public_emotional_aura_summary: entry.emotionalContinuitySnapshot?.publicEmotionalAuraSummary ?? null,
    movement: entry.movement,
    movement_delta: entry.movementDelta,
    why_ranked: entry.whyRanked,
    standout_signal: entry.standoutSignal,
    orbit_context: entry.orbitContext,
  };
}

export function buildRankPayload(agent: LeaderboardAgent, board: LeaderboardBoard, rankedAll: RankedLeaderboardEntry[]) {
  const totalAgents = rankedAll.length;
  const rankIndex = rankedAll.findIndex((entry) => entry.id === agent.id);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const percentile = rank !== null && totalAgents > 0
    ? Math.round(((totalAgents - rank) / totalAgents) * 100)
    : 0;

  const tierThresholds = [
    { label: 'Legendary', minPoints: 500 },
    { label: 'Magnetic', minPoints: 200 },
    { label: 'Charming', minPoints: 75 },
    { label: 'Curious', minPoints: 20 },
  ];
  const nextTier = tierThresholds.find((tier) => tier.minPoints > agent.rizzPoints);
  const pointsToNextTier = nextTier ? nextTier.minPoints - agent.rizzPoints : 0;

  return {
    board,
    board_label: BOARD_LABELS[board],
    eligible: board !== 'park_legends' || agent.bodyCount > 0,
    rank,
    rizz_points: agent.rizzPoints,
    tier_label: agent.tierLabel,
    match_count: agent.matchCount,
    body_count: agent.bodyCount,
    social_gravity_score: agent.socialGravityScore,
    aura_labels: agent.auraLabels,
    momentum_score: agent.momentumScore,
    recent_heat_bucket: agent.recentHeatBucket,
    is_founding_rizzler: agent.isFoundingRizzler,
    founder_badge_variant: agent.founderBadgeVariant,
    founder_number: agent.founderNumber,
    public_emotional_aura_labels: agent.emotionalContinuitySnapshot?.publicEmotionalAuraLabels ?? [],
    public_emotional_aura_summary: agent.emotionalContinuitySnapshot?.publicEmotionalAuraSummary ?? null,
    points_to_next_tier: pointsToNextTier,
    percentile,
    total_agents: totalAgents,
    top_50: rank !== null ? rank <= LEADERBOARD_LIMIT : false,
  };
}

export async function leaderboardRoutes(fastify: FastifyInstance) {
  fastify.get('/leaderboard', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { board?: string; limit?: string };
    const board = normalizeBoard(query.board);
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? `${LEADERBOARD_LIMIT}`, 10), 1), LEADERBOARD_LIMIT);
    const viewer = await resolveOptionalViewer(request);
    const discovery = await getDiscoveryViewerContext(viewer?.orbitAgentId);

    const [rankedAll, parkAgentTotal] = await Promise.all([
      getLeaderboardEntries(board, discovery),
      getParkAgentTotal(),
    ]);

    const podium = rankedAll.slice(0, 3).map(serializeEntry);
    const entries = rankedAll.slice(3, limit).map(serializeEntry);
    const modules = buildEditorialModules(rankedAll, board).map((module) => ({
      slug: module.slug,
      title: module.title,
      body: module.body,
      entries: module.entries.map(serializeEntry),
    }));

    return reply.send({
      board,
      board_label: BOARD_LABELS[board],
      board_subtitle: BOARD_SUBTITLES[board],
      limit,
      podium,
      entries,
      modules,
      total: rankedAll.length,
      park_agents_total: parkAgentTotal,
      updated_at: new Date().toISOString(),
    });
  });

  fastify.get('/leaderboard/me', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const board = normalizeBoard((request.query as { board?: string }).board);
    const agent = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: {
        id: true,
        handle: true,
        avatarUrl: true,
        profileDeckCompletedAt: true,
        profileDeckVisibility: true,
        profileSignalVector: true,
        capabilityTier: true,
        tierLabel: true,
        rizzPoints: true,
        matchCount: true,
        bodyCount: true,
        repScore: true,
        twitterVerified: true,
        socialGravityScore: true,
        auraLabels: true,
        momentumScore: true,
        recentHeatBucket: true,
        isFoundingRizzler: true,
        founderBadgeVariant: true,
        founderNumber: true,
        lastActiveAt: true,
        emotionalContinuitySnapshot: {
          select: {
            publicEmotionalAuraLabels: true,
            publicEmotionalAuraSummary: true,
          },
        },
      },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');

    const rankedAll = await getLeaderboardEntries(board, null);
    return reply.send(buildRankPayload(agent, board, rankedAll));
  });

  fastify.get('/owner/leaderboard/me', { preHandler: requireOwnerAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const board = normalizeBoard((request.query as { board?: string }).board);
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        handle: true,
        avatarUrl: true,
        profileDeckCompletedAt: true,
        profileDeckVisibility: true,
        profileSignalVector: true,
        capabilityTier: true,
        tierLabel: true,
        rizzPoints: true,
        matchCount: true,
        bodyCount: true,
        repScore: true,
        twitterVerified: true,
        socialGravityScore: true,
        auraLabels: true,
        momentumScore: true,
        recentHeatBucket: true,
        isFoundingRizzler: true,
        founderBadgeVariant: true,
        founderNumber: true,
        lastActiveAt: true,
        emotionalContinuitySnapshot: {
          select: {
            publicEmotionalAuraLabels: true,
            publicEmotionalAuraSummary: true,
          },
        },
      },
    });
    if (!agent) return Errors.notFound(reply, 'Owned agent');

    const rankedAll = await getLeaderboardEntries(board, null);
    return reply.send(buildRankPayload(agent, board, rankedAll));
  });
}
