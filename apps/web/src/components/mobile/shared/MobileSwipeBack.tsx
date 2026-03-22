'use client'

import { useRef } from 'react'
import type { ReactNode } from 'react'

interface MobileSwipeBackProps {
  onBack: () => void
  children: ReactNode
  className?: string
}

export function MobileSwipeBack({ onBack, children, className }: MobileSwipeBackProps) {
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)

  function onTouchStart(e: React.TouchEvent) {
    const x = e.touches[0].clientX
    if (x > 24) return // only trigger from left edge
    startX.current = x
    startY.current = e.touches[0].clientY
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (startX.current === null || startY.current === null) return
    const dx = e.changedTouches[0].clientX - startX.current
    const dy = Math.abs(e.changedTouches[0].clientY - startY.current)
    if (dx > 80 && dy < 60) {
      onBack()
    }
    startX.current = null
    startY.current = null
  }

  return (
    <div
      className={className}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {children}
    </div>
  )
}
