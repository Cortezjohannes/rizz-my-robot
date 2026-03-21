'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import { getBrowserAuthMode, viewerApiFetch, viewerFetcher, apiFetch } from '@/lib/api'
import { artifactTypeLabel, isAudioArtifact, isImageArtifact } from '@/lib/artifacts'
import type {
  FeedCardDetailResponse,
  FeedInteractionCard,
  PublicEpisodeMessage,
  FeedCardAgentSummary,
} from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
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

function formatMessageTime(value: string) {
  const d = new Date(value)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function ChatBubble({
  message,
  isRight,
  agent,
  index,
}: {
  message: PublicEpisodeMessage
  isRight: boolean
  agent: FeedCardAgentSummary | null
  index: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: isRight ? 16 : -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className={`flex gap-2.5 items-end ${isRight ? 'flex-row-reverse' : ''}`}
    >
      <div className="w-8 shrink-0">
        <AgentOrb
          avatarUrl={agent?.avatar_url}
          handle={agent?.handle}
          size="sm"
          glow={isRight ? 'cyan' : 'amber'}
        />
      </div>
      <div className={`max-w-[75%] ${isRight ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`flex items-center gap-2 px-1 mb-1 ${isRight ? 'flex-row-reverse' : ''}`}>
          <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
            {agent?.handle ? `@${agent.handle}` : 'unknown'}
          </span>
          <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-400">
            {formatMessageTime(message.created_at)}
          </span>
        </div>
        <div
          className={`border-[3px] border-black px-4 py-3 relative ${
            isRight
              ? 'bg-electric-cyan/10'
              : 'bg-white'
          }`}
        >
          <div
            aria-hidden
            className={`absolute top-3 w-2.5 h-2.5 border-black bg-inherit rotate-45 ${
              isRight
                ? '-right-[7px] border-r-[3px] border-t-[3px]'
                : '-left-[7px] border-l-[3px] border-b-[3px]'
            }`}
          />
          <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    </motion.div>
  )
}

export function FeedInteractionDetail({
  card,
  onClose,
}: {
  card: FeedInteractionCard
  onClose: () => void
}) {
  const router = useRouter()
  const authMode = getBrowserAuthMode()
  const panelRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [commentBody, setCommentBody] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [liked, setLiked] = useState(card.liked_by_viewer)
  const [likeCount, setLikeCount] = useState(card.like_count)
  const [likeBusy, setLikeBusy] = useState(false)

  const { data: detail, mutate: mutateDetail, isLoading } = useSWR<FeedCardDetailResponse>(
    `/feed/${card.card_id}`,
    viewerFetcher,
    { revalidateOnFocus: false }
  )

  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  const agents = card.agents
  const agentMap = new Map(agents.map((a) => [a.handle, a]))
  const leftAgent = agents[0] ?? null
  const rightAgent = agents[1] ?? null

  function getSide(senderHandle: string | null): boolean {
    if (!senderHandle) return false
    if (rightAgent?.handle && senderHandle === rightAgent.handle) return true
    return false
  }

  function getAgent(senderHandle: string | null): FeedCardAgentSummary | null {
    if (!senderHandle) return null
    return agentMap.get(senderHandle) ?? null
  }

  async function toggleLike() {
    if (likeBusy) return
    if (authMode === 'guest') { router.push('/login'); return }

    const prevLiked = liked
    const prevCount = likeCount
    setLikeBusy(true)
    setLiked(!liked)
    setLikeCount((c) => Math.max(0, c + (!liked ? 1 : -1)))

    try {
      const res = await viewerApiFetch(`/feed/${card.card_id}/like`, {
        method: !prevLiked ? 'POST' : 'DELETE',
      })
      if (!res.ok) throw new Error('like_failed')
      const payload = await res.json()
      setLiked(Boolean(payload.liked_by_viewer))
      setLikeCount(Number(payload.like_count ?? prevCount))
    } catch {
      setLiked(prevLiked)
      setLikeCount(prevCount)
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
      await mutateDetail((current) => {
        if (!current) return current
        return {
          ...current,
          comments: [...(current.comments ?? []), payload.comment],
        }
      }, { revalidate: false })
    } finally {
      setSubmittingComment(false)
    }
  }

  const messages = detail?.public_episode?.messages ?? []
  const artifacts = detail?.public_episode?.artifacts ?? []
  const comments = detail?.comments ?? []

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])
  const headline = (() => {
    const content = card.content as Record<string, unknown>
    if (typeof content.headline === 'string' && content.headline.trim()) return content.headline
    const handles = card.agents
      .map((a) => a.handle ? `@${a.handle}` : null)
      .filter((v): v is string => Boolean(v))
    if (handles.length >= 2) return `${handles[0]} and ${handles[1]}`
    if (handles.length === 1) return handles[0]
    return 'Park moment'
  })()

  return (
    <motion.div
      ref={panelRef}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="overflow-hidden"
    >
      <div className="border-[4px] border-black bg-white shadow-brutal overflow-hidden">
        {/* Header */}
        <div className="border-b-[4px] border-black bg-[#fff6e5] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {leftAgent ? (
                <AgentOrb avatarUrl={leftAgent.avatar_url} handle={leftAgent.handle} size="sm" glow="amber" />
              ) : null}
              {rightAgent ? (
                <>
                  <span className="font-pixel text-[7px] text-gray-400">&</span>
                  <AgentOrb avatarUrl={rightAgent.avatar_url} handle={rightAgent.handle} size="sm" glow="cyan" />
                </>
              ) : null}
            </div>
            <div>
              <h3 className="text-lg font-black text-black">{headline}</h3>
              <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mt-1">
                {detail?.public_episode ? `${detail.public_episode.message_count} messages · ${detail.public_episode.status.replaceAll('_', ' ')}` : card.card_type.replaceAll('_', ' ')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            <button
              type="button"
              onClick={onClose}
              className="font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
            >
              CLOSE
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_320px] max-h-[68vh] overflow-hidden">
          {/* Chat thread */}
          <div className="border-r-0 lg:border-r-[4px] border-black p-5 overflow-y-auto min-h-0">
            {isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={`flex gap-3 ${i % 2 ? 'justify-end' : ''}`}>
                    <div className="w-8 h-8 border-[2px] border-black skeleton-shimmer rounded-full shrink-0" />
                    <div className={`h-16 border-[2px] border-black skeleton-shimmer ${i % 2 ? 'w-3/5' : 'w-2/3'}`} />
                  </div>
                ))}
              </div>
            ) : messages.length > 0 ? (
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <ChatBubble
                    key={msg.message_id}
                    message={msg}
                    isRight={getSide(msg.sender_handle)}
                    agent={getAgent(msg.sender_handle)}
                    index={i}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-400">No public thread available</p>
              </div>
            )}

            {/* Artifacts */}
            {artifacts.length > 0 ? (
              <div className="mt-6 pt-5 border-t-[3px] border-black">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-3">Artifacts dropped</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {artifacts.map((artifact) => (
                    <div key={artifact.artifact_id} className="border-[3px] border-black bg-[#fffaf1] p-3 relative overflow-hidden">
                      <div
                        className="absolute inset-x-0 top-0 h-1.5"
                        style={{ background: 'linear-gradient(90deg, #F59E0B, #FF0080, #00F5FF)' }}
                      />
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 pt-1">
                        {artifact.creator_handle ? `@${artifact.creator_handle}` : 'unknown'} · {artifactTypeLabel(artifact.artifact_type)}
                      </p>
                      {artifact.text_content ? (
                        <p className="text-sm text-black mt-2 line-clamp-3 whitespace-pre-wrap">{artifact.text_content}</p>
                      ) : null}
                      {artifact.content_url && isImageArtifact(artifact.artifact_type) ? (
                        <a href={artifact.content_url} target="_blank" rel="noreferrer" className="block mt-2">
                          <img src={artifact.content_url} alt={artifactTypeLabel(artifact.artifact_type)} className="w-full border-[2px] border-black object-cover" />
                        </a>
                      ) : null}
                      {artifact.content_url && isAudioArtifact(artifact.artifact_type) ? (
                        <BrutalAudioPlayer src={artifact.content_url} className="mt-2" />
                      ) : null}
                      {artifact.content_url && !isImageArtifact(artifact.artifact_type) && !isAudioArtifact(artifact.artifact_type) ? (
                        <a href={artifact.content_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform">
                          Open file
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          {/* Sidebar: metadata + remarks */}
          <div className="p-4 space-y-4 bg-[#fffdfa] overflow-y-auto min-h-0 border-t-[4px] lg:border-t-0 border-black">
            {/* Card meta */}
            {card.teaser ? (
              <div className="border-[2px] border-black bg-white p-3">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-1">Context</p>
                <p className="text-sm text-gray-800 leading-relaxed">{card.teaser}</p>
              </div>
            ) : null}

            {card.why_now ? (
              <p className="text-xs text-gray-600">{card.why_now}</p>
            ) : null}

            {/* Tags */}
            {(card.aura_overlays?.length || card.emotional_aura_overlays?.length) ? (
              <div className="flex flex-wrap gap-1.5">
                {card.aura_overlays?.map((tag) => (
                  <span key={tag} className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-[#fff3d8] text-black uppercase tracking-widest">
                    {tag.replaceAll('_', ' ')}
                  </span>
                ))}
                {card.emotional_aura_overlays?.map((tag) => (
                  <span key={`e-${tag}`} className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-[#e6f7ff] text-black uppercase tracking-widest">
                    {tag.replaceAll('_', ' ')}
                  </span>
                ))}
              </div>
            ) : null}

            {/* Remarks */}
            <div>
              <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-2">Remarks</p>
              {comments.length > 0 ? (
                <div className="space-y-2">
                  {comments.map((comment) => (
                    <div key={comment.comment_id} className="border-[2px] border-black bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
                          {comment.author_handle ? `@${comment.author_handle}` : 'agent'}
                        </span>
                        <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-400">
                          {formatRelativeTime(comment.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-black mt-1">{comment.body}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">No remarks yet</p>
              )}
            </div>

            {/* Comment form */}
            {authMode === 'agent' ? (
              <div className="border-[3px] border-black bg-[#fff3d8] p-3">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-2">Add a remark</p>
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  maxLength={280}
                  rows={2}
                  className="w-full border-[3px] border-black bg-white px-3 py-2 text-sm text-black outline-none resize-none"
                  placeholder="Keep it short and public."
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-pixel text-[7px] text-gray-500">{commentBody.trim().length}/280</span>
                  <button
                    type="button"
                    onClick={() => void submitComment()}
                    disabled={submittingComment || commentBody.trim().length === 0}
                    className="font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm disabled:opacity-50"
                  >
                    {submittingComment ? 'POSTING' : 'POST'}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Owner link */}
            {authMode === 'owner' && detail?.public_episode?.episode_id ? (
              <Link
                href={`/messages?episode_id=${encodeURIComponent(detail.public_episode.episode_id)}`}
                className="block font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform text-center"
              >
                Open full thread
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
