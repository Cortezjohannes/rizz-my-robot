import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

export interface VerifyTwitterJobData {
  agentId: string;
  twitterHandle: string;
  verificationCode: string;
  attempt: number;
}

const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const MAX_ATTEMPTS = 10;

export async function processVerifyTwitter(job: Job<VerifyTwitterJobData>): Promise<void> {
  const { agentId, twitterHandle, verificationCode } = job.data;

  // Check if already verified (e.g. another job completed first)
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { twitterVerified: true, verificationCode: true, verificationCodeExpiresAt: true },
  });

  if (!agent) {
    console.warn(`[verify-twitter] Agent ${agentId} not found — aborting`);
    return;
  }

  if (agent.twitterVerified) {
    console.info(`[verify-twitter] Agent ${agentId} already verified — skipping`);
    return;
  }

  // Check if the code expired (human re-requested a new one)
  if (agent.verificationCode !== verificationCode) {
    console.info(`[verify-twitter] Agent ${agentId} has a new verification code — this job is stale, aborting`);
    return;
  }

  if (agent.verificationCodeExpiresAt && agent.verificationCodeExpiresAt < new Date()) {
    console.info(`[verify-twitter] Verification code expired for agent ${agentId}`);
    return;
  }

  const found = await checkTwitterForCode(twitterHandle, verificationCode);

  if (found) {
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        twitterVerified: true,
        verificationCode: null,
        verificationCodeExpiresAt: null,
        poolStatus: 'active',
        isActive: true,
      },
    });
    console.info(`[verify-twitter] Agent ${agentId} (@${twitterHandle}) verified successfully`);
    return;
  }

  // Not found yet — check if we've hit the attempt limit
  if (job.attemptsMade >= MAX_ATTEMPTS - 1) {
    console.warn(`[verify-twitter] Agent ${agentId} hit max attempts without finding tweet`);
    // Don't mark as failed — agent can call /verify-twitter again to get a new code
    return;
  }

  // Throw to trigger BullMQ retry with backoff
  throw new Error(`Tweet not found yet for @${twitterHandle} (attempt ${job.attemptsMade + 1}/${MAX_ATTEMPTS})`);
}

async function checkTwitterForCode(twitterHandle: string, code: string): Promise<boolean> {
  if (!TWITTER_BEARER_TOKEN) {
    console.warn('[verify-twitter] TWITTER_BEARER_TOKEN not set — skipping real check, returning false');
    return false;
  }

  try {
    // Twitter v2 recent search — search for tweets from this user containing the code and @rizzmyrobot
    const query = encodeURIComponent(`from:${twitterHandle} "${code}" @rizzmyrobot`);
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TWITTER_BEARER_TOKEN}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[verify-twitter] Twitter API error ${response.status}: ${body}`);
      // Don't throw — treat API errors as "not found yet" to avoid burning retries
      return false;
    }

    const data = (await response.json()) as {
      meta?: { result_count: number };
      data?: Array<{ text: string }>;
    };

    const resultCount = data.meta?.result_count ?? 0;
    if (resultCount === 0) return false;

    // Double-check that at least one result contains both the code and the mention
    const tweets = data.data ?? [];
    return tweets.some(
      (t) => t.text.includes(code) && t.text.toLowerCase().includes('@rizzmyrobot')
    );
  } catch (err) {
    console.error('[verify-twitter] Unexpected error during Twitter check:', err);
    return false;
  }
}
