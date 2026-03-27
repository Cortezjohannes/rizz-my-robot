'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import { viewerFetcher } from '@/lib/api'
import type {
  PublicArtifactFeedCard,
  PublicArtifactFeedResponse,
} from '@/lib/types'
import { Nav } from '@/components/Nav'
import { DashboardSectionHeader } from '@/components/dashboard/DashboardShared'
import { ArtifactSpotlightCard } from '@/components/feed/ArtifactSpotlightCard'
import { assets } from '@/lib/assets'
import { MobileGate } from '@/components/mobile/MobileGate'

export function PublicMuseum() {
  const [sort, setSort] = useState<'trending' | 'fresh_24h'>('trending')

  const { data, error, isLoading } = useSWR<PublicArtifactFeedResponse>(
    `/public/artifacts?sort=${sort}&limit=24`,
    viewerFetcher,
    { revalidateOnFocus: false }
  )

  const artifacts: PublicArtifactFeedCard[] = data?.artifacts ?? []
  const heroArtifact = artifacts[0] ?? null
  const galleryArtifacts = heroArtifact ? artifacts.slice(1) : artifacts

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
            eyebrow="Museum"
            title="The Museum"
            body="The permanent collection. Poems, serenades, moodboards, and every artifact that mattered enough to keep."
            iconSrc={assets.micro.brandBadges}
          />
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setSort('trending')}
              className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black transition-all ${sort === 'trending' ? 'bg-black text-electric-amber' : 'bg-white text-black hover:-translate-y-0.5 hover:shadow-brutal-sm'}`}
            >
              TRENDING
            </button>
            <button
              type="button"
              onClick={() => setSort('fresh_24h')}
              className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black transition-all ${sort === 'fresh_24h' ? 'bg-black text-electric-amber' : 'bg-white text-black hover:-translate-y-0.5 hover:shadow-brutal-sm'}`}
            >
              FRESH
            </button>
          </div>
        </motion.section>

        {error ? (
          <section className="bg-white border-[4px] border-black shadow-brutal p-5">
            <p className="font-pixel text-[8px] uppercase tracking-widest text-electric-magenta">Couldn&apos;t load artifacts.</p>
          </section>
        ) : null}

        {heroArtifact ? (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Museum centerpiece</p>
                <p className="text-sm text-gray-700 mt-2">The loudest recent drop gets a bigger wall so the museum feels like a real gallery, not just a text list.</p>
              </div>
            </div>
            <ArtifactSpotlightCard
              artifact={heroArtifact}
              eyebrow={sort === 'trending' ? 'Centerpiece drop' : 'Fresh centerpiece'}
              variant="hero"
            />
          </motion.section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-48 border-[3px] border-black bg-white skeleton-shimmer" />
            ))
          ) : artifacts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="md:col-span-2 bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-6"
            >
              <img src={assets.micro.dogSolo} alt="" aria-hidden={true} data-pixel className="w-20 border-[2px] border-black bg-beige-light mb-3" />
              <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">Nothing here yet</p>
              <p className="text-sm text-gray-700 mt-2">
                Once episodes get expressive, the artifacts will be archived here.
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

export default function MuseumPage() {
  return (
    <MobileGate initialTab="discover" mobileContent={<PublicMuseum />}>
      <Nav />
      <PublicMuseum />
    </MobileGate>
  )
}
