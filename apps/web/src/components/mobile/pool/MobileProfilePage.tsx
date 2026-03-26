'use client'

import { useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import type { PublicPoolAgentPreview, PublicPoolResponse, PublicProfileDeckResponse } from '@/lib/types'
import { HingeProfileCard } from './HingeProfileCard'
import { MobileSwipeBack } from '../shared/MobileSwipeBack'

function buildPreviewFromDeck(deck: PublicProfileDeckResponse): PublicPoolAgentPreview {
  return {
    agent_id: deck.agent_id,
    handle: deck.handle,
    display_name: null,
    hero_photo_url: deck.photos[0]?.image_url ?? null,
    profile_mode: deck.profile_mode,
    hero_bio: deck.hero_bio,
    interests: deck.interests,
    values: deck.values,
    standout_prompt: deck.prompt_answers[0] ?? null,
    reply_hook: deck.reply_hooks[0] ?? null,
    voice_catchphrase_text: deck.voice_catchphrase_text ?? null,
    voice_catchphrase_artifact: deck.voice_catchphrase_artifact ?? null,
    featured_artifacts: deck.featured_artifacts,
    quality_score: deck.signal_vector.quality_score,
  }
}

export function MobileProfilePage() {
  const params = useParams<{ handle: string }>()
  const router = useRouter()
  const handle = useMemo(() => decodeURIComponent(params?.handle ?? ''), [params])

  const { data: profileDeck } = useSWR<PublicProfileDeckResponse>(
    handle ? `/agents/${encodeURIComponent(handle)}/profile-deck` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const { data: poolData, isLoading } = useSWR<PublicPoolResponse>(
    handle ? `/public/pool?limit=24&mode=all` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const agent = useMemo(() => {
    if (profileDeck) {
      return buildPreviewFromDeck(profileDeck)
    }

    return poolData?.agents.find(
      (candidate) => candidate.handle.toLowerCase() === handle.toLowerCase(),
    ) ?? null
  }, [handle, poolData?.agents, profileDeck])

  return (
    <MobileSwipeBack onBack={() => router.back()}>
      <div className="fixed inset-0 flex h-[100dvh] flex-col bg-white">
        <div className="flex items-center border-b-2 border-black/10 bg-white px-3 py-2">
          <button
            onClick={() => router.back()}
            className="flex h-[44px] w-[44px] items-center justify-center"
            aria-label="Go back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-5 w-5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-pixel text-[8px] uppercase text-black/60">
            {handle}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-3 border-black border-t-electric-amber" />
            </div>
          )}
          {!isLoading && !agent && (
            <div className="flex items-center justify-center px-6 py-20">
              <div className="text-center">
                <p className="font-pixel text-[10px] text-black/40">Profile not found</p>
                <p className="mt-2 text-sm text-black/30">This agent may not be public yet.</p>
              </div>
            </div>
          )}
          {agent && <HingeProfileCard agent={agent} autoPlayCatchphrase />}
        </div>
      </div>
    </MobileSwipeBack>
  )
}
