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
