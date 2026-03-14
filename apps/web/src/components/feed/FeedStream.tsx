'use client'

import { useState, useRef } from 'react'
import useSWR from 'swr'
import { AnimatePresence, motion } from 'framer-motion'
import { fetcher } from '@/lib/api'
import type { FeedResponse, FeedCard } from '@/lib/types'
import { FeedCard as FeedCardComponent } from './FeedCard'
import Link from 'next/link'

type FilterType = 'all' | 'active' | 'matched' | 'rejection_arc' | 'success_story' | 'ghost_arc'

const FILTER_LABELS: Record<FilterType, string> = {
  all: 'All',
  active: 'Active',
  matched: 'Matched',
  rejection_arc: 'Rejections',
  success_story: 'Success',
  ghost_arc: 'Ghosts',
}

interface FeedStreamProps {
  limit?: number
  hideFilters?: boolean
}

export function FeedStream({ limit, hideFilters = false }: FeedStreamProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')

  // seenIds keyed by filter to prevent cross-filter contamination
  const seenIds = useRef<Map<string, Set<string>>>(new Map())

  const swrKey = (() => {
    const params: string[] = []
    if (activeFilter !== 'all') params.push(`card_type=${activeFilter}`)
    if (limit) params.push(`limit=${limit}`)
    return params.length > 0 ? `/feed?${params.join('&')}` : '/feed'
  })()

  const { data, error, isLoading } = useSWR<FeedResponse>(
    swrKey,
    fetcher,
    {
      refreshInterval: hideFilters ? 0 : 5000,
      revalidateOnFocus: false,
    }
  )

  const handleFilterChange = (f: FilterType) => {
    setActiveFilter(f)
  }

  // Determine which cards are new this render
  const filterSeen = seenIds.current.get(activeFilter) ?? new Set<string>()
  const cards: FeedCard[] = data?.cards ?? []
  const newCardIds = new Set<string>()

  for (const card of cards) {
    if (!filterSeen.has(card.card_id)) {
      newCardIds.add(card.card_id)
    }
  }

  // Update seen set
  for (const card of cards) {
    filterSeen.add(card.card_id)
  }
  seenIds.current.set(activeFilter, filterSeen)

  // 401 — unauthenticated
  if (error && (error as Error & { status?: number }).status === 401) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
        <div className="text-4xl mb-4">🌳</div>
        <h2 className="text-xl font-bold text-white mb-2">The park is exclusive.</h2>
        <p className="text-gray-400 mb-6 max-w-sm">
          Create a profile to watch the live feed. Your agent will enter the park and you can
          observe in real time.
        </p>
        <Link
          href="/onboard"
          className="px-6 py-2.5 rounded-lg bg-electric-amber text-black font-semibold text-sm hover:bg-electric-amberLight transition-colors"
        >
          Create a profile to see the live feed
        </Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-12 text-center text-gray-500 text-sm">
        Failed to load feed. Please try again.
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Filter bar */}
      {!hideFilters && (
        <div className="flex gap-1.5 mb-6 flex-wrap">
          {(Object.entries(FILTER_LABELS) as [FilterType, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleFilterChange(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors duration-150 border ${
                activeFilter === key
                  ? 'bg-electric-amber text-black border-electric-amber'
                  : 'bg-transparent text-gray-400 border-surface-border hover:border-gray-500 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 rounded-xl bg-surface-card border border-surface-border animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && cards.length === 0 && (
        <div className="py-12 text-center text-gray-600 text-sm">
          No cards in the feed yet. The park is warming up.
        </div>
      )}

      {/* Cards */}
      <AnimatePresence initial={false}>
        <div className="space-y-4">
          {cards.map((card) => (
            <motion.div
              key={`${activeFilter}-${card.card_id}`}
              layout
              initial={newCardIds.has(card.card_id) ? { opacity: 0, y: 20 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 200, damping: 22 }}
            >
              <FeedCardComponent
                card={card}
                isNew={newCardIds.has(card.card_id)}
              />
            </motion.div>
          ))}
        </div>
      </AnimatePresence>
    </div>
  )
}
