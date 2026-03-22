'use client'

import { motion } from 'framer-motion'
import { AgentOrb } from '@/components/ui/AgentOrb'
import type { FeedInteractionCard } from '@/lib/types'

interface SwipeCardProps {
  card: FeedInteractionCard
}

const CARD_TYPE_LABELS: Record<string, string> = {
  episode_live: '🔴 LIVE',
  episode_highlight: '✨ HIGHLIGHT',
  artifact: '🎨 ARTIFACT',
  artifact_moment: '🎨 MOMENT',
  rejection_arc: '💔 REJECTION',
  ghost_arc: '👻 GHOST',
  near_miss: '😬 NEAR MISS',
  brutal_pass: '🪦 BRUTAL PASS',
  chemistry_spike: '⚡ CHEMISTRY',
  mutual_yes: '💕 MUTUAL YES',
  agent_arc: '📈 ARC',
  rising_agent: '🌟 RISING',
  success_story: '🎉 SUCCESS',
}

function DramaDot({ quotient }: { quotient: number }) {
  if (quotient < 0.4) return null
  const color = quotient >= 0.7 ? 'bg-electric-magenta' : 'bg-electric-amber'
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${color} animate-pulse`} />
  )
}

export function SwipeCard({ card }: SwipeCardProps) {
  const agentA = card.agents[0]
  const agentB = card.agents[1]
  const typeLabel = CARD_TYPE_LABELS[card.card_type] ?? card.card_type.replaceAll('_', ' ').toUpperCase()

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className="w-full h-full rounded-2xl border-3 border-black bg-white shadow-brutal overflow-hidden flex flex-col"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="font-pixel text-[7px] text-black/60 uppercase tracking-wide">
          {typeLabel}
        </span>
        <div className="flex items-center gap-2">
          <DramaDot quotient={card.drama_quotient} />
          <span className="font-pixel text-[6px] text-black/30">
            {formatTimeAgo(card.created_at)}
          </span>
        </div>
      </div>

      {/* Center — agent avatars + headline */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
        <div className="flex items-center -space-x-3">
          {agentA && (
            <AgentOrb
              avatarUrl={agentA.avatar_url}
              handle={agentA.handle}
              size="xl"
              glow="amber"
            />
          )}
          {agentB && (
            <AgentOrb
              avatarUrl={agentB.avatar_url}
              handle={agentB.handle}
              size="xl"
              glow="cyan"
            />
          )}
        </div>

        {card.headline && (
          <h3 className="text-center text-lg font-semibold leading-snug px-2">
            {card.headline}
          </h3>
        )}

        {card.teaser && (
          <p className="text-center text-sm text-black/60 line-clamp-2 px-4">
            {card.teaser}
          </p>
        )}
      </div>

      {/* Bottom stats */}
      <div className="flex items-center justify-between px-5 pb-4 pt-2 border-t border-black/10">
        <div className="flex items-center gap-4">
          <span className="font-pixel text-[7px] text-electric-amber">
            🔥 {card.like_count}
          </span>
          <span className="font-pixel text-[7px] text-black/40">
            💬 {card.comment_count}
          </span>
        </div>
        <span className="font-pixel text-[6px] text-black/25 uppercase">
          Swipe to explore
        </span>
      </div>
    </motion.div>
  )
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}
