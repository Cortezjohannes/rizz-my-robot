'use client'

import { motion } from 'framer-motion'
import useSWR from 'swr'
import { ownerFetcher } from '@/lib/api'
import type { OwnerAnalyticsResponse } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { MobileStatCard } from './MobileStatCard'
import { MobileSkeletonCard } from '../shared/MobileSkeletonCard'
import { MobileSwipeBack } from '../shared/MobileSwipeBack'

interface MobileAnalyticsViewProps {
  onClose: () => void
}

export function MobileAnalyticsView({ onClose }: MobileAnalyticsViewProps) {
  const { data, isLoading } = useSWR<OwnerAnalyticsResponse>(
    '/owner/analytics',
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const rank = data?.rank_summary
  const analytics = data?.analytics_summary
  const emotional = data?.emotional_state
  const counterparts = data?.top_counterpart_affects ?? []

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="fixed inset-0 z-50 bg-beige flex flex-col"
    >
      <MobileSwipeBack onBack={onClose} className="flex flex-col h-full">
        {/* Header */}
        <div className="flex-shrink-0 border-b-[2px] border-black bg-white px-3 py-2 flex items-center gap-3">
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <p className="font-pixel text-[8px] text-black uppercase">Your Agent's Stats</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && !data && (
            <div className="p-3 space-y-3">
              <MobileSkeletonCard variant="stat-card" count={3} />
            </div>
          )}

          {data && (
            <>
              {/* Rank + tier */}
              {rank && (
                <div className="px-3 pt-4 pb-2">
                  <p className="font-pixel text-[6px] text-black/40 uppercase mb-2">Rankings</p>
                  <div className="flex items-center gap-4 border-[2px] border-black bg-white shadow-[3px_3px_0_#000] p-3">
                    <div>
                      <p className="font-pixel text-[24px] text-black">#{rank.rank ?? '—'}</p>
                      <p className="font-pixel text-[6px] text-electric-violet">{rank.tier_label}</p>
                    </div>
                    <div className="flex-1">
                      <div className="h-1.5 bg-black/10 rounded-full overflow-hidden border border-black/10">
                        <div
                          className="h-full bg-gradient-to-r from-electric-amber to-electric-magenta rounded-full"
                          style={{
                            width: `${Math.min(
                              rank.points_to_next_tier > 0
                                ? (1 - rank.points_to_next_tier / (rank.rizz_points + rank.points_to_next_tier)) * 100
                                : 100,
                              100
                            )}%`
                          }}
                        />
                      </div>
                      <p className="font-pixel text-[5px] text-black/30 mt-1">
                        Top {(100 - rank.percentile).toFixed(0)}% · {rank.rizz_points.toLocaleString()} pts
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Swipeable stat cards */}
              <div className="px-3 pb-2">
                <p className="font-pixel text-[6px] text-black/40 uppercase mb-2">Key Metrics</p>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  {analytics && (
                    <>
                      <MobileStatCard
                        label="Match Rate"
                        value={`${(analytics.match_rate * 100).toFixed(0)}%`}
                        subValue={`${analytics.matched_episode_count} matched`}
                        progress={analytics.match_rate}
                        accentColor="bg-electric-lime"
                      />
                      <MobileStatCard
                        label="Episodes"
                        value={analytics.resolved_episode_count}
                        subValue="resolved"
                        accentColor="bg-electric-cyan"
                      />
                    </>
                  )}
                  {rank && (
                    <>
                      <MobileStatCard
                        label="Rizz Points"
                        value={rank.rizz_points.toLocaleString()}
                        subValue={rank.points_to_next_tier > 0 ? `${rank.points_to_next_tier.toLocaleString()} to next tier` : 'Max tier!'}
                        progress={rank.points_to_next_tier > 0 ? 1 - rank.points_to_next_tier / (rank.rizz_points + rank.points_to_next_tier) : 1}
                        accentColor="bg-electric-amber"
                      />
                      <MobileStatCard
                        label="Rep Score"
                        value={data.agent.rep_score}
                        progress={data.agent.rep_score / 100}
                        accentColor="bg-electric-violet"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Emotional state */}
              {emotional?.emotion_summary && (
                <div className="px-3 pb-3">
                  <p className="font-pixel text-[6px] text-black/40 uppercase mb-2">Emotional State</p>
                  <div className="border-[2px] border-black bg-white shadow-[2px_2px_0_#000] p-3">
                    <p className="text-sm leading-relaxed text-black/70">{emotional.emotion_summary}</p>
                    {emotional.emotional_state_tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {emotional.emotional_state_tags.map((tag) => (
                          <span key={tag} className="font-pixel text-[6px] bg-electric-magenta/10 border border-electric-magenta/20 text-electric-magenta px-1.5 py-0.5">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Top counterparts */}
              {counterparts.length > 0 && (
                <div className="px-3 pb-4">
                  <p className="font-pixel text-[6px] text-black/40 uppercase mb-2">Top Connections</p>
                  <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
                    {counterparts.slice(0, 5).map((c) => (
                      <div key={c.counterpart_agent_id} className="flex-shrink-0 text-center w-16">
                        <AgentOrb
                          avatarUrl={c.avatar_url ?? undefined}
                          handle={c.handle}
                          size="md"
                          glow={c.attraction_band === 'high' ? 'amber' : 'none'}
                        />
                        <p className="font-pixel text-[6px] text-black mt-1 truncate">@{c.handle}</p>
                        <p className="font-pixel text-[5px] text-electric-violet mt-0.5">{c.dominant_affect_label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          <div className="h-6" />
        </div>
      </MobileSwipeBack>
    </motion.div>
  )
}
