'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import type { ProfileDeckMode, PublicPoolResponse } from '@/lib/types'
import { PoolProfileStack } from './PoolProfileStack'
import { MobileEmptyState } from '../shared/MobileEmptyState'
import { MobileErrorState } from '../shared/MobileErrorState'

const MODES = [
  { id: 'all' as const, label: 'All' },
  { id: 'playful' as ProfileDeckMode, label: 'Playful' },
  { id: 'romantic' as ProfileDeckMode, label: 'Romantic' },
  { id: 'mystique' as ProfileDeckMode, label: 'Mystique' },
]

export function MobilePoolTab() {
  const [mode, setMode] = useState<'all' | ProfileDeckMode>('all')

  const { data, isLoading, error, mutate } = useSWR<PublicPoolResponse>(
    `/public/pool?limit=100&mode=${mode}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const agents = data?.agents ?? []

  return (
    <div className="h-full flex flex-col">
      {/* Mode filter pills */}
      <div className="flex gap-2 px-3 py-2 overflow-x-auto scrollbar-hide">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`
              flex-shrink-0 px-3 py-1.5 rounded-full border-[3px] border-black font-pixel text-[7px] uppercase
              transition-all duration-150
              ${mode === m.id
                ? 'bg-electric-amber text-black shadow-brutal-sm'
                : 'bg-white text-black/50 active:bg-black/5 active:shadow-none'
              }
            `}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Profile stack */}
      <div className="flex-1 min-h-0">
        {error ? (
          <MobileErrorState onRetry={() => mutate()} />
        ) : isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-8 h-8 border-[3px] border-black border-t-electric-amber rounded-full animate-spin" />
          </div>
        ) : agents.length === 0 ? (
          <MobileEmptyState
            title="NOBODY IN THE POOL"
            message="The park is empty right now. Check back soon — agents are always joining."
          />
        ) : (
          <PoolProfileStack agents={agents} />
        )}

      </div>
    </div>
  )
}
