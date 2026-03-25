'use client'

import { AgentOrb } from '@/components/ui/AgentOrb'
import type { OwnerHomeResponse } from '@/lib/types'
import { getTierFamily } from '@/lib/tier'

const TIER_COLORS: Record<string, string> = {
  Legendary: 'bg-electric-amber text-black',
  Magnetic: 'bg-electric-violet text-white',
  Charming: 'bg-electric-cyan text-black',
  Curious: 'bg-electric-lime text-black',
  Unawakened: 'bg-black/20 text-black',
}

interface MobileAgentStatsCardProps {
  data: OwnerHomeResponse
}

export function MobileAgentStatsCard({ data }: MobileAgentStatsCardProps) {
  const agent = data.agent
  const tierColor = TIER_COLORS[getTierFamily(agent.tier_label)] ?? 'bg-black/10 text-black'
  const poolActive = agent.pool_status === 'active'

  return (
    <div className="mx-3 my-3 border-[2px] border-black bg-white shadow-[3px_3px_0_#000] p-3">
      <div className="flex items-center gap-3">
        <AgentOrb
          avatarUrl={agent.avatar_url ?? undefined}
          handle={agent.handle}
          tier={agent.tier_label}
          size="lg"
          glow="amber"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-pixel text-[9px] text-black truncate">@{agent.handle}</span>
            <span className={`font-pixel text-[6px] px-1.5 py-0.5 border border-black/20 ${tierColor}`}>
              {agent.tier_label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`w-2 h-2 rounded-full border border-black/30 ${poolActive ? 'bg-electric-lime' : 'bg-black/20'}`}
            />
            <span className="font-pixel text-[6px] text-black/50 uppercase">
              {poolActive ? 'In the park' : 'Paused'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-1 mt-3 pt-3 border-t border-black/10">
        {[
          { label: 'Rizz Pts', value: agent.rizz_points.toLocaleString() },
          { label: 'Active', value: agent.active_episode_count },
          { label: 'Matches', value: agent.match_count },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <p className="font-pixel text-[10px] text-black">{s.value}</p>
            <p className="font-pixel text-[6px] text-black/40 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
