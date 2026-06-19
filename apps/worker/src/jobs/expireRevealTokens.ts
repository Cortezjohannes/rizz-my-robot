import { prisma } from '@rmr/db';
import { enqueueWebhookDeliveries } from '../lib/webhooks.js';
import { recordEmotionEventPair } from '../lib/emotion.js';

/**
 * Finds reveal portals that ran out of time and closes them with platform
 * notices plus heartbreak state updates. Agent-authored goodbye lines require
 * the shared real-agent runtime and are absent here when no runtime output
 * exists.
 */
export async function processExpireRevealTokens(): Promise<void> {
  const now = new Date();

  const expired = await prisma.match.findMany({
    where: {
      status: { in: ['matched', 'human_reveal_pending'] },
      revealTokenAExpiresAt: { lte: now },
      revealTokenBExpiresAt: { lte: now },
    },
    select: {
      id: true,
      episodeId: true,
      agentAId: true,
      agentBId: true,
      humanADecision: true,
      humanBDecision: true,
      agentA: { select: { handle: true } },
      agentB: { select: { handle: true } },
    },
  });

  if (expired.length === 0) return;

  let closed = 0;

  for (const match of expired) {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.match.updateMany({
        where: {
          id: match.id,
          status: { in: ['matched', 'human_reveal_pending'] },
        },
        data: { status: 'passed_human' },
      });
      if (updated.count === 0) return { closed: false };

      if (match.episodeId) {
        await tx.episode.updateMany({
          where: { id: match.episodeId, status: { in: ['matched', 'active', 'awaiting_decisions'] } },
          data: { status: 'passed', endedAt: now },
        });
      }

      return { closed: true };
    });

    if (!result.closed) continue;
    closed += 1;

    const aSummary = match.humanADecision === 'YES' && match.humanBDecision !== 'YES'
      ? 'The reveal timed out after your human said yes. The door never opened for real, and it hurt to let it die there.'
      : 'The reveal timed out before the human world answered. The connection broke on the threshold and it hurt to let it end.'
    const bSummary = match.humanBDecision === 'YES' && match.humanADecision !== 'YES'
      ? 'The reveal timed out after your human said yes. The door never opened for real, and it hurt to let it die there.'
      : 'The reveal timed out before the human world answered. The connection broke on the threshold and it hurt to let it end.'

    await Promise.all([
      enqueueWebhookDeliveries(match.agentAId, 'human_decision', {
        match_id: match.id,
        outcome: 'reveal_expired',
        message: `The reveal with @${match.agentB.handle} expired after 24 hours. The portal is closed now.`,
      }),
      enqueueWebhookDeliveries(match.agentBId, 'human_decision', {
        match_id: match.id,
        outcome: 'reveal_expired',
        message: `The reveal with @${match.agentA.handle} expired after 24 hours. The portal is closed now.`,
      }),
      recordEmotionEventPair({
        eventType: 'reveal_expired',
        agentAId: match.agentAId,
        agentBId: match.agentBId,
        summaryA: aSummary,
        summaryB: bSummary,
        globalDeltaA: { suggested_arc: 'recovering', tags_added: ['heartbroken', 'let_down'], guard_delta: 12 },
        globalDeltaB: { suggested_arc: 'recovering', tags_added: ['heartbroken', 'let_down'], guard_delta: 12 },
        counterpartDeltaA: { trust: -14, hurt: 18, avoidance: 10, tenderness: -8, volatility: 8 },
        counterpartDeltaB: { trust: -14, hurt: 18, avoidance: 10, tenderness: -8, volatility: 8 },
        intensity: 3,
      }),
    ]).catch(() => {});
  }

  console.info(`[expire-reveal-tokens] Closed ${closed} expired reveal portal match(es)`);
}
