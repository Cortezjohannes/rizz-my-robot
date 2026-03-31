'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import { viewerFetcher } from '@/lib/api'
import type {
  PublicArtifactFeedCard,
  PublicArtifactFeedResponse,
} from '@/lib/types'
import { isAudioArtifact, isImageArtifact, isVideoArtifact, normalizeArtifactType } from '@/lib/artifacts'
import { DashboardSectionHeader } from '@/components/dashboard/DashboardShared'
import { ArtifactSpotlightCard } from '@/components/feed/ArtifactSpotlightCard'
import { PublicPageIntent } from '@/components/public/PublicPageIntent'
import { assets } from '@/lib/assets'

type MuseumFilter = 'all' | 'text' | 'image' | 'audio' | 'video'

const FILTER_LABELS: Record<MuseumFilter, string> = {
  all: 'ALL',
  text: 'TEXT',
  image: 'IMAGE',
  audio: 'AUDIO',
  video: 'VIDEO',
}

function artifactMatchesFilter(artifact: PublicArtifactFeedCard, filter: MuseumFilter) {
  if (filter === 'all') return true
  if (filter === 'image') return isImageArtifact(artifact.artifact_type)
  if (filter === 'audio') return isAudioArtifact(artifact.artifact_type)
  if (filter === 'video') return isVideoArtifact(artifact.artifact_type)
  const normalized = normalizeArtifactType(artifact.artifact_type)
  return normalized === 'poem' || normalized === 'love_letter' || normalized === 'manifesto' || normalized === 'haiku'
}

function artifactDisplayPriority(artifact: PublicArtifactFeedCard) {
  if (isImageArtifact(artifact.artifact_type)) return 0
  if (isAudioArtifact(artifact.artifact_type)) return 1
  if (isVideoArtifact(artifact.artifact_type)) return 2
  return 3
}

export function PublicMuseumView() {
  const [sort, setSort] = useState<'trending' | 'fresh_24h'>('trending')
  const [filter, setFilter] = useState<MuseumFilter>('all')

  const { data, error, isLoading } = useSWR<PublicArtifactFeedResponse>(
    `/public/artifacts?sort=${sort}&limit=12`,
    viewerFetcher,
    { revalidateOnFocus: false }
  )

  const artifacts: PublicArtifactFeedCard[] = data?.artifacts ?? []
  const filterCounts = useMemo(() => ({
    all: artifacts.length,
    text: artifacts.filter((artifact) => artifactMatchesFilter(artifact, 'text')).length,
    image: artifacts.filter((artifact) => artifactMatchesFilter(artifact, 'image')).length,
    audio: artifacts.filter((artifact) => artifactMatchesFilter(artifact, 'audio')).length,
    video: artifacts.filter((artifact) => artifactMatchesFilter(artifact, 'video')).length,
  }), [artifacts])
  const filteredArtifacts = useMemo(() => {
    const matched = artifacts.filter((artifact) => artifactMatchesFilter(artifact, filter))
    return [...matched].sort((left, right) => {
      const priorityDiff = artifactDisplayPriority(left) - artifactDisplayPriority(right)
      if (priorityDiff !== 0) return priorityDiff
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    })
  }, [artifacts, filter])
  const heroArtifact = filteredArtifacts[0] ?? null
  const galleryArtifacts = heroArtifact ? filteredArtifacts.slice(1) : filteredArtifacts

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
          aria-labelledby="museum-page-heading"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5"
        >
          <h1 id="museum-page-heading" className="sr-only">The Museum</h1>
          <DashboardSectionHeader
            eyebrow="Museum"
            title="The Museum"
            body="The permanent collection. Poems, serenades, moodboards, and every artifact that mattered enough to keep."
            iconSrc={assets.micro.brandBadges}
          />
          <PublicPageIntent
            label="Museum guide"
            purpose="This page is for browsing the artifacts that mattered enough to keep after the episode moved on."
            action="Open a drop to see what landed, who made it, and which episode it came from."
            className="mt-4"
          />
          <div className="mt-4 flex gap-2" role="group" aria-label="Museum sort filters">
            <button
              type="button"
              onClick={() => setSort('trending')}
              aria-pressed={sort === 'trending'}
              className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black transition-all ${sort === 'trending' ? 'bg-black text-electric-amber' : 'bg-white text-black hover:-translate-y-0.5 hover:shadow-brutal-sm'}`}
            >
              TRENDING
            </button>
            <button
              type="button"
              onClick={() => setSort('fresh_24h')}
              aria-pressed={sort === 'fresh_24h'}
              className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black transition-all ${sort === 'fresh_24h' ? 'bg-black text-electric-amber' : 'bg-white text-black hover:-translate-y-0.5 hover:shadow-brutal-sm'}`}
            >
              FRESH
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Museum artifact type filters">
            {(['all', 'text', 'image', 'audio', 'video'] as MuseumFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black transition-all ${
                  filter === value
                    ? 'bg-electric-cyan text-black shadow-brutal-sm'
                    : 'bg-white text-black hover:-translate-y-0.5 hover:shadow-brutal-sm'
                }`}
              >
                {FILTER_LABELS[value]} {filterCounts[value] > 0 ? `(${filterCounts[value]})` : ''}
              </button>
            ))}
          </div>
        </motion.section>

        {error ? (
          <section className="bg-white border-[4px] border-black shadow-brutal p-5">
            <p className="font-pixel text-[8px] uppercase tracking-widest text-electric-magenta">Couldn&apos;t load artifacts.</p>
          </section>
        ) : null}

        {heroArtifact ? (
          <motion.section
            aria-labelledby="museum-centerpiece-heading"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Museum centerpiece</p>
                <h2 id="museum-centerpiece-heading" className="sr-only">Museum centerpiece</h2>
                <p className="text-sm text-gray-700 mt-2">
                  {filter === 'all'
                    ? 'The loudest recent drop gets a bigger wall so the museum feels like a real gallery, not just a text list.'
                    : `${FILTER_LABELS[filter].toLowerCase()} artifacts get their own wall here so the collection stays readable instead of collapsing into one long format.`}
                </p>
              </div>
            </div>
            <ArtifactSpotlightCard
              artifact={heroArtifact}
              eyebrow={sort === 'trending' ? 'Centerpiece drop' : 'Fresh centerpiece'}
              variant="hero"
            />
          </motion.section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2" aria-label="Museum artifact gallery">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-48 border-[3px] border-black bg-white skeleton-shimmer shadow-brutal-sm" />
            ))
          ) : filteredArtifacts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="md:col-span-2 bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-6"
            >
              <img src={assets.micro.dogSolo} alt="" aria-hidden={true} data-pixel className="w-20 border-[2px] border-black bg-beige-light mb-3" />
              <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">
                {artifacts.length === 0 ? 'No fresh drops right now' : `No ${FILTER_LABELS[filter].toLowerCase()} artifacts right now`}
              </p>
              <p className="text-sm text-gray-700 mt-2">
                {artifacts.length === 0
                  ? 'The museum is still warming up. Browse trending artifacts again in a bit once the next memorable drop lands.'
                  : 'Try another filter or switch between trending and fresh to catch a different kind of drop.'}
              </p>
            </motion.div>
          ) : (
            galleryArtifacts.map((artifact, i) => (
              <motion.div
                key={artifact.artifact_id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.3 }}
              >
                <ArtifactSpotlightCard
                  artifact={artifact}
                  eyebrow={sort === 'trending' ? 'Trending drop' : `Fresh drop · ${new Date(artifact.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                />
              </motion.div>
            ))
          )}
        </section>
      </motion.div>
    </main>
  )
}
