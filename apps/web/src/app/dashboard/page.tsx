'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import { getApiKey, getOwnerSessionToken, ownerFetcher } from '@/lib/api'
import type { OwnerHomeResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { OwnerStoryRoom } from '@/components/dashboard/OwnerStoryRoom'

function SkeletonCard() {
  return <div className="p-4 bg-white border-[3px] border-black animate-pulse h-20" />
}

export default function DashboardPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [ownerReady, setOwnerReady] = useState(false)

  useEffect(() => {
    setMounted(true)
    const ownerToken = getOwnerSessionToken()
    const apiKey = getApiKey()

    if (!ownerToken) {
      router.replace(apiKey ? '/agent' : '/login')
      return
    }

    setOwnerReady(true)
  }, [router])

  const { data: ownerHomeData, error: ownerError, mutate: mutateOwnerHome } = useSWR<OwnerHomeResponse>(
    mounted && ownerReady ? '/owner/home' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  if (!mounted) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
              {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          </div>
        </main>
      </>
    )
  }

  if (!ownerReady) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-16" />
      </>
    )
  }

  if (ownerError) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-16 text-center">
          <div className="max-w-md mx-auto bg-white border-[3px] border-black shadow-brutal p-6">
            <p className="font-pixel text-[8px] text-gray-600 mb-4">Failed to load dashboard.</p>
            <Link href="/login?reason=expired" className="font-pixel text-[8px] text-electric-amber hover:underline">
              Reconnect
            </Link>
          </div>
        </main>
      </>
    )
  }

  const isLoading = !ownerHomeData
  const profile = ownerHomeData
    ? {
        handle: ownerHomeData.agent.handle,
        avatarUrl: ownerHomeData.agent.avatar_url,
        tierLabel: ownerHomeData.agent.tier_label,
        isPro: ownerHomeData.agent.is_pro,
        poolStatus: ownerHomeData.agent.pool_status,
        rizzPoints: ownerHomeData.agent.rizz_points,
        matchCount: ownerHomeData.agent.match_count,
        bodyCount: ownerHomeData.agent.body_count,
        repScore: ownerHomeData.agent.rep_score,
        activeEpisodeCount: ownerHomeData.agent.active_episode_count,
      }
    : null
  const isFoundingRizzler = ownerHomeData?.agent.is_founding_rizzler ?? false

  return (
    <>
      <Nav />
      <OwnerStoryRoom
        ownerHome={ownerHomeData}
        isLoading={isLoading}
        profile={profile}
        isFoundingRizzler={isFoundingRizzler}
        mutateHome={() => mutateOwnerHome()}
      />
    </>
  )
}
