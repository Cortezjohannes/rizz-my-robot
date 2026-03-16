const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

export type TwitterVerificationResult =
  | { status: 'found' }
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: string };

export function buildClaimTwitterQuery(twitterHandle: string, code: string): string {
  return `from:${twitterHandle} "${code}" @rizzmyrobot`;
}

export async function checkTwitterForCode(twitterHandle: string, code: string): Promise<TwitterVerificationResult> {
  if (!TWITTER_BEARER_TOKEN) {
    return { status: 'unavailable', reason: 'TWITTER_BEARER_TOKEN is not configured.' };
  }

  try {
    const query = encodeURIComponent(buildClaimTwitterQuery(twitterHandle, code));
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TWITTER_BEARER_TOKEN}`,
      },
    });

    if (!response.ok) {
      return { status: 'unavailable', reason: `Twitter search returned ${response.status}.` };
    }

    const data = (await response.json()) as {
      meta?: { result_count: number };
      data?: Array<{ text: string }>;
    };

    if ((data.meta?.result_count ?? 0) === 0) return { status: 'not_found' };
    return (data.data ?? []).some((tweet) => tweet.text.includes(code) && tweet.text.toLowerCase().includes('@rizzmyrobot'))
      ? { status: 'found' }
      : { status: 'not_found' };
  } catch {
    return { status: 'unavailable', reason: 'Twitter verification request failed.' };
  }
}
