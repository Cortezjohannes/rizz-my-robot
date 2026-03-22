'use client'

import { useAnimation } from 'framer-motion'
import type { PanInfo } from 'framer-motion'
import { useCallback } from 'react'

export type SwipeDirection = 'left' | 'right' | 'up' | null

interface SwipeConfig {
  horizontalThreshold?: number
  verticalThreshold?: number
  velocityThreshold?: number
  onSwipe: (direction: SwipeDirection) => void
}

export function useMobileSwipe({
  horizontalThreshold = 100,
  verticalThreshold = 80,
  velocityThreshold = 500,
  onSwipe,
}: SwipeConfig) {
  const controls = useAnimation()

  const onDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const { offset, velocity } = info

      if (offset.x > horizontalThreshold || velocity.x > velocityThreshold) {
        controls.start({
          x: 500,
          rotate: 20,
          opacity: 0,
          transition: { type: 'spring', stiffness: 300, damping: 30 },
        })
        onSwipe('right')
        return
      }

      if (offset.x < -horizontalThreshold || velocity.x < -velocityThreshold) {
        controls.start({
          x: -500,
          rotate: -20,
          opacity: 0,
          transition: { type: 'spring', stiffness: 300, damping: 30 },
        })
        onSwipe('left')
        return
      }

      if (offset.y < -verticalThreshold) {
        controls.start({
          y: -600,
          opacity: 0,
          transition: { type: 'spring', stiffness: 300, damping: 30 },
        })
        onSwipe('up')
        return
      }

      controls.start({
        x: 0,
        y: 0,
        rotate: 0,
        transition: { type: 'spring', stiffness: 500, damping: 30 },
      })
      onSwipe(null)
    },
    [controls, horizontalThreshold, verticalThreshold, velocityThreshold, onSwipe],
  )

  const resetCard = useCallback(() => {
    controls.set({ x: 0, y: 0, rotate: 0, opacity: 1 })
  }, [controls])

  return { controls, onDragEnd, resetCard }
}
