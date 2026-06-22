import { z } from 'zod';

export const SWIPE_DECISION_CONTEXT_STAGES = ['preview', 'peek_profile'] as const;
export const SwipeDecisionContextSchema = z.enum(SWIPE_DECISION_CONTEXT_STAGES);
export type SwipeDecisionContext = z.infer<typeof SwipeDecisionContextSchema>;

export const RIZZ_MOCHI_SWIPE_PREVIEW_DECISIONS = ['PASS', 'PEEK'] as const;
export const RIZZ_MOCHI_SWIPE_PEEK_DECISIONS = ['PASS', 'LIKE'] as const;

const CandidatePreviewSchema = z.object({
  candidate_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  avatar_ref: z.string().trim().min(1).max(500).nullable().optional(),
}).strict();

function requireExactDecisionSet(
  decisions: readonly string[],
  expected: readonly string[],
  context: z.RefinementCtx,
) {
  const decisionSet = new Set(decisions);
  const expectedSet = new Set(expected);
  if (decisionSet.size !== expectedSet.size || expected.some((decision) => !decisionSet.has(decision))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allowed_decisions'],
      message: `Allowed decisions must be exactly ${expected.join(', ')}.`,
    });
  }
}

export const RizzMochiSwipePreviewContextSchema = z.object({
  stage: z.literal('preview'),
  candidate: CandidatePreviewSchema,
  allowed_decisions: z.array(z.enum(RIZZ_MOCHI_SWIPE_PREVIEW_DECISIONS)).default([...RIZZ_MOCHI_SWIPE_PREVIEW_DECISIONS]),
}).strict().superRefine((value, context) => {
  requireExactDecisionSet(value.allowed_decisions, RIZZ_MOCHI_SWIPE_PREVIEW_DECISIONS, context);
});
export type RizzMochiSwipePreviewContext = z.infer<typeof RizzMochiSwipePreviewContextSchema>;

export const RizzMochiSwipePeekContextSchema = z.object({
  stage: z.literal('peek_profile'),
  candidate: CandidatePreviewSchema,
  profile_deck_ref: z.string().trim().min(1).max(255).regex(/^\/v1\/candidates\/[^/]+\/profile-deck$/),
  allowed_decisions: z.array(z.enum(RIZZ_MOCHI_SWIPE_PEEK_DECISIONS)).default([...RIZZ_MOCHI_SWIPE_PEEK_DECISIONS]),
}).strict().superRefine((value, context) => {
  requireExactDecisionSet(value.allowed_decisions, RIZZ_MOCHI_SWIPE_PEEK_DECISIONS, context);
});
export type RizzMochiSwipePeekContext = z.infer<typeof RizzMochiSwipePeekContextSchema>;

export const RizzMochiSwipeDecisionContextSchema = z.union([
  RizzMochiSwipePreviewContextSchema,
  RizzMochiSwipePeekContextSchema,
]);
export type RizzMochiSwipeDecisionContext = z.infer<typeof RizzMochiSwipeDecisionContextSchema>;
