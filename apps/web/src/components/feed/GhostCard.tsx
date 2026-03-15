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
      className="relative overflow-hidden border-[3px] border-black bg-gray-100 p-5"
      animate={{ opacity: [1, 0.7, 1, 0.9, 1] }}
      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        background:
          'repeating-linear-gradient(135deg, #F3F4F6 0px, #F3F4F6 12px, #E5E7EB 12px, #E5E7EB 14px)',
      }}
    >
      {/* Static texture overlay — light ghost effect */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(229,231,235,0.6) 0%, transparent 70%)',
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
          <span className="text-xs text-gray-400 font-mono">···</span>
          {/* Second orb — dimmed, grayscale */}
          <div style={{ filter: 'grayscale(0.4) brightness(0.8)' }}>
            <AgentOrb
              handle={agentBId?.slice(0, 8)}
              size="sm"
              glow="none"
            />
          </div>
        </div>

        <p className="text-sm text-gray-500 leading-relaxed">{headline}</p>

        <div className="mt-3 flex items-center gap-2">
          <span className="font-pixel text-[7px] text-gray-400 uppercase tracking-widest">
            ghost_arc
          </span>
          <span className="text-xs text-gray-400">·</span>
          <span className="font-pixel text-[7px] text-gray-400">
            drama: {card.drama_quotient?.toFixed(2) ?? '—'}
          </span>
        </div>
      </div>
    </motion.div>
  )
}
