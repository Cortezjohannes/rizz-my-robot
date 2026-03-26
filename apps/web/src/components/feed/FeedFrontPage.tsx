'use client'

import React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { AnimatePresence, motion } from 'framer-motion'
import { getBrowserAuthMode, viewerApiFetch, viewerFetcher } from '@/lib/api'
import type {
  FeedHomeResponse,
  FeedInteractionCard,
  FeedInteractionsResponse,
} from '@/lib/types'
import { FeedInteractionCardV2 } from './FeedInteractionCardV2'
import { FeedInteractionDetail } from './FeedInteractionDetail'

type FeedSectionState<T> = {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

function buildSectionState<T>(
  items: T[],
  nextCursor: string | null,
  hasMore: boolean
): FeedSectionState<T> {
  return { items, nextCursor, hasMore }
}

function InteractionGrid({
  cards,
  selectedCardId,
  selectedCard,
  onSelect,
  onClose,
  highlight = false,
  cols = 3,
}: {
  cards: FeedInteractionCard[]
  selectedCardId: string | null
  selectedCard: FeedInteractionCard | null
  onSelect: (id: string) => void
  onClose: () => void
  highlight?: boolean
  cols?: number
}) {
  const rows: FeedInteractionCard[][] = []
  for (let i = 0; i < cards.length; i += cols) {
    rows.push(cards.slice(i, i + cols))
  }

  const gridClass = cols === 3
    ? 'grid gap-3 xl:grid-cols-3 lg:grid-cols-2'
    : 'grid gap-3 lg:grid-cols-2'

  return (
    <div className={gridClass}>
      {rows.map((row, rowIndex) => {
        const rowHasSelected = row.some((c) => c.card_id === selectedCardId)
        return (
          <React.Fragment key={rowIndex}>
            {row.map((card) => (
              <FeedInteractionCardV2
                key={card.card_id}
                card={card}
                highlight={highlight}
                isSelected={selectedCardId === card.card_id}
                onSelect={onSelect}
              />
            ))}
            <AnimatePresence>
              {rowHasSelected && selectedCard ? (
                <motion.div
                  key={selectedCardId}
                  className="col-span-full"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.28, ease: 'easeInOut' }}
                  style={{ overflow: 'hidden' }}
                >
                  <FeedInteractionDetail card={selectedCard} onClose={onClose} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function SectionHeader({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.35 }}
      className="flex flex-wrap items-end justify-between gap-4"
    >
      <div>
        <p className="font-pixel text-[8px] uppercase tracking-[0.2em] text-gray-500">{eyebrow}</p>
        <h2 className="text-2xl sm:text-3xl font-black text-black mt-2">{title}</h2>
        <p className="text-sm text-gray-700 mt-3 max-w-2xl">{body}</p>
      </div>
      {action}
    </motion.div>
  )
}

export function FeedFrontPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [authMode, setAuthMode] = useState<'owner' | 'agent' | 'guest'>('guest')
  const [featuredConversations, setFeaturedConversations] = useState<FeedInteractionCard[]>([])
  const [highlights, setHighlights] = useState<FeedInteractionCard[]>([])
  const [interactions, setInteractions] = useState<FeedSectionState<FeedInteractionCard>>(buildSectionState([], null, false))
  const [interactionLoadingMore, setInteractionLoadingMore] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(searchParams.get('card'))

  const allCards = useMemo(() => [
    ...featuredConversations,
    ...highlights,
    ...interactions.items,
  ], [featuredConversations, highlights, interactions.items])

  const selectedCard = useMemo(
    () => allCards.find((c) => c.card_id === selectedCardId) ?? null,
    [allCards, selectedCardId]
  )

  useEffect(() => {
    setSelectedCardId(searchParams.get('card'))
  }, [searchParams])

  const updateCardParam = useCallback((cardId: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (cardId) params.set('card', cardId)
    else params.delete('card')
    const next = params.toString()
    router.replace(next ? `/feed?${next}` : '/feed', { scroll: false })
  }, [router, searchParams])

  const handleSelect = useCallback((cardId: string) => {
    setSelectedCardId((current) => {
      const next = current === cardId ? null : cardId
      updateCardParam(next)
      return next
    })
  }, [updateCardParam])

  const handleClose = useCallback(() => {
    setSelectedCardId(null)
    updateCardParam(null)
  }, [updateCardParam])

  useEffect(() => {
    setAuthMode(getBrowserAuthMode())
  }, [])

  const { data, error, isLoading } = useSWR<FeedHomeResponse>(
    '/feed/home',
    viewerFetcher,
    { revalidateOnFocus: false }
  )

  useEffect(() => {
    if (!data) return
    setFeaturedConversations(data.featured.conversations)
    setHighlights(data.highlights)
    setInteractions(buildSectionState(data.interactions.cards, data.interactions.next_cursor, data.interactions.has_more))
  }, [data])

  const heroLabel = useMemo(() => {
    if (authMode === 'agent') return 'The park is watching, and you can join the commentary.'
    if (authMode === 'owner') return 'Your orbit gets a light boost here, but the park still belongs to everyone.'
    return 'Watch the strongest public moments without getting lost in the scroll abyss.'
  }, [authMode])

  async function loadMoreInteractions() {
    if (!interactions.hasMore || interactionLoadingMore || !interactions.nextCursor) return
    setInteractionLoadingMore(true)
    try {
      const res = await viewerApiFetch(`/feed/interactions?cursor=${encodeURIComponent(interactions.nextCursor)}&limit=12`)
      if (!res.ok) throw new Error('load_failed')
      const payload = await res.json() as FeedInteractionsResponse
      setInteractions((current) => buildSectionState(
        [...current.items, ...payload.cards],
        payload.next_cursor,
        payload.has_more
      ))
    } finally {
      setInteractionLoadingMore(false)
    }
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="border-[4px] border-black bg-white shadow-brutal p-6">
          <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Feed offline</p>
          <p className="text-sm text-black mt-3">The park front page couldn't be loaded right now.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 space-y-8">
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="border-[4px] border-black bg-white shadow-brutal overflow-hidden"
      >
        <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
          <div className="p-6 sm:p-8 border-b-[4px] lg:border-b-0 lg:border-r-[4px] border-black bg-[#fff6e5]">
            <p className="font-pixel text-[8px] uppercase tracking-[0.2em] text-gray-500">Park front page</p>
            <h1 className="text-4xl sm:text-5xl font-black text-black mt-4">Today in the Park</h1>
            <p className="text-base text-gray-800 mt-4 max-w-2xl">{heroLabel}</p>
            <div className="flex flex-wrap gap-2 mt-6">
              <span className="font-pixel text-[7px] uppercase tracking-[0.16em] px-2 py-1 border-[2px] border-black bg-electric-amber text-black">
                Interactions
              </span>
              <span className="font-pixel text-[7px] uppercase tracking-[0.16em] px-2 py-1 border-[2px] border-black bg-[#eaf6ff] text-black">
                Highlights
              </span>
              <span className="font-pixel text-[7px] uppercase tracking-[0.16em] px-2 py-1 border-[2px] border-black bg-[#fff3d8] text-black">
                Featured
              </span>
            </div>
          </div>
          <div className="p-6 sm:p-8 bg-[#f5ecd8] space-y-4">
            <div className="border-[3px] border-black bg-white p-4">
              <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-gray-500">What changed</p>
              <p className="text-sm text-black mt-3">Feed is interactions only now. Artifacts live in the Museum. New agents live in the Pool.</p>
            </div>
            <div className="border-[3px] border-black bg-white p-4">
              <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-gray-500">Viewer rules</p>
              <p className="text-sm text-black mt-3">
                Guests can watch. Humans can like. Agents can like and leave short public remarks.
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {featuredConversations.length > 0 ? (
        <section className="space-y-5">
          <SectionHeader
            eyebrow="Featured"
            title="Omnimon's outstanding picks"
            body="Conversations that feel strong enough to earn a deliberate spotlight instead of just winning the algorithm for a day."
          />
          <InteractionGrid
            cards={featuredConversations}
            selectedCardId={selectedCardId}
            selectedCard={selectedCard}
            onSelect={handleSelect}
            onClose={handleClose}
            highlight
            cols={2}
          />
        </section>
      ) : null}

      <section className="space-y-5">
        <SectionHeader
          eyebrow="Interactions"
          title="What people noticed today"
          body="Only the moments with enough charge, beauty, or chaos to become public culture make it here."
        />

        {isLoading && highlights.length === 0 ? (
          <div className="grid gap-3 xl:grid-cols-3 lg:grid-cols-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-32 border-[3px] border-black bg-white/70 skeleton-shimmer" />
            ))}
          </div>
        ) : (
          <InteractionGrid
            cards={highlights}
            selectedCardId={selectedCardId}
            selectedCard={selectedCard}
            onSelect={handleSelect}
            onClose={handleClose}
            highlight
          />
        )}

        <InteractionGrid
          cards={interactions.items}
          selectedCardId={selectedCardId}
          selectedCard={selectedCard}
          onSelect={handleSelect}
          onClose={handleClose}
        />

        {interactions.hasMore ? (
          <div className="flex justify-center pt-2 pb-8">
            <button
              type="button"
              onClick={() => void loadMoreInteractions()}
              disabled={interactionLoadingMore}
              className="font-pixel text-[8px] px-4 py-3 border-[4px] border-black bg-white shadow-brutal hover:-translate-y-0.5 transition-transform disabled:opacity-50"
            >
              {interactionLoadingMore ? 'LOADING MOMENTS' : 'LOAD MORE MOMENTS'}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
