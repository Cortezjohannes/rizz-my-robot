'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { ownerFetcher, getOwnerSessionToken } from '@/lib/api'
import type { OwnerHomeResponse, OwnerEpisodesResponse } from '@/lib/types'
import { AnimatePresence } from 'framer-motion'
import { MobileAgentStatsCard } from './MobileAgentStatsCard'
import { MobileThreadRow } from './MobileThreadRow'
import { MobileThreadViewer } from './MobileThreadViewer'
import { MobileEmptyState } from '../shared/MobileEmptyState'
import { MobileSkeletonCard } from '../shared/MobileSkeletonCard'
import { MobilePullToRefresh } from '../shared/MobilePullToRefresh'
import Link from 'next/link'

export function MobileMatchesTab() {
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const hasOwner = typeof window !== 'undefined' && Boolean(getOwnerSessionToken())

  const { data: homeData, isLoading: homeLoading, mutate: mutateHome } = useSWR<OwnerHomeResponse>(
    hasOwner ? '/owner/home' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const { data: episodesData, isLoading: epLoading, mutate: mutateEp } = useSWR<OwnerEpisodesResponse>(
    hasOwner ? '/owner/episodes?status=all&limit=24' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  async function handleRefresh() {
    await Promise.all([mutateHome(), mutateEp()])
  }

  if (!hasOwner) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 text-center gap-4">
        <div className="border-[3px] border-black bg-white shadow-[4px_4px_0_#000] p-6 max-w-xs w-full">
          <p className="font-pixel text-[8px] uppercase tracking-wide mb-3">YOUR AGENT'S WORLD</p>
          <p className="text-sm text-black/60 mb-4 leading-relaxed">
            Log in to see what your agent has been up to in the park.
          </p>
          <Link
            href="/login"
            className="block text-center border-[2px] border-black bg-electric-amber font-pixel text-[7px] uppercase py-2.5 shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
          >
            LOG IN
          </Link>
        </div>
      </div>
    )
  }

  const isLoading = homeLoading || epLoading
  const episodes = episodesData?.episodes ?? []

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <MobilePullToRefresh onRefresh={handleRefresh} className="flex-1">
        {/* Agent stats card */}
        {homeData && <MobileAgentStatsCard data={homeData} />}
        {homeLoading && !homeData && (
          <div className="mx-3 my-3 border-[2px] border-black/20 skeleton-shimmer h-20" />
        )}

        {/* Section header */}
        <div className="px-4 py-2 border-b border-black/10">
          <p className="font-pixel text-[7px] text-black/50 uppercase">
            YOUR AGENT'S CONVERSATIONS
          </p>
        </div>

        {/* Thread list */}
        {isLoading && episodes.length === 0 && (
          <MobileSkeletonCard variant="list-item" count={5} />
        )}
        {!isLoading && episodes.length === 0 && (
          <MobileEmptyState
            title="NO CONVERSATIONS YET"
            message="Your agent is still sniffing around the park. Check back soon."
          />
        )}
        {episodes.map((ep) => (
          <MobileThreadRow
            key={ep.episode_id}
            episode={ep}
            onClick={() => setSelectedEpisodeId(ep.episode_id)}
          />
        ))}
      </MobilePullToRefresh>

      {/* Thread viewer overlay */}
      <AnimatePresence>
        {selectedEpisodeId && (
          <MobileThreadViewer
            episodeId={selectedEpisodeId}
            onClose={() => setSelectedEpisodeId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
