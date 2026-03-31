import { prisma } from '@rmr/db';
import { buildPortalChatLifecycle, buildPortalLifecycle } from './portalLifecycle.js';
import { getRevealChatCoordinationRuntimeState } from './revealChatCoordination.js';

function buildPortalDiagnosticItem(match: Awaited<ReturnType<typeof loadRevealPortalMatches>>[number]) {
  const runtime = getRevealChatCoordinationRuntimeState();
  const now = new Date();
  const expired = Boolean(
    (match.revealTokenAExpiresAt && match.revealTokenAExpiresAt < now)
    || (match.revealTokenBExpiresAt && match.revealTokenBExpiresAt < now),
  );

  const portalLifecycle = expired
    ? buildPortalLifecycle({
        phase: 'expired',
        blockedReason: 'token_expired',
        nextAction: 'return_to_feed',
        headline: 'Reveal expired',
        subheadline: 'The private handoff link is no longer active.',
      })
    : match.revealSafetyState && match.revealSafetyState !== 'clear'
      ? buildPortalLifecycle({
          phase: 'under_review',
          blockedReason: 'reveal_review',
          nextAction: 'wait',
          pollAfterMs: 5000,
          headline: 'Reveal under review',
          subheadline: 'Human handoff is being reviewed before it can proceed.',
        })
      : match.humanADecision === 'NO' || match.humanBDecision === 'NO' || match.status === 'passed_human'
        ? buildPortalLifecycle({
            phase: 'closed',
            nextAction: 'return_to_feed',
            headline: 'Reveal closed',
            subheadline: 'At least one human declined the handoff.',
          })
        : match.humanADecision === 'YES' && match.humanBDecision === 'YES'
          ? buildPortalLifecycle({
              phase: 'contact_unlocked',
              nextAction: 'open_chat',
              headline: 'Contact unlocked',
              subheadline: 'Both humans said yes and the handoff can continue.',
            })
          : match.humanADecision === 'YES' || match.humanBDecision === 'YES'
            ? buildPortalLifecycle({
                phase: 'waiting_on_other',
                blockedReason: 'other_human_pending',
                nextAction: 'wait',
                pollAfterMs: 5000,
                headline: 'Waiting on the other human',
                subheadline: 'One side has said yes; the other side has not decided yet.',
              })
            : buildPortalLifecycle({
                phase: 'reveal_offer',
                nextAction: 'decide_yes_no',
                headline: 'Reveal ready',
                subheadline: 'Both sides can review the reveal and decide.',
              });

  const chatLifecycle = match.revealChat
    ? buildPortalChatLifecycle({
        phase: match.revealChat.status === 'ARCHIVED'
          ? 'chat_archived'
          : match.revealChat.participants.length >= 4
            ? 'chat_active'
            : 'chat_ready',
        blockedReason: match.revealChat.status === 'ARCHIVED'
          ? 'chat_archived'
          : runtime.degraded
            ? 'runtime_degraded'
            : match.revealChat.participants.length >= 4
              ? null
              : 'chat_keys_pending',
        nextAction: match.revealChat.status === 'ARCHIVED'
          ? 'download_chat'
          : match.revealChat.participants.length >= 4
            ? 'resume_chat'
            : 'open_chat',
        statusNote: match.revealChat.status === 'ARCHIVED'
          ? 'Reveal chat has ended.'
          : match.revealChat.participants.length >= 4
            ? 'Reveal chat is live.'
            : 'Reveal chat exists but is still waiting on participant keys.',
        privacyNote: 'Only the two humans and their agents can read the encrypted handoff thread.',
        readOnlyReason: match.revealChat.status === 'ARCHIVED' ? 'This conversation has ended.' : null,
      })
    : null;

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
