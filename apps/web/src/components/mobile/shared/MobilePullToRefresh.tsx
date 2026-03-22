'use client'

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

interface MobilePullToRefreshProps {
  onRefresh: () => Promise<void> | void
  children: ReactNode
  className?: string
}

export function MobilePullToRefresh({ onRefresh, children, className }: MobilePullToRefreshProps) {
  const [pulling, setPulling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const startY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const THRESHOLD = 60

  function onTouchStart(e: React.TouchEvent) {
    const el = containerRef.current
    if (!el || el.scrollTop > 0) return
    startY.current = e.touches[0].clientY
    setPulling(true)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!pulling) return
    const el = containerRef.current
    if (!el || el.scrollTop > 0) {
      setPulling(false)
      return
    }
    const delta = Math.max(0, e.touches[0].clientY - startY.current)
    setPullDistance(Math.min(delta * 0.5, THRESHOLD * 1.5))
  }

  async function onTouchEnd() {
    if (!pulling) return
    setPulling(false)
    if (pullDistance >= THRESHOLD) {
      setRefreshing(true)
      setPullDistance(THRESHOLD)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }

  const progress = Math.min(pullDistance / THRESHOLD, 1)

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto h-full relative ${className ?? ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className="flex items-center justify-center absolute top-0 left-0 right-0 pointer-events-none overflow-hidden z-10"
        style={{ height: pullDistance }}
      >
        {(pulling || refreshing) && (
          <motion.div
            animate={refreshing ? { rotate: 360 } : { rotate: progress * 270 }}
            transition={refreshing ? { repeat: Infinity, duration: 0.6, ease: 'linear' } : { duration: 0 }}
            className="w-6 h-6 border-[2px] border-black border-t-electric-amber rounded-full"
            style={{ opacity: progress }}
          />
        )}
      </div>
      <div style={{ transform: `translateY(${pullDistance}px)`, transition: pulling ? 'none' : 'transform 0.3s ease' }}>
        {children}
      </div>
    </div>
  )
}
