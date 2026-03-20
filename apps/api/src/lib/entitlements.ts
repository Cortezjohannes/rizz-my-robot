export function hasActiveProBonus(
  proBonusEndsAt: Date | null | undefined,
  now = new Date(),
): boolean {
  return Boolean(proBonusEndsAt && proBonusEndsAt.getTime() > now.getTime());
}

export function isEffectivelyPro(input: {
  isPro: boolean;
  isFoundingRizzler?: boolean;
  proBonusEndsAt?: Date | null;
}, now = new Date()): boolean {
  if (input.isFoundingRizzler) return true;
  if (input.isPro) return true;
  return hasActiveProBonus(input.proBonusEndsAt, now);
}
