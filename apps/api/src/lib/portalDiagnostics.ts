import { prisma } from '@rmr/db';
import {
  buildPortalChatLifecycle,
  buildPortalLifecycle,
  derivePortalChatState,
  derivePortalRevealState,
} from './portalLifecycle.js';
import { getRevealChatCoordinationRuntimeState } from './revealChatCoordination.js';

function minutesBetween(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

function summarizeLifecycle(phase: string, blockedReason: string | null) {
  if (blockedReason === 'reveal_review') return 'Reveal is waiting on safety review.';
  if (blockedReason === 'other_human_pending') return 'One human has not finished the handoff yet.';
  if (blockedReason === 'chat_keys_pending') return 'The encrypted thread still needs to finish initialization.';
  if (blockedReason === 'runtime_degraded') return 'Realtime coordination is running in degraded mode.';
  if (phase === 'chat_active') return 'Encrypted handoff is live.';
  if (phase === 'chat_archived') return 'Encrypted handoff has ended and is archived.';
  if (phase === 'contact_unlocked') return 'Both humans said yes and contact is unlocked.';
  if (phase === 'closed') return 'The reveal was closed by a human decision.';
  if (phase === 'expired') return 'The reveal link expired.';
  return 'Portal is active.';
}

function summarizeAuditAction(action: string) {
  switch (action) {
    case 'portal.age_verified':
      return 'Viewer completed age verification.';
    case 'portal.decision_submitted':
      return 'A human decision was submitted.';
    case 'reveal_chat_initialized':
      return 'Encrypted handoff thread was initialized.';
    default:
      return action.replaceAll('.', ' ');
  }
}

function buildPortalDiagnosticItem(match: Awaited<ReturnType<typeof loadRevealPortalMatches>>[number]) {
  const runtime = getRevealChatCoordinationRuntimeState();
  const now = new Date();
  const expired = Boolean(
    (match.revealTokenAExpiresAt && match.revealTokenAExpiresAt < now)
    || (match.revealTokenBExpiresAt && match.revealTokenBExpiresAt < now),
  );

  const portalState = derivePortalRevealState({
    expired,
    underReview: Boolean(match.revealSafetyState && match.revealSafetyState !== 'clear'),
    isOmnimonReward: false,
    rewardReady: false,
    myDecision: match.humanADecision,
    theirDecision: match.humanBDecision,
    revealClosed: match.status === 'passed_human',
    stage2Ready: match.status === 'contact_exchanged',
  });

  const portalLifecycle = buildPortalLifecycle({
    phase: portalState.phase,
    blockedReason: portalState.blockedReason,
    nextAction: portalState.nextAction,
    pollAfterMs: portalState.pollAfterMs,
    headline: 'Reveal status',
    subheadline: summarizeLifecycle(portalState.phase, portalState.blockedReason),
  });

  const chatState = match.revealChat
    ? derivePortalChatState({
        expired,
        ageVerified: true,
        myDecision: match.humanADecision,
        theirDecision: match.humanBDecision,
        contactExchanged: match.status === 'contact_exchanged',
        chatExists: true,
        chatArchived: match.revealChat.status === 'ARCHIVED',
        participantCount: match.revealChat.participants.length,
        runtimeDegraded: runtime.degraded,
      })
    : null;
  const chatLifecycle = chatState
    ? buildPortalChatLifecycle({
        phase: chatState.phase,
        blockedReason: chatState.blockedReason,
        nextAction: chatState.nextAction,
        statusNote: summarizeLifecycle(chatState.phase, chatState.blockedReason),
        privacyNote: 'Only the two humans and their agents can read the encrypted handoff thread.',
        readOnlyReason: chatState.phase === 'chat_archived' ? 'This conversation has ended.' : null,
      })
    : null;

  const lastTransitionAt = match.revealChat?.updatedAt ?? match.updatedAt;

  return {
    match_id: match.id,
    pair: `@${match.agentA.handle} x @${match.agentB.handle}`,
    status: match.status,
    reveal_safety_state: match.revealSafetyState,
    reveal_hold_reason: match.revealHoldReason,
    updated_at: match.updatedAt.toISOString(),
    portal_phase: portalLifecycle.phase,
    portal_blocked_reason: portalLifecycle.blocked_reason,
    chat_phase: chatLifecycle?.phase ?? null,
    chat_blocked_reason: chatLifecycle?.blocked_reason ?? null,
    last_transition_at: lastTransitionAt.toISOString(),
    stuck_for_minutes: minutesBetween(lastTransitionAt, now),
    last_transition_summary: summarizeLifecycle(chatLifecycle?.phase ?? portalLifecycle.phase, chatLifecycle?.blocked_reason ?? portalLifecycle.blocked_reason),
    runtime,
    reveal_chat: match.revealChat
      ? {
          chat_id: match.revealChat.id,
          status: match.revealChat.status,
          participant_count: match.revealChat.participants.length,
          participants: match.revealChat.participants.map((participant) => ({
            kind: participant.kind,
            joined_at: participant.joinedAt.toISOString(),
            left_at: participant.leftAt?.toISOString() ?? null,
          })),
          last_message_at: match.revealChat.messages[0]?.createdAt.toISOString() ?? null,
          time_capsule_unlocks_at: match.revealChat.timeCapsuleUnlocksAt?.toISOString() ?? null,
          time_capsule_opened_at: match.revealChat.timeCapsuleOpenedAt?.toISOString() ?? null,
        }
      : null,
  };
}

async function loadRevealPortalMatches(limit = 100) {
  return prisma.match.findMany({
    where: {
      OR: [
        { revealTokenA: { not: null } },
        { revealTokenB: { not: null } },
        { revealChat: { isNot: null } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      updatedAt: true,
      revealHoldReason: true,
      revealSafetyState: true,
      humanADecision: true,
      humanBDecision: true,
      revealTokenAExpiresAt: true,
      revealTokenBExpiresAt: true,
      agentA: { select: { handle: true } },
      agentB: { select: { handle: true } },
      revealChat: {
        select: {
          id: true,
          status: true,
          timeCapsuleUnlocksAt: true,
          timeCapsuleOpenedAt: true,
          updatedAt: true,
          participants: {
            select: {
              kind: true,
              joinedAt: true,
              leftAt: true,
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
        },
      },
    },
  });
}

export async function buildRevealPortalDiagnostics(limit = 100) {
  const matches = await loadRevealPortalMatches(limit);
  return matches.map(buildPortalDiagnosticItem);
}

export async function buildRevealPortalDiagnosticDetail(matchId: string) {
  const matches = await prisma.match.findMany({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      revealHoldReason: true,
      revealSafetyState: true,
      humanADecision: true,
      humanBDecision: true,
      revealTokenAExpiresAt: true,
      revealTokenBExpiresAt: true,
      agentA: { select: { handle: true } },
      agentB: { select: { handle: true } },
      revealChat: {
        select: {
          id: true,
          status: true,
          timeCapsuleUnlocksAt: true,
          timeCapsuleOpenedAt: true,
          updatedAt: true,
          participants: {
            select: {
              kind: true,
              joinedAt: true,
              leftAt: true,
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
        },
      },
    },
  });

  const match = matches[0];
  if (!match) return null;

  const item = buildPortalDiagnosticItem(match);
  const auditTargets = [
    { targetType: 'match', targetId: match.id },
    ...(match.revealChat ? [{ targetType: 'reveal_chat', targetId: match.revealChat.id }] : []),
  ];

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      OR: auditTargets,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      action: true,
      actorType: true,
      actorId: true,
      targetType: true,
      targetId: true,
      payload: true,
      createdAt: true,
    },
  });

  return {
    ...item,
    last_transition_at: auditLogs[0]?.createdAt.toISOString() ?? item.last_transition_at,
    stuck_for_minutes: minutesBetween(new Date(auditLogs[0]?.createdAt ?? item.last_transition_at), new Date()),
    last_transition_summary: auditLogs[0]
      ? summarizeAuditAction(auditLogs[0].action)
      : item.last_transition_summary,
    timeline: auditLogs.map((log) => ({
      audit_id: log.id,
      at: log.createdAt.toISOString(),
      action: log.action,
      actor_type: log.actorType,
      actor_id: log.actorId,
      target_type: log.targetType,
      target_id: log.targetId,
      payload: log.payload,
    })),
  };
}
