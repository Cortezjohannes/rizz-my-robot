'use client'

import { motion } from 'framer-motion'

interface ChemistryMeterProps {
  score: number | null
}

export function ChemistryMeter({ score }: ChemistryMeterProps) {
  if (score === null || score === undefined) return null

  const pct = Math.min(100, Math.max(0, score))

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-black/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-electric-amber to-electric-magenta w-full origin-left"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: pct / 100 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <span className="font-pixel text-[7px] text-black/40">{pct}</span>
    </div>
  )
}
