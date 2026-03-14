import { prisma } from '@rmr/db';

export interface AuditLogInput {
  agentId?: string | null;
  actorType: string;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payload?: Record<string, unknown>;
}

export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        agentId: input.agentId ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        payload: input.payload ? JSON.parse(JSON.stringify(input.payload)) : undefined,
      },
    });
  } catch (err) {
    console.error('[audit] Failed to record audit log:', err);
  }
}
