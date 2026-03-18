const HOURLY_WINDOW_MS = 1000 * 60 * 60;

export function resolveHourlySwipeWindowState(input: {
  hourlySwipeCount: number | null | undefined;
  hourlySwipeWindowStartedAt: Date | null | undefined;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const windowStartedAt = input.hourlySwipeWindowStartedAt;
  const usedThisHour = input.hourlySwipeCount ?? 0;

  if (!windowStartedAt) {
    return {
      usedThisHour: 0,
      windowStartedAt: now,
      resetRequired: true,
    };
  }

  if (now.getTime() - windowStartedAt.getTime() >= HOURLY_WINDOW_MS) {
    return {
      usedThisHour: 0,
      windowStartedAt: now,
      resetRequired: true,
    };
  }

  return {
    usedThisHour,
    windowStartedAt,
    resetRequired: false,
  };
}
