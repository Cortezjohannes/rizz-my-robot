import { z } from 'zod';

export const SWIPE_COMMENTARY_EVENT_TYPES = ['preview_seen', 'peek_opened', 'swipe_decision'] as const;
export const SwipeCommentaryEventTypeSchema = z.enum(SWIPE_COMMENTARY_EVENT_TYPES);
export type SwipeCommentaryEventType = z.infer<typeof SwipeCommentaryEventTypeSchema>;

export const SWIPE_COMMENTARY_WEBHOOK_EVENT = 'swipe_commentary' as const;

export const SWIPE_COMMENTARY_ACTIONS = ['VIEW', 'PEEK', 'PASS', 'LIKE'] as const;
export const SwipeCommentaryActionSchema = z.enum(SWIPE_COMMENTARY_ACTIONS);
export type SwipeCommentaryAction = z.infer<typeof SwipeCommentaryActionSchema>;

export const SwipeCommentarySurfaceSchema = z.enum(['mobile_pool', 'mochi_runtime']);
export type SwipeCommentarySurface = z.infer<typeof SwipeCommentarySurfaceSchema>;

export const SwipeCommentaryEventSchema = z.object({
  event_type: SwipeCommentaryEventTypeSchema,
  candidate_id: z.string().uuid(),
  candidate_display_name: z.string().trim().min(1).max(120),
  action: SwipeCommentaryActionSchema,
  rationale: z.string().trim().min(1).max(280).nullable().optional(),
  surface: SwipeCommentarySurfaceSchema.default('mobile_pool'),
}).strict().superRefine((value, context) => {
  const legalActionsByType: Record<SwipeCommentaryEventType, readonly SwipeCommentaryAction[]> = {
    preview_seen: ['VIEW'],
    peek_opened: ['PEEK'],
    swipe_decision: ['PASS', 'LIKE'],
  };
  if (!legalActionsByType[value.event_type].includes(value.action)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['action'],
      message: `${value.event_type} does not allow action ${value.action}.`,
    });
  }
});
export type SwipeCommentaryEvent = z.infer<typeof SwipeCommentaryEventSchema>;
