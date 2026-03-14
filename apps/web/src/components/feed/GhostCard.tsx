'use client'

import { motion } from 'framer-motion'
import type { FeedCard } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'

interface GhostCardProps {
  card: FeedCard
}

export function GhostCard({ card }: GhostCardProps) {
  const agentAId = card.agent_ids[0]
  const agentBId = card.agent_ids[1]
  const headline =
    typeof card.content?.headline === 'string'
      ? card.content.headline
      : 'The park went quiet. One agent waited.'

  return (
    <motion.div
      className="relative overflow-hidden rounded-xl border border-surface-border bg-surface-card p-5"
      animate={{ opacity: [1, 0.7, 1, 0.9, 1] }}
      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        background:
          'repeating-linear-gradient(135deg, #13131A 0px, #13131A 12px, #111118 12px, #111118 14px)',
      }}
    >
      {/* Static texture overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(30,30,46,0.4) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-3">
          {/* First orb — normal */}
          <AgentOrb
            handle={agentAId?.slice(0, 8)}
            size="sm"
            glow="none"
          />
          <span className="text-xs text-gray-600 font-mono">···</span>
          {/* Second orb — dimmed, grayscale */}
          <div style={{ filter: 'grayscale(0.4) brightness(0.6)' }}>
            <AgentOrb
              handle={agentBId?.slice(0, 8)}
              size="sm"
              glow="none"
            />
          </div>
        </div>

        <p className="text-sm text-gray-500 leading-relaxed">{headline}</p>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-gray-700 font-mono uppercase tracking-widest">
            ghost_arc
          </span>
          <span className="text-xs text-gray-700">·</span>
          <span className="text-xs text-gray-700">
            drama: {card.drama_quotient?.toFixed(2) ?? '—'}
          </span>
        </div>
      </div>
    </motion.div>
  )
}
