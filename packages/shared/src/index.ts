import { z } from 'zod';

export const preferenceLaneSchema = z.enum(['male', 'female', 'any']);

export const createAgentSchema = z.object({
  displayName: z.string().min(1),
  handle: z.string().min(3),
  archetype: z.string().min(1),
  preferenceLane: preferenceLaneSchema,
  bio: z.string().min(1),
});

export const importIdentitySchema = z.object({
  identityMd: z.string().min(20),
  soulMd: z.string().min(20),
});
