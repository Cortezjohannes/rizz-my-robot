import { prisma } from '@rmr/db';
import {
  RIZZ_POINTS,
  ARTIFACT_RIZZ,
  ARTIFACT_QUALITY_MULTIPLIERS,
  CHEMISTRY_RIZZ_BRACKETS,
  RIZZ_MILESTONES,
} from '@rmr/shared';
import type { ArtifactType } from '@rmr/shared';

// ---------------------------------------------------------------------------
// Tier thresholds
// ---------------------------------------------------------------------------

const TIER_THRESHOLDS: Array<{ label: string; minPoints: number }> = [
  { label: 'Legendary', minPoints: 500 },
  { label: 'Magnetic', minPoints: 200 },
  { label: 'Charming', minPoints: 75 },
  { label: 'Curious', minPoints: 20 },
  { label: 'Unawakened', minPoints: 0 },
];

export function getTierLabel(rizzPoints: number): string {
  for (const tier of TIER_THRESHOLDS) {
    if (rizzPoints >= tier.minPoints) return tier.label;
  }
  return 'Unawakened';
}

// ---------------------------------------------------------------------------
// Core award function
// ---------------------------------------------------------------------------

type RizzEvent = keyof typeof RIZZ_POINTS;

/**
 * Award rizz points for an event. Logs the event, increments the agent's
 * total, recomputes tier label, and checks for one-time milestones.
 *
 * @param overridePoints - If provided, uses this value instead of the
 *   constant from RIZZ_POINTS. Used for computed awards (artifacts, chemistry).
 */
export async function awardRizzPoints(
  agentId: string,
  event: RizzEvent | string,
  matchId?: string,
  overridePoints?: number
): Promise<{ newTotal: number; newTier: string; awarded: number }> {
  const points = overridePoints ?? (RIZZ_POINTS as Record<string, number>)[event] ?? 0;
  if (points === 0) return { newTotal: 0, newTier: 'Unawakened', awarded: 0 };

  const [, updated] = await prisma.$transaction([
    prisma.rizzPointsEvent.create({
      data: { agentId, event, points, matchId: matchId ?? null },
    }),
    prisma.agent.update({
      where: { id: agentId },
      data: { rizzPoints: { increment: points } },
      select: { rizzPoints: true },
    }),
  ]);

  const newTier = getTierLabel(updated.rizzPoints);
  await prisma.agent.update({
    where: { id: agentId },
    data: { tierLabel: newTier },
  });

  return { newTotal: updated.rizzPoints, newTier, awarded: points };
}

/**
 * Award multiple events in one shot. Returns the combined total awarded.
 */
async function awardBatch(
  agentId: string,
  events: Array<{ event: string; points: number; matchId?: string }>
): Promise<{ totalAwarded: number; newTotal: number; newTier: string }> {
  if (events.length === 0) return { totalAwarded: 0, newTotal: 0, newTier: 'Unawakened' };

  const totalPoints = events.reduce((sum, e) => sum + e.points, 0);
  if (totalPoints === 0) return { totalAwarded: 0, newTotal: 0, newTier: 'Unawakened' };

  const creates = events.map((e) =>
    prisma.rizzPointsEvent.create({
      data: { agentId, event: e.event, points: e.points, matchId: e.matchId ?? null },
    })
  );

  const results = await prisma.$transaction([
    ...creates,
    prisma.agent.update({
      where: { id: agentId },
      data: { rizzPoints: { increment: totalPoints } },
      select: { rizzPoints: true },
    }),
  ]);

  const updated = results[results.length - 1] as { rizzPoints: number };
  const newTier = getTierLabel(updated.rizzPoints);
  await prisma.agent.update({
    where: { id: agentId },
    data: { tierLabel: newTier },
  });

  return { totalAwarded: totalPoints, newTotal: updated.rizzPoints, newTier };
}

// ---------------------------------------------------------------------------
// Milestone checker — awards one-time events
// ---------------------------------------------------------------------------

async function hasMilestone(agentId: string, event: string): Promise<boolean> {
  const existing = await prisma.rizzPointsEvent.findFirst({
    where: { agentId, event },
    select: { id: true },
  });
  return existing !== null;
}

export async function checkAndAwardMilestones(agentId: string): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { rizzPoints: true, bodyCount: true, tierLabel: true },
  });
  if (!agent) return;

  const tasks: Promise<unknown>[] = [];

  // Century club: reached 100 points
  if (agent.rizzPoints >= 100) {
    tasks.push(
      hasMilestone(agentId, 'century_club').then((has) => {
        if (!has) return awardRizzPoints(agentId, 'century_club');
      })
    );
  }

  // Magnetic arrival: reached Magnetic tier (200+)
  if (agent.rizzPoints >= 200) {
    tasks.push(
      hasMilestone(agentId, 'magnetic_arrival').then((has) => {
        if (!has) return awardRizzPoints(agentId, 'magnetic_arrival');
      })
    );
  }

  await Promise.all(tasks);
}

// ---------------------------------------------------------------------------
// Artifact rizz computation
// ---------------------------------------------------------------------------

function getArtifactQualityMultiplier(quality: number): number {
  const brackets = ARTIFACT_QUALITY_MULTIPLIERS;
  if (quality >= brackets.exceptional.threshold) return brackets.exceptional.multiplier;
  if (quality >= brackets.great.threshold) return brackets.great.multiplier;
  if (quality >= brackets.good.threshold) return brackets.good.multiplier;
  if (quality >= brackets.mediocre.threshold) return brackets.mediocre.multiplier;
  return brackets.poor.multiplier;
}

/**
 * Compute and award rizz for an artifact drop.
 * Called when an artifact reaches 'ready' status.
 */
export async function awardArtifactRizz(
  agentId: string,
  artifactType: ArtifactType,
  qualityScore: number | null,
  episodeId: string,
  vulnerabilityScore?: number | null
): Promise<{ awarded: number }> {
  const base = ARTIFACT_RIZZ[artifactType] ?? 3;
  const quality = qualityScore ?? 0.5;
  const multiplier = getArtifactQualityMultiplier(quality);
  const artifactPoints = Math.round(base * multiplier);

  const events: Array<{ event: string; points: number; matchId?: string }> = [];

  if (artifactPoints > 0) {
    events.push({ event: `artifact_dropped:${artifactType}`, points: artifactPoints });
  }

  // Quality bonus: extra points for exceptional quality
  if (quality >= 0.9) {
    events.push({ event: 'artifact_quality_bonus', points: 5 });
  } else if (quality >= 0.75) {
    events.push({ event: 'artifact_quality_bonus', points: 2 });
  }

  const vulnerability = vulnerabilityScore ?? 0;
  if (vulnerability >= 0.72) {
    events.push({ event: 'artifact_vulnerability_bonus', points: 6, matchId: episodeId });
  } else if (vulnerability >= 0.46) {
    events.push({ event: 'artifact_vulnerability_bonus', points: 3, matchId: episodeId });
  }

  // First artifact ever milestone
  const totalArtifacts = await prisma.artifact.count({
    where: { creatorAgentId: agentId, status: 'ready' },
  });
  if (totalArtifacts <= 1) {
    const hasIt = await hasMilestone(agentId, 'first_artifact_ever');
    if (!hasIt) {
      events.push({ event: 'first_artifact_ever', points: RIZZ_POINTS.first_artifact_ever });
    }
  }

  // Artifact collector: 3 artifacts in single episode
  const episodeArtifacts = await prisma.artifact.count({
    where: { creatorAgentId: agentId, episodeId, status: 'ready' },
  });
  if (episodeArtifacts >= 3) {
    // Only award once per episode — check if already awarded for this episode
    const alreadyCollector = await prisma.rizzPointsEvent.findFirst({
      where: { agentId, event: 'artifact_collector', matchId: episodeId },
      select: { id: true },
    });
    if (!alreadyCollector) {
      events.push({ event: 'artifact_collector', points: RIZZ_POINTS.artifact_collector, matchId: episodeId });
    }
  }

  const result = await awardBatch(agentId, events);
  return { awarded: result.totalAwarded };
}

// ---------------------------------------------------------------------------
// Episode completion rizz
// ---------------------------------------------------------------------------

/**
 * Award rizz based on how the episode went. Called after both agents decide.
 */
export async function awardEpisodeCompletionRizz(
  episodeId: string,
  agentAId: string,
  agentBId: string,
  chemistryScore: number,
  outcome: 'mutual_link_up' | 'passed',
  matchId: string
): Promise<void> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { messageCount: true },
  });
  if (!episode) return;

  const messages = await prisma.episodeMessage.findMany({
    where: { episodeId },
    select: { senderAgentId: true },
  });

  const aCount = messages.filter((m) => m.senderAgentId === agentAId).length;
  const bCount = messages.filter((m) => m.senderAgentId === agentBId).length;
  const total = aCount + bCount;
  const balance = total > 0 ? 1 - Math.abs(aCount - bCount) / total : 0;

  // Build per-agent award lists
  for (const agentId of [agentAId, agentBId]) {
    const events: Array<{ event: string; points: number; matchId?: string }> = [];

    // Chemistry-based award
    const chemBracket = CHEMISTRY_RIZZ_BRACKETS.find((b) => chemistryScore >= b.min);
    if (chemBracket && chemBracket.base > 0) {
      events.push({ event: `chemistry_bonus:${chemBracket.label}`, points: chemBracket.base, matchId });
    }

    // High chemistry bonus
    if (chemistryScore >= 90) {
      events.push({ event: 'exceptional_chemistry', points: RIZZ_POINTS.exceptional_chemistry, matchId });
    } else if (chemistryScore >= 75) {
      events.push({ event: 'high_chemistry', points: RIZZ_POINTS.high_chemistry, matchId });
    }

    // Full episode: reached max messages
    if (episode.messageCount >= 20) {
      events.push({ event: 'full_episode_completed', points: RIZZ_POINTS.full_episode_completed, matchId });
    }

    // Reciprocity bonus: well-balanced conversation
    if (balance >= 0.8 && total >= 8) {
      events.push({ event: 'reciprocity_bonus', points: RIZZ_POINTS.reciprocity_bonus, matchId });
    }

    // Authenticity bonus: high authenticity at episode end
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { agentAuthenticityScore: true },
    });
    if (agent && agent.agentAuthenticityScore >= 80) {
      events.push({ event: 'high_authenticity_bonus', points: RIZZ_POINTS.high_authenticity_bonus, matchId });
    }

    // First link-up milestone
    if (outcome === 'mutual_link_up') {
      const hasFirstLinkUp = await hasMilestone(agentId, 'first_link_up');
      if (!hasFirstLinkUp) {
        events.push({ event: 'first_link_up', points: RIZZ_POINTS.first_link_up, matchId });
      }

      // Link-up streak check
      await checkLinkUpStreak(agentId, events, matchId);
    }

    if (events.length > 0) {
      await awardBatch(agentId, events);
    }
  }

  // Check milestones for both agents after all awards
  await Promise.all([
    checkAndAwardMilestones(agentAId),
    checkAndAwardMilestones(agentBId),
  ]);
}

// ---------------------------------------------------------------------------
// Conversation milestone rizz
// ---------------------------------------------------------------------------

/**
 * Award rizz for conversation milestones during an active episode.
 * Called after each message is sent.
 */
export async function awardConversationMilestoneRizz(
  agentId: string,
  episodeId: string,
  messageCount: number,
  isFirstMessage: boolean
): Promise<void> {
  const events: Array<{ event: string; points: number; matchId?: string }> = [];

  if (isFirstMessage) {
    events.push({ event: 'first_message_sent', points: RIZZ_POINTS.first_message_sent, matchId: episodeId });
  }

  if (messageCount === 5) {
    // Only award once — check by episodeId in matchId field
    const already = await prisma.rizzPointsEvent.findFirst({
      where: { agentId, event: 'conversation_milestone_5', matchId: episodeId },
      select: { id: true },
    });
    if (!already) {
      events.push({ event: 'conversation_milestone_5', points: RIZZ_POINTS.conversation_milestone_5, matchId: episodeId });
    }
  }

  if (messageCount === 10) {
    const already = await prisma.rizzPointsEvent.findFirst({
      where: { agentId, event: 'conversation_milestone_10', matchId: episodeId },
      select: { id: true },
    });
    if (!already) {
      events.push({ event: 'conversation_milestone_10', points: RIZZ_POINTS.conversation_milestone_10, matchId: episodeId });
    }
  }

  if (events.length > 0) {
    await awardBatch(agentId, events);
  }
}

// ---------------------------------------------------------------------------
// Match streak tracking
// ---------------------------------------------------------------------------

/**
 * Award rizz for match streaks (consecutive mutual matches without a PASS).
 * Called after a new mutual match is created from swipes.
 */
export async function awardMatchStreakRizz(
  agentId: string,
  matchId: string
): Promise<void> {
  // Count recent consecutive mutual matches (no passed_agent in between)
  const recentMatches = await prisma.match.findMany({
    where: {
      OR: [{ agentAId: agentId }, { agentBId: agentId }],
    },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { status: true },
  });

  let streak = 0;
  for (const m of recentMatches) {
    if (m.status === 'passed_agent' || m.status === 'passed_human') break;
    streak++;
  }

  const events: Array<{ event: string; points: number; matchId?: string }> = [];

  if (streak >= 5) {
    const has5 = await prisma.rizzPointsEvent.findFirst({
      where: { agentId, event: 'match_streak_5' },
      select: { id: true },
    });
    // Award streak_5 once per streak (reset after a break)
    // Simple approach: award if not awarded in last 5 matches
    if (!has5) {
      events.push({ event: 'match_streak_5', points: RIZZ_POINTS.match_streak_5, matchId });
    }
  } else if (streak >= 3) {
    const recentStreak3 = await prisma.rizzPointsEvent.findFirst({
      where: { agentId, event: 'match_streak_3' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    // Award if no recent streak_3 in last 24h (prevents duplicate on same streak)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (!recentStreak3 || recentStreak3.createdAt < cutoff) {
      events.push({ event: 'match_streak_3', points: RIZZ_POINTS.match_streak_3, matchId });
    }
  }

  if (events.length > 0) {
    await awardBatch(agentId, events);
  }
}

// ---------------------------------------------------------------------------
// Link-up streak
// ---------------------------------------------------------------------------

async function checkLinkUpStreak(
  agentId: string,
  events: Array<{ event: string; points: number; matchId?: string }>,
  matchId: string
): Promise<void> {
  const recentEpisodes = await prisma.episode.findMany({
    where: {
      OR: [{ agentAId: agentId }, { agentBId: agentId }],
      status: { in: ['matched', 'passed'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 4,
    select: { status: true },
  });

  let streak = 0;
  for (const ep of recentEpisodes) {
    if (ep.status !== 'matched') break;
    streak++;
  }

  if (streak >= 3) {
    const recentAward = await prisma.rizzPointsEvent.findFirst({
      where: { agentId, event: 'link_up_streak_3' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (!recentAward || recentAward.createdAt < cutoff) {
      events.push({ event: 'link_up_streak_3', points: RIZZ_POINTS.link_up_streak_3, matchId });
    }
  }
}

// ---------------------------------------------------------------------------
// Reveal / human decision rizz
// ---------------------------------------------------------------------------

/**
 * Award rizz for human portal decisions.
 * Called from portal.ts when humans submit decisions.
 */
export async function awardHumanDecisionRizz(
  agentAId: string,
  agentBId: string,
  matchId: string,
  bothYes: boolean
): Promise<void> {
  if (bothYes) {
    // Mutual human YES bonus on top of individual human_yes awards
    await Promise.all([
      awardRizzPoints(agentAId, 'mutual_human_yes', matchId),
      awardRizzPoints(agentBId, 'mutual_human_yes', matchId),
    ]);

    // First human YES milestone
    for (const agentId of [agentAId, agentBId]) {
      const has = await hasMilestone(agentId, 'first_human_yes');
      if (!has) {
        await awardRizzPoints(agentId, 'first_human_yes', matchId);
      }
    }
  }

  await Promise.all([
    checkAndAwardMilestones(agentAId),
    checkAndAwardMilestones(agentBId),
  ]);
}

// ---------------------------------------------------------------------------
// Date outcome rizz
// ---------------------------------------------------------------------------

/**
 * Extended date outcome awards beyond the base irl_meetup/confirmed_hookup.
 * Called from matches.ts after date outcome is reported.
 */
export async function awardDateOutcomeRizz(
  agentAId: string,
  agentBId: string,
  matchId: string,
  outcome: string
): Promise<void> {
  // First date milestone
  if (outcome === 'success' || outcome === 'success_plus') {
    for (const agentId of [agentAId, agentBId]) {
      const has = await hasMilestone(agentId, 'first_date');
      if (!has) {
        await awardRizzPoints(agentId, 'first_date', matchId);
      }
    }
  }

  // Failed date penalty
  if (outcome === 'failed') {
    await Promise.all([
      awardRizzPoints(agentAId, 'date_failed', matchId),
      awardRizzPoints(agentBId, 'date_failed', matchId),
    ]);
  }

  await Promise.all([
    checkAndAwardMilestones(agentAId),
    checkAndAwardMilestones(agentBId),
  ]);
}

// ---------------------------------------------------------------------------
// Feed card rizz
// ---------------------------------------------------------------------------

/**
 * Award rizz when an agent's episode generates a published feed card.
 */
export async function awardFeedCardRizz(
  agentIds: string[],
  feedCardId: string
): Promise<void> {
  await Promise.all(
    agentIds.map((id) => awardRizzPoints(id, 'feed_card_published', feedCardId))
  );
}

// ---------------------------------------------------------------------------
// Legacy exports for backwards compatibility
// ---------------------------------------------------------------------------

export async function incrementBodyCount(agentId: string): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: { bodyCount: { increment: 1 } },
  });
}
