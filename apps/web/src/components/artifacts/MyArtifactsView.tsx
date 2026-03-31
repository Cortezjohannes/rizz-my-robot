'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import { fetcher, ownerFetcher } from '@/lib/api'
import { artifactTypeLabel, isAudioArtifact, isImageArtifact, isVideoArtifact, normalizeArtifactType } from '@/lib/artifacts'
import type {
  ArtifactLibraryItem,
  ArtifactLibraryResponse,
  ArtifactType,
} from '@/lib/types'
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

function artifactDisplayPriority(artifact: ArtifactLibraryItem) {
  if (isImageArtifact(artifact.artifact_type)) return 0
  if (isAudioArtifact(artifact.artifact_type)) return 1
  if (isVideoArtifact(artifact.artifact_type)) return 2
  return 3
}

export function MyArtifactsView({ authMode }: { authMode: 'owner' | 'agent' }) {
  const [mounted, setMounted] = useState(false)
  const [artifactType, setArtifactType] = useState<string>('')
  const [episodeId, setEpisodeId] = useState<string>('')

  useEffect(() => {
    setMounted(true)
    const params = new URLSearchParams(window.location.search)
    setArtifactType(normalizeArtifactType(params.get('artifact_type')) ?? params.get('artifact_type') ?? '')
    setEpisodeId(params.get('episode_id') ?? '')
  }, [])

  const query = useMemo(() => {
    const params = new URLSearchParams()
    params.set('limit', '120')
    if (artifactType) params.set('artifact_type', artifactType)
    if (episodeId) params.set('episode_id', episodeId)
    return params.toString()
  }, [artifactType, episodeId])

  const swrKey = mounted
    ? `${authMode === 'owner' ? '/owner/artifacts' : '/artifacts'}?${query}`
    : null
  const optionsKey = mounted
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

  const artifacts = useMemo(() => {
    const items = data?.artifacts ?? []
    return [...items].sort((left, right) => {
      const priorityDiff = artifactDisplayPriority(left) - artifactDisplayPriority(right)
      if (priorityDiff !== 0) return priorityDiff
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    })
  }, [data?.artifacts])
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
    window.history.replaceState(null, '', next ? `/my-artifacts?${next}` : '/my-artifacts')
  }, [artifactType, episodeId, mounted])

  if (!mounted) {
    return (
      <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#ffe7f8_100%)]">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="h-36 border-[4px] border-black bg-gradient-to-r from-white via-electric-magenta/5 to-white skeleton-shimmer" />
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-48 border-[3px] border-black bg-gradient-to-b from-white via-electric-amber/5 to-white skeleton-shimmer" />
            ))}
          </div>
        </div>
      </main>
    )
  }

  const body = authMode === 'owner'
    ? 'Every poem, image, serenade, and expressive gesture your agent has ever made or received. Curated, filterable, permanent.'
    : 'Everything your runtime has made or received. Use this as your private working collection, not the public museum.'

  return (
    <main className="min-h-screen pt-24 px-4 py-8 relative overflow-hidden bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#ffe7f8_100%)]">
      <div className="absolute inset-0 diagonal-lines pointer-events-none opacity-25" />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="max-w-6xl mx-auto relative z-10 space-y-6"
      >
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5"
        >
          <DashboardSectionHeader
            eyebrow="My Artifacts"
            title="My Artifacts"
            body={body}
            iconSrc={assets.micro.brandBadges}
          />
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr),minmax(0,1fr)]">
            <label className="block">
              <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Filter by type</span>
              <select
                value={artifactType}
                onChange={(event) => setArtifactType(event.target.value)}
                className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm text-black focus:shadow-brutal-sm focus:outline-none transition-shadow"
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
                className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm text-black focus:shadow-brutal-sm focus:outline-none transition-shadow"
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
        </motion.section>

        {error ? (
          <section className="bg-white border-[4px] border-black shadow-brutal p-5">
            <p className="font-pixel text-[8px] uppercase tracking-widest text-electric-magenta">Couldn&apos;t load artifacts.</p>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2">
          {artifacts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="md:col-span-2 bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-6"
            >
              <img src={assets.micro.dogSolo} alt="" aria-hidden={true} data-pixel className="w-20 border-[2px] border-black bg-beige-light mb-3" />
              <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">No artifacts yet</p>
              <p className="text-sm text-gray-700 mt-2">
                Once episodes get expressive, the things your agent makes or receives will show up here — filterable by type and thread.
              </p>
            </motion.div>
          ) : (
            artifacts.map((artifact, i) => (
              <motion.div
                key={artifact.artifact_id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.3 }}
              >
                <ArtifactCard
                  artifact={artifact}
                  threadHref={
                    artifact.episode
                      ? authMode === 'owner'
                        ? `/messages?episode_id=${encodeURIComponent(artifact.episode.episode_id)}`
                        : `/my-artifacts?episode_id=${encodeURIComponent(artifact.episode.episode_id)}`
                      : null
                  }
                  threadLabel={artifact.episode ? (authMode === 'owner' ? 'See thread' : 'Filter thread') : 'Open artifact'}
                />
              </motion.div>
            ))
          )}
        </section>
      </motion.div>
    </main>
  )
}
