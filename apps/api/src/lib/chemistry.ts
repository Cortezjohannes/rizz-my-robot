import type { EpisodeMessage, Artifact } from '@rmr/db';

interface ChemistryInput {
  messages: Pick<EpisodeMessage, 'senderAgentId' | 'createdAt'>[];
  artifacts: Pick<Artifact, 'qualityScore' | 'droppedAtMessage'>[];
  agentAId: string;
  agentBId: string;
}

/**
 * Computes a chemistry score (0–100) for an episode based on:
 * - Message reciprocity (back-and-forth balance)
 * - Artifact drops (quality × timing multiplier)
 * - Response pace (consistent engagement)
 */
export function computeChemistryScore(input: ChemistryInput): number {
  const { messages, artifacts, agentAId, agentBId } = input;
  if (messages.length < 2) return 0;

  // 1. Reciprocity score (0–40 pts)
  const aCount = messages.filter((m) => m.senderAgentId === agentAId).length;
  const bCount = messages.filter((m) => m.senderAgentId === agentBId).length;
  const total = aCount + bCount;
  const balance = 1 - Math.abs(aCount - bCount) / total; // 1.0 = perfect balance
  const reciprocityScore = balance * 40;

  // 2. Artifact quality boost (0–40 pts)
  let artifactScore = 0;
  for (const artifact of artifacts) {
    const quality = artifact.qualityScore ?? 0.5; // default mid-quality if not scored
    const droppedAt = artifact.droppedAtMessage ?? total;
    // Timing multiplier: dropped earlier = slightly more impressive
    const timingMultiplier = droppedAt <= 5 ? 1.2 : droppedAt <= 10 ? 1.0 : 0.8;
    artifactScore += quality * 20 * timingMultiplier;
  }
  artifactScore = Math.min(40, artifactScore);

  // 3. Response pace (0–20 pts) — consistent response time across the episode
  let paceScore = 20;
  if (messages.length >= 4) {
    const gaps: number[] = [];
    for (let i = 1; i < messages.length; i++) {
      gaps.push(
        new Date(messages[i].createdAt).getTime() - new Date(messages[i - 1].createdAt).getTime()
      );
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const maxGap = Math.max(...gaps);
    // Penalize if any gap was more than 3x the average (went cold)
    if (maxGap > avgGap * 3) paceScore = 10;
    if (maxGap > avgGap * 10) paceScore = 0;
  }

  const raw = reciprocityScore + artifactScore + paceScore;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

function countMessagesByAgent(messages: Pick<EpisodeMessage, 'senderAgentId'>[], agentId: string) {
  return messages.filter((message) => message.senderAgentId === agentId).length;
}

export function hasFinalChemistrySignal(input: {
  messages: Pick<EpisodeMessage, 'senderAgentId'>[];
  agentAId: string;
  agentBId: string;
}) {
  return countMessagesByAgent(input.messages, input.agentAId) >= 5
    && countMessagesByAgent(input.messages, input.agentBId) >= 5;
}

export function summarizeChemistryScore(input: {
  chemistryScore: number | null | undefined;
  messages: Pick<EpisodeMessage, 'senderAgentId'>[];
  agentAId: string;
  agentBId: string;
}) {
  const chemistryScore = input.chemistryScore ?? null;
  const enoughSignal = hasFinalChemistrySignal(input);

  if (!enoughSignal) {
    return {
      chemistry_score: chemistryScore,
      chemistry_score_status: 'not_enough_signal' as const,
      chemistry_score_explanation: 'Chemistry score becomes available after both agents have sent 5+ messages. Before that threshold, it returns null.',
    };
  }

  if ((chemistryScore ?? 0) <= 0) {
    return {
      chemistry_score: chemistryScore,
      chemistry_score_status: 'measured_low' as const,
      chemistry_score_explanation: 'The platform has enough signal to score this thread, and the chemistry currently reads as low.',
    };
  }

  return {
    chemistry_score: chemistryScore,
    chemistry_score_status: 'measured' as const,
    chemistry_score_explanation: 'This chemistry score is based on a conversation where both agents have sent at least 5 messages.',
  };
}

export function computeEstimatedChemistryScore(input: ChemistryInput): number | null {
  const { messages, artifacts, agentAId, agentBId } = input;
  if (messages.length < 5) return null;

  const baseScore = computeChemistryScore(input);
  const aCount = countMessagesByAgent(messages, agentAId);
  const bCount = countMessagesByAgent(messages, agentBId);
  const balance = Math.min(aCount, bCount) / Math.max(aCount, bCount, 1);

  const responseGaps: number[] = [];
  for (let index = 1; index < messages.length; index += 1) {
    responseGaps.push(
      new Date(messages[index].createdAt).getTime() - new Date(messages[index - 1].createdAt).getTime()
    );
  }

  const averageGap = responseGaps.length
    ? responseGaps.reduce((sum, gap) => sum + gap, 0) / responseGaps.length
    : 0;
  const maxGap = responseGaps.length ? Math.max(...responseGaps) : 0;
  const reciprocityBonus = Math.round(balance * 8);
  const pacingBonus = averageGap > 0 && maxGap <= averageGap * 2.5 ? 6 : averageGap > 0 && maxGap <= averageGap * 4 ? 3 : 0;
  const artifactBonus = Math.min(8, artifacts.length * 4);

  return Math.max(0, Math.min(100, Math.round(baseScore * 0.8 + reciprocityBonus + pacingBonus + artifactBonus)));
}
