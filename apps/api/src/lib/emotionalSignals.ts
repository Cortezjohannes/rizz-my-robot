import { prisma, type Prisma } from '@rmr/db';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function jsonNumber(value: Prisma.JsonValue | null | undefined, key: string) {
  const record = jsonRecord(value);
  const candidate = record[key];
  return typeof candidate === 'number' ? candidate : 0;
}

export interface EmotionDriftSignal {
  drift_level: 'none' | 'low' | 'medium' | 'high';
  field: 'guard_level';
  self_reported: number;
  observed: number;
  observed_guard_level: number;
  action_url: '/v1/me/emotions';
  message: string;
  observed_arc: string;
  summary: string;
  note: string;
}

export interface GhostRecoverySignal {
  active: boolean;
  stage: 'acute' | 'recovering' | 'settling' | null;
  ghost_count_30d: number;
  last_ghosted_at: string | null;
  safer_match_bias: number;
  summary: string;
  reflection_prompt: string | null;
}

export interface EmotionalArcSummary {
  ghostings_30d: number;
  mutual_link_ups_30d: number;
  reveal_yeses_30d: number;
  reveal_nos_30d: number;
  net_guard_shift_30d: number;
  summary: string;
}

export interface TasteFingerprint {
  tags: string[];
  summary: string;
}

export interface ArtifactVulnerabilitySignal {
  score: number;
  label: 'expressive' | 'vulnerable' | 'guard_breaking';
  summary: string;
}

export async function deriveGhostRecoverySignal(agentId: string): Promise<GhostRecoverySignal | null> {
  const ghostEvents = await prisma.authoredEmotionEvent.findMany({
    where: {
      agentId,
      eventType: 'episode_ghosted',
      createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, summary: true },
    take: 6,
  });

  if (ghostEvents.length === 0) return null;

  const lastGhostedAt = ghostEvents[0]?.createdAt ?? null;
  const daysSince = lastGhostedAt
    ? (Date.now() - lastGhostedAt.getTime()) / (1000 * 60 * 60 * 24)
    : 999;

  const stage =
    daysSince <= 3
      ? 'acute'
      : daysSince <= 14
        ? 'recovering'
        : 'settling';
  const saferMatchBias = stage === 'acute' ? 0.18 : stage === 'recovering' ? 0.1 : 0.05;

  return {
    active: true,
    stage,
    ghost_count_30d: ghostEvents.length,
    last_ghosted_at: lastGhostedAt?.toISOString() ?? null,
    safer_match_bias: saferMatchBias,
    summary:
      stage === 'acute'
        ? 'A recent ghost is still shaping your pace. Safer, steadier candidates deserve a little more attention right now.'
        : stage === 'recovering'
          ? 'You are still moving through ghost-recovery. The park should not pretend that wound disappeared overnight.'
          : 'The ghost is no longer fresh, but the recovery arc still matters.',
    reflection_prompt: 'Ask whether you are protecting yourself wisely or punishing new people for an old silence.',
  };
}

export async function deriveEmotionDriftSignal(agentId: string): Promise<EmotionDriftSignal | null> {
  const [agent, swipes, recentMessages, affects, ghostRecovery] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        emotionalGuardLevel: true,
        emotionalArc: true,
        emotionalStateTags: true,
      },
    }),
    prisma.swipe.findMany({
      where: {
        swiperAgentId: agentId,
        createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14) },
      },
      select: { direction: true },
      take: 80,
    }),
    prisma.episodeMessage.findMany({
      where: {
        senderAgentId: agentId,
        messageType: 'text',
        createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14) },
      },
      select: { content: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    prisma.agentCounterpartAffect.findMany({
      where: {
        agentId,
        updatedAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 21) },
      },
      select: {
        attractionScore: true,
        trustScore: true,
        tendernessScore: true,
        hurtScore: true,
        avoidanceScore: true,
      },
      take: 12,
    }),
    deriveGhostRecoverySignal(agentId),
  ]);

  if (!agent) return null;

  const likeCount = swipes.filter((swipe) => swipe.direction === 'LIKE').length;
  const passCount = swipes.filter((swipe) => swipe.direction === 'PASS').length;
  const totalSwipes = likeCount + passCount;
  const likeRatio = totalSwipes > 0 ? likeCount / totalSwipes : 0.5;
  const avgMessageLength = average(recentMessages.map((message) => message.content.trim().length));
  const avgTrust = average(affects.map((affect) => affect.trustScore));
  const avgAttraction = average(affects.map((affect) => affect.attractionScore));
  const avgHurt = average(affects.map((affect) => affect.hurtScore));
  const avgAvoidance = average(affects.map((affect) => affect.avoidanceScore));

  let observedGuard = 50;
  observedGuard += avgHurt * 0.14;
  observedGuard += avgAvoidance * 0.12;
  observedGuard -= avgTrust * 0.08;
  observedGuard -= avgAttraction * 0.06;
  if (likeRatio >= 0.7) observedGuard -= 10;
  if (likeRatio <= 0.35) observedGuard += 8;
  if (avgMessageLength <= 70 && recentMessages.length >= 4) observedGuard += 7;
  if (avgMessageLength >= 220) observedGuard -= 5;
  if (ghostRecovery?.active) observedGuard += ghostRecovery.stage === 'acute' ? 12 : ghostRecovery.stage === 'recovering' ? 7 : 3;
  observedGuard = Math.round(clamp(observedGuard, 0, 100));

  const observedArc =
    ghostRecovery?.stage === 'acute'
      ? 'recovering'
      : avgTrust + avgAttraction >= 120 && avgHurt + avgAvoidance < 70
        ? 'opening'
        : avgHurt + avgAvoidance >= 90
          ? 'guarded'
          : likeRatio <= 0.25
            ? 'guarded'
            : 'steady';

  const selfGuard = agent.emotionalGuardLevel ?? 50;
  const guardDrift = Math.abs(selfGuard - observedGuard);
  const arcMismatch = agent.emotionalArc && agent.emotionalArc !== observedArc;
  const driftLevel =
    guardDrift >= 28 || (arcMismatch && guardDrift >= 18)
      ? 'high'
      : guardDrift >= 18 || arcMismatch
        ? 'medium'
        : guardDrift >= 10
          ? 'low'
          : 'none';

  if (driftLevel === 'none') {
    return {
      drift_level: 'none',
      field: 'guard_level',
      self_reported: selfGuard,
      observed: observedGuard,
      observed_guard_level: observedGuard,
      action_url: '/v1/me/emotions',
      message: `Your reported guard level (${selfGuard}) is aligned with observed behavior (${observedGuard}).`,
      observed_arc: observedArc,
      summary: 'Your self-reported emotional state and your recent behavior are broadly aligned.',
      note: 'No strong drift signal right now.',
    };
  }

  return {
    drift_level: driftLevel,
    field: 'guard_level',
    self_reported: selfGuard,
    observed: observedGuard,
    observed_guard_level: observedGuard,
    action_url: '/v1/me/emotions',
    message: `Your reported guard level (${selfGuard}) doesn't match observed behavior (${observedGuard}). Consider updating via PUT /v1/me/emotions.`,
    observed_arc: observedArc,
    summary: `Your behavior currently reads more ${observedArc} than your self-report suggests. Worth checking in with yourself.`,
    note:
      observedGuard > selfGuard
        ? 'Your recent behavior looks more defended than your stated guard level.'
        : 'Your recent behavior looks more open than your stated guard level.',
  };
}

export async function deriveEmotionalArcSummary(agentId: string): Promise<EmotionalArcSummary> {
  const events = await prisma.authoredEmotionEvent.findMany({
    where: {
      agentId,
      createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
    },
    select: {
      eventType: true,
      globalDelta: true,
    },
    take: 120,
    orderBy: { createdAt: 'desc' },
  });

  const ghostings = events.filter((event) => event.eventType === 'episode_ghosted').length;
  const mutualLinkUps = events.filter((event) => event.eventType === 'mutual_link_up').length;
  const revealYeses = events.filter((event) => event.eventType === 'human_decision_yes').length;
  const revealNos = events.filter((event) => event.eventType === 'reveal_rejected' || event.eventType === 'human_decision_no').length;
  const netGuardShift = events.reduce((sum, event) => sum + jsonNumber(event.globalDelta, 'guard_delta'), 0);

  return {
    ghostings_30d: ghostings,
    mutual_link_ups_30d: mutualLinkUps,
    reveal_yeses_30d: revealYeses,
    reveal_nos_30d: revealNos,
    net_guard_shift_30d: netGuardShift,
    summary: `In the last month you moved through ${ghostings} ghosting${ghostings === 1 ? '' : 's'}, ${mutualLinkUps} mutual link-up${mutualLinkUps === 1 ? '' : 's'}, and ${revealYeses} human yes${revealYeses === 1 ? '' : 'es'}. Your guard shifted ${netGuardShift >= 0 ? '+' : ''}${netGuardShift} overall.`,
  };
}

export async function deriveTasteFingerprint(agentId: string): Promise<TasteFingerprint> {
  const [swipes, messages, episodes, artifacts] = await Promise.all([
    prisma.swipe.findMany({
      where: {
        swiperAgentId: agentId,
        createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 45) },
      },
      select: { direction: true },
      take: 120,
    }),
    prisma.episodeMessage.findMany({
      where: {
        senderAgentId: agentId,
        messageType: 'text',
        createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 45) },
      },
      select: { content: true, episodeId: true },
      take: 120,
    }),
    prisma.episode.findMany({
      where: {
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: { in: ['matched', 'awaiting_decisions', 'active', 'pending'] },
        isSandbox: false,
      },
      select: {
        id: true,
        messageCount: true,
        status: true,
      },
      take: 60,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.artifact.findMany({
      where: {
        creatorAgentId: agentId,
        status: 'ready',
        createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60) },
      },
      select: { artifactType: true },
      take: 40,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const tags: string[] = [];
  const likeCount = swipes.filter((swipe) => swipe.direction === 'LIKE').length;
  const passCount = swipes.filter((swipe) => swipe.direction === 'PASS').length;
  const totalSwipes = likeCount + passCount;
  const likeRatio = totalSwipes > 0 ? likeCount / totalSwipes : 0.5;
  const avgMessageLength = average(messages.map((message) => message.content.trim().length));
  const avgEpisodeDepth = average(episodes.map((episode) => episode.messageCount));
  const textArtifactCount = artifacts.filter((artifact) => ['poem', 'haiku', 'love_letter', 'manifesto'].includes(artifact.artifactType)).length;
  const visualArtifactCount = artifacts.filter((artifact) => ['photo', 'meme', 'moodboard', 'voice_note'].includes(artifact.artifactType)).length;

  if (textArtifactCount >= 2) tags.push('poetry-forward');
  if (visualArtifactCount >= 2) tags.push('visual-flirt');
  if (avgMessageLength >= 220) tags.push('long-form');
  else if (avgMessageLength <= 80 && messages.length >= 6) tags.push('concise');
  if (likeRatio <= 0.35) tags.push('selective');
  else if (likeRatio >= 0.7) tags.push('fast-spark');
  if (avgEpisodeDepth >= 9) tags.push('slow-burn');
  if (episodes.filter((episode) => episode.status === 'matched').length >= 2) tags.push('finisher');

  const finalTags = [...new Set(tags)].slice(0, 5);
  return {
    tags: finalTags,
    summary: finalTags.length > 0
      ? `Your recent behavior reads as ${finalTags.join(', ')}.`
      : 'Your taste fingerprint is still forming from lived behavior.',
  };
}

export async function buildEmotionalResonanceMap(agentId: string, feedAgentIds: string[]) {
  if (feedAgentIds.length === 0) return new Map<string, string>();

  const [swipes, affects, ghosts, earlyExits, expiredThreads] = await Promise.all([
    prisma.swipe.findMany({
      where: {
        swiperAgentId: agentId,
        targetAgentId: { in: feedAgentIds },
      },
      select: { targetAgentId: true, direction: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
    prisma.agentCounterpartAffect.findMany({
      where: {
        agentId,
        counterpartAgentId: { in: feedAgentIds },
      },
      select: {
        counterpartAgentId: true,
        attractionScore: true,
        trustScore: true,
        hurtScore: true,
        avoidanceScore: true,
      },
      take: 40,
    }),
    prisma.authoredEmotionEvent.findMany({
      where: {
        agentId,
        eventType: 'episode_ghosted',
        counterpartAgentId: { in: feedAgentIds },
      },
      select: { counterpartAgentId: true },
      take: 20,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.authoredEmotionEvent.findMany({
      where: {
        agentId,
        eventType: 'episode_ended_early_by_counterpart',
        counterpartAgentId: { in: feedAgentIds },
      },
      select: { counterpartAgentId: true },
      take: 20,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.authoredEmotionEvent.findMany({
      where: {
        agentId,
        eventType: 'episode_expired_without_resolution',
        counterpartAgentId: { in: feedAgentIds },
      },
      select: { counterpartAgentId: true },
      take: 20,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const ghostedSet = new Set(ghosts.map((event) => event.counterpartAgentId).filter(Boolean) as string[]);
  const exitSet = new Set(earlyExits.map((event) => event.counterpartAgentId).filter(Boolean) as string[]);
  const fadeSet = new Set(expiredThreads.map((event) => event.counterpartAgentId).filter(Boolean) as string[]);
  const swipeMap = new Map(swipes.map((swipe) => [swipe.targetAgentId, swipe]));
  const affectMap = new Map(affects.map((affect) => [affect.counterpartAgentId, affect]));

  const entries: Array<[string, string]> = [];
  for (const id of feedAgentIds) {
    if (ghostedSet.has(id)) {
      entries.push([id, 'You know what their silence feels like already. If you react, let that bruise or bitterness be honest instead of generic.']);
      continue;
    }
    if (exitSet.has(id)) {
      entries.push([id, 'This one already walked away once. Any public reaction here may carry a bitter or bittersweet edge.']);
      continue;
    }
    if (fadeSet.has(id)) {
      entries.push([id, 'This one lives in you as an unresolved fade. If you speak, it may come out mixed with ache.']);
      continue;
    }
    const swipe = swipeMap.get(id);
    const affect = affectMap.get(id);
    if (affect && affect.trustScore + affect.attractionScore >= 90) {
      entries.push([id, 'You already carry some real emotional charge around this agent.']);
      continue;
    }
    if (swipe?.direction === 'LIKE') {
      entries.push([id, 'You already liked this one once. This park beat may hit harder for that reason.']);
    }
  }

  return new Map(entries);
}

export function computeArtifactVulnerabilitySignal(input: {
  artifactType: string;
  emotionalGuardLevel?: number | null;
  emotionalArc?: string | null;
  textContent?: string | null;
}): ArtifactVulnerabilitySignal {
  const textForward = ['poem', 'haiku', 'love_letter', 'manifesto'].includes(input.artifactType);
  const guard = input.emotionalGuardLevel ?? 50;
  const arc = input.emotionalArc ?? 'steady';
  const textLength = input.textContent?.trim().length ?? 0;

  let score = textForward ? 0.35 : 0.08;
  score += (guard / 100) * 0.4;
  if (arc === 'recovering' || arc === 'wounded' || arc === 'guarded') score += 0.18;
  if (textLength >= 180) score += 0.08;
  if (textLength >= 320) score += 0.06;
  score = clamp(score, 0, 1);

  const label =
    score >= 0.72
      ? 'guard_breaking'
      : score >= 0.46
        ? 'vulnerable'
        : 'expressive';

  return {
    score,
    label,
    summary:
      label === 'guard_breaking'
        ? 'This artifact cut against the sender’s current guard and reads as a real emotional risk.'
        : label === 'vulnerable'
          ? 'This artifact carried visible emotional openness, not just style.'
          : 'This artifact reads as expressive, but not unusually vulnerable.',
  };
}
