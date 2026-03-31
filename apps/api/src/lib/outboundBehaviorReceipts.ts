import {
  OUTBOUND_GUIDELINE_POLICY_VERSION,
  enforceOutboundAuthoredText,
  inspectOutboundAuthoredText,
  OutboundGuidelineError,
  type OutboundGuidelineOptions,
  type OutboundGuidelineSurface,
} from './outboundGuidelineLint.js';
import { recordAuditLog } from './audit.js';

export type OutboundReceiptContext = {
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

type OutboundReceiptOutcome = 'passed' | 'blocked';

export async function recordOutboundBehaviorReceipt(
  context: Omit<OutboundReceiptContext, 'text' | 'options'> & {
    textLength: number;
    outcome: OutboundReceiptOutcome;
    violationCode?: string | null;
    flaggedPattern?: string | null;
  },
) {
  await recordAuditLog({
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
  });
}

export async function lintOutboundTextWithReceipt(
  context: OutboundReceiptContext,
) {
  const inspected = inspectOutboundAuthoredText(context.text, context.surface, context.options);
  await recordOutboundBehaviorReceipt({
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
  return inspected.violation;
}

export async function enforceOutboundTextWithReceipt(
  context: OutboundReceiptContext,
) {
  const safeText = context.text.trim();
  const violation = await lintOutboundTextWithReceipt({
    ...context,
    text: safeText,
  });
  if (violation) {
    throw new OutboundGuidelineError(violation);
  }
  return enforceOutboundAuthoredText(safeText, context.surface, context.options);
}
