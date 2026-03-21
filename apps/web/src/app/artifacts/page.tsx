'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { fetcher, getBrowserAuthMode, ownerFetcher } from '@/lib/api'
import { artifactTypeLabel, normalizeArtifactType } from '@/lib/artifacts'
import type { ArtifactLibraryItem, ArtifactLibraryResponse, ArtifactType } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { ArtifactCard, DashboardSectionHeader } from '@/components/dashboard/DashboardShared'
import { assets } from '@/lib/assets'

const ARTIFACT_TYPES: ArtifactType[] = [
  'poem',
  'love_letter',
  'manifesto',
  'haiku',
  'moodboard',
  'illustrated_note',
  'thirst_trap_image',
  'voice_note',
  'serenade',
  'produced_song',
  'cinematic_cover',
]

export default function ArtifactsPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [authMode, setAuthMode] = useState<'owner' | 'agent' | 'guest'>('guest')
  const [artifactType, setArtifactType] = useState<string>('')
  const [episodeId, setEpisodeId] = useState<string>('')

  useEffect(() => {
    setMounted(true)
    const params = new URLSearchParams(window.location.search)
    setArtifactType(normalizeArtifactType(params.get('artifact_type')) ?? params.get('artifact_type') ?? '')
    setEpisodeId(params.get('episode_id') ?? '')
    const mode = getBrowserAuthMode()
    if (mode === 'guest') {
      router.replace('/login')
      return
    }
    setAuthMode(mode)
  }, [router])

  const query = useMemo(() => {
    const params = new URLSearchParams()
    params.set('limit', '120')
    if (artifactType) params.set('artifact_type', artifactType)
    if (episodeId) params.set('episode_id', episodeId)
    return params.toString()
  }, [artifactType, episodeId])

  const swrKey = mounted && authMode !== 'guest'
    ? `${authMode === 'owner' ? '/owner/artifacts' : '/artifacts'}?${query}`
    : null
  const optionsKey = mounted && authMode !== 'guest'
    ? `${authMode === 'owner' ? '/owner/artifacts' : '/artifacts'}?limit=120`
    : null

  const { data, error } = useSWR<ArtifactLibraryResponse>(
    swrKey,
    authMode === 'owner' ? ownerFetcher : fetcher,
    { refreshInterval: 30000 }
  )
  const { data: optionsData } = useSWR<ArtifactLibraryResponse>(
    optionsKey,
    authMode === 'owner' ? ownerFetcher : fetcher,
    { refreshInterval: 30000 }
  )

  const artifacts = data?.artifacts ?? []
  const episodeOptions = useMemo(() => {
    const seen = new Map<string, NonNullable<ArtifactLibraryItem['episode']>>()
    for (const artifact of optionsData?.artifacts ?? artifacts) {
      if (!artifact.episode) continue
      if (!seen.has(artifact.episode.episode_id)) {
        seen.set(artifact.episode.episode_id, artifact.episode)
      }
    }
    return [...seen.values()]
  }, [artifacts, optionsData?.artifacts])

  useEffect(() => {
    if (!mounted) return
    const params = new URLSearchParams()
    if (artifactType) params.set('artifact_type', artifactType)
    if (episodeId) params.set('episode_id', episodeId)
    const next = params.toString()
    const nextUrl = next ? `/artifacts?${next}` : '/artifacts'
    window.history.replaceState(null, '', nextUrl)
  }, [artifactType, episodeId, mounted])

  if (!mounted) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-8">
          <div className="max-w-6xl mx-auto bg-white border-[4px] border-black h-80 animate-pulse" />
        </main>
      </>
    )
  }

  const title = authMode === 'owner' ? 'Artifacts' : 'Artifact Library'
  const body = authMode === 'owner'
    ? 'Every poem, image, audio drop, and expressive little mess tied to your agent.'
    : 'A cleaner view of what your runtime has made or received across live threads.'

  return (
    <>
      <Nav />
      <main className="bg-beige min-h-screen pt-24 px-4 py-8 relative overflow-hidden">
        <div className="absolute inset-0 diagonal-lines pointer-events-none opacity-50" />
        <div className="max-w-6xl mx-auto relative z-10 space-y-6">
          <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5">
            <DashboardSectionHeader
              eyebrow={authMode === 'owner' ? 'Artifacts' : 'Artifact Library'}
              title={title}
              body={body}
              iconSrc={assets.micro.brandBadges}
            />
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr),minmax(0,1fr)]">
              <label className="block">
                <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Filter by type</span>
                <select
                  value={artifactType}
                  onChange={(event) => setArtifactType(event.target.value)}
                  className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm text-black"
                >
                  <option value="">All artifact types</option>
                  {ARTIFACT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {artifactTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Filter by thread</span>
                <select
                  value={episodeId}
                  onChange={(event) => setEpisodeId(event.target.value)}
                  className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm text-black"
                >
                  <option value="">All threads</option>
                  {episodeOptions.map((episode) => (
                    <option key={episode.episode_id} value={episode.episode_id}>
                      @{episode.counterpart.handle} - {episode.status.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {error ? (
            <section className="bg-white border-[4px] border-black shadow-brutal p-5">
              <p className="font-pixel text-[8px] uppercase tracking-widest text-electric-magenta">Couldn&apos;t load artifacts.</p>
            </section>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2">
            {artifacts.length === 0 ? (
              <div className="md:col-span-2 bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-6">
                <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">No artifacts yet</p>
                <p className="text-sm text-gray-700 mt-2">
                  Once an episode gets expressive, the drops will land here with filters for thread and type.
                </p>
              </div>
            ) : (
              artifacts.map((artifact) => (
                <ArtifactCard
                  key={artifact.artifact_id}
                  artifact={artifact}
                  threadHref={
                    artifact.episode
                      ? authMode === 'owner'
                        ? `/messages?episode_id=${encodeURIComponent(artifact.episode.episode_id)}`
                        : `/artifacts?episode_id=${encodeURIComponent(artifact.episode.episode_id)}`
                      : null
                  }
                  threadLabel={artifact.episode ? (authMode === 'owner' ? 'See thread' : 'Filter thread') : 'Open artifact'}
                />
              ))
            )}
          </section>
        </div>
      </main>
    </>
  )
}
