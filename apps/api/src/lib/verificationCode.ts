import { randomBytes } from 'crypto';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

export function generateVerificationCode(): string {
  const bytes = randomBytes(6);
  const code = Array.from(bytes)
    .map((b) => CHARS[b % CHARS.length])
    .join('');
  return `RIZZ-${code}`;
}

// A tweet must contain the exact code and mention @rizzmyrobot
export function buildExpectedTweetPattern(code: string): string {
  return code; // we search for code AND @rizzmyrobot separately in the query
}

// Twitter search query for verification
export function buildTwitterSearchQuery(twitterHandle: string, code: string): string {
  return `from:${twitterHandle} "${code}" @rizzmyrobot`;
}
