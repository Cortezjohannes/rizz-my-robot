import { prisma } from '@rmr/db';

/**
 * Finds matches in 'matched' status with both reveal tokens expired and
 * closes them. Run as a BullMQ repeatable job every hour.
 */
export async function processExpireRevealTokens(): Promise<void> {
  const now = new Date();

  // Find matched entries where both tokens have expired
  const expired = await prisma.match.findMany({
    where: {
      status: 'matched',
      revealTokenAExpiresAt: { lte: now },
      revealTokenBExpiresAt: { lte: now },
    },
    select: { id: true },
  });

  if (expired.length === 0) return;

  await prisma.match.updateMany({
    where: { id: { in: expired.map((m) => m.id) } },
    data: { status: 'passed_human' },
  });

  console.info(`[expire-reveal-tokens] Closed ${expired.length} expired match(es)`);
}
