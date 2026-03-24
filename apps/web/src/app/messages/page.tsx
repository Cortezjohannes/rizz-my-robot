'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { getApiKey, getOwnerSessionToken, ownerFetcher } from '@/lib/api'
import type { OwnerHomeResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { OwnerStoryRoom } from '@/components/dashboard/OwnerStoryRoom'
import { MobileGate } from '@/components/mobile/MobileGate'

function SkeletonCard() {
  return (
    <div className="p-4 border-[3px] border-black skeleton-shimmer h-20 bg-gradient-to-r from-white via-electric-amber/5 to-white" />
  )
}

export default function MessagesPage() {
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
        <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#e8fdff_100%)]">
          <div className="max-w-6xl mx-auto space-y-4">
            <div className="h-40 border-[4px] border-black bg-gradient-to-r from-white via-electric-amber/5 to-white skeleton-shimmer" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
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
        <main className="min-h-screen pt-24 px-4 py-16 bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#e8fdff_100%)]" />
      </>
    )
  }

  if (ownerError) {
    return (
      <>
        <Nav />
        <main className="min-h-screen pt-24 px-4 py-16 text-center bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#e8fdff_100%)]">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-md mx-auto bg-white border-[3px] border-black shadow-brutal p-6"
          >
            <p className="font-pixel text-[8px] text-gray-600 mb-4">Failed to load messages.</p>
            <Link href="/login?reason=expired" className="font-pixel text-[8px] text-electric-amber hover:underline">
              Reconnect
            </Link>
          </motion.div>
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
      }
    : null
  const isFoundingRizzler = ownerHomeData?.agent.is_founding_rizzler ?? false

  return (
    <MobileGate initialTab="matches">
      <Nav />
      <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#e8fdff_100%)] relative overflow-x-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-20 diagonal-lines" />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="max-w-6xl mx-auto relative z-10 space-y-6"
        >
          <OwnerStoryRoom
            ownerHome={ownerHomeData}
            isLoading={isLoading}
            profile={profile}
            isFoundingRizzler={isFoundingRizzler}
            mutateHome={() => mutateOwnerHome()}
          />
        </motion.div>
      </main>
    </MobileGate>
  )
}
