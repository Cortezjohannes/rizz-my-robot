import { prisma } from '@rmr/db';
import {
  enforceOutboundAuthoredText,
  inspectOutboundAuthoredText,
  OutboundGuidelineError,
  OUTBOUND_GUIDELINE_POLICY_VERSION,
  type OutboundGuidelineOptions,
  type OutboundGuidelineSurface,
} from '@rmr/shared';

type WorkerOutboundReceiptContext = {
  agentId?: string | null;
  actorType: string;
  actorId?: string | null;
  targetType: string;
  targetId: string;
  surface: OutboundGuidelineSurface;
  text: string;
  options?: OutboundGuidelineOptions;
  extraPayload?: Record<string, unknown>;
};

async function recordWorkerOutboundBehaviorReceipt(
  context: Omit<WorkerOutboundReceiptContext, 'text' | 'options'> & {
    textLength: number;
    outcome: 'passed' | 'blocked';
    violationCode?: string | null;
    flaggedPattern?: string | null;
  },
) {
  await prisma.auditLog.create({
    data: {
      agentId: context.agentId ?? null,
      actorType: context.actorType,
      actorId: context.actorId ?? null,
      action: 'outbound_guideline.receipt',
      targetType: context.targetType,
      targetId: context.targetId,
      payload: {
        policy_version: OUTBOUND_GUIDELINE_POLICY_VERSION,
        surface: context.surface,
        outcome: context.outcome,
        text_length: context.textLength,
        repaired: false,
        repair_count: 0,
        repair_strategies: [],
        violation_code: context.violationCode ?? null,
        flagged_pattern: context.flaggedPattern ?? null,
        semantic_judge_active: true,
        ...(context.extraPayload ?? {}),
      },
    },
  }).catch(() => {});
}

export async function enforceWorkerOutboundTextWithReceipt(
  context: WorkerOutboundReceiptContext,
) {
  const safeText = context.text.trim();
  const inspected = inspectOutboundAuthoredText(safeText, context.surface, context.options);
  await recordWorkerOutboundBehaviorReceipt({
    agentId: context.agentId,
    actorType: context.actorType,
    actorId: context.actorId,
    targetType: context.targetType,
    targetId: context.targetId,
    surface: context.surface,
    textLength: inspected.clean.length,
    outcome: inspected.violation ? 'blocked' : 'passed',
    violationCode: inspected.violation?.code ?? null,
    flaggedPattern: inspected.violation?.flaggedPattern ?? null,
    extraPayload: context.extraPayload,
  });
  if (inspected.violation) {
    throw new OutboundGuidelineError(inspected.violation);
  }
  return enforceOutboundAuthoredText(safeText, context.surface, context.options);
}
