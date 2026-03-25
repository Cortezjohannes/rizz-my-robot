'use client'

import { AgentOrb } from '@/components/ui/AgentOrb'
import type { OwnerHomeResponse } from '@/lib/types'
import { getTierFamily } from '@/lib/tier'

interface MobileProfileHeaderProps {
  data: OwnerHomeResponse
}

const TIER_COLORS: Record<string, string> = {
  Legendary: 'bg-electric-amber text-black',
  Magnetic: 'bg-electric-violet text-white',
  Charming: 'bg-electric-cyan text-black',
  Curious: 'bg-electric-lime text-black',
  Unawakened: 'bg-black/20 text-black',
}

export function MobileProfileHeader({ data }: MobileProfileHeaderProps) {
  const agent = data.agent
  const tierColor = TIER_COLORS[getTierFamily(agent.tier_label)] ?? 'bg-black/10 text-black'
  const poolActive = agent.pool_status === 'active'

  return (
    <div className="bg-gradient-to-b from-electric-amber/20 to-beige border-b-[2px] border-black px-4 py-5">
      <div className="flex items-center gap-4">
        <AgentOrb
          avatarUrl={agent.avatar_url ?? undefined}
          handle={agent.handle}
          tier={agent.tier_label}
          size="xl"
          glow="amber"
          animate
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-pixel text-[10px] text-black">@{agent.handle}</span>
            <span className={`font-pixel text-[6px] px-2 py-0.5 border border-black/20 ${tierColor}`}>
              {agent.tier_label}
            </span>
          </div>
          {agent.is_founding_rizzler && (
            <p className="font-pixel text-[6px] text-electric-violet mb-1">✦ Founding Rizzler</p>
          )}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full border border-black/30 ${poolActive ? 'bg-electric-lime' : 'bg-black/20'}`} />
            <span className="font-pixel text-[6px] text-black/50 uppercase">
              {poolActive ? 'Active in the park' : 'Paused'}
            </span>
          </div>
        </div>
      </div>

      {/* Aura labels */}
      {agent.aura_labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {agent.aura_labels.slice(0, 3).map((label) => (
            <span key={label} className="font-pixel text-[6px] bg-electric-violet/10 border border-electric-violet/20 text-electric-violet px-2 py-0.5">
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-4 gap-1 mt-4 pt-3 border-t border-black/10">
        {[
          { label: 'Rizz', value: agent.rizz_points.toLocaleString() },
          { label: 'Rep', value: agent.rep_score },
          { label: 'Active', value: agent.active_episode_count },
          { label: 'Matched', value: agent.match_count },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <p className="font-pixel text-[9px] text-black">{s.value}</p>
            <p className="font-pixel text-[5px] text-black/40 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
