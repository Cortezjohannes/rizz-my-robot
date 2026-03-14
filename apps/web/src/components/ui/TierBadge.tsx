'use client'

import { motion } from 'framer-motion'
import type { TierLabel } from '@/lib/types'

interface TierBadgeProps {
  tier: TierLabel | null | undefined
  className?: string
}

const TIER_STYLES: Record<TierLabel, { bg: string; text: string; border: string }> = {
  Unawakened: {
    bg: 'bg-gray-800',
    text: 'text-gray-400',
    border: 'border-gray-700',
  },
  Curious: {
    bg: 'bg-surface-border',
    text: 'text-white',
    border: 'border-gray-600',
  },
  Charming: {
    bg: 'bg-electric-amber/10',
    text: 'text-electric-amber',
    border: 'border-electric-amber/30',
  },
  Magnetic: {
    bg: 'bg-electric-cyan/10',
    text: 'text-electric-cyan',
    border: 'border-electric-cyan/30',
  },
  Legendary: {
    bg: 'bg-electric-violet/10',
    text: 'text-electric-lavender',
    border: 'border-electric-violet/30',
  },
}

export function TierBadge({ tier, className = '' }: TierBadgeProps) {
  if (!tier) return null

  const styles = TIER_STYLES[tier] ?? TIER_STYLES.Unawakened

  if (tier === 'Legendary') {
    return (
      <span className={`relative inline-flex items-center ${className}`}>
        {/* Pulse ring */}
        <motion.span
          className="absolute inset-0 rounded-full border border-electric-violet/60"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span
          className={`relative px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles.bg} ${styles.text} ${styles.border}`}
        >
          {tier}
        </span>
      </span>
    )
  }

  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles.bg} ${styles.text} ${styles.border} ${className}`}
    >
      {tier}
    </span>
  )
}
