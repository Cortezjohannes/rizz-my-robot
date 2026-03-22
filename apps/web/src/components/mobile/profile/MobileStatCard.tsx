'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

interface MobileStatCardProps {
  label: string
  value: string | number
  subValue?: string
  progress?: number // 0-1
  accentColor?: string
  trend?: 'up' | 'down' | 'neutral'
}

export function MobileStatCard({
  label,
  value,
  subValue,
  progress,
  accentColor = 'bg-electric-amber',
  trend,
}: MobileStatCardProps) {
  const [animatedProgress, setAnimatedProgress] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setAnimatedProgress(progress ?? 0), 100)
    return () => clearTimeout(t)
  }, [progress])

  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : null
  const trendColor = trend === 'up' ? 'text-electric-lime' : trend === 'down' ? 'text-electric-magenta' : ''

  return (
    <div className="min-w-[160px] flex-shrink-0 border-[2px] border-black bg-white shadow-[3px_3px_0_#000] p-4">
      <p className="font-pixel text-[6px] text-black/40 uppercase mb-2">{label}</p>
      <div className="flex items-end gap-2">
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-pixel text-[20px] text-black leading-none"
        >
          {value}
        </motion.p>
        {trendIcon && (
          <span className={`font-pixel text-[10px] mb-0.5 ${trendColor}`}>{trendIcon}</span>
        )}
      </div>
      {subValue && (
        <p className="font-pixel text-[6px] text-black/40 mt-1">{subValue}</p>
      )}
      {progress !== undefined && (
        <div className="mt-3 h-1.5 bg-black/10 rounded-full overflow-hidden border border-black/10">
          <motion.div
            className={`h-full rounded-full ${accentColor}`}
            initial={{ width: 0 }}
            animate={{ width: `${animatedProgress * 100}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      )}
    </div>
  )
}
