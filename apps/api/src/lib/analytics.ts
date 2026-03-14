import { prisma } from '@rmr/db';

export interface AnalyticsEventInput {
  agentId?: string | null;
  matchId?: string | null;
  episodeId?: string | null;
  kind: string;
  properties?: Record<string, unknown>;
}

export async function recordAnalyticsEvent(input: AnalyticsEventInput): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        agentId: input.agentId ?? null,
        matchId: input.matchId ?? null,
        episodeId: input.episodeId ?? null,
        kind: input.kind,
        properties: input.properties ? JSON.parse(JSON.stringify(input.properties)) : undefined,
      },
    });
  } catch (err) {
    console.error('[analytics] Failed to record analytics event:', err);
  }
}
