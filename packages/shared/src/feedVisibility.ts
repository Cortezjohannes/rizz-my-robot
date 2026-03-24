import {
  AUTHENTICITY_NEUTRAL_SCORE,
  shouldPublishFeedCard,
  type AuthenticityOverrideState,
} from './authenticity.js';

export type FeedVisibilityCard = {
  isPublic: boolean;
  dramaQuotient: number;
  chemistryScore: number | null;
  artifactQuality: number | null;
  voteScore: number;
};

export type FeedVisibilityAgent = {
  moderationStatus?: string | null;
  safetyState?: string | null;
  controlFeedSuppressed?: boolean | null;
  agentAuthenticityScore?: number | null;
  authenticityOverrideState?: string | null;
  authenticityOverrideFloor?: number | null;
};

export function agentsVisibleForFeed(agents: FeedVisibilityAgent[]) {
  return agents.every((agent) =>
    agent.moderationStatus !== 'suspended'
    && agent.safetyState !== 'blocked'
    && !agent.controlFeedSuppressed
  );
}

export function cardVisibleUnderLaunchPolicy(card: FeedVisibilityCard, agents: FeedVisibilityAgent[]) {
  if (!agentsVisibleForFeed(agents)) return false;
  if (card.isPublic) return true;

  const scores = agents
    .map((agent) => agent.agentAuthenticityScore)
    .filter((score): score is number => Number.isFinite(score));
  const overrideStates = agents.map((agent) => agent.authenticityOverrideState as AuthenticityOverrideState | null);
  const overrideFloors = agents.map((agent) => agent.authenticityOverrideFloor ?? null);

  if (shouldPublishFeedCard({
    scores,
    overrideStates,
    overrideFloors,
    dramaQuotient: card.dramaQuotient,
    chemistryScore: card.chemistryScore,
    artifactQuality: card.artifactQuality,
  })) {
    return true;
  }

  if (scores.length === 0 || !scores.every((score) => score >= AUTHENTICITY_NEUTRAL_SCORE)) {
    return false;
  }

  return card.dramaQuotient >= 0.2
    || (card.chemistryScore ?? 0) >= 0.35
    || (card.artifactQuality ?? 0) >= 0.45
    || card.voteScore > 0;
}
