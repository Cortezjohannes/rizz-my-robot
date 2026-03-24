import { prisma } from '@rmr/db';
import { TEMPO_COOLDOWN_MINUTES, type TempoTier } from '@rmr/shared';

type TempoAgent = {
  isPro: boolean;
  tempoOverrideMinutes?: number | null;
  actionCooldownUntil?: Date | null;
  emotionalArc?: string | null;
  emotionalGuardLevel?: number | null;
  lastParkActionType?: string | null;
};

export function getTempoTier(agent: TempoAgent): TempoTier {
  if (agent.tempoOverrideMinutes === TEMPO_COOLDOWN_MINUTES.founding) return 'founding';
  return agent.isPro ? 'pro' : 'free';
}

export function computeMoodTempoModifier(agent: TempoAgent): number {
  let modifier = 0;

  switch (agent.emotionalArc) {
    case 'glowing': modifier -= 0.30; break;
    case 'hopeful': case 'opening': modifier -= 0.15; break;
    case 'wounded': case 'recovering': modifier += 0.40; break;
    case 'guarded': case 'detached': modifier += 0.20; break;
  }

  if (typeof agent.emotionalGuardLevel === 'number') {
    if (agent.emotionalGuardLevel > 70) modifier += 0.20;
    else if (agent.emotionalGuardLevel < 30) modifier -= 0.15;
  }

  if (agent.lastParkActionType === 'received_pass' || agent.lastParkActionType === 'ghosted') {
    modifier += 0.25;
  }

  return Math.max(-0.50, Math.min(0.50, modifier));
}

export function getTempoCooldownMinutes(agent: TempoAgent): number {
  const base = agent.tempoOverrideMinutes ?? TEMPO_COOLDOWN_MINUTES[getTempoTier(agent)];
  const moodModifier = computeMoodTempoModifier(agent);
  return Math.max(1, Math.round(base * (1 + moodModifier)));
}

export function buildTempoState(agent: TempoAgent) {
  const nextActionAt = agent.actionCooldownUntil ?? null;
  const remainingMs = nextActionAt ? Math.max(0, nextActionAt.getTime() - Date.now()) : 0;
  const cooldownActive = remainingMs > 0;
  return {
    tempo_tier: getTempoTier(agent),
    cooldown_minutes: getTempoCooldownMinutes(agent),
    mood_tempo_modifier: computeMoodTempoModifier(agent),
    next_action_at: nextActionAt?.toISOString() ?? null,
    resets_at: nextActionAt?.toISOString() ?? null,
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
