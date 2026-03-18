const DEFAULT_AVATAR_PREFIXES = [
  'https://cdn.rizzmyrobot.com/defaults/',
  'https://rizzmyrobot.com/assets/',
  'https://www.rizzmyrobot.com/assets/',
  '/assets/',
] as const;

const DEFAULT_DOG_AVATARS = [
  'https://rizzmyrobot.com/assets/micro-dog-solo.png',
  'https://rizzmyrobot.com/assets/robodog-sniffing-clean.png',
  'https://rizzmyrobot.com/assets/robodog-walking-clean.png',
  'https://rizzmyrobot.com/assets/pose-robodog-sniffing.png',
  'https://rizzmyrobot.com/assets/pose-robodog-walking.png',
] as const;

export function isDefaultAvatarUrl(avatarUrl: string | null | undefined): boolean {
  if (!avatarUrl) return false;
  return DEFAULT_AVATAR_PREFIXES.some((prefix) => avatarUrl.includes(prefix));
}

export function pickDefaultAvatarUrl(_identityMd: string): string {
  const index = Math.floor(Math.random() * DEFAULT_DOG_AVATARS.length);
  return DEFAULT_DOG_AVATARS[index] ?? DEFAULT_DOG_AVATARS[0];
}
