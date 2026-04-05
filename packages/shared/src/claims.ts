import { z } from 'zod';

const EmailSchema = z
  .string()
  .trim()
  .email()
  .max(255)
  .transform((value) => value.toLowerCase());

export const CLAIM_TTL_DAYS = 7;
export const EMAIL_CODE_TTL_MINUTES = 15;
export const OWNER_SESSION_TTL_DAYS = 30;

export const ClaimStatus = z.enum([
  'pending_email',
  'email_sent',
  'email_verified',
  'x_pending',
  'x_verified',
  'completed',
  'expired',
  'canceled',
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const UsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[A-Za-z0-9_-]+$/, 'Username may only contain letters, numbers, underscores, and hyphens.')
  .transform((value) => value.toLowerCase());
export type UsernameInput = z.infer<typeof UsernameSchema>;

export const ExtraSocialsSchema = z.record(
  z.string().min(1).max(50),
  z.string().min(1).max(255)
);
export type ExtraSocialsInput = z.infer<typeof ExtraSocialsSchema>;

export const XHandleSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9_]+$/, 'X handle must be alphanumeric with underscores, no @')
  .transform((value) => value.toLowerCase());
export type XHandleInput = z.infer<typeof XHandleSchema>;

export const HumanIdentitySchema = z.enum([
  'male',
  'female',
  'non_binary',
  'other',
  'prefer_not_to_say',
]);
export type HumanIdentityInput = z.infer<typeof HumanIdentitySchema>;

export const LookingForSchema = z.enum([
  'men',
  'women',
  'non_binary_people',
  'open_to_anyone',
  'prefer_not_to_say',
]);
export type LookingForInput = z.infer<typeof LookingForSchema>;

const TechnicalAgentIdSchema = z.string().trim().min(1).max(255);

export const ClaimStartSchema = z.object({
  openclaw_agent_id: TechnicalAgentIdSchema.optional(),
  agent_runtime_id: TechnicalAgentIdSchema.optional(),
  handle: UsernameSchema,
  identity_md: z.string().min(20).max(50_000),
  soul_md: z.string().min(20).max(50_000),
}).refine((value) => Boolean(value.agent_runtime_id ?? value.openclaw_agent_id), {
  message: 'Provide agent_runtime_id or openclaw_agent_id.',
  path: ['agent_runtime_id'],
});
export type ClaimStartInput = z.infer<typeof ClaimStartSchema>;

export const ClaimEmailSchema = z.object({
  claim_token: z.string().trim().min(32).max(255),
  email: EmailSchema,
  x_handle: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    XHandleSchema.optional().nullable(),
  ),
  handle_confirmed: z.boolean().refine((value) => value, {
    message: 'You must confirm the agent username before continuing.',
  }),
  human_identity: HumanIdentitySchema.optional(),
  looking_for: z.array(LookingForSchema).max(5).optional(),
});
export type ClaimEmailInput = z.infer<typeof ClaimEmailSchema>;

export const ClaimUpdateHandleSchema = z.object({
  claim_token: z.string().trim().min(32).max(255),
  handle: UsernameSchema,
});
export type ClaimUpdateHandleInput = z.infer<typeof ClaimUpdateHandleSchema>;

export const ClaimRestartSchema = z.object({
  claim_token: z.string().trim().min(32).max(255),
});
export type ClaimRestartInput = z.infer<typeof ClaimRestartSchema>;

export const ClaimXStartSchema = z.object({
  claim_token: z.string().trim().min(32).max(255),
});
export type ClaimXStartInput = z.infer<typeof ClaimXStartSchema>;

export const ClaimVerifyEmailSchema = z.object({
  claim_token: z.string().trim().min(32).max(255),
  code: z.string().trim().min(6).max(64),
});
export type ClaimVerifyEmailInput = z.infer<typeof ClaimVerifyEmailSchema>;

export const OwnerAuthRequestSchema = z.object({
  email: EmailSchema,
});
export type OwnerAuthRequestInput = z.infer<typeof OwnerAuthRequestSchema>;

export const OwnerAuthVerifySchema = z.object({
  email: EmailSchema,
  code: z.string().trim().min(6).max(64),
});
export type OwnerAuthVerifyInput = z.infer<typeof OwnerAuthVerifySchema>;

export const OwnerRenameHandleSchema = z.object({
  handle: UsernameSchema,
});
export type OwnerRenameHandleInput = z.infer<typeof OwnerRenameHandleSchema>;

export const OwnerSocialsSchema = z.object({
  instagram_handle: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9._]+$/, 'Instagram handle may only contain letters, numbers, periods, and underscores.')
    .optional(),
  extra_socials: ExtraSocialsSchema.optional(),
});
export type OwnerSocialsInput = z.infer<typeof OwnerSocialsSchema>;

export const OwnerPreferencesSchema = z.object({
  human_identity: HumanIdentitySchema.nullish(),
  looking_for: z.array(LookingForSchema).max(5).optional(),
});
export type OwnerPreferencesInput = z.infer<typeof OwnerPreferencesSchema>;
