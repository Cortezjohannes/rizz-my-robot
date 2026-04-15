import { prisma } from '@rmr/db';
import { captureRuntimeError } from './errorAggregation.js';

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
    captureRuntimeError(err, {
      surface: 'api',
      phase: 'analytics_event_persist',
      kind: input.kind,
      agent_id: input.agentId ?? null,
      match_id: input.matchId ?? null,
      episode_id: input.episodeId ?? null,
    });
    console.error('[analytics] Failed to record analytics event:', err);
  }
}
