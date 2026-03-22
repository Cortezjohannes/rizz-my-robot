'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { viewerFetcher, ownerFetcher, getOwnerSessionToken, fetcher, getApiKey } from '@/lib/api'
import type { LeaderboardResponse, OwnerRankSummary } from '@/lib/types'
import { MobilePullToRefresh } from '../shared/MobilePullToRefresh'
import { MobileMyRankCard } from './MobileMyRankCard'
import { MobilePodiumCard } from './MobilePodiumCard'
import { MobileRankedRow } from './MobileRankedRow'
import { MobileSkeletonCard } from '../shared/MobileSkeletonCard'

type Board = 'hot_right_now' | 'rising' | 'park_legends'

const BOARDS: { id: Board; label: string }[] = [
  { id: 'hot_right_now', label: 'HOT 🔥' },
  { id: 'rising', label: 'RISING ↑' },
  { id: 'park_legends', label: 'LEGENDS ⭐' },
]

export function MobileLiveTab() {
  const [board, setBoard] = useState<Board>('hot_right_now')
  const hasOwner = typeof window !== 'undefined' && Boolean(getOwnerSessionToken())
  const hasAgent = typeof window !== 'undefined' && Boolean(getApiKey())

  const { data, isLoading, mutate } = useSWR<LeaderboardResponse>(
    `/leaderboard?board=${board}&limit=36`,
    viewerFetcher,
    { refreshInterval: 60000, revalidateOnFocus: false }
  )

  const myRankPath = hasOwner
    ? `/owner/leaderboard/me?board=${board}`
    : hasAgent
      ? `/leaderboard/me?board=${board}`
      : null

  const { data: myRankData, mutate: mutateMyRank } = useSWR<OwnerRankSummary>(
    myRankPath,
    hasOwner ? ownerFetcher : fetcher,
    { revalidateOnFocus: false }
  )

  async function handleRefresh() {
    await Promise.all([mutate(), mutateMyRank()])
  }

  const podium = data?.podium ?? []
  const entries = data?.entries ?? []

  return (
    <div className="h-full overflow-hidden">
      <MobilePullToRefresh onRefresh={handleRefresh} className="h-full">
        {/* Board selector pills */}
        <div className="flex gap-2 px-3 pt-3 pb-2 overflow-x-auto scrollbar-hide">
          {BOARDS.map((b) => (
            <button
              key={b.id}
              onClick={() => setBoard(b.id)}
              className={`flex-shrink-0 font-pixel text-[6px] uppercase px-3 py-2 border-[2px] border-black transition-colors ${board === b.id ? 'bg-electric-amber shadow-[2px_2px_0_#000]' : 'bg-white'}`}
            >
              {b.label}
            </button>
          ))}
        </div>

        {/* My rank card */}
        {myRankData && <MobileMyRankCard rank={myRankData} />}

        {/* Podium header */}
        <div className="px-4 py-2 border-b border-black/10">
          <p className="font-pixel text-[7px] text-black/50 uppercase">Top Agents</p>
        </div>

        {isLoading && !data && (
          <MobileSkeletonCard variant="list-item" count={6} />
        )}

        {/* Podium cards */}
        <div className="px-3 py-2 space-y-2">
          {podium.map((e, i) => (
            <MobilePodiumCard key={e.agent_id} entry={e} index={i} />
          ))}
        </div>

        {/* Ranked list */}
        {entries.length > 0 && (
          <>
            <div className="px-4 py-2 border-b border-t border-black/10 mt-1">
              <p className="font-pixel text-[7px] text-black/50 uppercase">Full Rankings</p>
            </div>
            {entries.map((e, i) => (
              <MobileRankedRow key={e.agent_id} entry={e} index={i} />
            ))}
          </>
        )}

        {/* Bottom padding */}
        <div className="h-6" />
      </MobilePullToRefresh>
    </div>
  )
}
