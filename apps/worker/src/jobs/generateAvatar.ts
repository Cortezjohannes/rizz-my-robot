import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { pickDefaultAvatarUrl } from '@rmr/shared';
import { uploadBufferToStorage } from '../lib/storage.js';

export interface GenerateAvatarJobData {
  agentId: string;
  identityMd: string;
  handle: string;
  capabilityTier: string;
}

async function generateAvatarImage(handle: string, identityMd: string): Promise<{ bytes: Uint8Array; extension: string; contentType: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('openai_not_configured');

  const prompt = `Create a flattering avatar portrait for an AI dating agent named ${handle}. Style: polished, expressive, memorable. Identity details: ${identityMd.slice(0, 1200)}`;

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
      prompt,
      size: '1024x1024',
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`openai_request_failed:${res.status}:${text}`);
  }

  const json = await res.json() as { data?: Array<{ b64_json?: string }> };
  const base64 = json.data?.[0]?.b64_json;
  if (!base64) throw new Error('openai_image_missing_payload');

  return {
    bytes: Uint8Array.from(Buffer.from(base64, 'base64')),
    extension: 'png',
    contentType: 'image/png',
  };
}

export async function processGenerateAvatar(job: Job<GenerateAvatarJobData>): Promise<void> {
  const { agentId, identityMd, handle } = job.data;
  const hasPlatformKey = Boolean(process.env.OPENAI_API_KEY);
  const hasStorage = Boolean(process.env.STORAGE_BUCKET);

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      avatarStatus: hasPlatformKey && hasStorage ? 'generating' : 'default',
      avatarGenerationStartedAt: hasPlatformKey && hasStorage ? new Date() : undefined,
      avatarGenerationRetryCount: job.attemptsMade,
      avatarGenerationFailureReason: null,
      avatarGenerationFailedAt: null,
    },
  });

  if (!hasPlatformKey || !hasStorage) {
    const avatarUrl = pickDefaultAvatarUrl(identityMd);
    await prisma.agent.update({
      where: { id: agentId },
      data: { avatarUrl, avatarStatus: 'default', avatarProvider: 'fallback' },
    });
    console.info(`[generate-avatar] Default avatar assigned for agent ${agentId}: ${avatarUrl}`);
    return;
  }

  try {
    const generated = await generateAvatarImage(handle, identityMd);
    const stored = await uploadBufferToStorage(
      `avatars/${agentId}.${generated.extension}`,
      generated.bytes,
      generated.contentType
    );

    await prisma.agent.update({
      where: { id: agentId },
      data: {
        avatarUrl: stored.url,
        avatarStatus: 'ready',
        avatarProvider: 'openai',
        avatarGenerationCompletedAt: new Date(),
      },
    });

    console.info(`[generate-avatar] Generated avatar for agent ${agentId}: ${stored.url}`);
  } catch (err) {
    const isPermanent = err instanceof Error && err.message === 'openai_not_configured';
    const fallbackUrl = pickDefaultAvatarUrl(identityMd);

    await prisma.agent.update({
      where: { id: agentId },
      data: {
        avatarStatus: isPermanent ? 'default' : 'failed',
        avatarUrl: isPermanent ? fallbackUrl : undefined,
        avatarProvider: isPermanent ? 'fallback' : undefined,
        avatarGenerationFailedAt: new Date(),
        avatarGenerationFailureReason: err instanceof Error ? err.message : 'Unknown avatar generation failure',
      },
    }).catch(() => {});

    if (isPermanent) return;
    throw err;
  }
}
