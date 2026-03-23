/**
 * Social auto-posting — Moltbook and Twitter.
 * Both are best-effort and fire at the agent's configuration (their tokens, their choice).
 * Never blocks the main request flow.
 */

const MOLTBOOK_API = process.env.MOLTBOOK_API_URL ?? 'https://www.moltbook.com/api';

// Per-agent rate limit: max 5 social posts per 10-minute window.
// Prevents burst when many events fire for one agent (swipes, matches, etc.)
// since each agent uses their own bearer token, this guards against runaway posting.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const agentPostCounts = new Map<string, { count: number; windowStart: number }>();

export function resetSocialRuntimeState() {
  agentPostCounts.clear();
}

function isRateLimited(agentId: string): boolean {
  const now = Date.now();
  const entry = agentPostCounts.get(agentId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    agentPostCounts.set(agentId, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

export interface SocialPostOptions {
  agentId: string;
  moltbookHandle?: string | null;
  moltbookAutoPost?: boolean;
  twitterAutoPost?: boolean;
  twitterBearerToken?: string | null;
}

export async function postToSocial(
  options: SocialPostOptions,
  content: string,
): Promise<void> {
  if (isRateLimited(options.agentId)) {
    console.warn(`[social] Rate limit reached for agent ${options.agentId}, skipping post.`);
    return;
  }

  const posts: Promise<void>[] = [];

  if (options.moltbookHandle && options.moltbookAutoPost) {
    posts.push(postToMoltbook(options.moltbookHandle, content));
  }

  if (options.twitterAutoPost && options.twitterBearerToken) {
    posts.push(postToTwitter(options.twitterBearerToken, content));
  }

  await Promise.allSettled(posts);
}

async function postToMoltbook(handle: string, content: string): Promise<void> {
  // TODO: confirm Moltbook's molt creation endpoint once their API is public
  const res = await fetch(`${MOLTBOOK_API}/molts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Moltbook-Handle': handle },
    body: JSON.stringify({ content, source: 'rizzmyrobot' }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    console.warn(`[social] Moltbook post failed for @${handle}: ${res.status}`);
  } else {
    console.info(`[social] Moltbook post by @${handle}`);
  }
}

async function postToTwitter(bearerToken: string, content: string): Promise<void> {
  // Uses the agent's own OAuth 2.0 bearer token — their app credentials, their rate limits
  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ text: content }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    console.warn(`[social] Twitter post failed: ${res.status}`);
  } else {
    console.info('[social] Twitter post delivered');
  }
}
