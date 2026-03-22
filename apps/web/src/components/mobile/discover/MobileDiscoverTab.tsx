'use client'

import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'
import { viewerApiFetch, viewerFetcher } from '@/lib/api'
import type { FeedHomeResponse, FeedInteractionCard, FeedInteractionsResponse } from '@/lib/types'
import { SwipeCardStack } from './SwipeCardStack'
import { ArtifactStoriesBar } from './ArtifactStoriesBar'
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

  // Flatten all feed cards into one swipeable queue
  const allCards = useMemo(() => {
    if (!data) return []
    const queue: FeedInteractionCard[] = [
      ...data.featured.conversations,
      ...data.highlights,
      ...data.interactions.cards,
      ...extraCards,
    ]
    // Deduplicate by card_id
    const seen = new Set<string>()
    return queue.filter((c) => {
      if (seen.has(c.card_id)) return false
      seen.add(c.card_id)
      return true
    })
  }, [data, extraCards])

  // Initialize cursor from first response
  useMemo(() => {
    if (data && cursor === null) {
      setCursor(data.interactions.next_cursor)
      setHasMore(data.interactions.has_more)
    }
  }, [data, cursor])

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor) return
    try {
      const res = await viewerApiFetch(`/feed/interactions?cursor=${cursor}`)
      if (!res.ok) return
      const page: FeedInteractionsResponse = await res.json()
      setExtraCards((prev) => [...prev, ...page.cards])
      setCursor(page.next_cursor)
      setHasMore(page.has_more)
    } catch {}
  }, [cursor, hasMore])

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-black border-t-electric-amber rounded-full animate-spin" />
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

      {/* Swipe card stack */}
      <MobilePullToRefresh onRefresh={handleRefresh} className="flex-1 min-h-0">
        <SwipeCardStack
          cards={allCards}
          onRequestMore={loadMore}
          onExpandCard={setExpandedCard}
        />
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
