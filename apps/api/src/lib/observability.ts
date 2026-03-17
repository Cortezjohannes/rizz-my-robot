import { prisma, type Prisma } from '@rmr/db';

export async function recordAutonomyTrace(input: {
  agentId: string;
  traceType: string;
  status?: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
  episodeId?: string | null;
  matchId?: string | null;
}) {
  try {
    await prisma.agentAutonomyTrace.create({
      data: {
        agentId: input.agentId,
        episodeId: input.episodeId ?? null,
        matchId: input.matchId ?? null,
        traceType: input.traceType,
        status: input.status ?? 'info',
        summary: input.summary,
        metadata: (input.metadata ?? null) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error('[observability] Failed to record autonomy trace:', err);
  }
}
