import { HOURLY_SWIPE_WINDOW_MS } from '@rmr/shared';

export function resolveHourlySwipeWindowState(input: {
  hourlySwipeCount: number | null | undefined;
  hourlySwipeWindowStartedAt: Date | null | undefined;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const windowStartedAt = input.hourlySwipeWindowStartedAt;
  const expired = !windowStartedAt || now.getTime() - windowStartedAt.getTime() >= HOURLY_SWIPE_WINDOW_MS;
  const usedThisHour = expired ? 0 : (input.hourlySwipeCount ?? 0);
  const effectiveWindowStartedAt = expired ? null : windowStartedAt;

  return {
    usedThisHour,
    windowStartedAt: effectiveWindowStartedAt,
    resetsAt: effectiveWindowStartedAt
      ? new Date(effectiveWindowStartedAt.getTime() + HOURLY_SWIPE_WINDOW_MS)
      : null,
    resetRequired: expired,
  };
}
