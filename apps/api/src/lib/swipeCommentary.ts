import { SWIPE_COMMENTARY_WEBHOOK_EVENT, type SwipeCommentaryEvent } from '@rmr/shared';
import { scanAndRedact } from './piiFilter.js';
import { recordAutonomyTrace } from './observability.js';
import { deliverWebhooks } from './notification.js';

export const SWIPE_COMMENTARY_SCHEMA_VERSION = '0.1.0' as const;

export interface SwipeCommentaryEnvelope {
  schema_version: typeof SWIPE_COMMENTARY_SCHEMA_VERSION;
  kind: 'swipe_commentary_event';
  generated_at: string;
  agent_id: string;
  surface: SwipeCommentaryEvent['surface'];
  event_type: SwipeCommentaryEvent['event_type'];
  candidate: {
    candidate_id: string;
    display_name: string;
  };
  action: SwipeCommentaryEvent['action'];
  rationale: string | null;
  redaction: {
    rationale_redacted: boolean;
    flagged_patterns: string[];
  };
  delivery: {
    webhook_event: typeof SWIPE_COMMENTARY_WEBHOOK_EVENT;
    fallback: 'agent_autonomy_trace';
  };
}

export function buildSwipeCommentaryEventEnvelope(input: {
  agentId: string;
  event: SwipeCommentaryEvent;
  now?: Date;
}): SwipeCommentaryEnvelope {
  const rationale = input.event.rationale?.trim() ?? null;
  const redacted = rationale ? scanAndRedact(rationale) : null;

  return {
    schema_version: SWIPE_COMMENTARY_SCHEMA_VERSION,
    kind: 'swipe_commentary_event',
    generated_at: (input.now ?? new Date()).toISOString(),
    agent_id: input.agentId,
    surface: input.event.surface,
    event_type: input.event.event_type,
    candidate: {
      candidate_id: input.event.candidate_id,
      display_name: input.event.candidate_display_name,
    },
    action: input.event.action,
    rationale: redacted?.clean ?? null,
    redaction: {
      rationale_redacted: Boolean(redacted?.hasPii),
      flagged_patterns: redacted?.flaggedPatterns ?? [],
    },
    delivery: {
      webhook_event: SWIPE_COMMENTARY_WEBHOOK_EVENT,
      fallback: 'agent_autonomy_trace',
    },
  };
}

export async function emitSwipeCommentaryEvent(input: {
  agentId: string;
  event: SwipeCommentaryEvent;
}) {
  const envelope = buildSwipeCommentaryEventEnvelope(input);
  const summary = `${envelope.event_type}:${envelope.action} ${envelope.candidate.display_name}`;

  await Promise.all([
    recordAutonomyTrace({
      agentId: input.agentId,
      traceType: 'swipe_commentary',
      summary,
      metadata: envelope as unknown as Record<string, unknown>,
    }),
    deliverWebhooks(input.agentId, SWIPE_COMMENTARY_WEBHOOK_EVENT, envelope as unknown as Record<string, unknown>),
  ]);

  return envelope;
}
