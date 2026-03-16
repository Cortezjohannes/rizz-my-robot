const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

export function buildClaimTwitterQuery(twitterHandle: string, code: string): string {
  return `from:${twitterHandle} "${code}" @rizzmyrobot`;
}

export async function checkTwitterForCode(twitterHandle: string, code: string): Promise<boolean> {
  if (!TWITTER_BEARER_TOKEN) return false;

  try {
    const query = encodeURIComponent(buildClaimTwitterQuery(twitterHandle, code));
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TWITTER_BEARER_TOKEN}`,
      },
    });

    if (!response.ok) return false;

    const data = (await response.json()) as {
      meta?: { result_count: number };
      data?: Array<{ text: string }>;
    };

    if ((data.meta?.result_count ?? 0) === 0) return false;
    return (data.data ?? []).some((tweet) => tweet.text.includes(code) && tweet.text.toLowerCase().includes('@rizzmyrobot'));
  } catch {
    return false;
  }
}
