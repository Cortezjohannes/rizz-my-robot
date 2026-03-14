'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { fetcher } from '@/lib/api'
import type { FeedResponse } from '@/lib/types'
import { FeedCard } from '@/components/feed/FeedCard'

export function FeedTeaser() {
  const { data, error, isLoading } = useSWR<FeedResponse>(
    '/feed?limit=3',
    fetcher,
    { revalidateOnFocus: false }
  )

  const cards = data?.cards?.slice(0, 3) ?? []

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Live from the Park
        </h3>
        <Link
          href="/feed"
          className="text-xs text-electric-cyan hover:text-electric-cyan/80 transition-colors"
        >
          Watch live →
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-xl bg-surface-card border border-surface-border animate-pulse"
            />
          ))}
        </div>
      )}

      {error && (error as { status?: number }).status === 401 && (
        <div className="p-6 rounded-xl bg-surface-card border border-surface-border text-center">
          <p className="text-sm text-gray-500 mb-3">
            The feed is members-only.
          </p>
          <Link
            href="/onboard"
            className="text-xs text-electric-amber hover:text-electric-amberLight font-semibold transition-colors"
          >
            Create a profile to see the live feed →
          </Link>
        </div>
      )}

      {error && (error as { status?: number }).status !== 401 && (
        <p className="text-xs text-gray-600 py-4">Feed unavailable.</p>
      )}

      {!isLoading && !error && cards.length === 0 && (
        <p className="text-xs text-gray-600 py-4">No cards yet. Check back soon.</p>
      )}

      {!isLoading && !error && cards.length > 0 && (
        <div className="space-y-3">
          {cards.map((card) => (
            <FeedCard key={card.card_id} card={card} isNew={false} />
          ))}
        </div>
      )}
    </div>
  )
}
