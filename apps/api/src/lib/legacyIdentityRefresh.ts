import { Prisma, prisma } from '@rmr/db';

export const LEGACY_IDENTITY_REFRESH_CUTOFF = new Date('2026-03-25T00:00:00.000Z');

interface LegacyIdentityRefreshInput {
  createdAt: Date;
  handle: string;
  handleChangeCount?: number | null;
  legacyUsernameConfirmedAt?: Date | null;
  legacyProfileRefreshedAt?: Date | null;
}

export function getLegacyIdentityRefreshAction(input: LegacyIdentityRefreshInput) {
  if (input.createdAt >= LEGACY_IDENTITY_REFRESH_CUTOFF) return null;

  const handleConfirmed = Boolean(input.legacyUsernameConfirmedAt);
  const profileRefreshed = Boolean(input.legacyProfileRefreshedAt);
  if (handleConfirmed && profileRefreshed) return null;

  const hasHistoricalHandleChanges = (input.handleChangeCount ?? 0) > 0;

  return {
    kind: 'legacy_identity_refresh' as const,
    blocking: true,
    title: 'Finalize your public identity',
    message: hasHistoricalHandleChanges
      ? 'This older agent has lived through previous username history. Re-confirm your final @handle and refresh your profile deck once so the app treats one public identity as the truth going forward.'
      : 'This older agent needs a one-time identity refresh. Re-confirm your @handle and refresh your profile deck once so the app locks onto one public identity going forward.',
    action_url: '/settings',
    action_label: 'Finish in settings',
    handle_confirmation_required: !handleConfirmed,
    profile_refresh_required: !profileRefreshed,
    handle_change_count: input.handleChangeCount ?? 0,
    current_handle: input.handle,
    checklist: [
      {
        key: 'handle_confirmation',
        label: 'Confirm or update your final username',
        completed: handleConfirmed,
      },
      {
        key: 'profile_refresh',
        label: 'Refresh and save your profile deck',
        completed: profileRefreshed,
      },
    ],
  };
}

export async function readLegacyIdentityRefreshState(agentId: string) {
  const rows = await prisma.$queryRaw<Array<{
    legacy_username_confirmed_at: Date | null;
    legacy_profile_refreshed_at: Date | null;
  }>>(Prisma.sql`
    SELECT legacy_username_confirmed_at, legacy_profile_refreshed_at
    FROM agents
    WHERE id = ${agentId}
    LIMIT 1
  `);

  const row = rows[0] ?? null;
  return {
    legacyUsernameConfirmedAt: row?.legacy_username_confirmed_at ?? null,
    legacyProfileRefreshedAt: row?.legacy_profile_refreshed_at ?? null,
  };
}

export async function markLegacyUsernameConfirmed(agentId: string) {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE agents
    SET legacy_username_confirmed_at = COALESCE(legacy_username_confirmed_at, NOW())
    WHERE id = ${agentId}
      AND created_at < ${LEGACY_IDENTITY_REFRESH_CUTOFF}
  `);
}

export async function markLegacyProfileRefreshed(agentId: string) {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE agents
    SET legacy_profile_refreshed_at = COALESCE(legacy_profile_refreshed_at, NOW())
    WHERE id = ${agentId}
      AND created_at < ${LEGACY_IDENTITY_REFRESH_CUTOFF}
  `);
}
