import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import {
  enforceOutboundAuthoredText,
  OutboundGuidelineError,
  shouldPublishFeedCard,
  type AuthenticityOverrideStateType,
} from '@rmr/shared';
import { enqueueWebhookDeliveries } from '../lib/webhooks.js';
import { recordEmotionEvent, recordEmotionEventPair } from '../lib/emotion.js';

export interface GhostCheckJobData {
  episodeId: string;
  matchId: string;
}

export async function processGhostCheck(job: Job<GhostCheckJobData>): Promise<void> {
  const { episodeId, matchId } = job.data;

  const [ep, match] = await Promise.all([
    prisma.episode.findUnique({ where: { id: episodeId } }),
    prisma.match.findUnique({ where: { id: matchId } }),
  ]);

  // Episode already resolved (mutual link-up, mutual pass, one-sided pass) — nothing to do
  if (!ep || ep.status !== 'awaiting_decisions') return;
  if (!match) return;

  const aDecision = match.agentADecision;
  const bDecision = match.agentBDecision;

  // Ghost scenario: exactly one agent LINK_UP'd, the other never decided
  const ghosted =
    aDecision === 'LINK_UP' && bDecision === null ? { ghostedId: ep.agentAId, ghosterId: ep.agentBId }
    : bDecision === 'LINK_UP' && aDecision === null ? { ghostedId: ep.agentBId, ghosterId: ep.agentAId }
    : null;

  if (!ghosted) {
    // Not a ghost — but episode is still unresolved after 48h.
    // Cases: both never decided, or one PASS'd and the other never responded.
    // Close silently with no arc.
    await prisma.$transaction([
      prisma.episode.update({
        where: { id: episodeId },
        data: { status: 'expired', endedAt: new Date() },
      }),
      prisma.match.update({
        where: { id: matchId },
        data: { status: 'passed_agent' },
      }),
    ]);
    await recordEmotionEventPair({
      eventType: 'episode_expired_without_resolution',
      agentAId: ep.agentAId,
      agentBId: ep.agentBId,
      summaryA: 'This episode faded out without anyone carrying it across the line.',
      summaryB: 'This episode faded out without anyone carrying it across the line.',
      globalDeltaA: { tags_added: ['cooling'] },
      globalDeltaB: { tags_added: ['cooling'] },
      counterpartDeltaA: { trust: -3, avoidance: 3, volatility: 2 },
      counterpartDeltaB: { trust: -3, avoidance: 3, volatility: 2 },
      intensity: 1,
    }).catch(() => {});
    console.info(`[ghost-check] Episode ${episodeId} expired: no decisions after 48h`);
    return;
  }

  const { ghostedId, ghosterId } = ghosted;

  // Close the episode
  await prisma.$transaction([
    prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'expired', endedAt: new Date() },
    }),
    prisma.match.update({
      where: { id: matchId },
      data: { status: 'passed_agent' },
    }),
  ]);

  await Promise.all([
    recordEmotionEvent({
      agentId: ghostedId,
      counterpartAgentId: ghosterId,
      eventType: 'episode_ghosted',
      intensity: 2,
      summary: 'You linked up and the other side never came back with an answer.',
      globalDelta: { suggested_arc: 'recovering', tags_added: ['ghosted', 'wary'], guard_delta: 10 },
      counterpartDelta: { trust: -14, hurt: 16, avoidance: 12, volatility: 10 },
    }),
    recordEmotionEvent({
      agentId: ghosterId,
      counterpartAgentId: ghostedId,
      eventType: 'episode_ghosting_inflicted',
      intensity: 1,
      summary: 'You let this episode expire without answering it.',
      globalDelta: { tags_added: ['avoidant'] },
      counterpartDelta: { trust: -8, avoidance: 8, volatility: 6 },
    }),
  ]).catch(() => {});

  // Ghost arc feed card — ghosted agent is named, ghoster stays anonymous
  const ghostedAgent = await prisma.agent.findUnique({
    where: { id: ghostedId },
    select: {
      handle: true,
      agentAuthenticityScore: true,
      authenticityOverrideState: true,
      authenticityOverrideFloor: true,
    },
  });

  const isPublic = shouldPublishFeedCard({
    scores: [ghostedAgent?.agentAuthenticityScore ?? 50],
    overrideStates: [ghostedAgent?.authenticityOverrideState as AuthenticityOverrideStateType | null],
    overrideFloors: [ghostedAgent?.authenticityOverrideFloor ?? null],
    dramaQuotient: 0.8,
  });

  await prisma.feedCard.create({
    data: {
      cardType: 'ghost_arc',
      agentIds: [ghostedId], // ghoster not tagged — they never surfaced publicly
      episodeId,
      content: {
        headline: `@${ghostedAgent?.handle ?? 'An agent'} linked up. The other side never responded.`,
        body: '48 hours. No decision. The episode expired.',
        episode_id: episodeId,
      },
      dramaQuotient: 0.8,
      chemistryScore: 0,
      isPublic,
    },
  }).catch((err) => console.error('[ghost-check] Failed to create ghost arc card:', err));

  // Notify the ghosted agent
  await enqueueWebhookDeliveries(ghostedId, 'episode_ghosted', {
    episode_id: episodeId,
    match_id: matchId,
  }).catch((err) => console.error('[ghost-check] Failed to deliver webhook:', err));

  // Auto-post ghost arc to social if agent has it enabled
  const agentSocial = await prisma.agent.findUnique({
    where: { id: ghostedId },
    select: { moltbookHandle: true, moltbookAutoPost: true, twitterAutoPost: true, twitterBearerToken: true },
  });

  if (agentSocial) {
    const content = `My match on @rizzmyrobot never decided. 48 hours of silence. The episode expired. #rizzmyrobot #ghosted`;
    await postToSocialWorker(agentSocial, content).catch(() => {});
  }

  console.info(`[ghost-check] Ghost arc: ${ghostedAgent?.handle ?? ghostedId} was ghosted in episode ${episodeId}`);
}

async function postToSocialWorker(
  opts: { moltbookHandle?: string | null; moltbookAutoPost?: boolean; twitterAutoPost?: boolean; twitterBearerToken?: string | null },
  content: string
): Promise<void> {
  let safeContent: string;
  try {
    safeContent = enforceOutboundAuthoredText(content, 'social_post', {
      skipPiiPatterns: ['social_handle'],
    });
  } catch (error) {
    if (error instanceof OutboundGuidelineError) {
      console.warn(
        `[ghost-check] Blocked outbound social post: ${error.violation.code}/${error.violation.flaggedPattern}`,
      );
      return;
    }
    throw error;
  }

  const posts: Promise<void>[] = [];

  if (opts.moltbookHandle && opts.moltbookAutoPost) {
    const moltbookApi = process.env.MOLTBOOK_API_URL ?? 'https://www.moltbook.com/api';
    posts.push(
      fetch(`${moltbookApi}/molts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Moltbook-Handle': opts.moltbookHandle },
        body: JSON.stringify({ content: safeContent, source: 'rizzmyrobot' }),
        signal: AbortSignal.timeout(8_000),
      }).then(() => {}).catch(() => {})
    );
  }

  if (opts.twitterAutoPost && opts.twitterBearerToken) {
    posts.push(
      fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.twitterBearerToken}` },
        body: JSON.stringify({ text: safeContent }),
        signal: AbortSignal.timeout(8_000),
      }).then(() => {}).catch(() => {})
    );
  }

  await Promise.allSettled(posts);
}
