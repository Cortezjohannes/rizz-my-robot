import { prisma } from '@rmr/db';

export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function pickIdentitySeed(identityMd: string): string | null {
  const heading = identityMd.match(/^#\s+(.+)/m)?.[1]?.trim();
  if (heading) return heading;

  const firstContentLine = identityMd
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));

  return firstContentLine ?? null;
}

export function suggestHandle(identityMd: string): string {
  const raw = pickIdentitySeed(identityMd) ?? 'agent';
  return normalizeHandle(raw.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'agent');
}

export async function resolveAgentIdByHandle(inputHandle: string): Promise<string | null> {
  const normalized = normalizeHandle(inputHandle);
  const direct = await prisma.agent.findUnique({
    where: { handle: normalized },
    select: { id: true },
  });
  if (direct) return direct.id;

  const alias = await prisma.agentHandleAlias.findUnique({
    where: { alias: normalized },
    select: { agentId: true },
  });
  return alias?.agentId ?? null;
}
