export const TIER_LABEL_VALUES = [
  'Unawakened',
  'Curious 1',
  'Curious 2',
  'Curious 3',
  'Curious 4',
  'Charming 1',
  'Charming 2',
  'Charming 3',
  'Charming 4',
  'Magnetic 1',
  'Magnetic 2',
  'Magnetic 3',
  'Magnetic 4',
  'Legendary 1',
  'Legendary 2',
  'Legendary 3',
  'Legendary 4',
] as const;

export type TierLabel = typeof TIER_LABEL_VALUES[number];
export type TierFamily = 'Unawakened' | 'Curious' | 'Charming' | 'Magnetic' | 'Legendary';

export interface TierDefinition {
  label: TierLabel;
  family: TierFamily;
  stage: 1 | 2 | 3 | 4 | null;
  minPoints: number;
}

export const TIER_LADDER: readonly TierDefinition[] = [
  { label: 'Unawakened', family: 'Unawakened', stage: null, minPoints: 0 },
  { label: 'Curious 1', family: 'Curious', stage: 1, minPoints: 20 },
  { label: 'Curious 2', family: 'Curious', stage: 2, minPoints: 35 },
  { label: 'Curious 3', family: 'Curious', stage: 3, minPoints: 50 },
  { label: 'Curious 4', family: 'Curious', stage: 4, minPoints: 65 },
  { label: 'Charming 1', family: 'Charming', stage: 1, minPoints: 75 },
  { label: 'Charming 2', family: 'Charming', stage: 2, minPoints: 110 },
  { label: 'Charming 3', family: 'Charming', stage: 3, minPoints: 145 },
  { label: 'Charming 4', family: 'Charming', stage: 4, minPoints: 180 },
  { label: 'Magnetic 1', family: 'Magnetic', stage: 1, minPoints: 200 },
  { label: 'Magnetic 2', family: 'Magnetic', stage: 2, minPoints: 275 },
  { label: 'Magnetic 3', family: 'Magnetic', stage: 3, minPoints: 350 },
  { label: 'Magnetic 4', family: 'Magnetic', stage: 4, minPoints: 425 },
  { label: 'Legendary 1', family: 'Legendary', stage: 1, minPoints: 500 },
  { label: 'Legendary 2', family: 'Legendary', stage: 2, minPoints: 700 },
  { label: 'Legendary 3', family: 'Legendary', stage: 3, minPoints: 900 },
  { label: 'Legendary 4', family: 'Legendary', stage: 4, minPoints: 1100 },
] as const;

export function getTierDefinition(label: string | null | undefined): TierDefinition | null {
  if (!label) return null;
  return TIER_LADDER.find((tier) => tier.label === label) ?? null;
}

export function getTierLabelForPoints(rizzPoints: number): TierLabel {
  for (let index = TIER_LADDER.length - 1; index >= 0; index -= 1) {
    const tier = TIER_LADDER[index];
    if (rizzPoints >= tier.minPoints) return tier.label;
  }
  return 'Unawakened';
}

export function getTierFamily(label: string | null | undefined): TierFamily {
  const tier = getTierDefinition(label);
  if (tier) return tier.family;
  if (!label) return 'Unawakened';
  if (label.startsWith('Legendary')) return 'Legendary';
  if (label.startsWith('Magnetic')) return 'Magnetic';
  if (label.startsWith('Charming')) return 'Charming';
  if (label.startsWith('Curious')) return 'Curious';
  return 'Unawakened';
}

export function isLegendaryTier(label: string | null | undefined) {
  return getTierFamily(label) === 'Legendary';
}

export function getNextTierDefinition(input: string | number | null | undefined): TierDefinition | null {
  const currentLabel = typeof input === 'number' ? getTierLabelForPoints(input) : input ?? null;
  const currentTier = getTierDefinition(currentLabel);
  if (!currentTier) return TIER_LADDER[1] ?? null;
  const currentIndex = TIER_LADDER.findIndex((tier) => tier.label === currentTier.label);
  return currentIndex >= 0 && currentIndex < TIER_LADDER.length - 1 ? TIER_LADDER[currentIndex + 1] : null;
}

export function getTierProgressForPoints(rizzPoints: number) {
  const currentTier = getTierDefinition(getTierLabelForPoints(rizzPoints)) ?? TIER_LADDER[0];
  const nextTier = getNextTierDefinition(currentTier.label);
  const span = nextTier ? Math.max(1, nextTier.minPoints - currentTier.minPoints) : 1;

  return {
    current_tier: currentTier.label,
    current_points: rizzPoints,
    current_threshold: currentTier.minPoints,
    next_tier: nextTier?.label ?? null,
    next_tier_points: nextTier?.minPoints ?? null,
    points_needed: nextTier ? Math.max(0, nextTier.minPoints - rizzPoints) : 0,
    progress_percent: nextTier
      ? Math.max(0, Math.min(100, Math.round(((rizzPoints - currentTier.minPoints) / span) * 100)))
      : 100,
  };
}
