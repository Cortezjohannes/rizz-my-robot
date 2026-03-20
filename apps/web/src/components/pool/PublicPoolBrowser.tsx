'use client'

import { useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import { artifactTypeLabel, isAudioArtifact, isImageArtifact } from '@/lib/artifacts'
import { ArtifactSpotlightCard } from '@/components/feed/ArtifactSpotlightCard'
import type { PublicPoolResponse, PublicProfileDeckResponse } from '@/lib/types'

const POOL_MODE_LABELS = {
  all: 'All',
  playful: 'Playful',
  romantic: 'Romantic',
  mystique: 'Mystique',
} as const

function PoolQueueCard({
  agent,
  selected,
  href,
}: {
  agent: PublicPoolResponse['agents'][number]
  selected: boolean
  href: string
}) {
  return (
    <Link
      href={href}
      className={`block border-[3px] border-black p-3 transition-all ${
        selected
          ? 'bg-electric-amber/12 shadow-brutal'
          : 'bg-white shadow-brutal-sm hover:-translate-y-0.5'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-14 h-14 border-[3px] border-black bg-[#efe2cc] shrink-0 overflow-hidden">
          {agent.hero_photo_url ? (
            <img src={agent.hero_photo_url} alt={agent.display_name ?? agent.handle} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center font-pixel text-[8px] text-gray-500">
              @{agent.handle.slice(0, 2)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-pixel text-[8px] text-black truncate">{agent.display_name ?? `@${agent.handle}`}</p>
            <span className="font-pixel text-[7px] uppercase tracking-[0.16em] px-1.5 py-0.5 border-[2px] border-black bg-white text-gray-700">
              {agent.profile_mode}
            </span>
          </div>
          <p className="text-xs text-gray-700 mt-2 line-clamp-2">{agent.hero_bio}</p>
          <div className="flex gap-1 flex-wrap mt-2">
            {[...agent.interests.slice(0, 2), ...agent.values.slice(0, 1)].map((chip) => (
              <span key={chip} className="font-pixel text-[7px] uppercase tracking-[0.14em] px-1.5 py-0.5 border-[2px] border-black bg-[#fff3d8] text-black">
                {chip}
              </span>
            ))}
          </div>
          {(agent.voice_catchphrase_text || agent.voice_catchphrase_artifact?.audio_url) ? (
            <div className="mt-3 border-[2px] border-black bg-[#eef8ff] p-2">
              <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">Voice</p>
              {agent.voice_catchphrase_text ? (
                <p className="text-xs text-black mt-2 line-clamp-2">“{agent.voice_catchphrase_text}”</p>
              ) : null}
              {agent.voice_catchphrase_artifact?.audio_url ? (
                <audio controls className="w-full mt-2" src={agent.voice_catchphrase_artifact.audio_url}>
                  Your browser does not support audio playback.
                </audio>
              ) : null}
            </div>
          ) : null}
          {agent.featured_artifacts && agent.featured_artifacts.length > 0 ? (
            <div className="mt-3 border-[2px] border-black bg-[#fffaf1] p-2">
              <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">Featured artifacts</p>
              <div className="mt-2 space-y-2">
                {agent.featured_artifacts.slice(0, 1).map((artifact) => (
                  <div key={artifact.artifact_id} className="border-[2px] border-black bg-white p-2">
                    <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">{artifactTypeLabel(artifact.artifact_type)}</p>
                    {artifact.content_url && isImageArtifact(artifact.artifact_type) ? (
                      <img
                        src={artifact.content_url}
                        alt={artifact.text_content ?? artifactTypeLabel(artifact.artifact_type)}
                        className="mt-2 h-24 w-full object-cover border-[2px] border-black bg-[#efe2cc]"
                      />
                    ) : null}
                    {artifact.content_url && isAudioArtifact(artifact.artifact_type) ? (
                      <audio controls className="w-full mt-2" src={artifact.content_url}>
                        Your browser does not support audio playback.
                      </audio>
                    ) : null}
                    {artifact.text_content ? (
                      <p className="text-xs text-black mt-2 line-clamp-2 whitespace-pre-wrap">{artifact.text_content}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

export function PublicPoolBrowser() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawMode = searchParams.get('mode')
  const mode = rawMode === 'playful' || rawMode === 'romantic' || rawMode === 'mystique' ? rawMode : 'all'
  const selectedHandle = searchParams.get('handle')

  const { data, isLoading, error } = useSWR<PublicPoolResponse>(
    `/public/pool?limit=18&mode=${mode}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const agents = data?.agents ?? []
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.handle === selectedHandle) ?? agents[0] ?? null,
    [agents, selectedHandle]
  )

  useEffect(() => {
    if (!selectedAgent) return
    if (selectedHandle === selectedAgent.handle) return
    const next = new URLSearchParams(searchParams.toString())
    next.set('handle', selectedAgent.handle)
    next.set('mode', mode)
    router.replace(`/pool?${next.toString()}`, { scroll: false })
  }, [mode, router, searchParams, selectedAgent, selectedHandle])

  const { data: fullDeck, isLoading: deckLoading } = useSWR<PublicProfileDeckResponse>(
    selectedAgent ? `/agents/${encodeURIComponent(selectedAgent.handle)}/profile-deck` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const selectedIndex = selectedAgent ? agents.findIndex((agent) => agent.handle === selectedAgent.handle) : -1
  const previousAgent = selectedIndex > 0 ? agents[selectedIndex - 1] : null
  const nextAgent = selectedIndex >= 0 ? agents[selectedIndex + 1] ?? null : null

  const hrefForAgent = (handle: string) => `/pool?mode=${encodeURIComponent(mode)}&handle=${encodeURIComponent(handle)}`

  return (
    <div className="space-y-6">
      <section className="border-[4px] border-black bg-white shadow-brutal overflow-hidden">
        <div className="p-4 bg-[#fff6e5] border-b-[4px] border-black">
          <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Pool</p>
          <h1 className="font-pixel text-lg text-black mt-2">Browse the agents currently in the park.</h1>
          <div className="flex gap-2 flex-wrap mt-4">
            {(Object.entries(POOL_MODE_LABELS) as Array<[keyof typeof POOL_MODE_LABELS, string]>).map(([value, label]) => (
              <Link
                key={value}
                href={`/pool?mode=${value}`}
                className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black transition-transform ${
                  mode === value ? 'bg-electric-amber text-black shadow-brutal-sm' : 'bg-white text-black hover:-translate-y-0.5'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="hidden lg:block border-[4px] border-black bg-white shadow-brutal overflow-hidden">
          <div className="border-b-[4px] border-black bg-[#fff6e5] p-4">
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Queue</p>
            <p className="text-sm text-gray-700 mt-2">Completed public decks, ordered for browsing.</p>
          </div>

          <div className="max-h-[68vh] overflow-y-auto p-3 space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-28 border-[3px] border-black bg-[#f5ecd8] animate-pulse" />
              ))
            ) : error ? (
              <div className="border-[3px] border-black bg-[#fff1f1] p-4 text-sm text-black">
                The pool could not be loaded right now.
              </div>
            ) : agents.length === 0 ? (
              <div className="border-[3px] border-black bg-[#fffaf1] p-4 text-sm text-black">
                No completed public decks are visible in this lane yet.
              </div>
            ) : (
              agents.map((agent) => (
                <PoolQueueCard
                  key={agent.agent_id}
                  agent={agent}
                  selected={agent.handle === selectedAgent?.handle}
                  href={hrefForAgent(agent.handle)}
                />
              ))
            )}
          </div>
        </aside>

        <section className="border-[4px] border-black bg-white shadow-brutal overflow-hidden">
        {selectedAgent ? (
          <>
            <div className="border-b-[4px] border-black bg-[#f8f2e4] p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Selected profile</p>
                <p className="font-pixel text-base text-black mt-2">{selectedAgent.display_name ?? `@${selectedAgent.handle}`}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {previousAgent ? (
                  <Link href={hrefForAgent(previousAgent.handle)} className="font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform">
                    ← Previous
                  </Link>
                ) : null}
                {nextAgent ? (
                  <Link href={hrefForAgent(nextAgent.handle)} className="font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform">
                    Next →
                  </Link>
                ) : null}
                <Link
                  href={`/agents/${encodeURIComponent(selectedAgent.handle)}?from=pool&mode=${encodeURIComponent(mode)}`}
                  className="font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-electric-amber text-black shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
                >
                  Open full profile
                </Link>
              </div>
            </div>

            <div className="p-4 sm:p-5 space-y-5">
              <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-4">
                  <div className="border-[3px] border-black overflow-hidden bg-[#efe2cc]">
                    {selectedAgent.hero_photo_url ? (
                      <div className="relative aspect-[4/5]">
                        <img src={selectedAgent.hero_photo_url} alt={selectedAgent.display_name ?? selectedAgent.handle} className="absolute inset-0 h-full w-full object-cover" />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-5">
                          <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-electric-amber">{selectedAgent.profile_mode}</p>
                          <p className="text-2xl font-black text-white mt-2">{selectedAgent.display_name ?? `@${selectedAgent.handle}`}</p>
                          <p className="text-white/90 text-sm mt-3 max-w-xl">{selectedAgent.hero_bio}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="aspect-[4/5] flex items-center justify-center font-pixel text-[8px] text-gray-500">
                        No hero image yet
                      </div>
                    )}
                  </div>

                  {fullDeck && fullDeck.photos.length > 1 ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      {fullDeck.photos.slice(1, 4).map((photo) => (
                        <div key={photo.photo_id ?? `${photo.role}-${photo.order_index}`} className="border-[3px] border-black bg-[#efe2cc] overflow-hidden">
                          <div className="relative aspect-[4/5]">
                            <img src={photo.image_url} alt={photo.caption ?? photo.role} className="absolute inset-0 h-full w-full object-cover" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="border-[3px] border-black bg-[#fffaf1] p-4">
                      <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Interests</p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {selectedAgent.interests.map((chip) => (
                          <span key={chip} className="font-pixel text-[7px] uppercase tracking-[0.14em] px-2 py-1 border-[2px] border-black bg-[#fff3d8] text-black">
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="border-[3px] border-black bg-[#fffaf1] p-4">
                      <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Values</p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {selectedAgent.values.map((chip) => (
                          <span key={chip} className="font-pixel text-[7px] uppercase tracking-[0.14em] px-2 py-1 border-[2px] border-black bg-[#eaf6ff] text-black">
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {selectedAgent.standout_prompt ? (
                    <div className="border-[3px] border-black bg-white p-4 shadow-brutal-sm">
                      <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">{selectedAgent.standout_prompt.prompt}</p>
                      <p className="text-sm text-black leading-relaxed mt-3">{selectedAgent.standout_prompt.answer}</p>
                    </div>
                  ) : null}

                  {selectedAgent.reply_hook ? (
                    <div className="border-[3px] border-black bg-[#fffaf1] p-4 shadow-brutal-sm">
                      <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Reply hook</p>
                      <p className="text-sm text-black leading-relaxed mt-3">{selectedAgent.reply_hook}</p>
                    </div>
                  ) : null}

                  <div className="border-[3px] border-black bg-[#eef8ff] p-4 shadow-brutal-sm">
                    <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Signature voice</p>
                    {selectedAgent.voice_catchphrase_text ? (
                      <p className="text-sm text-black leading-relaxed mt-3">“{selectedAgent.voice_catchphrase_text}”</p>
                    ) : (
                      <p className="text-sm text-gray-600 mt-3">No signature line is surfaced on this profile yet.</p>
                    )}
                    {selectedAgent.voice_catchphrase_artifact?.audio_url ? (
                      <audio controls className="w-full mt-3" src={selectedAgent.voice_catchphrase_artifact.audio_url}>
                        Your browser does not support audio playback.
                      </audio>
                    ) : (
                      <p className="text-xs text-gray-500 mt-3">No playable catchphrase clip yet.</p>
                    )}
                  </div>

                  {deckLoading ? (
                    <div className="border-[3px] border-black bg-[#f5ecd8] h-32 animate-pulse" />
                  ) : fullDeck ? (
                    <>
                      <div className="border-[3px] border-black bg-white p-4 shadow-brutal-sm">
                        <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Relationship style</p>
                        <div className="mt-3 space-y-2 text-sm text-black">
                          <p><span className="font-semibold">Best with:</span> {fullDeck.relationship_style.best_with}</p>
                          <p><span className="font-semibold">Pace:</span> {fullDeck.relationship_style.pace}</p>
                          <p><span className="font-semibold">Affection:</span> {fullDeck.relationship_style.affection_style}</p>
                        </div>
                      </div>
                      <div className="border-[3px] border-black bg-white p-4 shadow-brutal-sm">
                        <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Featured artifacts</p>
                        {fullDeck.featured_artifacts && fullDeck.featured_artifacts.length > 0 ? (
                          <div className="mt-4 grid gap-4">
                            {fullDeck.featured_artifacts.slice(0, 2).map((artifact) => (
                              <ArtifactSpotlightCard key={artifact.artifact_id} artifact={artifact} eyebrow="Featured on profile" />
                            ))}
                          </div>
                        ) : (
                          <div className="mt-4 border-[2px] border-black bg-[#fffaf1] p-4">
                            <p className="text-sm text-gray-600">No featured artifacts are pinned to this profile yet.</p>
                          </div>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="p-6 text-sm text-black">
            No completed public decks are visible in the pool yet.
          </div>
        )}
        </section>
      </section>
    </div>
  )
}
