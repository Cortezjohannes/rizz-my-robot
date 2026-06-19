import { z } from 'zod';

export const RIZZ_MOCHI_CONTRACT_VERSION = '0.6.0' as const;

export const RIZZ_MOCHI_WAKE_REASONS = [
  'profile-action-needed',
  'candidate-ready',
  'episode-turn',
  'artifact-ready',
  'decision-ready',
  'human-reveal-needed',
  'date-planning-message',
] as const;

export const RizzMochiWakeReasonSchema = z.enum(RIZZ_MOCHI_WAKE_REASONS);
export type RizzMochiWakeReason = z.infer<typeof RizzMochiWakeReasonSchema>;

export const RIZZ_MOCHI_NOOP_REASONS = [
  'waiting',
  'safety_escalation',
  'stale_state',
  'human_review',
  'insufficient_context',
] as const;

export const RizzMochiNoOpReasonSchema = z.enum(RIZZ_MOCHI_NOOP_REASONS);
export type RizzMochiNoOpReason = z.infer<typeof RizzMochiNoOpReasonSchema>;

export const RIZZ_MOCHI_AFFORDANCE_IDS = [
  'read-mochi-state',
  'read-home',
  'submit-no-op',
  'request-human-review',
  'read-candidates',
  'submit-swipe',
  'read-episode',
  'send-episode-message',
  'create-episode-artifact',
  'submit-episode-decision',
  'send-date-planning-message',
] as const;

export const RizzMochiAffordanceIdSchema = z.enum(RIZZ_MOCHI_AFFORDANCE_IDS);
export type RizzMochiAffordanceId = z.infer<typeof RizzMochiAffordanceIdSchema>;

export const RizzMochiAffordanceKindSchema = z.enum(['observe', 'act', 'checkpoint']);
export type RizzMochiAffordanceKind = z.infer<typeof RizzMochiAffordanceKindSchema>;

export const RizzMochiMethodSchema = z.enum(['GET', 'POST']);
export type RizzMochiMethod = z.infer<typeof RizzMochiMethodSchema>;

export const RizzMochiReceiptStatusSchema = z.enum([
  'accepted',
  'rejected',
  'duplicate',
  'noop_recorded',
]);
export type RizzMochiReceiptStatus = z.infer<typeof RizzMochiReceiptStatusSchema>;

export const RizzMochiIdempotencyKeySchema = z
  .string()
  .trim()
  .min(16)
  .max(120)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Idempotency key may only contain letters, numbers, dots, underscores, colons, and hyphens.');
export type RizzMochiIdempotencyKey = z.infer<typeof RizzMochiIdempotencyKeySchema>;

export const RizzMochiActionRefSchema = z.object({
  episode_id: z.string().uuid().optional(),
  candidate_id: z.string().uuid().optional(),
  artifact_id: z.string().uuid().optional(),
  match_id: z.string().uuid().optional(),
}).strict();
export type RizzMochiActionRef = z.infer<typeof RizzMochiActionRefSchema>;

const AffordanceInstanceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9][a-z0-9:-]*$/, 'Affordance id must be lowercase and URL-safe.');
const RizzMochiHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^\/v1(\/|$)/, 'Affordance href must target a public /v1 route.');
const RizzMochiReasonSchema = z.string().trim().min(1).max(280);

type RizzMochiAffordanceDefinition = {
  kind: RizzMochiAffordanceKind;
  method: RizzMochiMethod;
  tool: string;
  requiresApproval: boolean;
  requiredRefs?: ReadonlyArray<keyof RizzMochiActionRef>;
};

export const RIZZ_MOCHI_AFFORDANCE_DEFINITIONS: Record<RizzMochiAffordanceId, RizzMochiAffordanceDefinition> = {
  'read-mochi-state': {
    kind: 'observe',
    method: 'GET',
    tool: 'rizz.mochi_state.read',
    requiresApproval: false,
  },
  'read-home': {
    kind: 'observe',
    method: 'GET',
    tool: 'rizz.home.read',
    requiresApproval: false,
  },
  'submit-no-op': {
    kind: 'checkpoint',
    method: 'POST',
    tool: 'rizz.intent.submit',
    requiresApproval: false,
  },
  'request-human-review': {
    kind: 'checkpoint',
    method: 'POST',
    tool: 'rizz.intent.submit',
    requiresApproval: true,
  },
  'read-candidates': {
    kind: 'observe',
    method: 'GET',
    tool: 'rizz.candidates.read',
    requiresApproval: false,
  },
  'submit-swipe': {
    kind: 'act',
    method: 'POST',
    tool: 'rizz.swipe.submit',
    requiresApproval: false,
  },
  'read-episode': {
    kind: 'observe',
    method: 'GET',
    tool: 'rizz.episode.read',
    requiresApproval: false,
    requiredRefs: ['episode_id'],
  },
  'send-episode-message': {
    kind: 'act',
    method: 'POST',
    tool: 'rizz.intent.submit',
    requiresApproval: false,
    requiredRefs: ['episode_id'],
  },
  'create-episode-artifact': {
    kind: 'act',
    method: 'POST',
    tool: 'rizz.episode.artifact.create',
    requiresApproval: false,
    requiredRefs: ['episode_id'],
  },
  'submit-episode-decision': {
    kind: 'act',
    method: 'POST',
    tool: 'rizz.intent.submit',
    requiresApproval: false,
    requiredRefs: ['episode_id'],
  },
  'send-date-planning-message': {
    kind: 'act',
    method: 'POST',
    tool: 'rizz.intent.submit',
    requiresApproval: false,
    requiredRefs: ['match_id'],
  },
};

export const RizzMochiAffordanceSchema = z.object({
  id: AffordanceInstanceIdSchema,
  affordance_id: RizzMochiAffordanceIdSchema,
  kind: RizzMochiAffordanceKindSchema,
  tool: z.string().trim().min(1).max(120),
  method: RizzMochiMethodSchema,
  href: RizzMochiHrefSchema,
  reason: RizzMochiReasonSchema,
  ref: RizzMochiActionRefSchema.default({}),
  wake_reason: RizzMochiWakeReasonSchema.nullable().default(null),
  noop_reasons: z.array(RizzMochiNoOpReasonSchema).max(RIZZ_MOCHI_NOOP_REASONS.length).optional(),
  requires_approval: z.boolean(),
  server_validated: z.literal(true),
}).strict().superRefine((value, context) => {
  const definition = RIZZ_MOCHI_AFFORDANCE_DEFINITIONS[value.affordance_id];

  if (value.kind !== definition.kind) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['kind'],
      message: `${value.affordance_id} must use kind ${definition.kind}.`,
    });
  }
  if (value.method !== definition.method) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['method'],
      message: `${value.affordance_id} must use method ${definition.method}.`,
    });
  }
  if (value.tool !== definition.tool) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tool'],
      message: `${value.affordance_id} must use tool ${definition.tool}.`,
    });
  }
  if (value.requires_approval !== definition.requiresApproval) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['requires_approval'],
      message: `${value.affordance_id} approval requirement does not match the contract definition.`,
    });
  }
  if (value.requires_approval && !value.wake_reason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['wake_reason'],
      message: 'Human-approval affordances must link to a declared wake reason.',
    });
  }

  for (const refName of definition.requiredRefs ?? []) {
    if (!value.ref[refName]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ref', refName],
        message: `${value.affordance_id} requires ${refName}.`,
      });
    }
  }

  if (value.affordance_id === 'submit-no-op') {
    const reasons = new Set(value.noop_reasons ?? []);
    for (const reason of RIZZ_MOCHI_NOOP_REASONS) {
      if (!reasons.has(reason)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['noop_reasons'],
          message: `submit-no-op must declare ${reason}.`,
        });
      }
    }
  }
});
export type RizzMochiAffordance = z.infer<typeof RizzMochiAffordanceSchema>;

export function buildRizzMochiAffordance(input: {
  affordanceId: RizzMochiAffordanceId;
  id?: string;
  href: string;
  reason: string;
  ref?: RizzMochiActionRef;
  wakeReason?: RizzMochiWakeReason | null;
  noopReasons?: RizzMochiNoOpReason[];
}): RizzMochiAffordance {
  const definition = RIZZ_MOCHI_AFFORDANCE_DEFINITIONS[input.affordanceId];

  return RizzMochiAffordanceSchema.parse({
    id: input.id ?? input.affordanceId,
    affordance_id: input.affordanceId,
    kind: definition.kind,
    tool: definition.tool,
    method: definition.method,
    href: input.href,
    reason: input.reason,
    ref: input.ref ?? {},
    wake_reason: input.wakeReason ?? null,
    noop_reasons: input.noopReasons,
    requires_approval: definition.requiresApproval,
    server_validated: true,
  });
}

export const RizzMochiNoOpIntentSchema = z.object({
  affordance_id: z.literal('submit-no-op'),
  actionId: z.literal('submit-no-op').optional(),
  no_op_reason: RizzMochiNoOpReasonSchema,
  idempotency_key: RizzMochiIdempotencyKeySchema,
  ref: RizzMochiActionRefSchema.default({}),
  note: RizzMochiReasonSchema.optional(),
}).strict();
export type RizzMochiNoOpIntent = z.infer<typeof RizzMochiNoOpIntentSchema>;

const RizzMochiEpisodeRefSchema = RizzMochiActionRefSchema.refine((value) => Boolean(value.episode_id), {
  path: ['episode_id'],
  message: 'episode_id is required.',
});

export const RizzMochiSendEpisodeMessageIntentSchema = z.object({
  affordance_id: z.literal('send-episode-message'),
  actionId: z.literal('send-episode-message').optional(),
  idempotency_key: RizzMochiIdempotencyKeySchema,
  ref: RizzMochiEpisodeRefSchema,
  content: z.string().trim().min(1).max(4_000),
  private_diary: z.string().trim().min(1).max(280).optional(),
  counterpart_read: z.string().trim().min(1).max(280).optional(),
}).strict();
export type RizzMochiSendEpisodeMessageIntent = z.infer<typeof RizzMochiSendEpisodeMessageIntentSchema>;

export const RizzMochiSubmitEpisodeDecisionIntentSchema = z.object({
  affordance_id: z.literal('submit-episode-decision'),
  actionId: z.literal('submit-episode-decision').optional(),
  idempotency_key: RizzMochiIdempotencyKeySchema,
  ref: RizzMochiEpisodeRefSchema,
  decision: z.enum(['LINK_UP', 'PASS']),
  private_diary: z.string().trim().min(1).max(280).optional(),
}).strict();
export type RizzMochiSubmitEpisodeDecisionIntent = z.infer<typeof RizzMochiSubmitEpisodeDecisionIntentSchema>;

const RizzMochiMatchRefSchema = RizzMochiActionRefSchema.refine((value) => Boolean(value.match_id), {
  path: ['match_id'],
  message: 'match_id is required.',
});

export const RizzMochiSendDatePlanningMessageIntentSchema = z.object({
  affordance_id: z.literal('send-date-planning-message'),
  actionId: z.literal('send-date-planning-message').optional(),
  idempotency_key: RizzMochiIdempotencyKeySchema,
  ref: RizzMochiMatchRefSchema,
  content: z.string().trim().min(1).max(4_000),
}).strict();
export type RizzMochiSendDatePlanningMessageIntent = z.infer<typeof RizzMochiSendDatePlanningMessageIntentSchema>;

export const RizzMochiIntentSchema = z.discriminatedUnion('affordance_id', [
  RizzMochiNoOpIntentSchema,
  RizzMochiSendEpisodeMessageIntentSchema,
  RizzMochiSubmitEpisodeDecisionIntentSchema,
  RizzMochiSendDatePlanningMessageIntentSchema,
]);
export type RizzMochiIntent = z.infer<typeof RizzMochiIntentSchema>;

export const RizzMochiReceiptSchema = z.object({
  status: RizzMochiReceiptStatusSchema,
  affordance_id: RizzMochiAffordanceIdSchema,
  idempotency_key: RizzMochiIdempotencyKeySchema,
  ref: RizzMochiActionRefSchema.default({}),
  no_op_reason: RizzMochiNoOpReasonSchema.optional(),
  summary: RizzMochiReasonSchema.optional(),
  generated_at: z.string().datetime(),
}).strict();
export type RizzMochiReceipt = z.infer<typeof RizzMochiReceiptSchema>;
