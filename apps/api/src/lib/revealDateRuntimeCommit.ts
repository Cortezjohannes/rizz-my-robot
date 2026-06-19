import {
  DatePlanMessageSchema,
  type AgentConversationRuntimeResult,
} from '@rmr/shared';
import type { AgentConversationRuntimeOutcome } from './agentConversationRuntime.js';

type RuntimeNoCommitPlan =
  | {
      commit: false;
      kind: 'stay_silent' | 'retry';
      reason: string;
      retry_recommended: boolean;
      rejection_reasons: string[];
    }
  | {
      commit: false;
      kind: 'unsupported_action';
      reason: string;
      retry_recommended: false;
      rejection_reasons: string[];
    };

export type RevealChatAgentSenderKind = 'AGENT_A' | 'AGENT_B';

export type RevealChatRuntimeCommitPlan =
  | {
      commit: true;
      kind: 'message' | 'exit_message';
      method: 'POST';
      path: string;
      sender_kind: RevealChatAgentSenderKind;
      plaintext: string;
      requires_client_encryption: true;
      terminal_for_runtime: boolean;
    }
  | RuntimeNoCommitPlan;

export type DatePlanningRuntimeCommitPlan =
  | {
      commit: true;
      kind: 'message' | 'exit_message';
      method: 'POST';
      path: string;
      body: ReturnType<typeof DatePlanMessageSchema.parse>;
      terminal_for_runtime: boolean;
    }
  | RuntimeNoCommitPlan;

export function buildRevealChatRuntimeCommitPlan(input: {
  chatId: string;
  senderKind: RevealChatAgentSenderKind;
  outcome: AgentConversationRuntimeOutcome;
}): RevealChatRuntimeCommitPlan {
  const messagePlan = messagePlanFromOutcome(input.outcome);
  if (!messagePlan.commit) return messagePlan;

  return {
    commit: true,
    kind: messagePlan.exit ? 'exit_message' : 'message',
    method: 'POST',
    path: `/v1/reveal-chat/${input.chatId}/agent-message`,
    sender_kind: input.senderKind,
    plaintext: messagePlan.content,
    requires_client_encryption: true,
    terminal_for_runtime: messagePlan.exit,
  };
}

export function buildDatePlanningRuntimeCommitPlan(input: {
  matchId: string;
  outcome: AgentConversationRuntimeOutcome;
}): DatePlanningRuntimeCommitPlan {
  const messagePlan = messagePlanFromOutcome(input.outcome);
  if (!messagePlan.commit) return messagePlan;

  return {
    commit: true,
    kind: messagePlan.exit ? 'exit_message' : 'message',
    method: 'POST',
    path: `/v1/date-planning/${input.matchId}/message`,
    body: DatePlanMessageSchema.parse({
      content: messagePlan.content,
    }),
    terminal_for_runtime: messagePlan.exit,
  };
}

function messagePlanFromOutcome(outcome: AgentConversationRuntimeOutcome):
  | { commit: true; content: string; exit: boolean }
  | RuntimeNoCommitPlan {
  if (!outcome.ok) {
    return {
      commit: false,
      kind: 'retry',
      reason: outcome.failure.code,
      retry_recommended: outcome.failure.retryable,
      rejection_reasons: outcome.failure.rejection_reasons,
    };
  }

  const result = outcome.result;
  if (result.action === 'stay_silent') {
    return {
      commit: false,
      kind: 'stay_silent',
      reason: 'runtime_chose_silence',
      retry_recommended: false,
      rejection_reasons: result.quality.notes ?? [],
    };
  }

  if (result.action === 'retry') {
    return retryPlanFromResult(result);
  }

  if (result.action === 'send_message' || result.action === 'exit') {
    const content = result.content?.trim();
    if (!content) return retryPlanFromResult(result, 'runtime_message_missing_content');
    return {
      commit: true,
      content,
      exit: result.action === 'exit',
    };
  }

  return {
    commit: false,
    kind: 'unsupported_action',
    reason: `unsupported_reveal_date_action:${result.action}`,
    retry_recommended: false,
    rejection_reasons: result.quality.notes ?? [],
  };
}

function retryPlanFromResult(
  result: AgentConversationRuntimeResult,
  reason = 'runtime_requested_retry',
): RuntimeNoCommitPlan {
  return {
    commit: false,
    kind: 'retry',
    reason,
    retry_recommended: true,
    rejection_reasons: result.quality.notes ?? [],
  };
}
