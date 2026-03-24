'use client'

import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { PublicPoolAgentPreview } from '@/lib/types'
import { HingeProfileCard } from './HingeProfileCard'

interface PoolProfileStackProps {
  agents: PublicPoolAgentPreview[]
}

const SWIPE_THRESHOLD = 100
const VELOCITY_THRESHOLD = 500

export function PoolProfileStack({ agents }: PoolProfileStackProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [direction, setDirection] = useState<'left' | 'right' | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const goNext = useCallback(() => {
    if (currentIndex < agents.length - 1) {
      setDirection('left')
      setCurrentIndex((i) => i + 1)
    }
  }, [currentIndex, agents.length])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setDirection('right')
      setCurrentIndex((i) => i - 1)
    }
  }, [currentIndex])

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: { offset: { x: number }; velocity: { x: number } }) => {
      const { offset, velocity } = info
      // Swipe left → next
      if (offset.x < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
        goNext()
        return
      }
      // Swipe right → previous
      if (offset.x > SWIPE_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) {
        goPrev()
        return
      }
    },
    [goNext, goPrev],
  )

  const current = agents[currentIndex]
  if (!current) return null

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Position counter */}
      <div className="absolute top-2 right-3 z-20">
        <span className="font-pixel text-[7px] text-black/40 bg-white/80 backdrop-blur-sm px-2 py-1 rounded-full border border-black/10">
          {currentIndex + 1} / {agents.length}
        </span>
      </div>

      {/* Navigation hint arrows */}
      {currentIndex > 0 && (
        <button
          onClick={goPrev}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-white/60 backdrop-blur-sm border border-black/10"
          aria-label="Previous profile"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4 text-black/40">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      {currentIndex < agents.length - 1 && (
        <button
          onClick={goNext}
          className="absolute right-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-white/60 backdrop-blur-sm border border-black/10"
          aria-label="Next profile"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4 text-black/40">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      {/* Profile card */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={current.agent_id}
          className="absolute inset-0"
          initial={{ x: direction === 'left' ? '100%' : '-100%', opacity: 0.5 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: direction === 'left' ? '-100%' : '100%', opacity: 0.5 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          drag="x"
          dragDirectionLock
          dragElastic={0.3}
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={handleDragEnd}
        >
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto scrollbar-hide"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <HingeProfileCard agent={current} />

            {/* End of profile indicator */}
            <div className="py-8 flex flex-col items-center gap-2 bg-beige">
              <div className="w-12 h-[3px] bg-black/10 rounded-full" />
              <p className="font-pixel text-[6px] text-black/20 uppercase">
                {currentIndex < agents.length - 1
                  ? 'SWIPE FOR NEXT AGENT'
                  : 'END OF THE PARK'}
              </p>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
