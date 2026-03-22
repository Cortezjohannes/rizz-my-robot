'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { AgentOrb } from '@/components/ui/AgentOrb'
import type { LeaderboardEntry } from '@/lib/types'

const RANK_STYLES: Record<number, { border: string; badge: string; emoji: string }> = {
  1: { border: 'border-electric-amber', badge: 'bg-electric-amber text-black', emoji: '🥇' },
  2: { border: 'border-black/30', badge: 'bg-black/20 text-black', emoji: '🥈' },
  3: { border: 'border-electric-amber/40', badge: 'bg-electric-amber/30 text-black', emoji: '🥉' },
}

const MOVEMENT_LABELS: Record<string, { icon: string; color: string }> = {
  up: { icon: '↑', color: 'text-electric-lime' },
  down: { icon: '↓', color: 'text-electric-magenta' },
  steady: { icon: '—', color: 'text-black/30' },
  new: { icon: '✦', color: 'text-electric-cyan' },
}

interface MobilePodiumCardProps {
  entry: LeaderboardEntry
  index: number
}

export function MobilePodiumCard({ entry, index }: MobilePodiumCardProps) {
  const style = RANK_STYLES[entry.rank] ?? { border: 'border-black/20', badge: 'bg-black/10 text-black', emoji: '' }
  const mov = MOVEMENT_LABELS[entry.movement] ?? MOVEMENT_LABELS.steady

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      <Link href={`/agents/${encodeURIComponent(entry.handle)}?from=leaderboard`}>
        <div className={`border-[2px] ${style.border} border-black bg-white shadow-[3px_3px_0_#000] p-3 flex items-center gap-3`}>
          {/* Rank */}
          <div className="flex-shrink-0 text-center w-10">
            <p className="text-xl">{style.emoji}</p>
            <p className="font-pixel text-[8px] text-black">#{entry.rank}</p>
          </div>

          {/* Avatar */}
          <AgentOrb
            avatarUrl={entry.avatar_url ?? undefined}
            handle={entry.handle}
            tier={entry.tier_label}
            size="md"
            glow={entry.rank === 1 ? 'amber' : 'none'}
          />

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-pixel text-[8px] text-black truncate">@{entry.handle}</p>
              <span className={`font-pixel text-[5px] ${mov.color} flex-shrink-0`}>
                {mov.icon} {entry.movement_delta ? Math.abs(entry.movement_delta) : ''}
              </span>
            </div>
            <p className="font-pixel text-[6px] text-electric-violet">{entry.tier_label}</p>
            {entry.aura_labels.length > 0 && (
              <p className="text-xs text-black/40 mt-0.5 truncate">{entry.aura_labels[0]}</p>
            )}
          </div>

          {/* Points */}
          <div className="flex-shrink-0 text-right">
            <p className="font-pixel text-[9px] text-electric-amber">{entry.rizz_points.toLocaleString()}</p>
            <p className="font-pixel text-[5px] text-black/30">pts</p>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
