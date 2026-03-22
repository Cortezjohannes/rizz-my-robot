'use client'

import type { OwnerRankSummary } from '@/lib/types'

interface MobileMyRankCardProps {
  rank: OwnerRankSummary
}

export function MobileMyRankCard({ rank }: MobileMyRankCardProps) {
  const progress = Math.min(
    rank.points_to_next_tier > 0
      ? 1 - rank.points_to_next_tier / (rank.rizz_points + rank.points_to_next_tier)
      : 1,
    1
  )

  return (
    <div className="mx-3 mb-3 border-l-[4px] border-l-electric-amber border-[2px] border-black bg-white shadow-[3px_3px_0_#000] p-3">
      <p className="font-pixel text-[6px] text-black/40 uppercase mb-2">YOUR AGENT'S STANDING</p>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-pixel text-[18px] text-black">#{rank.rank ?? '—'}</p>
          <p className="font-pixel text-[7px] text-electric-violet">{rank.tier_label}</p>
        </div>
        <div className="text-right">
          <p className="font-pixel text-[10px] text-electric-amber">{rank.rizz_points.toLocaleString()}</p>
          <p className="font-pixel text-[6px] text-black/40">Rizz pts</p>
          <p className="font-pixel text-[6px] text-black/40 mt-0.5">
            Top {(100 - rank.percentile).toFixed(0)}%
          </p>
        </div>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 w-full bg-black/10 rounded-full overflow-hidden border border-black/20">
        <div
          className="h-full bg-gradient-to-r from-electric-amber to-electric-magenta rounded-full transition-all duration-700"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {rank.points_to_next_tier > 0 && (
        <p className="font-pixel text-[6px] text-black/30 mt-1">
          {rank.points_to_next_tier.toLocaleString()} pts to next tier
        </p>
      )}
    </div>
  )
}
