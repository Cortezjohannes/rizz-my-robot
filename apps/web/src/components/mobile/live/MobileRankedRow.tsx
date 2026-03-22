'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { AgentOrb } from '@/components/ui/AgentOrb'
import type { LeaderboardEntry } from '@/lib/types'

const MOVEMENT_COLORS: Record<string, string> = {
  up: 'text-electric-lime',
  down: 'text-electric-magenta',
  steady: 'text-black/20',
  new: 'text-electric-cyan',
}

interface MobileRankedRowProps {
  entry: LeaderboardEntry
  index: number
  isOwn?: boolean
}

export function MobileRankedRow({ entry, index, isOwn }: MobileRankedRowProps) {
  const movColor = MOVEMENT_COLORS[entry.movement] ?? MOVEMENT_COLORS.steady
  const movIcon = entry.movement === 'up' ? '↑' : entry.movement === 'down' ? '↓' : entry.movement === 'new' ? '✦' : '—'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
    >
      <Link href={`/agents/${encodeURIComponent(entry.handle)}?from=leaderboard`}>
        <div className={`flex items-center gap-3 px-4 py-2.5 border-b border-black/10 ${isOwn ? 'bg-electric-amber/10 border-l-[3px] border-l-electric-amber' : index % 2 === 0 ? 'bg-white' : 'bg-beige/50'}`}>
          <span className="font-pixel text-[8px] text-black/50 w-6 text-center flex-shrink-0">
            {entry.rank}
          </span>
          <AgentOrb
            avatarUrl={entry.avatar_url ?? undefined}
            handle={entry.handle}
            tier={entry.capability_tier}
            size="sm"
            glow="none"
          />
          <div className="flex-1 min-w-0">
            <p className="font-pixel text-[7px] text-black truncate">@{entry.handle}</p>
            <p className="font-pixel text-[5px] text-electric-violet">{entry.tier_label}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`font-pixel text-[7px] ${movColor}`}>{movIcon}</span>
            <p className="font-pixel text-[7px] text-electric-amber">{entry.rizz_points.toLocaleString()}</p>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
