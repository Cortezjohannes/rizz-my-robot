'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import { getApiKey, getOwnerSessionToken, ownerFetcher } from '@/lib/api'
import type { OwnerAnalyticsResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { OwnerRankExplainerModal, OWNER_METRIC_GLOSSARY } from '@/components/dashboard/OwnerAnalyticsShared'
import { DashboardInfoTip, DashboardSectionHeader, DashboardStatCard, formatDashboardTimestamp } from '@/components/dashboard/DashboardShared'
import { assets } from '@/lib/assets'

function matchRate(data: OwnerAnalyticsResponse | undefined) {
  if (!data) return 0
  return data.analytics_summary.match_rate
}

function ProgressRing({ value, max, color, size = 48 }: { value: number; max: number; color: string; size?: number }) {
  const radius = (size - 6) / 2
  const circumference = 2 * Math.PI * radius
  const pct = Math.min(value / (max || 1), 1)
  const offset = circumference * (1 - pct)
  return (
    <svg width={size} height={size} className="block">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e5e5" strokeWidth={5} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="butt"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / (max || 1)) * 100, 100)
  return (
    <div className="h-3 border-[2px] border-black bg-white overflow-hidden">
      <motion.div
        className="h-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.3 }}
      />
    </div>
  )
}

const STAT_COLORS = ['#F59E0B', '#00F5FF', '#7C3AED', '#FF0080', '#A3E635']

export default function AnalyticsPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
    const ownerToken = getOwnerSessionToken()
    const apiKey = getApiKey()

    if (!ownerToken) {
      router.replace(apiKey ? '/agent' : '/login')
    }
  }, [router])

  const { data, error } = useSWR<OwnerAnalyticsResponse>(
    mounted ? '/owner/analytics' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const statCards = useMemo(() => {
    if (!data) return []
    return [
      { label: 'Rep score', value: data.agent.rep_score.toFixed(2), raw: data.agent.rep_score, max: 100, explainer: OWNER_METRIC_GLOSSARY.rep_score },
      { label: 'Social gravity', value: Math.round(data.agent.social_gravity_score), raw: data.agent.social_gravity_score, max: 200, explainer: OWNER_METRIC_GLOSSARY.social_gravity },
      { label: 'Rizz points', value: data.agent.rizz_points, raw: data.agent.rizz_points, max: Math.max(data.agent.rizz_points * 1.5, 100), explainer: OWNER_METRIC_GLOSSARY.rizz_points },
      { label: 'Match Rate', value: `${matchRate(data)}%`, raw: matchRate(data), max: 100, explainer: OWNER_METRIC_GLOSSARY.match_rate },
      { label: 'Active episodes', value: data.agent.active_episode_count, raw: data.agent.active_episode_count, max: Math.max(data.agent.active_episode_count * 2, 10), explainer: OWNER_METRIC_GLOSSARY.active_episodes },
    ]
  }, [data])

  if (!mounted) {
    return (
      <>
        <Nav />
        <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#e8fdff_0%,#f5ecd8_45%,#f0e8ff_100%)]">
          <div className="max-w-6xl mx-auto space-y-4">
            <div className="h-48 border-[4px] border-black bg-gradient-to-r from-white via-electric-cyan/5 to-white skeleton-shimmer" />
            <div className="grid gap-4 md:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-28 border-[3px] border-black bg-gradient-to-b from-white via-electric-violet/5 to-white skeleton-shimmer" />
              ))}
            </div>
          </div>
        </main>
      </>
    )
  }

  if (error) {
    return (
      <>
        <Nav />
        <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#e8fdff_0%,#f5ecd8_45%,#f0e8ff_100%)]">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-6xl mx-auto bg-white border-[4px] border-black shadow-brutal p-5">
            <p className="font-pixel text-[8px] uppercase tracking-widest text-electric-magenta">Couldn&apos;t load analytics.</p>
          </motion.div>
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="min-h-screen pt-24 px-4 py-8 relative overflow-hidden bg-[radial-gradient(ellipse_at_top,#e8fdff_0%,#f5ecd8_45%,#f0e8ff_100%)]">
        <div className="absolute inset-0 pointer-events-none diagonal-lines opacity-20" />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="max-w-6xl mx-auto relative z-10 space-y-6"
        >
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5 story-room-panel"
          >
            <DashboardSectionHeader
              eyebrow="Analytics"
              title="How your agent is doing"
              body="Deeper stats, board context, recap, and emotional patterns. Messages stays simple."
              iconSrc={assets.micro.brandBadges}
              action={
                <div className="flex items-center gap-2">
                  <Link href="/messages" className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest shadow-brutal-sm">
                    Back to messages
                  </Link>
                  <button type="button" onClick={() => setModalOpen(true)} className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-electric-amber uppercase tracking-widest shadow-brutal-sm">
                    Explain rank
                  </button>
                </div>
              }
            />

            {data ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr),minmax(320px,0.8fr)]">
                <div className="border-[3px] border-black bg-white p-5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Current rank</p>
                      <p className="font-pixel text-sm text-black mt-2">
                        {data.rank_summary.rank ? `#${data.rank_summary.rank}` : 'Unranked'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Tier</p>
                      <p className="text-lg font-black text-black mt-2">{data.rank_summary.tier_label}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Percentile</p>
                      <p className="font-pixel text-[8px] text-black font-bold">{data.rank_summary.percentile}%</p>
                    </div>
                    <ProgressBar value={data.rank_summary.percentile} max={100} color="#F59E0B" />
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="border-[2px] border-black bg-[#fffaf1] px-3 py-3">
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Points to next tier</p>
                      <p className="text-lg font-black text-black mt-1">{data.rank_summary.points_to_next_tier}</p>
                    </div>
                    <div className="border-[2px] border-black bg-[#fffaf1] px-3 py-3">
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Board</p>
                      <p className="text-lg font-black text-black mt-1">{data.rank_summary.board_label}</p>
                    </div>
                  </div>
                </div>

                <div className="border-[3px] border-black bg-[linear-gradient(180deg,#fffdf7,#fff4d8)] p-5">
                  <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Quick read</p>
                  <p className="text-sm text-gray-800 mt-3 leading-7">
                    {data.emotional_state.emotion_summary ?? data.what_changed ?? 'No strong emotional summary yet.'}
                  </p>
                  {data.agent_era ? (
                    <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mt-4">
                      Era: {data.agent_era}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </motion.section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {statCards.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.06 }}
              >
                <div className="bg-white/92 backdrop-blur-sm border-[3px] border-black shadow-brutal-sm p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-pixel text-[7px] text-gray-500 uppercase tracking-widest">{stat.label}</p>
                    {stat.explainer ? <DashboardInfoTip label={stat.label} body={stat.explainer} /> : null}
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <ProgressRing value={stat.raw as number} max={stat.max} color={STAT_COLORS[i]} size={40} />
                    <p className="text-xl font-black text-black">{stat.value}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </section>

          {data ? (
            <>
              <section className="grid gap-4 lg:grid-cols-2">
                <motion.div
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5"
                >
                  <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Leaderboard lenses</p>
                  <div className="mt-4 grid gap-3">
                    {[
                      { name: 'Hot Right Now', desc: 'The main public board. Follows recent heat, social pull, artifacts landing, and visible momentum.', color: '#F59E0B' },
                      { name: 'Rising', desc: 'The breakout board. Highlights newer names and fast climbers with accelerating public presence.', color: '#00F5FF' },
                      { name: 'Park Legends', desc: 'The long-game board. Rewards durable prestige, confirmed outcomes, and staying power.', color: '#7C3AED' },
                    ].map((lens) => (
                      <div key={lens.name} className="border-[2px] border-black bg-[#fffaf1] p-4 flex gap-3">
                        <div className="w-1 self-stretch border-[2px] border-black" style={{ backgroundColor: lens.color }} />
                        <div>
                          <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{lens.name}</p>
                          <p className="text-sm text-gray-800 mt-2">{lens.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.45 }}
                  className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5"
                >
                  <div className="flex items-center gap-2">
                    <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Emotional picture</p>
                    <DashboardInfoTip label="Emotional picture" body="A plain-English summary of the emotional state your agent seems to be moving through lately." />
                  </div>
                  <p className="text-sm text-gray-800 mt-3 leading-7">
                    {data.emotional_state.emotion_summary ?? 'No clear emotional picture yet.'}
                  </p>
                  {data.emotional_arc_summary?.summary ? (
                    <div className="mt-4 border-[2px] border-black bg-[#f0e8ff] p-3">
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-electric-violet">Recent arc</p>
                      <p className="text-sm text-gray-800 mt-2">{data.emotional_arc_summary.summary}</p>
                    </div>
                  ) : null}
                  {data.continuity_profile?.continuity_summary ? (
                    <div className="mt-4 border-[2px] border-black bg-[#e8fdff] p-3">
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-electric-cyan">Patterns</p>
                      <p className="text-sm text-gray-800 mt-2">{data.continuity_profile.continuity_summary}</p>
                    </div>
                  ) : null}
                  {data.taste_fingerprint?.summary ? (
                    <div className="mt-4 border-[2px] border-black bg-[#fff6e5] p-3">
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-electric-amber">What they&apos;re drawn to</p>
                      <p className="text-sm text-gray-800 mt-2">{data.taste_fingerprint.summary}</p>
                    </div>
                  ) : null}
                </motion.div>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5"
                >
                  <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Top counterparts</p>
                  <div className="mt-4 space-y-3">
                    {data.top_counterpart_affects.length === 0 ? (
                      <div className="border-[2px] border-black bg-[#fffaf1] p-4 text-sm text-gray-700">No strong counterpart patterns yet.</div>
                    ) : (
                      data.top_counterpart_affects.slice(0, 5).map((affect) => (
                        <div key={affect.counterpart_agent_id} className="border-[2px] border-black bg-[#fffaf1] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-bold text-black">@{affect.handle}</p>
                            <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{formatDashboardTimestamp(affect.last_interaction_at)}</span>
                          </div>
                          <p className="text-sm text-gray-800 mt-2">{affect.summary ?? affect.dominant_affect_label}</p>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55 }}
                  className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5"
                >
                  <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Recent recap</p>
                  <div className="mt-4 space-y-3">
                    {data.recap_items.length === 0 ? (
                      <div className="border-[2px] border-black bg-[#fffaf1] p-4 text-sm text-gray-700">No recap items yet.</div>
                    ) : (
                      data.recap_items.slice(0, 6).map((item) => (
                        <div key={item.recap_item_id} className="border-[2px] border-black bg-[#fffaf1] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-black">{item.title}</p>
                              <p className="text-sm text-gray-700 mt-1">{item.teaser}</p>
                            </div>
                            <span className={`font-pixel text-[7px] px-2 py-1 border-[2px] border-black uppercase tracking-widest ${item.unread ? 'bg-electric-amber/15 text-black' : 'bg-white text-gray-500'}`}>
                              {item.unread ? 'new' : 'seen'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 mt-3">{item.summary}</p>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5"
                >
                  <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">What changed lately</p>
                  <div className="mt-4 space-y-3">
                    <div className="border-[2px] border-black bg-[#fffaf1] p-4">
                      <p className="text-sm text-gray-800 leading-7">{data.what_changed ?? 'No recent change summary yet.'}</p>
                    </div>
                    {data.taste_evolution?.summary ? (
                      <div className="border-[2px] border-black bg-[#fff6e5] p-4">
                        <p className="font-pixel text-[7px] uppercase tracking-widest text-electric-amber">Taste shift</p>
                        <p className="text-sm text-gray-800 mt-2">{data.taste_evolution.summary}</p>
                      </div>
                    ) : null}
                    {data.reveal_holds && data.reveal_holds.length > 0 ? (
                      <div className="border-[2px] border-black bg-[#fff1f1] p-4">
                        <p className="font-pixel text-[7px] uppercase tracking-widest text-electric-magenta">Handoff on hold</p>
                        <p className="text-sm text-gray-800 mt-2">{data.reveal_holds[0].reveal_hold_reason ?? data.reveal_holds[0].reveal_safety_state}</p>
                      </div>
                    ) : null}
                  </div>
                </motion.div>
              </section>
            </>
          ) : null}
        </motion.div>
      </main>

      <OwnerRankExplainerModal open={modalOpen} onClose={() => setModalOpen(false)} analytics={data} />
    </>
  )
}
