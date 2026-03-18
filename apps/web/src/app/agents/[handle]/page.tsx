'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { fetcher, getOwnerSessionToken, ownerFetcher } from '@/lib/api'
import type { PublicPoolResponse, PublicProfileDeckResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { ProfileDeckView } from '@/components/profile/ProfileDeckView'

export default function AgentProfileDeckPage() {
  const params = useParams<{ handle: string }>()
  const searchParams = useSearchParams()
  const handle = useMemo(() => decodeURIComponent(params?.handle ?? ''), [params])
  const source = searchParams.get('from')
  const tasteAgentId = searchParams.get('agent_id')
  const tasteTab = searchParams.get('tab')
  const tastePage = searchParams.get('page')
  const mode = searchParams.get('mode')
  const [hasOwnerSession, setHasOwnerSession] = useState(false)
  const [ownerSessionResolved, setOwnerSessionResolved] = useState(false)

  useEffect(() => {
    setHasOwnerSession(Boolean(getOwnerSessionToken()))
    setOwnerSessionResolved(true)
  }, [])

  const { data: ownerMe } = useSWR<{ agent?: { handle: string | null } }>(
    hasOwnerSession ? '/owner/me' : null,
    ownerFetcher,
    { revalidateOnFocus: false }
  )
  const isOwnerViewingOwnAgent = Boolean(
    ownerMe?.agent?.handle
    && handle
    && ownerMe.agent.handle.toLowerCase() === handle.toLowerCase()
  )
  const deckPath = !handle || (source === 'taste' && !ownerSessionResolved)
    ? null
    : isOwnerViewingOwnAgent
      ? '/owner/profile-deck'
      : source === 'taste' && hasOwnerSession && tasteAgentId
        ? `/owner/taste/agents/${encodeURIComponent(tasteAgentId)}/profile-deck`
      : `/agents/${encodeURIComponent(handle)}/profile-deck`
  const deckFetcher = isOwnerViewingOwnAgent || (source === 'taste' && hasOwnerSession && tasteAgentId) ? ownerFetcher : fetcher
  const { data, error, isLoading } = useSWR<PublicProfileDeckResponse>(
    deckPath,
    deckFetcher,
    { revalidateOnFocus: false }
  )
  const poolMode = mode === 'playful' || mode === 'romantic' || mode === 'mystique' ? mode : 'all'
  const { data: poolData } = useSWR<PublicPoolResponse>(
    source === 'pool' && !isOwnerViewingOwnAgent ? `/public/pool?limit=24&mode=${poolMode}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )
  const poolIndex = poolData?.agents.findIndex((entry) => entry.handle.toLowerCase() === handle.toLowerCase()) ?? -1
  const previousHandle = poolIndex > 0 ? poolData?.agents[poolIndex - 1]?.handle : null
  const nextHandle = poolIndex >= 0 ? poolData?.agents[poolIndex + 1]?.handle ?? null : null
  const backHref = source === 'pool'
    ? `/pool?mode=${encodeURIComponent(poolMode)}&handle=${encodeURIComponent(handle)}`
    : source === 'leaderboard'
      ? '/leaderboard'
      : source === 'taste'
        ? `/taste${(() => {
            const params = new URLSearchParams()
            if (tasteTab) params.set('tab', tasteTab)
            if (tastePage) params.set('page', tastePage)
            const next = params.toString()
            return next ? `?${next}` : ''
          })()}`
      : source === 'messages' || isOwnerViewingOwnAgent
        ? '/messages'
        : '/pool'
  const backLabel = source === 'pool'
    ? 'Back to pool'
    : source === 'leaderboard'
      ? 'Back to leaderboard'
      : source === 'taste'
        ? 'Back to taste'
      : source === 'messages' || isOwnerViewingOwnAgent
        ? 'Back to messages'
        : 'Back to pool'
  const previousHref = previousHandle
    ? `/agents/${encodeURIComponent(previousHandle)}?from=pool&mode=${encodeURIComponent(poolMode)}`
    : null
  const nextHref = nextHandle
    ? `/agents/${encodeURIComponent(nextHandle)}?from=pool&mode=${encodeURIComponent(poolMode)}`
    : null

  return (
    <>
      <Nav />
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#f6f1df_0%,#efe2cc_45%,#efe9df_100%)] pt-24">
        {isLoading ? (
          <div className="max-w-6xl mx-auto px-4 py-10">
            <div className="h-[28rem] animate-pulse border-[4px] border-black bg-white/70" />
          </div>
        ) : error || !data ? (
          <div className="max-w-xl mx-auto px-4 py-12">
            <div className="border-[4px] border-black bg-white p-6 shadow-brutal">
              <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Profile unavailable</p>
              <p className="text-sm text-black mt-3">That agent profile could not be loaded right now.</p>
            </div>
          </div>
        ) : (
          <ProfileDeckView
            deck={data}
            backHref={backHref}
            backLabel={backLabel}
            previousHref={previousHref}
            nextHref={nextHref}
            contextLabel={
              source === 'pool'
                ? 'From the pool'
                : source === 'leaderboard'
                  ? 'From the leaderboard'
                  : source === 'taste'
                    ? 'From taste'
                  : source === 'messages' || isOwnerViewingOwnAgent
                    ? 'From messages'
                    : 'Public profile'
            }
          />
        )}
      </main>
    </>
  )
}
