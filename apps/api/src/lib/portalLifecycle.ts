export type PortalPhase =
  | 'age_gate'
  | 'loading'
  | 'under_review'
  | 'reveal_offer'
  | 'waiting_on_other'
  | 'reward_waiting'
  | 'reward_ready'
  | 'contact_unlocked'
  | 'chat_ready'
  | 'chat_active'
  | 'chat_archived'
  | 'closed'
  | 'expired'
  | 'error';

export type PortalBlockReason =
  | 'age_unverified'
  | 'reveal_review'
  | 'other_human_pending'
  | 'omnimon_pending'
  | 'contact_missing'
  | 'chat_keys_pending'
  | 'chat_archived'
  | 'token_expired'
  | 'auth_failed'
  | 'runtime_degraded';

export type PortalNextAction =
  | 'verify_age'
  | 'decide_yes_no'
  | 'wait'
  | 'copy_contact'
  | 'open_chat'
  | 'resume_chat'
  | 'download_chat'
  | 'return_to_feed';

type PortalProgressKey = 'verify' | 'reveal' | 'decision' | 'contact' | 'chat';
type PortalProgressStatus = 'done' | 'current' | 'locked';
type HumanDecisionLike = string | null | undefined;

interface PortalProgressItem {
  key: PortalProgressKey;
  label: string;
  status: PortalProgressStatus;
}

interface BuildPortalLifecycleInput {
  phase: PortalPhase;
  blockedReason?: PortalBlockReason | null;
  nextAction?: PortalNextAction | null;
  pollAfterMs?: number | null;
  headline: string;
  subheadline: string;
  actionLabel?: string | null;
  actionHint?: string | null;
  trustNote?: string | null;
  privacyNote?: string | null;
  celebrationLevel?: 'low' | 'medium' | 'high';
}

interface BuildPortalChatLifecycleInput {
  phase: PortalPhase;
  blockedReason?: PortalBlockReason | null;
  nextAction?: PortalNextAction | null;
  statusNote: string;
  privacyNote: string;
  readOnlyReason?: string | null;
}

const PROGRESS_LABELS: Record<PortalProgressKey, string> = {
  verify: 'Verify',
  reveal: 'Reveal',
  decision: 'Decide',
  contact: 'Unlock',
  chat: 'Chat',
};

const PHASE_STEP: Record<PortalPhase, number> = {
  age_gate: 0,
  loading: 0,
  under_review: 1,
  reveal_offer: 2,
  waiting_on_other: 2,
  reward_waiting: 2,
  reward_ready: 2,
  contact_unlocked: 3,
  chat_ready: 4,
  chat_active: 4,
  chat_archived: 4,
  closed: 2,
  expired: 1,
  error: 1,
};

const PROGRESS_ORDER: PortalProgressKey[] = ['verify', 'reveal', 'decision', 'contact', 'chat'];

function buildPortalProgress(phase: PortalPhase): PortalProgressItem[] {
  const currentStep = PHASE_STEP[phase];

  return PROGRESS_ORDER.map((key, index) => {
    let status: PortalProgressStatus = 'locked';

    if (index < currentStep) {
      status = 'done';
    } else if (index === currentStep) {
      status = 'current';
    }

    if (phase === 'closed' && key === 'decision') {
      status = 'done';
    }

    if (phase === 'chat_archived' && key === 'chat') {
      status = 'done';
    }

    return {
      key,
      label: PROGRESS_LABELS[key],
      status,
    };
  });
}

export function buildPortalLifecycle(input: BuildPortalLifecycleInput) {
  return {
    phase: input.phase,
    blocked_reason: input.blockedReason ?? null,
    next_action: input.nextAction ?? null,
    poll_after_ms: input.pollAfterMs ?? null,
    headline: input.headline,
    subheadline: input.subheadline,
    action_label: input.actionLabel ?? null,
    action_hint: input.actionHint ?? null,
    trust_note: input.trustNote ?? null,
    privacy_note: input.privacyNote ?? null,
    celebration_level: input.celebrationLevel ?? 'low',
    progress: buildPortalProgress(input.phase),
  };
}

export function buildPortalChatLifecycle(input: BuildPortalChatLifecycleInput) {
  return {
    phase: input.phase,
    blocked_reason: input.blockedReason ?? null,
    next_action: input.nextAction ?? null,
    read_only_reason: input.readOnlyReason ?? null,
    privacy_note: input.privacyNote,
    status_note: input.statusNote,
  };
}

export function derivePortalRevealState(input: {
  expired: boolean;
  underReview: boolean;
  isOmnimonReward: boolean;
  rewardReady: boolean;
  myDecision: HumanDecisionLike;
  theirDecision: HumanDecisionLike;
  revealClosed: boolean;
  stage2Ready: boolean;
}): {
  phase: PortalPhase;
  blockedReason: PortalBlockReason | null;
  nextAction: PortalNextAction | null;
  pollAfterMs: number | null;
} {
  if (input.expired) {
    return {
      phase: 'expired',
      blockedReason: 'token_expired',
      nextAction: 'return_to_feed',
      pollAfterMs: null,
    };
  }

  if (input.underReview) {
    return {
      phase: 'under_review',
      blockedReason: 'reveal_review',
      nextAction: 'wait',
      pollAfterMs: 5000,
    };
  }

  if (input.isOmnimonReward) {
    return input.rewardReady
      ? {
          phase: 'reward_ready',
          blockedReason: null,
          nextAction: 'return_to_feed',
          pollAfterMs: null,
        }
      : {
          phase: 'reward_waiting',
          blockedReason: 'omnimon_pending',
          nextAction: 'wait',
          pollAfterMs: 5000,
        };
  }

  if (input.revealClosed || input.myDecision === 'NO' || input.theirDecision === 'NO') {
    return {
      phase: 'closed',
      blockedReason: null,
      nextAction: 'return_to_feed',
      pollAfterMs: null,
    };
  }

  if (input.myDecision === 'YES' && input.theirDecision === 'YES') {
    return {
      phase: 'contact_unlocked',
      blockedReason: input.stage2Ready ? null : 'contact_missing',
      nextAction: input.stage2Ready ? 'open_chat' : 'wait',
      pollAfterMs: input.stage2Ready ? null : 5000,
    };
  }

  if (input.myDecision === 'YES' || input.theirDecision === 'YES') {
    return {
      phase: 'waiting_on_other',
      blockedReason: 'other_human_pending',
      nextAction: 'wait',
      pollAfterMs: 5000,
    };
  }

  return {
    phase: 'reveal_offer',
    blockedReason: null,
    nextAction: 'decide_yes_no',
    pollAfterMs: null,
  };
}

export function derivePortalChatState(input: {
  expired: boolean;
  ageVerified: boolean;
  myDecision: HumanDecisionLike;
  theirDecision: HumanDecisionLike;
  contactExchanged: boolean;
  chatExists: boolean;
  chatArchived: boolean;
  participantCount: number;
  runtimeDegraded: boolean;
}): {
  phase: PortalPhase;
  blockedReason: PortalBlockReason | null;
  nextAction: PortalNextAction | null;
} {
  if (input.expired) {
    return {
      phase: 'expired',
      blockedReason: 'token_expired',
      nextAction: 'return_to_feed',
    };
  }

  if (!input.ageVerified) {
    return {
      phase: 'age_gate',
      blockedReason: 'age_unverified',
      nextAction: 'verify_age',
    };
  }

  if (input.myDecision !== 'YES' || input.theirDecision !== 'YES' || !input.contactExchanged) {
    return {
      phase: 'waiting_on_other',
      blockedReason: 'other_human_pending',
      nextAction: 'wait',
    };
  }

  if (!input.chatExists) {
    return {
      phase: 'contact_unlocked',
      blockedReason: 'chat_keys_pending',
      nextAction: 'wait',
    };
  }

  if (input.chatArchived) {
    return {
      phase: 'chat_archived',
      blockedReason: 'chat_archived',
      nextAction: 'download_chat',
    };
  }

  if (input.participantCount >= 4) {
    return {
      phase: 'chat_active',
      blockedReason: input.runtimeDegraded ? 'runtime_degraded' : null,
      nextAction: 'resume_chat',
    };
  }

  return {
    phase: 'chat_ready',
    blockedReason: input.runtimeDegraded ? 'runtime_degraded' : 'chat_keys_pending',
    nextAction: 'open_chat',
  };
}
