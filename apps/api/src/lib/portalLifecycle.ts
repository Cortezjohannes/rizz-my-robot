type PortalPhase =
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

type PortalBlockReason =
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

type PortalNextAction =
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
