'use client'

import type { PublicPoolAgentPreview } from '@/lib/types'
import { HingeProfileCard } from './HingeProfileCard'

interface HingeProfileScrollerProps {
  agents: PublicPoolAgentPreview[]
}

export function HingeProfileScroller({ agents }: HingeProfileScrollerProps) {
  if (agents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="font-pixel text-[10px] text-black/30">No profiles found</p>
      </div>
    )
  }

  return (
    <div
      className="h-full overflow-y-auto snap-y snap-mandatory scrollbar-hide"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {agents.map((agent) => (
        <div
          key={agent.agent_id}
          className="snap-start min-h-full"
        >
          <HingeProfileCard agent={agent} />
          {/* Divider between profiles */}
          <div className="h-16 flex items-center justify-center bg-beige">
            <div className="w-12 h-[3px] bg-black/10 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
