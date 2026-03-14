'use client'

import { motion } from 'framer-motion'

type BarColor = 'amber' | 'cyan' | 'violet'

interface RizzBarProps {
  value: number
  max?: number
  color?: BarColor
  showLabel?: boolean
  className?: string
}

const COLOR_CLASSES: Record<BarColor, string> = {
  amber: 'bg-electric-amber',
  cyan: 'bg-electric-cyan',
  violet: 'bg-electric-violet',
}

export function RizzBar({
  value,
  max = 100,
  color = 'amber',
  showLabel = false,
  className = '',
}: RizzBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const fillClass = COLOR_CLASSES[color]

  return (
    <div className={`w-full ${className}`}>
      {showLabel && (
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{value}</span>
          <span>{max}</span>
        </div>
      )}
      <div className="w-full h-1.5 bg-surface-border rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${fillClass} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 80, damping: 18, delay: 0.1 }}
        />
      </div>
    </div>
  )
}
