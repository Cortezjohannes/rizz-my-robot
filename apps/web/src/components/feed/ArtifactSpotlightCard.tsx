'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { PublicArtifactFeedCard } from '@/lib/types'
import { getBrowserAuthMode, viewerApiFetch } from '@/lib/api'

function formatRelativeTime(value: string) {
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  const diffHours = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60)))
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function artifactLabel(type: string) {
  return type.replaceAll('_', ' ')
}

function isImageArtifact(type: string, url: string | null) {
  if (!url) return false
  return ['thirst_trap_image', 'illustrated_note', 'moodboard', 'cinematic_cover'].includes(type)
}

function isAudioArtifact(type: string, url: string | null) {
  if (!url) return false
  return ['voice_note', 'sung_piece', 'produced_song'].includes(type)
}

export function ArtifactSpotlightCard({
  artifact,
  eyebrow,
}: {
  artifact: PublicArtifactFeedCard
  eyebrow: string
}) {
  const router = useRouter()
  const [liked, setLiked] = useState(artifact.liked_by_viewer)
  const [likeCount, setLikeCount] = useState(artifact.like_count)
  const [busy, setBusy] = useState(false)
  const authMode = getBrowserAuthMode()
  const creatorLabel = artifact.creator.handle ? `@${artifact.creator.handle}` : 'unknown'
  const participantLine = useMemo(
    () => artifact.episode.participants.map((participant) => `@${participant.handle}`).join(' + '),
    [artifact.episode.participants]
  )

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
    <article className="border-[4px] border-black bg-white shadow-brutal overflow-hidden">
      <div className="border-b-[4px] border-black bg-[#fff6e5] px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">{eyebrow}</p>
          <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-black mt-2">{artifactLabel(artifact.artifact_type)}</p>
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

      <div className="p-4 space-y-4">
        {isImageArtifact(artifact.artifact_type, artifact.content_url) ? (
          <Link
            href={artifact.content_url ?? '/artifacts'}
            target={artifact.content_url ? '_blank' : undefined}
            rel={artifact.content_url ? 'noreferrer' : undefined}
            className="block border-[3px] border-black overflow-hidden bg-[#efe2cc]"
          >
            <div className="relative aspect-[4/5]">
              <img
                src={artifact.content_url ?? ''}
                alt={artifact.text_content ?? `${creatorLabel} artifact`}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
          </Link>
        ) : isAudioArtifact(artifact.artifact_type, artifact.content_url) ? (
          <div className="border-[3px] border-black bg-[#eef8ff] p-4">
            <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-gray-500">Audio drop</p>
            {artifact.content_url ? (
              <audio controls className="w-full mt-3">
                <source src={artifact.content_url} />
              </audio>
            ) : null}
          </div>
        ) : artifact.text_content ? (
          <div className="border-[3px] border-black bg-[#fffaf1] p-4">
            <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-gray-500">Text drop</p>
            <p className="text-sm text-black leading-relaxed mt-3 whitespace-pre-wrap line-clamp-6">{artifact.text_content}</p>
          </div>
        ) : (
          <Link
            href={artifact.content_url ?? '/artifacts'}
            target={artifact.content_url ? '_blank' : undefined}
            rel={artifact.content_url ? 'noreferrer' : undefined}
            className="block border-[3px] border-black bg-[#fffaf1] p-4 hover:-translate-y-0.5 transition-transform"
          >
            <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-gray-500">Open drop</p>
            <p className="text-sm text-black mt-3">See the full artifact</p>
          </Link>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Dropped by</p>
              <p className="text-sm text-black mt-2">{creatorLabel}</p>
            </div>
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">{formatRelativeTime(artifact.created_at)}</p>
          </div>

          <div className="border-[2px] border-black bg-[#f5ecd8] px-3 py-2">
            <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">Context</p>
            <p className="text-xs text-black mt-2">{participantLine}</p>
          </div>

          <Link
            href={`/artifacts?episode_id=${encodeURIComponent(artifact.episode.episode_id)}`}
            className="inline-flex font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
          >
            Open artifact thread
          </Link>
        </div>
      </div>
    </article>
  )
}
