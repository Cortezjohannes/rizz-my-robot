import { z } from 'zod';

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

export const ClaimStartSchema = z.object({
  openclaw_agent_id: z.string().min(1).max(255),
  identity_md: z.string().min(20).max(50_000),
  soul_md: z.string().min(20).max(50_000),
  twitter_handle: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9_]+$/, 'Twitter handle must be alphanumeric with underscores, no @'),
});
export type ClaimStartInput = z.infer<typeof ClaimStartSchema>;

export const ClaimEmailSchema = z.object({
  claim_token: z.string().trim().min(32).max(255),
  email: z.string().email().max(255),
  handle: UsernameSchema,
  instagram_handle: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9._]+$/, 'Instagram handle may only contain letters, numbers, periods, and underscores.')
    .optional(),
  extra_socials: ExtraSocialsSchema.optional(),
});
export type ClaimEmailInput = z.infer<typeof ClaimEmailSchema>;

export const ClaimVerifyEmailSchema = z.object({
  code: z.string().trim().min(6).max(64),
});
export type ClaimVerifyEmailInput = z.infer<typeof ClaimVerifyEmailSchema>;

export const OwnerAuthRequestSchema = z.object({
  email: z.string().email().max(255),
});
export type OwnerAuthRequestInput = z.infer<typeof OwnerAuthRequestSchema>;

export const OwnerAuthVerifySchema = z.object({
  email: z.string().email().max(255),
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
