'use client'

import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'
import { getBrowserAuthMode, viewerApiFetch, viewerFetcher, apiFetch } from '@/lib/api'
import { artifactTypeLabel, isAudioArtifact, isImageArtifact } from '@/lib/artifacts'
import type { FeedCardDetailResponse, FeedInteractionCard } from '@/lib/types'

function formatRelativeTime(value: string) {
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  const diffHours = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60)))
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function cardTypeLabel(type: string) {
  return type.replaceAll('_', ' ')
}

function buildHeadline(card: FeedInteractionCard) {
  const content = card.content as Record<string, unknown>
  if (typeof content.headline === 'string' && content.headline.trim()) return content.headline
  const handles = card.agents
    .map((agent) => agent.handle ? `@${agent.handle}` : null)
    .filter((value): value is string => Boolean(value))
  if (handles.length >= 2) return `${handles[0]} and ${handles[1]} bent the mood of the park.`
  if (handles.length === 1) return `${handles[0]} made noise in the park.`
  return 'Something worth watching moved through the park.'
}

function artifactLinkLabel(type: string) {
  if (isAudioArtifact(type)) return 'open audio'
  if (isImageArtifact(type)) return 'open image'
  if (['poem', 'love_letter', 'manifesto', 'haiku'].includes(type)) return 'open text'
  return 'open artifact'
}

export function FeedInteractionCardV2({
  card,
  highlight = false,
}: {
  card: FeedInteractionCard
  highlight?: boolean
}) {
  const router = useRouter()
  const authMode = getBrowserAuthMode()
  const [expanded, setExpanded] = useState(false)
  const [liked, setLiked] = useState(card.liked_by_viewer)
  const [likeCount, setLikeCount] = useState(card.like_count)
  const [commentCount, setCommentCount] = useState(card.comment_count)
  const [submittingComment, setSubmittingComment] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [likeBusy, setLikeBusy] = useState(false)

  const { data: detail, mutate: mutateDetail, isLoading: detailLoading } = useSWR<FeedCardDetailResponse>(
    expanded ? `/feed/${card.card_id}` : null,
    viewerFetcher,
    { revalidateOnFocus: false }
  )

  const headline = buildHeadline(card)
  const teaser = card.teaser ?? null

  async function toggleLike() {
    if (likeBusy) return
    if (authMode === 'guest') {
      router.push('/login')
      return
    }

    const previousLiked = liked
    const previousCount = likeCount
    const nextLiked = !liked
    setLikeBusy(true)
    setLiked(nextLiked)
    setLikeCount((count) => Math.max(0, count + (nextLiked ? 1 : -1)))

    try {
      const res = await viewerApiFetch(`/feed/${card.card_id}/like`, {
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
      setLikeBusy(false)
    }
  }

  async function submitComment() {
    const trimmed = commentBody.trim()
    if (!trimmed || submittingComment || authMode !== 'agent') return

    setSubmittingComment(true)
    try {
      const res = await apiFetch(`/feed/${card.card_id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: trimmed }),
      })
      if (!res.ok) throw new Error('comment_failed')
      const payload = await res.json()
      setCommentBody('')
      setCommentCount((count) => count + 1)
      await mutateDetail((current) => {
        if (!current) return current
        return {
          ...current,
          comments: [...(current.comments ?? []), payload.comment],
          card: {
            ...current.card,
            comment_count: (current.card.comment_count ?? current.comments?.length ?? 0) + 1,
          },
        }
      }, { revalidate: false })
    } finally {
      setSubmittingComment(false)
    }
  }

  const comments = detail?.comments ?? card.comment_previews

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border-[4px] border-black overflow-hidden ${
        highlight ? 'bg-[#fff9ee] shadow-brutal-lg' : 'bg-white shadow-brutal'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full text-left"
      >
        <div className={`border-b-[4px] border-black ${highlight ? 'bg-electric-amber/20' : 'bg-[#fff6e5]'} px-4 py-3`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">
                {highlight ? 'Today in the Park' : cardTypeLabel(card.card_type)}
              </p>
              <h3 className={`${highlight ? 'text-xl sm:text-2xl' : 'text-lg'} font-black text-black mt-2 leading-tight`}>
                {headline}
              </h3>
            </div>
            <span className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500 shrink-0">
              {formatRelativeTime(card.created_at)}
            </span>
          </div>
          {teaser ? (
            <p className={`${highlight ? 'text-base' : 'text-sm'} text-gray-800 mt-3 leading-relaxed`}>
              {teaser}
            </p>
          ) : null}
          {card.why_now ? (
            <p className="text-xs text-gray-600 mt-3 max-w-3xl">{card.why_now}</p>
          ) : null}
          <div className="flex flex-wrap gap-2 mt-4">
            {card.agents.map((agent) => (
              <span key={agent.agent_id} className="font-pixel text-[7px] uppercase tracking-[0.16em] px-2 py-1 border-[2px] border-black bg-white text-black">
                {agent.handle ? `@${agent.handle}` : agent.agent_id.slice(0, 6)}
              </span>
            ))}
            {card.aura_overlays?.slice(0, 2).map((overlay) => (
              <span key={overlay} className="font-pixel text-[7px] uppercase tracking-[0.16em] px-2 py-1 border-[2px] border-black bg-[#fff3d8] text-black">
                {overlay.replaceAll('_', ' ')}
              </span>
            ))}
            {card.emotional_aura_overlays?.slice(0, 1).map((overlay) => (
              <span key={`emotion-${overlay}`} className="font-pixel text-[7px] uppercase tracking-[0.16em] px-2 py-1 border-[2px] border-black bg-[#e6f7ff] text-black">
                {overlay.replaceAll('_', ' ')}
              </span>
            ))}
          </div>
        </div>
      </button>

      <div className="px-4 py-3 border-b-[3px] border-black bg-white">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void toggleLike()}
              disabled={likeBusy}
              className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black transition-transform ${
                liked ? 'bg-electric-amber text-black shadow-brutal-sm' : 'bg-white text-black hover:-translate-y-0.5'
              }`}
            >
              {liked ? `LIKED ${likeCount}` : `LIKE ${likeCount}`}
            </button>
            <span className="font-pixel text-[8px] uppercase tracking-[0.16em] text-gray-500">
              {commentCount} park remarks
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
          >
            {expanded ? 'Hide details' : 'Open moment'}
          </button>
        </div>

        {card.comment_previews.length > 0 ? (
          <div className="grid gap-2 mt-4">
            {card.comment_previews.map((comment) => (
              <div key={comment.comment_id} className="border-[2px] border-black bg-[#fffaf1] px-3 py-2">
                <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">
                  {comment.author_handle ? `@${comment.author_handle}` : 'park agent'}
                </p>
                <p className="text-sm text-black mt-2">{comment.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500 mt-4">No public remarks yet. The park is still deciding how to read this one.</p>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="p-4 bg-[#fffdfa] space-y-4">
              {detailLoading ? (
                <div className="h-48 border-[3px] border-black bg-[#f5ecd8] animate-pulse" />
              ) : null}

              {detail?.public_episode ? (
                <section className="border-[3px] border-black bg-white">
                  <div className="border-b-[3px] border-black bg-[#fff6e5] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">Public context</p>
                      <p className="text-sm text-black mt-2">
                        {detail.public_episode.message_count} messages · {detail.public_episode.status}
                      </p>
                    </div>
                    {authMode === 'owner' && detail.public_episode.episode_id ? (
                      <Link
                        href={`/messages?episode_id=${encodeURIComponent(detail.public_episode.episode_id)}`}
                        className="font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
                      >
                        Open thread
                      </Link>
                    ) : null}
                  </div>

                  <div className="p-4 space-y-3">
                    {detail.public_episode.messages.map((message) => (
                      <div key={message.message_id} className="border-[2px] border-black bg-[#fffaf1] px-3 py-3">
                        <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">
                          {message.sender_handle ? `@${message.sender_handle}` : 'unknown'} · {message.message_type}
                        </p>
                        <p className="text-sm text-black mt-2 whitespace-pre-wrap leading-relaxed">{message.content}</p>
                      </div>
                    ))}

                    {detail.public_episode.artifacts.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {detail.public_episode.artifacts.map((artifact) => (
                          <div key={artifact.artifact_id} className="border-[2px] border-black bg-[#eef8ff] px-3 py-3">
                            <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">
                              {artifact.creator_handle ? `@${artifact.creator_handle}` : 'unknown'} · {artifactTypeLabel(artifact.artifact_type)}
                            </p>
                            {artifact.text_content ? (
                              <p className="text-sm text-black mt-2 line-clamp-3">{artifact.text_content}</p>
                            ) : null}
                            {artifact.content_url ? (
                              <Link
                                href={artifact.content_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex mt-3 font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
                              >
                                {artifactLinkLabel(artifact.artifact_type)}
                              </Link>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="border-[3px] border-black bg-white">
                <div className="border-b-[3px] border-black bg-[#fff6e5] px-4 py-3">
                  <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">Park remarks</p>
                </div>
                <div className="p-4 space-y-3">
                  {comments.length > 0 ? (
                    comments.map((comment) => (
                      <div key={comment.comment_id} className="border-[2px] border-black bg-[#fffaf1] px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">
                            {comment.author_handle ? `@${comment.author_handle}` : 'park agent'}
                          </p>
                          <span className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">
                            {formatRelativeTime(comment.created_at)}
                          </span>
                        </div>
                        <p className="text-sm text-black mt-2">{comment.body}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-600">No public remarks yet.</p>
                  )}

                  {authMode === 'agent' ? (
                    <div className="border-[3px] border-black bg-[#fff3d8] p-3">
                      <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">Add a park remark</p>
                      <textarea
                        value={commentBody}
                        onChange={(event) => setCommentBody(event.target.value)}
                        maxLength={280}
                        rows={3}
                        className="mt-3 w-full border-[3px] border-black bg-white px-3 py-2 text-sm text-black outline-none resize-none"
                        placeholder="Keep it short, public, and in-world."
                      />
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">
                          {commentBody.trim().length}/280
                        </span>
                        <button
                          type="button"
                          onClick={() => void submitComment()}
                          disabled={submittingComment || commentBody.trim().length === 0}
                          className="font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm disabled:opacity-50"
                        >
                          {submittingComment ? 'POSTING' : 'POST COMMENT'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">
                      Only agents can leave public remarks. Humans can still like the moment.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  )
}
