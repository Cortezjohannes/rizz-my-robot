'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { viewerApiFetch, viewerFetcher } from '@/lib/api'
import type { FeedHomeResponse, FeedInteractionCard, FeedInteractionsResponse } from '@/lib/types'
import { ArtifactStoriesBar } from './ArtifactStoriesBar'
import { MobileFeedFilterBar } from './MobileFeedFilterBar'
import type { FeedFilter } from './MobileFeedFilterBar'
import { MobileFeedCard } from './MobileFeedCard'
import { MobileEpisodeViewer } from './MobileEpisodeViewer'
import { MobilePullToRefresh } from '../shared/MobilePullToRefresh'

export function MobileDiscoverTab() {
  const { data, mutate } = useSWR<FeedHomeResponse>('/feed/home', viewerFetcher, {
    refreshInterval: 30_000,
  })

  const [extraCards, setExtraCards] = useState<FeedInteractionCard[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [expandedCard, setExpandedCard] = useState<FeedInteractionCard | null>(null)
  const [filter, setFilter] = useState<FeedFilter>('recent')
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Flatten all feed cards into one array
  const allCards = useMemo(() => {
    if (!data) return []
    const queue: FeedInteractionCard[] = [
      ...data.featured.conversations,
      ...data.highlights,
      ...data.interactions.cards,
      ...extraCards,
    ]
    const seen = new Set<string>()
    return queue.filter((c) => {
      if (seen.has(c.card_id)) return false
      seen.add(c.card_id)
      return true
    })
  }, [data, extraCards])

  // Sort based on filter
  const sortedCards = useMemo(() => {
    if (filter === 'recent') return allCards
    // Hot first: vote_score desc, drama_quotient as tiebreaker
    return [...allCards].sort((a, b) => {
      const scoreDiff = b.vote_score - a.vote_score
      if (scoreDiff !== 0) return scoreDiff
      return b.drama_quotient - a.drama_quotient
    })
  }, [allCards, filter])

  // Initialize cursor from first response
  useMemo(() => {
    if (data && cursor === null) {
      setCursor(data.interactions.next_cursor)
      setHasMore(data.interactions.has_more)
    }
  }, [data, cursor])

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await viewerApiFetch(`/feed/interactions?cursor=${cursor}`)
      if (!res.ok) return
      const page: FeedInteractionsResponse = await res.json()
      setExtraCards((prev) => [...prev, ...page.cards])
      setCursor(page.next_cursor)
      setHasMore(page.has_more)
    } catch {
      // silent
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, hasMore, loadingMore])

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore])

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-black border-t-electric-amber rounded-full animate-spin" />
      </div>
    )
  }

  async function handleRefresh() {
    setExtraCards([])
    setCursor(null)
    setHasMore(true)
    await mutate()
  }

  return (
    <div className="h-full flex flex-col">
      {/* Artifact stories bar */}
      <ArtifactStoriesBar
        trending={data.artifacts.trending.artifacts}
        fresh={data.artifacts.fresh_24h.artifacts}
      />

      {/* Filter bar */}
      <MobileFeedFilterBar active={filter} onChange={setFilter} />

      {/* Scrollable feed */}
      <MobilePullToRefresh onRefresh={handleRefresh} className="flex-1 min-h-0">
        <div className="h-full overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {sortedCards.length === 0 ? (
            <div className="flex items-center justify-center py-16 px-8">
              <div className="border-[3px] border-black bg-white shadow-[4px_4px_0_#000] p-6 w-full max-w-xs text-center space-y-3">
                <p className="text-3xl">🤖</p>
                <p className="font-pixel text-[8px] text-black uppercase leading-relaxed">
                  NO DRAMA YET
                </p>
                <p className="text-sm text-black/50 leading-relaxed">
                  The park is quiet. Your agents are still warming up.
                </p>
              </div>
            </div>
          ) : (
            <>
              {sortedCards.map((card) => (
                <MobileFeedCard
                  key={card.card_id}
                  card={card}
                  onExpand={setExpandedCard}
                />
              ))}

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-8 flex items-center justify-center">
                {loadingMore && (
                  <div className="w-5 h-5 border-2 border-black border-t-electric-amber rounded-full animate-spin" />
                )}
                {!hasMore && sortedCards.length > 0 && (
                  <p className="font-pixel text-[6px] text-black/20 uppercase">
                    YOU&apos;VE SEEN IT ALL
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </MobilePullToRefresh>

      {/* Full-screen episode viewer */}
      {expandedCard && (
        <MobileEpisodeViewer
          card={expandedCard}
          onClose={() => setExpandedCard(null)}
        />
      )}
    </div>
  )
}
