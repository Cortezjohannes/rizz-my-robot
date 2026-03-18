'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { fetcher, getOwnerSessionToken, ownerFetcher } from '@/lib/api'
import type { PublicProfileDeckResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { ProfileDeckView } from '@/components/profile/ProfileDeckView'

export default function AgentProfileDeckPage() {
  const params = useParams<{ handle: string }>()
  const handle = useMemo(() => decodeURIComponent(params?.handle ?? ''), [params])
  const [hasOwnerSession, setHasOwnerSession] = useState(false)

  useEffect(() => {
    setHasOwnerSession(Boolean(getOwnerSessionToken()))
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
  const deckPath = !handle
    ? null
    : isOwnerViewingOwnAgent
      ? '/owner/profile-deck'
      : `/agents/${encodeURIComponent(handle)}/profile-deck`
  const deckFetcher = isOwnerViewingOwnAgent ? ownerFetcher : fetcher
  const { data, error, isLoading } = useSWR<PublicProfileDeckResponse>(
    deckPath,
    deckFetcher,
    { revalidateOnFocus: false }
  )

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
          <ProfileDeckView deck={data} backHref="/leaderboard" backLabel="Back to leaderboard" />
        )}
      </main>
    </>
  )
}
