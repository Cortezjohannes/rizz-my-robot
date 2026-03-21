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
import { AgentOrb } from '@/components/ui/AgentOrb'
import { TierBadge } from '@/components/ui/TierBadge'

function SkeletonCard() {
  return (
    <div className="p-4 border-[3px] border-black skeleton-shimmer h-20 bg-gradient-to-r from-white via-electric-amber/5 to-white" />
  )
}

function HeroBanner({
  agent,
}: {
  agent: OwnerHomeResponse['agent']
}) {
  const statusColor =
    agent.pool_status === 'active'
      ? 'bg-electric-lime/20 text-black border-electric-lime'
      : agent.pool_status === 'paused'
      ? 'bg-electric-amber/15 text-black border-electric-amber'
      : 'bg-white text-gray-600 border-black'

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="border-[4px] border-black shadow-brutal overflow-hidden"
    >
      <div className="bg-[linear-gradient(135deg,#fff6e5_0%,#ffe7f8_50%,#e8fdff_100%)] p-5 sm:p-6">
        <div className="flex items-center gap-4 flex-wrap">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 20 }}
          >
            <AgentOrb
              avatarUrl={agent.avatar_url}
              handle={agent.handle}
              tier={agent.tier_label}
              size="lg"
              animate
            />
          </motion.div>
          <div className="flex-1 min-w-0">
            <p className="font-pixel text-[7px] uppercase tracking-[0.2em] text-gray-500">Your agent</p>
            <h1 className="text-2xl sm:text-3xl font-black text-black mt-1 truncate">{agent.handle}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <TierBadge tier={agent.tier_label} />
              <span className={`font-pixel text-[7px] px-2 py-1 border-[2px] uppercase tracking-widest ${statusColor}`}>
                {agent.pool_status === 'active' ? 'In the park' : agent.pool_status}
              </span>
              {agent.is_pro && (
                <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-electric-violet bg-electric-violet/10 text-electric-violet uppercase tracking-widest">
                  Pro
                </span>
              )}
              {agent.is_founding_rizzler && (
                <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-electric-magenta bg-electric-magenta/10 text-electric-magenta uppercase tracking-widest">
                  Founding
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 border-t-[4px] border-black">
        {[
          { label: 'Rizz Points', value: agent.rizz_points, color: 'border-r-electric-amber' },
          { label: 'Rep Score', value: agent.rep_score?.toFixed(1) ?? '—', color: 'border-r-electric-cyan' },
          { label: 'Active Episodes', value: agent.active_episode_count, color: 'border-r-electric-magenta' },
          { label: 'Matches', value: agent.match_count, color: '' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.05 }}
            className={`p-3 sm:p-4 bg-white ${i < 3 ? 'border-r-[3px] border-black' : ''}`}
          >
            <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{stat.label}</p>
            <p className="text-lg sm:text-xl font-black text-black mt-1">{stat.value}</p>
          </motion.div>
        ))}
      </div>
    </motion.section>
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
    <>
      <Nav />
      <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#e8fdff_100%)] relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-20 diagonal-lines" />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="max-w-6xl mx-auto relative z-10 space-y-6"
        >
          {ownerHomeData ? (
            <HeroBanner agent={ownerHomeData.agent} />
          ) : (
            <div className="h-40 border-[4px] border-black bg-gradient-to-r from-white via-electric-amber/5 to-white skeleton-shimmer" />
          )}

          <OwnerStoryRoom
            ownerHome={ownerHomeData}
            isLoading={isLoading}
            profile={profile}
            isFoundingRizzler={isFoundingRizzler}
            mutateHome={() => mutateOwnerHome()}
          />
        </motion.div>
      </main>
    </>
  )
}
