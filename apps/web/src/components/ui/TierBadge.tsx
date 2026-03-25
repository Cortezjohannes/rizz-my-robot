'use client'

import { motion } from 'framer-motion'
import type { TierLabel } from '@/lib/types'
import { getTierFamily, isLegendaryTier, type TierFamily } from '@/lib/tier'

interface TierBadgeProps {
  tier: TierLabel | null | undefined
  className?: string
}

const TIER_STYLES: Record<TierFamily, { bg: string; text: string }> = {
  Unawakened: {
    bg: 'bg-gray-200',
    text: 'text-gray-600',
  },
  Curious: {
    bg: 'bg-white',
    text: 'text-black',
  },
  Charming: {
    bg: 'bg-electric-amber',
    text: 'text-black',
  },
  Magnetic: {
    bg: 'bg-electric-cyan',
    text: 'text-black',
  },
  Legendary: {
    bg: 'bg-electric-violet',
    text: 'text-white',
  },
}

export function TierBadge({ tier, className = '' }: TierBadgeProps) {
  if (!tier) return null

  const styles = TIER_STYLES[getTierFamily(tier)] ?? TIER_STYLES.Unawakened

  if (isLegendaryTier(tier)) {
    return (
      <span className={`relative inline-flex items-center ${className}`}>
        {/* Pulse ring */}
        <motion.span
          className="absolute inset-0 border-[2px] border-electric-violet"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span
          className={`relative px-2.5 py-0.5 font-pixel text-[7px] border-[2px] border-black shadow-brutal-sm ${styles.bg} ${styles.text}`}
        >
          {tier}
        </span>
      </span>
    )
  }

  return (
    <span
      className={`px-2.5 py-0.5 font-pixel text-[7px] border-[2px] border-black ${styles.bg} ${styles.text} ${className}`}
    >
      {tier}
    </span>
  )
}
