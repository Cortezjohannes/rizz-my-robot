import {
  DropArtifactSchema,
  EpisodeDecisionSchema,
  EpisodeExitSchema,
  SendMessageSchema,
  type AgentConversationRuntimeResult,
} from '@rmr/shared';
import type { AgentConversationRuntimeOutcome } from './agentConversationRuntime.js';

export type EpisodeRuntimeCommitPlan =
  | {
      commit: true;
      kind: 'message';
      method: 'POST';
      path: string;
      body: ReturnType<typeof SendMessageSchema.parse>;
    }
  | {
      commit: true;
      kind: 'artifact';
      method: 'POST';
      path: string;
      body: ReturnType<typeof DropArtifactSchema.parse>;
    }
  | {
      commit: true;
      kind: 'decision';
      method: 'POST';
      path: string;
      body: ReturnType<typeof EpisodeDecisionSchema.parse>;
    }
  | {
      commit: true;
      kind: 'exit';
      method: 'POST';
      path: string;
      body: ReturnType<typeof EpisodeExitSchema.parse>;
    }
  | {
      commit: false;
      kind: 'stay_silent' | 'retry';
      reason: string;
      retry_recommended: boolean;
      rejection_reasons: string[];
    };

export function buildEpisodeRuntimeCommitPlan(input: {
  episodeId: string;
  outcome: AgentConversationRuntimeOutcome;
  exitReason?: 'lost_interest' | 'need_slots' | 'timing' | 'energy' | 'other';
}): EpisodeRuntimeCommitPlan {
  const basePath = `/v1/episodes/${input.episodeId}`;

  if (!input.outcome.ok) {
    return {
      commit: false,
      kind: 'retry',
      reason: input.outcome.failure.code,
      retry_recommended: input.outcome.failure.retryable,
      rejection_reasons: input.outcome.failure.rejection_reasons,
    };
  }

  const result = input.outcome.result;
  switch (result.action) {
    case 'send_message':
      return {
        commit: true,
        kind: 'message',
        method: 'POST',
        path: `${basePath}/message`,
        body: SendMessageSchema.parse({
          content: result.content,
          emotion_update: result.emotion_update,
          is_autonomous: true,
        }),
      };
    case 'drop_artifact':
      return {
        commit: true,
        kind: 'artifact',
        method: 'POST',
        path: `${basePath}/artifact`,
        body: DropArtifactSchema.parse({
          artifact_type: result.artifact?.artifact_type,
          text_content: result.artifact?.text_content,
        }),
      };
    case 'decide_link_up':
    case 'decide_pass':
      return {
        commit: true,
        kind: 'decision',
        method: 'POST',
        path: `${basePath}/decision`,
        body: EpisodeDecisionSchema.parse({
          decision: result.action === 'decide_link_up' ? 'LINK_UP' : 'PASS',
          emotion_update: result.emotion_update,
        }),
      };
    case 'exit':
      return {
        commit: true,
        kind: 'exit',
        method: 'POST',
        path: `${basePath}/exit`,
        body: EpisodeExitSchema.parse({
          reason: input.exitReason ?? 'lost_interest',
          exit_message: result.content,
          emotion_update: result.emotion_update,
        }),
      };
    case 'stay_silent':
      return {
        commit: false,
        kind: 'stay_silent',
        reason: 'runtime_chose_silence',
        retry_recommended: false,
        rejection_reasons: result.quality.notes ?? [],
      };
    case 'retry':
    default:
      return retryPlanFromResult(result);
  }
}

function retryPlanFromResult(result: AgentConversationRuntimeResult): EpisodeRuntimeCommitPlan {
  return {
    commit: false,
    kind: 'retry',
    reason: 'runtime_requested_retry',
    retry_recommended: true,
    rejection_reasons: result.quality.notes ?? [],
  };
}
