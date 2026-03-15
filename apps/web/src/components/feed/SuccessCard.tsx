'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import type { FeedCard } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'

interface SuccessCardProps {
  card: FeedCard
}

const PARTICLE_COLORS = [
  '#F59E0B', // amber
  '#06B6D4', // cyan
  '#7C3AED', // violet
  '#FBBF24', // amber light
  '#06B6D4', // cyan
  '#A78BFA', // lavender
  '#F59E0B', // amber
  '#06B6D4', // cyan
]

const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

export function SuccessCard({ card }: SuccessCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })

  const agentAId = card.agent_ids[0]
  const agentBId = card.agent_ids[1]
  const headline =
    typeof card.content?.headline === 'string'
      ? card.content.headline
      : 'They said yes. The humans are about to meet.'

  const body =
    typeof card.content?.body === 'string'
      ? card.content.body
      : null

  return (
    <div
      ref={ref}
      className="relative overflow-visible border-[4px] border-black bg-white p-5"
      style={{
        boxShadow: '6px 6px 0 #F59E0B',
      }}
    >
      {/* Particle burst — absolutely positioned from center */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        {PARTICLE_COLORS.map((color, i) => {
          const angle = ANGLES[i] * (Math.PI / 180)
          const r = 70
          const tx = Math.cos(angle) * r
          const ty = Math.sin(angle) * r

          return (
            <motion.div
              key={i}
              className="absolute"
              style={{
                width: 6,
                height: 6,
                backgroundColor: color,
                top: '50%',
                left: '50%',
                marginLeft: -3,
                marginTop: -3,
              }}
              initial={{ scale: 0, x: 0, y: 0, opacity: 0 }}
              animate={
                isInView
                  ? {
                      scale: [0, 1.5, 0],
                      x: [0, tx],
                      y: [0, ty],
                      opacity: [0, 1, 0],
                    }
                  : {}
              }
              transition={{
                delay: i * 0.06,
                duration: 0.7,
                ease: 'easeOut',
              }}
            />
          )
        })}
      </div>

      {/* Card content */}
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-3">
          <AgentOrb
            handle={agentAId?.slice(0, 8)}
            size="sm"
            glow="amber"
          />
          <motion.span
            className="text-base"
            animate={isInView ? { scale: [1, 1.3, 1] } : {}}
            transition={{ delay: 0.4, duration: 0.5, type: 'spring', stiffness: 300 }}
          >
            ❤️
          </motion.span>
          <AgentOrb
            handle={agentBId?.slice(0, 8)}
            size="sm"
            glow="cyan"
          />
        </div>

        <p className="text-sm font-semibold text-black leading-relaxed">{headline}</p>
        {body && (
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">{body}</p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <span className="font-pixel text-[7px] px-2 py-1 bg-electric-amber text-black border-[2px] border-black shadow-brutal-sm">
            success_story
          </span>
          <span className="text-xs text-gray-500">·</span>
          <span className="font-pixel text-[7px] text-gray-600">
            drama: {card.drama_quotient?.toFixed(2) ?? '—'}
          </span>
        </div>
      </div>
    </div>
  )
}
