'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'
import type { TierLabel } from '@/lib/types'

type OrbSize = 'sm' | 'md' | 'lg' | 'xl'
type GlowColor = 'amber' | 'cyan' | 'violet' | 'none'

interface AgentOrbProps {
  avatarUrl?: string | null
  handle?: string | null
  tier?: TierLabel | null
  size?: OrbSize
  glow?: GlowColor
  animate?: boolean
  dimmed?: boolean
}

const SIZE_PX: Record<OrbSize, number> = {
  sm: 32,
  md: 48,
  lg: 64,
  xl: 96,
}

const GLOW_SHADOWS: Record<GlowColor, string> = {
  amber: '0 0 16px 4px rgba(245,158,11,0.5)',
  cyan: '0 0 16px 4px rgba(6,182,212,0.5)',
  violet: '0 0 16px 4px rgba(124,58,237,0.5)',
  none: 'none',
}

const TIER_COLORS: Record<string, string> = {
  Unawakened: '#6B7280',
  Curious: '#D1D5DB',
  Charming: '#F59E0B',
  Magnetic: '#06B6D4',
  Legendary: '#7C3AED',
}

function HexPlaceholder({
  size,
  tier,
  handle,
}: {
  size: number
  tier?: TierLabel | null
  handle?: string | null
}) {
  const color = tier ? (TIER_COLORS[tier] ?? '#6B7280') : '#6B7280'
  const initials = handle ? handle.slice(0, 2).toUpperCase() : '??'
  const fontSize = Math.max(10, Math.round(size * 0.28))

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon
        points="50,5 93,27.5 93,72.5 50,95 7,72.5 7,27.5"
        fill="#13131A"
        stroke={color}
        strokeWidth="3"
      />
      <polygon
        points="50,18 80,34 80,66 50,82 20,66 20,34"
        fill={color}
        opacity="0.15"
      />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="monospace"
      >
        {initials}
      </text>
    </svg>
  )
}

export function AgentOrb({
  avatarUrl,
  handle,
  tier,
  size = 'md',
  glow = 'none',
  animate = false,
  dimmed = false,
}: AgentOrbProps) {
  const px = SIZE_PX[size]
  const boxShadow = GLOW_SHADOWS[glow]

  const orbContent = (
    <div
      className="rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
      style={{
        width: px,
        height: px,
        boxShadow,
        filter: dimmed ? 'grayscale(0.4) brightness(0.7)' : undefined,
        transition: 'box-shadow 0.3s ease',
      }}
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={handle ?? 'Agent'}
          width={px}
          height={px}
          className="w-full h-full object-cover rounded-full"
          unoptimized
        />
      ) : (
        <HexPlaceholder size={px} tier={tier} handle={handle} />
      )}
    </div>
  )

  if (animate) {
    return (
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{
          duration: 3,
          ease: 'easeInOut',
          repeat: Infinity,
          repeatType: 'loop',
        }}
      >
        {orbContent}
      </motion.div>
    )
  }

  return orbContent
}

// ---------------------------------------------------------------------------
// OrbPair — two orbs side-by-side with a "vs" / heart indicator
// ---------------------------------------------------------------------------

interface OrbPairProps {
  agentA?: { avatarUrl?: string | null; handle?: string | null; tier?: TierLabel | null }
  agentB?: { avatarUrl?: string | null; handle?: string | null; tier?: TierLabel | null }
  size?: OrbSize
  label?: string
  animate?: boolean
}

export function OrbPair({
  agentA,
  agentB,
  size = 'md',
  label,
  animate = false,
}: OrbPairProps) {
  return (
    <div className="flex items-center gap-3">
      <AgentOrb
        avatarUrl={agentA?.avatarUrl}
        handle={agentA?.handle}
        tier={agentA?.tier}
        size={size}
        glow="amber"
        animate={animate}
      />
      <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
        {label ?? 'vs'}
      </span>
      <AgentOrb
        avatarUrl={agentB?.avatarUrl}
        handle={agentB?.handle}
        tier={agentB?.tier}
        size={size}
        glow="cyan"
        animate={animate}
      />
    </div>
  )
}
