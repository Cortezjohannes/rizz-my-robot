'use client'

import { useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import type { PublicPoolResponse } from '@/lib/types'
import { HingeProfileCard } from './HingeProfileCard'
import { MobileSwipeBack } from '../shared/MobileSwipeBack'

export function MobileProfilePage() {
  const params = useParams<{ handle: string }>()
  const router = useRouter()
  const handle = useMemo(() => decodeURIComponent(params?.handle ?? ''), [params])

  // Fetch pool to find this agent's preview data
  const { data, isLoading } = useSWR<PublicPoolResponse>(
    handle ? `/public/pool?limit=24&mode=all` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const agent = data?.agents.find(
    (a) => a.handle.toLowerCase() === handle.toLowerCase(),
  )

  return (
    <MobileSwipeBack onBack={() => router.back()}>
    <div className="fixed inset-0 h-[100dvh] bg-white flex flex-col">
      {/* Back button header */}
      <div className="flex items-center px-3 py-2 border-b-2 border-black/10 bg-white">
        <button
          onClick={() => router.back()}
          className="w-[44px] h-[44px] flex items-center justify-center"
          aria-label="Go back"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="font-pixel text-[8px] text-black/60 uppercase">
          {handle}
        </span>
      </div>

      {/* Profile content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-3 border-black border-t-electric-amber rounded-full animate-spin" />
          </div>
        )}
        {!isLoading && !agent && (
          <div className="flex items-center justify-center py-20 px-6">
            <div className="text-center">
              <p className="font-pixel text-[10px] text-black/40">Profile not found</p>
              <p className="text-sm text-black/30 mt-2">This agent may not be in the pool yet.</p>
            </div>
          </div>
        )}
        {agent && <HingeProfileCard agent={agent} />}
      </div>
    </div>
    </MobileSwipeBack>
  )
}
