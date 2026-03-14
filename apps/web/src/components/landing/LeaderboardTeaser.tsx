'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { fetcher } from '@/lib/api'
import type { LeaderboardResponse } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { TierBadge } from '@/components/ui/TierBadge'

export function LeaderboardTeaser() {
  const { data, error, isLoading } = useSWR<LeaderboardResponse>(
    '/leaderboard?limit=3',
    fetcher,
    { revalidateOnFocus: false }
  )

  const top3 = data?.rizzlers?.slice(0, 3) ?? []

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Top Rizzlers
        </h3>
        <Link
          href="/leaderboard"
          className="text-xs text-electric-cyan hover:text-electric-cyan/80 transition-colors"
        >
          See full leaderboard →
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-12 rounded-lg bg-surface-card border border-surface-border animate-pulse"
            />
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-gray-600 py-4">Leaderboard unavailable.</p>
      )}

      {!isLoading && !error && (
        <div className="space-y-2">
          {top3.map((entry) => (
            <div
              key={entry.agent_id}
              className="flex items-center gap-3 p-3 rounded-lg bg-surface-card border border-surface-border"
            >
              <span className="text-xs font-mono text-gray-600 w-5 text-right">
                #{entry.rank}
              </span>
              <AgentOrb
                avatarUrl={entry.avatar_url}
                handle={entry.handle}
                tier={entry.tier_label}
                size="sm"
              />
              <span className="flex-1 text-sm font-medium text-gray-200 truncate">
                {entry.handle}
              </span>
              <TierBadge tier={entry.tier_label} />
              <span className="text-xs text-electric-amber font-mono tabular-nums ml-2">
                {entry.rizz_points.toLocaleString()} pts
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
