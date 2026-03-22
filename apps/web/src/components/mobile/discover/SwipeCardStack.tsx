'use client'

import { useCallback, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion'
import { viewerApiFetch } from '@/lib/api'
import type { FeedInteractionCard } from '@/lib/types'
import { SwipeCard } from './SwipeCard'
import { SwipeOverlayIndicator } from './SwipeOverlayIndicator'

interface SwipeCardStackProps {
  cards: FeedInteractionCard[]
  onRequestMore: () => void
  onExpandCard: (card: FeedInteractionCard) => void
}

export function SwipeCardStack({ cards, onRequestMore, onExpandCard }: SwipeCardStackProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const dragX = useMotionValue(0)
  const dragY = useMotionValue(0)
  const rotate = useTransform(dragX, [-200, 200], [-15, 15])

  const advance = useCallback(() => {
    const nextIndex = currentIndex + 1
    setCurrentIndex(nextIndex)
    if (cards.length - nextIndex <= 5) {
      onRequestMore()
    }
  }, [currentIndex, cards.length, onRequestMore])

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: { offset: { x: number; y: number }; velocity: { x: number; y: number } }) => {
      const { offset, velocity } = info

      // Swipe right — FIRE
      if (offset.x > 100 || velocity.x > 500) {
        const card = cards[currentIndex]
        if (card) {
          viewerApiFetch(`/feed/${card.card_id}/like`, { method: 'POST' }).catch(() => {})
        }
        advance()
        return
      }

      // Swipe left — SKIP
      if (offset.x < -100 || velocity.x < -500) {
        advance()
        return
      }

      // Swipe up — EXPAND
      if (offset.y < -80) {
        const card = cards[currentIndex]
        if (card) onExpandCard(card)
        return
      }
    },
    [cards, currentIndex, advance, onExpandCard],
  )

  const visibleCards = cards.slice(currentIndex, currentIndex + 3)

  if (visibleCards.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="text-center">
          <p className="font-pixel text-[10px] text-black/40">NO MORE CARDS</p>
          <p className="text-sm text-black/30 mt-2">Check back later for new moments</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center px-4">
      <AnimatePresence>
        {visibleCards.map((card, stackIndex) => {
          const isFront = stackIndex === 0
          const scale = 1 - stackIndex * 0.05
          const yOffset = stackIndex * 8

          if (isFront) {
            return (
              <motion.div
                key={card.card_id}
                className="absolute inset-x-4 top-2 bottom-2"
                style={{
                  x: dragX,
                  y: dragY,
                  rotate,
                  zIndex: 30 - stackIndex,
                  touchAction: 'none',
                }}
                drag
                dragElastic={0.7}
                dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                onDragEnd={handleDragEnd}
                initial={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
              >
                <SwipeOverlayIndicator dragX={dragX} dragY={dragY} />
                <SwipeCard card={card} />
              </motion.div>
            )
          }

          return (
            <motion.div
              key={card.card_id}
              className="absolute inset-x-4 top-2 bottom-2 pointer-events-none"
              style={{ zIndex: 30 - stackIndex }}
              initial={{ scale, y: yOffset, opacity: 1 - stackIndex * 0.3 }}
              animate={{ scale, y: yOffset, opacity: 1 - stackIndex * 0.3 }}
              transition={{ duration: 0.3 }}
            >
              <SwipeCard card={card} />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
