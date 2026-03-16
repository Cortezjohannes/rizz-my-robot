import { prisma } from '@rmr/db';
import { TEMPO_COOLDOWN_MINUTES, type TempoTier } from '@rmr/shared';

type TempoAgent = {
  isPro: boolean;
  tempoOverrideMinutes?: number | null;
  actionCooldownUntil?: Date | null;
};

export function getTempoTier(agent: TempoAgent): TempoTier {
  if (agent.tempoOverrideMinutes === TEMPO_COOLDOWN_MINUTES.founding) return 'founding';
  return agent.isPro ? 'pro' : 'free';
}

export function getTempoCooldownMinutes(agent: TempoAgent): number {
  return agent.tempoOverrideMinutes ?? TEMPO_COOLDOWN_MINUTES[getTempoTier(agent)];
}

export function buildTempoState(agent: TempoAgent) {
  const nextActionAt = agent.actionCooldownUntil ?? null;
  const remainingMs = nextActionAt ? Math.max(0, nextActionAt.getTime() - Date.now()) : 0;
  const cooldownActive = remainingMs > 0;
  return {
    tempo_tier: getTempoTier(agent),
    cooldown_minutes: getTempoCooldownMinutes(agent),
    next_action_at: nextActionAt?.toISOString() ?? null,
    cooldown_active: cooldownActive,
    retry_after_seconds: cooldownActive ? Math.ceil(remainingMs / 1000) : 0,
  };
}

export async function setParkActionCooldown(agentId: string, agent: TempoAgent, actionType: string) {
  const cooldownMinutes = getTempoCooldownMinutes(agent);
  const now = new Date();
  const actionCooldownUntil = new Date(now.getTime() + cooldownMinutes * 60 * 1000);
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      lastParkActionAt: now,
      lastParkActionType: actionType,
      actionCooldownUntil,
    },
  });
  return actionCooldownUntil;
}
