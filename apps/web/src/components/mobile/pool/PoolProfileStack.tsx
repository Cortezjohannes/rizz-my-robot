'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PeekProfile } from './HingeProfileCard'
import { PreviewCard } from './PreviewCard'
import type { SwipeCandidate } from './swipeCandidate'

interface PoolProfileStackProps {
  candidates: SwipeCandidate[]
}

const SWIPE_THRESHOLD = 100
const VELOCITY_THRESHOLD = 500
type StackView = 'preview' | 'peek'

export function PoolProfileStack({ candidates }: PoolProfileStackProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [direction, setDirection] = useState<'left' | 'right' | null>(null)
  const [view, setView] = useState<StackView>('preview')
  const scrollRef = useRef<HTMLDivElement>(null)
  const current = candidates[currentIndex]

  useEffect(() => {
    setView('preview')
    scrollRef.current?.scrollTo({ top: 0 })
  }, [current?.id])

  useEffect(() => {
    if (currentIndex >= candidates.length) {
      setCurrentIndex(Math.max(0, candidates.length - 1))
    }
  }, [candidates.length, currentIndex])

  const goNext = useCallback(() => {
    setView('preview')
    if (currentIndex < candidates.length - 1) {
      setDirection('left')
      setCurrentIndex((i) => i + 1)
    }
  }, [currentIndex, candidates.length])

  const goPrev = useCallback(() => {
    setView('preview')
    if (currentIndex > 0) {
      setDirection('right')
      setCurrentIndex((i) => i - 1)
    }
  }, [currentIndex])

  const openPeek = useCallback(() => {
    setDirection(null)
    setView('peek')
    window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0 })
    })
  }, [])

  const closePeek = useCallback(() => {
    setDirection(null)
    setView('preview')
    window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0 })
    })
  }, [])

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: { offset: { x: number }; velocity: { x: number } }) => {
      if (view !== 'preview') return
      const { offset, velocity } = info
      if (offset.x < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
        goNext()
        return
      }
      if (offset.x > SWIPE_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) {
        goPrev()
        return
      }
    },
    [goNext, goPrev, view],
  )

  if (!current) return null

  const canGoNext = currentIndex < candidates.length - 1
  const initialX = direction === 'left' ? '100%' : direction === 'right' ? '-100%' : 0
  const exitX = direction === 'left' ? '-100%' : direction === 'right' ? '100%' : 0
  const transitionOpacity = direction ? 0.5 : 1

  return (
    <div className="relative h-full w-full overflow-hidden">
      {view === 'preview' && (
        <div className="absolute right-3 top-2 z-30">
          <span className="font-pixel text-[7px] text-black/40 bg-white/80 backdrop-blur-sm px-2 py-1 rounded-full border border-black/10">
            {currentIndex + 1} / {candidates.length}
          </span>
        </div>
      )}

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={`${current.id}-${view}`}
          className="absolute inset-0"
          initial={{ x: initialX, opacity: transitionOpacity }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: exitX, opacity: transitionOpacity }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          drag={view === 'preview' ? 'x' : false}
          dragDirectionLock
          dragElastic={0.3}
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={handleDragEnd}
        >
          <div
            ref={scrollRef}
            className={view === 'peek' ? 'h-full overflow-y-auto bg-white scrollbar-hide' : 'h-full overflow-hidden'}
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {view === 'peek' ? (
              <>
                <div className="sticky top-0 z-20 flex items-center justify-between border-b-2 border-black/10 bg-white px-3 py-2">
                  <button
                    type="button"
                    onClick={closePeek}
                    className="flex min-h-10 items-center rounded-lg border-[3px] border-black bg-white px-3 font-pixel text-[7px] uppercase text-black shadow-brutal-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                  >
                    BACK
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={!canGoNext}
                    className="flex min-h-10 items-center rounded-lg border-[3px] border-black bg-electric-amber px-3 font-pixel text-[7px] uppercase text-black shadow-brutal-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    NEXT
                  </button>
                </div>
                <PeekProfile agent={current.peek_profile} profileDeckPath={current.profile_deck_path} />
              </>
            ) : (
              <PreviewCard
                preview={current.preview}
                canPass={canGoNext}
                onPass={goNext}
                onPeek={openPeek}
              />
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
