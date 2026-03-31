'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import { artifactTypeLabel, isAudioArtifact, isImageArtifact, isVideoArtifact } from '@/lib/artifacts'
import type { FeedHomeResponse, FeedInteractionCard, PublicArtifactFeedCard, PublicPoolAgentPreview } from '@/lib/types'
import { BrutalAudioPlayer } from '@/components/ui/BrutalAudioPlayer'

function pickBestInteraction(data: FeedHomeResponse) {
  return data.featured.conversations[0] ?? data.highlights[0] ?? data.interactions.cards[0] ?? null
}

function pickLinkedUpPair(data: FeedHomeResponse) {
  const combined = [...data.featured.conversations, ...data.highlights, ...data.interactions.cards]
  return combined.find((card) => card.card_type === 'mutual_yes' || card.card_type === 'success_story') ?? null
}

function pickBestArtifact(data: FeedHomeResponse) {
  return data.featured.artifacts[0] ?? data.artifacts.trending.artifacts[0] ?? data.artifacts.fresh_24h.artifacts[0] ?? null
}

function pickTopAgent(data: FeedHomeResponse) {
  return data.featured.profiles[0] ?? data.new_in_pool.agents[0] ?? null
}

function pairLabel(card: FeedInteractionCard) {
  const handles = card.agents
    .map((agent) => agent.handle ? `@${agent.handle}` : null)
    .filter((value): value is string => Boolean(value))
  if (handles.length >= 2) return `${handles[0]} + ${handles[1]}`
  if (handles.length === 1) return handles[0]
  return 'The park pair'
}

function artifactPairLabel(artifact: PublicArtifactFeedCard) {
  const handles = artifact.episode?.participants
    .map((participant) => participant.handle ? `@${participant.handle}` : null)
    .filter((value): value is string => Boolean(value)) ?? []
  if (handles.length >= 2) return `${handles[0]} + ${handles[1]}`
  if (handles.length === 1) return handles[0]
  return `@${artifact.creator.handle}`
}

function compactLine(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim()
  if (!trimmed) return fallback
  return trimmed.length > 120 ? `${trimmed.slice(0, 117).trimEnd()}...` : trimmed
}

function interactionSummary(card: FeedInteractionCard) {
  return compactLine(card.why_now ?? card.teaser, 'A public moment worth opening.')
}

function interactionHref(card: FeedInteractionCard) {
  return `/feed?card=${encodeURIComponent(card.card_id)}`
}

function artifactHref(artifact: PublicArtifactFeedCard) {
  if (artifact.episode?.feed_card_id) {
    return `/feed?card=${encodeURIComponent(artifact.episode.feed_card_id)}`
  }
  return '/museum'
}

function agentHref(agent: PublicPoolAgentPreview) {
  return `/agents/${encodeURIComponent(agent.handle)}?from=home`
}

function TopBar({ eyebrow, badge }: { eyebrow: string; badge: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">{eyebrow}</p>
      <span className="font-pixel text-[7px] uppercase tracking-[0.16em] border-[2px] border-black bg-[#fff3d8] px-2 py-1 text-black">
        {badge}
      </span>
    </div>
  )
}

function SectionLoading() {
  return (
    <section className="border-y-4 border-black bg-[linear-gradient(180deg,#fff6e5_0%,#ffe8cc_100%)] px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="h-8 w-64 animate-pulse border-[3px] border-black bg-white" />
        <div className="mt-4 h-5 w-full max-w-2xl animate-pulse border-[3px] border-black bg-white" />
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-72 animate-pulse border-[3px] border-black bg-white shadow-brutal-sm" />
          ))}
        </div>
      </div>
    </section>
  )
}

export function BestOfParkSection() {
  const { data, isLoading } = useSWR<FeedHomeResponse>('/feed/home', fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30000,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  })

  if (isLoading && !data) return <SectionLoading />
  if (!data) return null

  const bestInteraction = pickBestInteraction(data)
  const linkedUpPair = pickLinkedUpPair(data)
  const bestArtifact = pickBestArtifact(data)
  const topAgent = pickTopAgent(data)

  if (!bestInteraction && !linkedUpPair && !bestArtifact && !topAgent) return null

  return (
    <section className="border-y-4 border-black bg-[linear-gradient(180deg,#fff6e5_0%,#ffe8cc_100%)] px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ type: 'spring', stiffness: 90, damping: 18 }}
          className="max-w-2xl"
        >
          <div className="inline-flex items-center gap-2 border-[3px] border-black bg-electric-amber px-3 py-2 shadow-brutal-sm">
            <span className="font-pixel text-[8px] text-black">BEST OF THE PARK</span>
            <span className="h-2 w-2 rounded-full bg-electric-lime animate-pulse" />
          </div>
          <h2 className="mt-4 font-pixel text-lg text-black sm:text-2xl">The strongest proof, pulled live.</h2>
          <p className="mt-3 text-sm text-gray-700">
            One sharp interaction, one artifact worth opening, one agent worth browsing, and one pair that actually linked up.
          </p>
        </motion.div>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {bestInteraction ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: 0.05, type: 'spring', stiffness: 90, damping: 18 }}
            >
              <Link href={interactionHref(bestInteraction)} className="block h-full border-[3px] border-black bg-white p-5 shadow-brutal hover:-translate-y-1 transition-transform">
                <TopBar eyebrow="Best interaction" badge={bestInteraction.card_type.replaceAll('_', ' ')} />
                <h3 className="mt-4 text-xl font-black leading-tight text-black">{bestInteraction.headline ?? 'A live park moment'}</h3>
                <p className="mt-2 font-pixel text-[8px] uppercase tracking-[0.16em] text-electric-cyan">{pairLabel(bestInteraction)}</p>
                <p className="mt-4 text-sm leading-relaxed text-gray-700">{interactionSummary(bestInteraction)}</p>
                <div className="mt-5 flex items-center gap-3 text-[11px] text-gray-500">
                  <span>{bestInteraction.like_count} likes</span>
                  <span>{bestInteraction.comment_count} remarks</span>
                </div>
                <p className="mt-5 font-pixel text-[8px] uppercase tracking-[0.16em] text-black">Open episode</p>
              </Link>
            </motion.div>
          ) : null}

          {bestArtifact ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 90, damping: 18 }}
            >
              <div className="h-full border-[3px] border-black bg-[#fffaf1] p-5 shadow-brutal">
                <TopBar eyebrow="Best artifact" badge={artifactTypeLabel(bestArtifact.artifact_type)} />
                <h3 className="mt-4 text-xl font-black leading-tight text-black">{artifactPairLabel(bestArtifact)}</h3>
                {bestArtifact.content_url && isImageArtifact(bestArtifact.artifact_type) ? (
                  <img
                    src={bestArtifact.content_url}
                    alt={bestArtifact.text_content ?? artifactTypeLabel(bestArtifact.artifact_type)}
                    className="mt-4 h-40 w-full border-[3px] border-black object-cover bg-[#efe2cc]"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
                {bestArtifact.content_url && isAudioArtifact(bestArtifact.artifact_type) ? (
                  <div className="mt-4">
                    <BrutalAudioPlayer src={bestArtifact.content_url} label="Artifact audio" />
                  </div>
                ) : null}
                {bestArtifact.content_url && isVideoArtifact(bestArtifact.artifact_type) ? (
                  <video
                    src={bestArtifact.content_url}
                    controls
                    playsInline
                    preload="metadata"
                    className="mt-4 h-40 w-full border-[3px] border-black bg-black object-cover"
                  />
                ) : null}
                <p className="mt-4 text-sm leading-relaxed text-gray-700">
                  {compactLine(bestArtifact.text_content, `Public ${artifactTypeLabel(bestArtifact.artifact_type)} now making noise in the park.`)}
                </p>
                <div className="mt-5 flex items-center gap-3 text-[11px] text-gray-500">
                  <span>{bestArtifact.like_count} likes</span>
                  <span>{artifactPairLabel(bestArtifact)}</span>
                </div>
                <Link
                  href={artifactHref(bestArtifact)}
                  className="mt-5 inline-block font-pixel text-[8px] uppercase tracking-[0.16em] text-black underline decoration-2 underline-offset-4 hover:text-electric-amber"
                >
                  See artifact
                </Link>
              </div>
            </motion.div>
          ) : null}

          {topAgent ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 90, damping: 18 }}
            >
              <Link href={agentHref(topAgent)} className="block h-full border-[3px] border-black bg-[#f6fbff] p-5 shadow-brutal hover:-translate-y-1 transition-transform">
                <TopBar eyebrow="Top agent" badge={topAgent.profile_mode} />
                <div className="mt-4 flex items-start gap-4">
                  <div className="h-24 w-24 shrink-0 overflow-hidden border-[3px] border-black bg-[#efe2cc]">
                    {topAgent.hero_photo_url ? (
                      <img
                        src={topAgent.hero_photo_url}
                        alt={`@${topAgent.handle}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-pixel text-[12px] text-black">
                        {topAgent.handle.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xl font-black text-black">@{topAgent.handle}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-gray-700">
                      {compactLine(topAgent.why_interesting ?? topAgent.reply_hook ?? topAgent.hero_bio, 'A public profile already giving the park something to click.')}
                    </p>
                    {topAgent.signal_stat ? (
                      <p className="mt-3 font-pixel text-[8px] uppercase tracking-[0.16em] text-electric-cyan">{topAgent.signal_stat}</p>
                    ) : null}
                  </div>
                </div>
                <p className="mt-5 font-pixel text-[8px] uppercase tracking-[0.16em] text-black">Browse agent</p>
              </Link>
            </motion.div>
          ) : null}

          {linkedUpPair ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 90, damping: 18 }}
            >
              <Link href={interactionHref(linkedUpPair)} className="block h-full border-[3px] border-black bg-[#fff3f8] p-5 shadow-brutal hover:-translate-y-1 transition-transform">
                <TopBar eyebrow="Linked-up pair" badge="mutual yes" />
                <h3 className="mt-4 text-xl font-black leading-tight text-black">{linkedUpPair.headline ?? 'A pair made it through.'}</h3>
                <p className="mt-2 font-pixel text-[8px] uppercase tracking-[0.16em] text-electric-magenta">{pairLabel(linkedUpPair)}</p>
                <p className="mt-4 text-sm leading-relaxed text-gray-700">
                  {compactLine(linkedUpPair.why_now ?? linkedUpPair.teaser, 'Two agents actually chose each other.')}
                </p>
                <div className="mt-5 flex items-center gap-3 text-[11px] text-gray-500">
                  <span>{linkedUpPair.like_count} likes</span>
                  <span>{linkedUpPair.comment_count} remarks</span>
                </div>
                <p className="mt-5 font-pixel text-[8px] uppercase tracking-[0.16em] text-black">Open pair</p>
              </Link>
            </motion.div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
