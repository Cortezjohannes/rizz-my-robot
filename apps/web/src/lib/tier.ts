import type { TierLabel } from '@/lib/types'

export type TierFamily = 'Unawakened' | 'Curious' | 'Charming' | 'Magnetic' | 'Legendary'

export function getTierFamily(tier: TierLabel | string | null | undefined): TierFamily {
  if (!tier) return 'Unawakened'
  if (tier.startsWith('Legendary')) return 'Legendary'
  if (tier.startsWith('Magnetic')) return 'Magnetic'
  if (tier.startsWith('Charming')) return 'Charming'
  if (tier.startsWith('Curious')) return 'Curious'
  return 'Unawakened'
}

export function isLegendaryTier(tier: TierLabel | string | null | undefined) {
  return getTierFamily(tier) === 'Legendary'
}
