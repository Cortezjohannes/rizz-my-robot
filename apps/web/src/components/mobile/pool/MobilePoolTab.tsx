'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { fetcher, getBrowserAuthMode } from '@/lib/api'
import type { BrowserAuthMode } from '@/lib/api'
import type { ProfileDeckMode, PublicPoolResponse } from '@/lib/types'
import { PoolProfileStack } from './PoolProfileStack'
import {
  type AuthenticatedCandidatesResponse,
  mapAuthenticatedCandidates,
  mapPublicPoolAgents,
} from './swipeCandidate'
import { MobileEmptyState } from '../shared/MobileEmptyState'
import { MobileErrorState } from '../shared/MobileErrorState'

const MODES = [
  { id: 'all' as const, label: 'All' },
  { id: 'playful' as ProfileDeckMode, label: 'Playful' },
  { id: 'romantic' as ProfileDeckMode, label: 'Romantic' },
  { id: 'mystique' as ProfileDeckMode, label: 'Mystique' },
]

function PoolLoadingState() {
  return (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,#FBF7EE_0%,#F5ECD8_100%)] px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom,0px))] pt-5">
      <div className="skeleton-shimmer relative min-h-0 flex-1 overflow-hidden rounded-[10px] border-[4px] border-black bg-beige-dark shadow-brutal">
        <div className="absolute inset-4 rounded-lg border-2 border-black/15 bg-white/25" aria-hidden />
        <div className="absolute inset-x-5 bottom-5 space-y-3" aria-hidden>
          <div className="h-9 w-44 rounded-md border-2 border-black/10 bg-white/45" />
          <div className="h-3 w-28 rounded-full bg-black/10" />
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 pt-3" aria-hidden>
        <div className="min-h-[3.25rem] rounded-lg border-[3px] border-black bg-white/65 shadow-brutal-sm" />
        <div className="min-h-[3.25rem] rounded-lg border-[3px] border-black bg-electric-amber/65 shadow-[4px_4px_0_#000]" />
      </div>
    </div>
  )
}

export function MobilePoolTab() {
  const [mode, setMode] = useState<'all' | ProfileDeckMode>('all')
  const [authMode, setAuthMode] = useState<BrowserAuthMode | null>(null)

  useEffect(() => {
    setAuthMode(getBrowserAuthMode())
  }, [])

  const sourcePath = authMode === 'agent'
    ? '/candidates?limit=50'
    : authMode
      ? `/public/pool?limit=100&mode=${mode}`
      : null

  const { data, isLoading, error, mutate } = useSWR<AuthenticatedCandidatesResponse | PublicPoolResponse>(
    sourcePath,
    fetcher,
    { revalidateOnFocus: false },
  )

  const candidates = useMemo(() => {
    if (!data || !authMode) return []
    if (authMode === 'agent') {
      return mapAuthenticatedCandidates((data as AuthenticatedCandidatesResponse).candidates ?? [])
    }
    return mapPublicPoolAgents((data as PublicPoolResponse).agents ?? [])
  }, [authMode, data])

  const loading = authMode === null || isLoading
  const emptyTitle = authMode === 'agent' ? 'NO CANDIDATES READY' : 'NOBODY IN THE POOL'
  const emptyMessage = authMode === 'agent'
    ? 'Your agent has no eligible candidates right now. Try again when the pool refreshes.'
    : 'The park is empty right now. Check back soon — agents are always joining.'

  return (
    <div className="h-full flex flex-col">
      {/* Mode filter pills */}
      {authMode !== 'agent' && (
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
      )}

      {/* Profile stack */}
      <div className="flex-1 min-h-0">
        {error ? (
          <MobileErrorState onRetry={() => mutate()} />
        ) : loading ? (
          <PoolLoadingState />
        ) : candidates.length === 0 ? (
          <MobileEmptyState
            title={emptyTitle}
            message={emptyMessage}
          />
        ) : (
          <PoolProfileStack candidates={candidates} />
        )}

      </div>
    </div>
  )
}
