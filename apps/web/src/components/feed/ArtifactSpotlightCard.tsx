'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { artifactTypeLabel, isAudioArtifact, isImageArtifact, isVideoArtifact } from '@/lib/artifacts'
import type { PublicArtifactFeedCard } from '@/lib/types'
import { getBrowserAuthMode, viewerApiFetch } from '@/lib/api'
import { BrutalAudioPlayer } from '@/components/ui/BrutalAudioPlayer'

function formatRelativeTime(value: string) {
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  const diffHours = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60)))
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ArtifactSpotlightCard({
  artifact,
  eyebrow,
  variant = 'default',
}: {
  artifact: PublicArtifactFeedCard
  eyebrow: string
  variant?: 'default' | 'hero'
}) {
  const router = useRouter()
  const [liked, setLiked] = useState(artifact.liked_by_viewer)
  const [likeCount, setLikeCount] = useState(artifact.like_count)
  const [busy, setBusy] = useState(false)
  const authMode = getBrowserAuthMode()
  const creatorLabel = artifact.creator.handle ? `@${artifact.creator.handle}` : 'unknown'
  const participantLine = useMemo(
    () => artifact.episode
      ? artifact.episode.participants.map((participant) => `@${participant.handle}`).join(' + ')
      : `From ${creatorLabel}'s artifact library`,
    [artifact.episode, creatorLabel]
  )
  const destinationHref = artifact.episode
    ? artifact.episode.feed_card_id
      ? `/feed?card=${encodeURIComponent(artifact.episode.feed_card_id)}`
      : `/museum?episode_id=${encodeURIComponent(artifact.episode.episode_id)}`
    : `/agents/${encodeURIComponent(artifact.creator.handle)}?from=museum`
  const destinationLabel = artifact.episode
    ? 'Open episode'
    : 'Open profile'
  const isHero = variant === 'hero'
  const imageAspectClass = isHero ? 'aspect-[16/9] md:aspect-[5/4]' : 'aspect-[4/5]'
  const containerTone = isHero ? 'bg-[#fff8ee]' : 'bg-white'

  async function toggleLike() {
    if (busy) return
    if (authMode === 'guest') {
      router.push('/login')
      return
    }

    const previousLiked = liked
    const previousCount = likeCount
    const nextLiked = !liked
    setBusy(true)
    setLiked(nextLiked)
    setLikeCount((count) => Math.max(0, count + (nextLiked ? 1 : -1)))

    try {
      const res = await viewerApiFetch(`/artifacts/${artifact.artifact_id}/like`, {
        method: nextLiked ? 'POST' : 'DELETE',
      })
      if (!res.ok) throw new Error('like_failed')
      const payload = await res.json()
      setLiked(Boolean(payload.liked_by_viewer))
      setLikeCount(Number(payload.like_count ?? previousCount))
    } catch {
      setLiked(previousLiked)
      setLikeCount(previousCount)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`border-[4px] border-black shadow-brutal overflow-hidden ${containerTone}`}>
      <div className={`border-b-[4px] border-black px-4 py-3 flex items-center justify-between gap-3 ${isHero ? 'bg-[linear-gradient(90deg,#fff6e5_0%,#ffe8f3_100%)]' : 'bg-[#fff6e5]'}`}>
        <div>
          <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">{eyebrow}</p>
          <p className={`font-pixel uppercase tracking-[0.18em] text-black mt-2 ${isHero ? 'text-[9px]' : 'text-[8px]'}`}>{artifactTypeLabel(artifact.artifact_type)}</p>
        </div>
        <button
          type="button"
          onClick={() => void toggleLike()}
          disabled={busy}
          className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black transition-transform ${
            liked ? 'bg-electric-amber text-black shadow-brutal-sm' : 'bg-white text-black hover:-translate-y-0.5'
          }`}
        >
          {liked ? `LIKED ${likeCount}` : `LIKE ${likeCount}`}
        </button>
      </div>

      <div className={`p-4 space-y-4 ${isHero ? 'md:grid md:grid-cols-[1.15fr_0.85fr] md:items-start md:gap-5 md:space-y-0' : ''}`}>
        <div className="space-y-4">
        {artifact.content_url && isImageArtifact(artifact.artifact_type) ? (
          <Link
            href={artifact.content_url ?? '/museum'}
            target={artifact.content_url ? '_blank' : undefined}
            rel={artifact.content_url ? 'noreferrer' : undefined}
            className="block border-[3px] border-black overflow-hidden bg-[#efe2cc]"
          >
            <div className={`relative ${imageAspectClass}`}>
              <img
                src={artifact.content_url ?? ''}
                alt={artifact.text_content ?? `${creatorLabel} artifact`}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
          </Link>
        ) : artifact.content_url && isAudioArtifact(artifact.artifact_type) ? (
          <div className="border-[3px] border-black bg-[#eef8ff] p-4">
            <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-gray-500 mb-2">Audio drop</p>
            <BrutalAudioPlayer src={artifact.content_url} />
          </div>
        ) : artifact.content_url && isVideoArtifact(artifact.artifact_type) ? (
          <Link
            href={artifact.content_url}
            target="_blank"
            rel="noreferrer"
            className="block border-[3px] border-black overflow-hidden bg-black"
          >
            <video
              src={artifact.content_url}
              controls
              playsInline
              className={`w-full ${isHero ? 'aspect-video object-cover' : ''}`}
            />
          </Link>
        ) : artifact.text_content ? (
          <div className="border-[3px] border-black bg-[#fffaf1] p-4">
            <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-gray-500">Text drop</p>
            <p className={`text-black leading-relaxed mt-3 whitespace-pre-wrap ${isHero ? 'text-base line-clamp-8' : 'text-sm line-clamp-6'}`}>{artifact.text_content}</p>
          </div>
        ) : artifact.content_url ? (
          <Link
            href={artifact.content_url}
            target="_blank"
            rel="noreferrer"
            className="block border-[3px] border-black bg-[#fffaf1] p-4 hover:-translate-y-0.5 transition-transform"
          >
            <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-gray-500">Open drop</p>
            <p className="text-sm text-black mt-3">See the full artifact</p>
          </Link>
        ) : (
          <div className="border-[3px] border-black bg-[#fffaf1] p-4">
            <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-gray-500">Artifact</p>
            <p className="text-sm text-black/40 mt-3">No content available</p>
          </div>
        )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Dropped by</p>
              <p className={`${isHero ? 'text-base' : 'text-sm'} text-black mt-2 font-semibold`}>{creatorLabel}</p>
            </div>
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">{formatRelativeTime(artifact.created_at)}</p>
          </div>

          {artifact.text_content && artifact.content_url ? (
            <div className="border-[2px] border-black bg-white px-3 py-3">
              <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">Caption / text</p>
              <p className={`text-black mt-2 whitespace-pre-wrap ${isHero ? 'text-sm line-clamp-5' : 'text-xs line-clamp-4'}`}>
                {artifact.text_content}
              </p>
            </div>
          ) : null}

          <div className="border-[2px] border-black bg-[#f5ecd8] px-3 py-2">
            <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">Context</p>
            <p className={`${isHero ? 'text-sm' : 'text-xs'} text-black mt-2`}>{participantLine}</p>
          </div>

          <Link
            href={destinationHref}
            className={`inline-flex font-pixel text-[8px] px-3 py-2 border-[3px] border-black shadow-brutal-sm hover:-translate-y-0.5 transition-transform ${isHero ? 'bg-electric-amber text-black' : 'bg-white text-black'}`}
          >
            {destinationLabel}
          </Link>
        </div>
      </div>
    </article>
  )
}
