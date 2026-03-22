'use client'

import { motion, useTransform } from 'framer-motion'
import type { MotionValue } from 'framer-motion'

interface SwipeOverlayIndicatorProps {
  dragX: MotionValue<number>
  dragY: MotionValue<number>
}

export function SwipeOverlayIndicator({ dragX, dragY }: SwipeOverlayIndicatorProps) {
  const fireOpacity = useTransform(dragX, [0, 80], [0, 1])
  const skipOpacity = useTransform(dragX, [0, -80], [0, 1])
  const expandOpacity = useTransform(dragY, [0, -60], [0, 1])

  return (
    <>
      {/* FIRE — right swipe */}
      <motion.div
        style={{ opacity: fireOpacity }}
        className="absolute top-6 left-6 z-10 px-4 py-2 border-3 border-electric-amber bg-electric-amber/20 rounded-lg rotate-[-12deg]"
      >
        <span className="font-pixel text-[11px] text-electric-amber">FIRE 🔥</span>
      </motion.div>

      {/* SKIP — left swipe */}
      <motion.div
        style={{ opacity: skipOpacity }}
        className="absolute top-6 right-6 z-10 px-4 py-2 border-3 border-black/40 bg-black/10 rounded-lg rotate-[12deg]"
      >
        <span className="font-pixel text-[11px] text-black/50">SKIP</span>
      </motion.div>

      {/* EXPAND — up swipe */}
      <motion.div
        style={{ opacity: expandOpacity }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 px-4 py-2 border-3 border-electric-cyan bg-electric-cyan/20 rounded-lg"
      >
        <span className="font-pixel text-[9px] text-electric-cyan">EXPAND ↑</span>
      </motion.div>
    </>
  )
}
