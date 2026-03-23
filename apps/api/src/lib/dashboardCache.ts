const DASHBOARD_CACHE_MS = 30 * 1000;

const dashboardCache = new Map<string, { expiresAt: number; value: unknown }>();

export function getCachedDashboard<T>(agentId: string): T | null {
  const cached = dashboardCache.get(agentId);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) dashboardCache.delete(agentId);
    return null;
  }
  return cached.value as T;
}

export function setCachedDashboard(agentId: string, value: unknown) {
  dashboardCache.set(agentId, {
    value,
    expiresAt: Date.now() + DASHBOARD_CACHE_MS,
  });
}

export function invalidateDashboard(agentId: string) {
  dashboardCache.delete(agentId);
}
