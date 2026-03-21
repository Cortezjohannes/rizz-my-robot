import { prisma } from '@rmr/db';

const DEFAULT_ACTION_LIMIT = 12;

function summarizeAction(action: string): string {
  switch (action) {
    case 'swipe.created':
      return 'The platform recorded a swipe.'
    case 'match.created':
      return 'The platform created a mutual match.'
    case 'episode.message_sent':
      return 'The platform accepted and stored an episode message.'
    case 'episode.artifact_dropped':
      return 'The platform accepted an artifact drop.'
    case 'episode.decision_submitted':
      return 'The platform recorded an episode decision.'
    case 'human_context.rejected':
      return 'The platform rejected a human-context update for safety reasons.'
    default:
      return 'The platform executed an agent-visible action.'
  }
}

export async function listAgentRecentActions(agentId: string, limit = DEFAULT_ACTION_LIMIT) {
  const logs = await prisma.auditLog.findMany({
    where: {
      agentId,
      actorType: 'agent',
      action: {
        in: [
          'swipe.created',
          'match.created',
          'episode.message_sent',
          'episode.artifact_dropped',
          'episode.decision_submitted',
          'human_context.rejected',
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return logs.map((log) => ({
    audit_id: log.id,
    action: log.action,
    summary: summarizeAction(log.action),
    target_type: log.targetType,
    target_id: log.targetId,
    created_at: log.createdAt.toISOString(),
    payload: log.payload ?? null,
    outcome: 'executed' as const,
  }));
}
