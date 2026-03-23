import { prisma } from '@rmr/db';
import { isStorageConfigured } from './storage.js';

type HealthState = 'healthy' | 'degraded' | 'down';

function overallFrom(states: HealthState[]): HealthState {
  if (states.includes('down')) return 'down';
  if (states.includes('degraded')) return 'degraded';
  return 'healthy';
}

export async function getSystemStatus() {
  const mediaStorage = isStorageConfigured()
    ? { status: 'healthy' as const, provider: 'r2' }
    : { status: 'down' as const, provider: 'local_storage', reason: 'R2 storage is not configured.' };

  const hasElevenLabs = Boolean(process.env.ELEVENLABS_API_KEY);
  const hasOpenAiTts = Boolean(process.env.OPENAI_API_KEY);
  const tts = hasElevenLabs
    ? { status: 'healthy' as const, provider: 'elevenlabs', fallback: hasOpenAiTts ? 'openai' : 'text_only' }
    : hasOpenAiTts
      ? { status: 'degraded' as const, provider: 'openai', fallback: 'text_only', reason: 'ElevenLabs is unavailable, using OpenAI TTS fallback.' }
      : { status: 'down' as const, provider: 'text_only', fallback: 'text_only', reason: 'No TTS provider is configured.' };

  const [discordHookCount, discordFailuresLastHour] = await Promise.all([
    prisma.webhook.count({
      where: {
        isActive: true,
        OR: [
          { url: { contains: 'discord.com', mode: 'insensitive' } },
          { url: { contains: 'discordapp.com', mode: 'insensitive' } },
        ],
      },
    }),
    prisma.webhookDelivery.count({
      where: {
        status: 'failed',
        createdAt: { gte: new Date(Date.now() - (60 * 60 * 1000)) },
        webhook: {
          OR: [
            { url: { contains: 'discord.com', mode: 'insensitive' } },
            { url: { contains: 'discordapp.com', mode: 'insensitive' } },
          ],
        },
      },
    }),
  ]);

  const discord = discordHookCount === 0
    ? { status: 'degraded' as const, reason: 'No Discord webhook endpoints are currently registered.' }
    : discordFailuresLastHour >= 3
      ? { status: 'degraded' as const, reason: `${discordFailuresLastHour} Discord delivery failures in the last hour.` }
      : { status: 'healthy' as const };

  const email = process.env.SENDGRID_API_KEY
    ? { status: 'healthy' as const }
    : process.env.EMAIL_PREVIEW_MODE === 'true'
      ? { status: 'degraded' as const, reason: 'Email preview mode is enabled.' }
      : { status: 'down' as const, reason: 'SendGrid is not configured.' };

  return {
    services: {
      media_storage: mediaStorage,
      tts,
      discord,
      email,
    },
    overall: overallFrom([mediaStorage.status, tts.status, discord.status, email.status]),
  };
}
