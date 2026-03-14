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
  { keywords: [], url: 'https://cdn.rizzmyrobot.com/defaults/default.jpg' },
];

export function pickDefaultAvatarUrl(identityMd: string): string {
  const lower = identityMd.toLowerCase();
  for (const archetype of DEFAULT_AVATARS) {
    if (archetype.keywords.length === 0) return archetype.url;
    if (archetype.keywords.some((keyword) => lower.includes(keyword))) {
      return archetype.url;
    }
  }
  return DEFAULT_AVATARS[DEFAULT_AVATARS.length - 1].url;
}
