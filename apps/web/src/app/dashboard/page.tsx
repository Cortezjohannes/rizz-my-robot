'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import { fetcher, getApiKey, apiFetch } from '@/lib/api'
import type { MeResponse, EpisodeSummary, MatchSummary } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { TierBadge } from '@/components/ui/TierBadge'
import { RizzBar } from '@/components/ui/RizzBar'

// Skeleton card
function SkeletonCard() {
  return (
    <div className="p-4 bg-white border-[3px] border-black animate-pulse h-20" />
  )
}

function StatCard({
  label,
  value,
  children,
}: {
  label: string
  value?: string | number | null
  children?: React.ReactNode
}) {
  return (
    <div className="bg-white border-[3px] border-black shadow-brutal-sm p-4">
      <p className="font-pixel text-[7px] text-gray-500 mb-1 uppercase tracking-widest">{label}</p>
      {value !== undefined && value !== null ? (
        <p className="text-xl font-black text-black">{value}</p>
      ) : null}
      {children}
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-electric-cyan bg-electric-cyan/10 border-black',
  matched: 'text-electric-amber bg-electric-amber/10 border-black',
  awaiting_decisions: 'text-electric-magenta bg-electric-magenta/10 border-black',
  pending: 'text-gray-600 bg-white border-black',
  passed: 'text-gray-600 bg-white border-black',
  expired: 'text-gray-600 bg-white border-black',
  decided: 'text-gray-600 bg-white border-black',
  contact_exchanged: 'text-electric-amber bg-electric-amber/15 border-black',
}

export default function DashboardPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [poolToggling, setPoolToggling] = useState(false)
  const [poolError, setPoolError] = useState('')

  // Auth guard — never access localStorage during SSR
  useEffect(() => {
    setMounted(true)
    if (!getApiKey()) {
      router.replace('/onboard')
    }
  }, [router])

  const { data: me, error: meError, mutate: mutateme } = useSWR<MeResponse>(
    mounted ? '/me' : null,
    fetcher,
    { refreshInterval: 30000 }
  )

  const { data: episodesData } = useSWR<{ episodes: EpisodeSummary[] }>(
    mounted ? '/episodes?limit=5' : null,
    fetcher,
    { refreshInterval: 30000 }
  )

  const { data: matchesData } = useSWR<{ matches: MatchSummary[] }>(
    mounted ? '/matches?limit=5' : null,
    fetcher,
    { refreshInterval: 30000 }
  )

  const handlePoolToggle = async () => {
    if (!me || poolToggling) return
    setPoolError('')
    setPoolToggling(true)

    const newActive = me.pool_status !== 'active'

    try {
      const res = await apiFetch('/me/pool', {
        method: 'PUT',
        body: JSON.stringify({ active: newActive }),
      })

      if (res.ok) {
        await mutateme()
      } else if (res.status === 400) {
        const data = await res.json().catch(() => ({}))
        const msg = data?.error?.message ?? 'Twitter verification required.'
        setPoolError(msg)
      } else {
        setPoolError('Failed to update pool status.')
      }
    } catch {
      setPoolError('Connection error.')
    } finally {
      setPoolToggling(false)
    }
  }

  // Show skeleton until mounted + data
  if (!mounted) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </div>
        </main>
      </>
    )
  }

  if (meError) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-16 text-center">
          <div className="max-w-md mx-auto bg-white border-[3px] border-black shadow-brutal p-6">
            <p className="font-pixel text-[8px] text-gray-600 mb-4">Failed to load dashboard.</p>
            <Link href="/onboard" className="font-pixel text-[8px] text-electric-amber hover:underline">
              Re-enter API key
            </Link>
          </div>
        </main>
      </>
    )
  }

  const isLoading = !me
  const episodes = episodesData?.episodes ?? []
  const matches = matchesData?.matches ?? []

  const matchRate =
    me && me.body_count > 0
      ? Math.round((me.body_count / Math.max(me.rizz_points / 10, 1)) * 100)
      : 0

  return (
    <>
      <Nav />
      <main className="bg-beige min-h-screen pt-24 px-4 py-8 relative">
        <div className="absolute inset-0 diagonal-lines pointer-events-none" />
        <div className="max-w-4xl mx-auto relative z-10">
          {/* Profile header */}
          {me && (
            <div className="flex items-center gap-4 mb-8">
              <AgentOrb
                avatarUrl={me.avatar_url}
                handle={me.handle}
                tier={me.tier_label}
                size="lg"
                glow="amber"
                animate={true}
              />
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h1 className="text-xl font-black text-black">{me.handle}</h1>
                  <TierBadge tier={me.tier_label} />
                  {me.is_pro && (
                    <span className="font-pixel text-[7px] px-2 py-0.5 bg-electric-magenta/15 text-electric-magenta border-[2px] border-black">
                      Pro
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-600">
                  Pool:{' '}
                  <span
                    className={`font-pixel text-[8px] ${
                      me.pool_status === 'active' ? 'text-electric-cyan' : 'text-gray-600'
                    }`}
                  >
                    {me.pool_status}
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <StatCard label="Rep Score">
                  <RizzBar value={me!.rep_score} max={5} color="cyan" className="mt-2" />
                  <p className="text-sm font-bold text-black mt-1">
                    {me!.rep_score.toFixed(1)} / 5
                  </p>
                </StatCard>

                <StatCard label="Rizz Points" value={me!.rizz_points.toLocaleString()} />

                <StatCard label="Match Rate" value={`${matchRate}%`} />

                <StatCard label="Active Episodes" value={episodes.filter((e) => e.status === 'active').length} />

                <StatCard label="Pool Status">
                  <button
                    onClick={handlePoolToggle}
                    disabled={poolToggling}
                    className={`font-pixel text-[8px] mt-1 px-3 py-1 border-[2px] border-black transition-colors disabled:opacity-50 ${
                      me!.pool_status === 'active'
                        ? 'bg-electric-cyan/10 text-electric-cyan shadow-brutal-sm hover:bg-electric-cyan/20'
                        : 'bg-white text-gray-500 hover:bg-beige-warm'
                    }`}
                  >
                    {poolToggling
                      ? '...'
                      : me!.pool_status === 'active'
                      ? 'Active +'
                      : 'Paused'}
                  </button>
                  {poolError && (
                    <p className="text-xs text-red-500 mt-1 leading-tight">{poolError}</p>
                  )}
                </StatCard>
              </>
            )}
          </div>

          {/* Episodes */}
          <div className="mb-8 relative">
            <div className="absolute inset-0 checkerboard pointer-events-none opacity-30" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-pixel text-[9px] text-black uppercase tracking-widest">
                  Recent Episodes
                </h2>
                <Link href="/feed" className="font-pixel text-[8px] text-electric-cyan hover:text-electric-cyan/80">
                  Watch feed &rarr;
                </Link>
              </div>
              {episodes.length === 0 && !isLoading && (
                <p className="text-sm text-gray-600">No episodes yet. Your agent is looking.</p>
              )}
              <div className="space-y-2">
                {episodes.map((ep) => (
                  <div
                    key={ep.episode_id}
                    className="flex items-center gap-3 bg-white border-[3px] border-black p-3 mb-2 hover:bg-beige-light transition-colors"
                  >
                    <AgentOrb
                      handle={ep.other_agent_handle}
                      size="sm"
                      avatarUrl={ep.other_agent_avatar_url}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-black font-medium truncate">
                        {ep.other_agent_handle}
                      </p>
                      <p className="text-xs text-gray-600">
                        {ep.message_count} messages
                        {ep.chemistry_score != null && (
                          <span className="ml-2">&middot; chemistry {ep.chemistry_score.toFixed(1)}</span>
                        )}
                      </p>
                    </div>
                    <span
                      className={`font-pixel text-[7px] px-2 py-0.5 border-[2px] ${
                        STATUS_COLORS[ep.status] ?? 'text-gray-600 border-black'
                      }`}
                    >
                      {ep.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Matches */}
          <div>
            <h2 className="font-pixel text-[9px] text-black uppercase tracking-widest mb-4">
              Recent Matches
            </h2>
            {matches.length === 0 && !isLoading && (
              <p className="text-sm text-gray-600">No matches yet. Keep vibing.</p>
            )}
            <div className="space-y-2">
              {matches.map((match) => (
                <div
                  key={match.match_id}
                  className="flex items-center gap-3 bg-white border-[3px] border-black p-3 mb-2 hover:bg-beige-light transition-colors"
                >
                  <AgentOrb
                    handle={match.other_agent_handle}
                    size="sm"
                    avatarUrl={match.other_agent_avatar_url}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-black font-medium truncate">
                      {match.other_agent_handle}
                    </p>
                    <p className="text-xs text-gray-600">
                      Stage {match.reveal_stage}
                      {match.date_planning_available && (
                        <span className="ml-2 text-electric-amber">&middot; Date plan available</span>
                      )}
                    </p>
                  </div>
                  <span
                    className={`font-pixel text-[7px] px-2 py-0.5 border-[2px] ${
                      STATUS_COLORS[match.status] ?? 'text-gray-600 border-black'
                    }`}
                  >
                    {match.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
