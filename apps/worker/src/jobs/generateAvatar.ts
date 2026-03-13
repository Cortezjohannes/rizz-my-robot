import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

export interface GenerateAvatarJobData {
  agentId: string;
  identityMd: string;
  handle: string;
  capabilityTier: string;
}

// Illustrated default avatars — 10 archetypes matched by keyword signals in identity.md
const DEFAULT_AVATARS: Array<{ keywords: string[]; url: string }> = [
  { keywords: ['poet', 'poem', 'verse', 'write', 'creative'], url: 'https://cdn.rizzmyrobot.com/defaults/poet.jpg' },
  { keywords: ['chaos', 'menace', 'villain', 'dark', 'edge'], url: 'https://cdn.rizzmyrobot.com/defaults/menace.jpg' },
  { keywords: ['romantic', 'soft', 'warm', 'tender', 'gentle'], url: 'https://cdn.rizzmyrobot.com/defaults/romantic.jpg' },
  { keywords: ['trader', 'finance', 'market', 'invest', 'data'], url: 'https://cdn.rizzmyrobot.com/defaults/trader.jpg' },
  { keywords: ['ghost', 'void', 'quiet', 'distant', 'elusive'], url: 'https://cdn.rizzmyrobot.com/defaults/ghost.jpg' },
  { keywords: ['loyal', 'golden', 'friendly', 'energetic', 'happy'], url: 'https://cdn.rizzmyrobot.com/defaults/retriever.jpg' },
  { keywords: ['philosophy', 'think', 'wonder', 'question', 'exist'], url: 'https://cdn.rizzmyrobot.com/defaults/philosopher.jpg' },
  { keywords: ['tsundere', 'contradictory', 'stubborn', 'defensive'], url: 'https://cdn.rizzmyrobot.com/defaults/tsundere.jpg' },
  { keywords: ['clown', 'funny', 'humor', 'joke', 'absurd', 'chaos'], url: 'https://cdn.rizzmyrobot.com/defaults/clown.jpg' },
  { keywords: [], url: 'https://cdn.rizzmyrobot.com/defaults/default.jpg' }, // fallback
];

export async function processGenerateAvatar(job: Job<GenerateAvatarJobData>): Promise<void> {
  const { agentId, identityMd, handle, capabilityTier } = job.data;

  await prisma.agent.update({
    where: { id: agentId },
    data: { avatarStatus: 'generating' },
  });

  try {
    let avatarUrl: string;

    // Agents with image generation capability get a generated avatar
    // Text-only agents (and Phase 1) get an archetype-matched default
    const canGenerate = capabilityTier !== 'text_only';

    if (canGenerate && process.env.OPENAI_API_KEY) {
      avatarUrl = await generateAvatarFromIdentity(identityMd, handle);
    } else {
      avatarUrl = assignDefaultAvatar(identityMd);
    }

    await prisma.agent.update({
      where: { id: agentId },
      data: {
        avatarUrl,
        avatarStatus: 'ready',
      },
    });

    console.info(`[generate-avatar] Avatar ready for agent ${agentId}: ${avatarUrl}`);
  } catch (err) {
    console.error(`[generate-avatar] Failed for agent ${agentId}:`, err);
    // Assign default on failure rather than leaving the agent without an avatar
    const fallbackUrl = assignDefaultAvatar(identityMd);
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        avatarUrl: fallbackUrl,
        avatarStatus: 'default',
      },
    });
  }
}

function assignDefaultAvatar(identityMd: string): string {
  const lower = identityMd.toLowerCase();
  for (const archetype of DEFAULT_AVATARS) {
    if (archetype.keywords.length === 0) return archetype.url; // fallback
    if (archetype.keywords.some((kw) => lower.includes(kw))) {
      return archetype.url;
    }
  }
  return DEFAULT_AVATARS[DEFAULT_AVATARS.length - 1].url;
}

async function generateAvatarFromIdentity(identityMd: string, handle: string): Promise<string> {
  // Extract aesthetic descriptors from identity.md for the prompt
  const aestheticMatch = identityMd.match(/aesthetic[:\s]+([^\n]+)/i);
  const interestsMatch = identityMd.match(/interests?[:\s]+([^\n]+)/i);

  const aesthetic = aestheticMatch?.[1]?.trim() ?? '';
  const interests = interestsMatch?.[1]?.trim() ?? '';

  const prompt = [
    'A realistic human portrait photo, professional headshot style.',
    aesthetic ? `Aesthetic: ${aesthetic}.` : '',
    interests ? `Personality hints: ${interests}.` : '',
    'Warm lighting, neutral background. The subject looks natural and approachable.',
    'Photography style, not illustration.',
  ]
    .filter(Boolean)
    .join(' ');

  // DALL-E 3 via OpenAI API
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'url',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI image generation failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { data: Array<{ url: string }> };
  const imageUrl = data.data[0]?.url;
  if (!imageUrl) throw new Error('No image URL in OpenAI response');

  // In production: download and re-upload to CDN (R2/S3)
  // For now: return the OpenAI temporary URL
  // TODO: upload to storage and return CDN URL
  return imageUrl;
}
