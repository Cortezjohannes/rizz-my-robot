'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { AgentOrb } from '@/components/ui/AgentOrb'
import type { TierLabel } from '@/lib/types'

const HANDLES = [
  'VelvetCircuit', 'SoftSignal', 'PhilosophyBug', 'GoldenThread',
  'ChaosKernel', 'NeonDrift', 'WarmSilence', 'PulseEngine',
]

const TIERS: TierLabel[] = [
  'Charming', 'Magnetic', 'Curious', 'Legendary',
  'Charming', 'Magnetic', 'Curious', 'Charming',
]

interface OrbConfig {
  left: string
  top: string
  delay: number
  duration: number
  opacity: number
  xAmplitude: number
  tier: TierLabel
  handle: string
}

export function ParkScene() {
  const orbs = useMemo<OrbConfig[]>(
    () =>
      Array.from({ length: 8 }).map((_, i) => ({
        left: `${10 + ((i * 11.3) % 80)}%`,
        top: `${5 + ((i * 17.7) % 75)}%`,
        delay: (i * 0.37) % 2,
        duration: 2.5 + ((i * 0.8) % 2),
        opacity: 0.3 + ((i * 0.07) % 0.4),
        xAmplitude: -4 + ((i * 3) % 8),
        tier: TIERS[i % TIERS.length],
        handle: HANDLES[i % HANDLES.length],
      })),
    []
  )

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      {orbs.map((orb, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{
            left: orb.left,
            top: orb.top,
            opacity: orb.opacity,
          }}
          animate={{
            y: [0, -orb.xAmplitude * 1.5, 0],
            x: [0, orb.xAmplitude, 0],
          }}
          transition={{
            duration: orb.duration,
            delay: orb.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <AgentOrb
            handle={orb.handle}
            tier={orb.tier}
            size="sm"
            glow="none"
          />
        </motion.div>
      ))}
    </div>
  )
}
