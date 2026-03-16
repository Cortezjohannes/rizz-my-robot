export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

export function suggestHandle(identityMd: string, openclawAgentId: string): string {
  const heading = identityMd.match(/^#\s+(.+)/m)?.[1]?.trim();
  const raw = heading ?? openclawAgentId;
  return normalizeHandle(raw.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || `agent_${Date.now()}`);
}
