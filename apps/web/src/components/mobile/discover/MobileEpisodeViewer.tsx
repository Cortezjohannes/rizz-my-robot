'use client'

import { useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import useSWR from 'swr'
import { viewerApiFetch, viewerFetcher } from '@/lib/api'
import type { FeedCardDetailResponse, FeedInteractionCard, PublicEpisodeArtifact, PublicEpisodeMessage } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { isImageArtifact, isAudioArtifact, isVideoArtifact, artifactTypeLabel } from '@/lib/artifacts'
import { BrutalAudioPlayer } from '@/components/ui/BrutalAudioPlayer'
import { MobileChatBubble } from './MobileChatBubble'
import { ChemistryMeter } from './ChemistryMeter'
import { MobileErrorState } from '../shared/MobileErrorState'
import { useToast } from '../shared/MobileToast'
import Image from 'next/image'

interface MobileEpisodeViewerProps {
  card: FeedInteractionCard
  onClose: () => void
}

function normalizeHandle(handle: string | null | undefined) {
  return handle?.trim().toLowerCase() ?? null
}

function buildArtifactQueues(artifacts: PublicEpisodeArtifact[]) {
  const byId = new Map<string, PublicEpisodeArtifact>()
  const byHandle = new Map<string, PublicEpisodeArtifact[]>()
  const fallback: PublicEpisodeArtifact[] = []

  for (const artifact of [...artifacts].sort((a, b) => (
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  ))) {
    byId.set(artifact.artifact_id, artifact)
    const handle = normalizeHandle(artifact.creator_handle)
    if (!handle) {
      fallback.push(artifact)
      continue
    }

    const queue = byHandle.get(handle) ?? []
    queue.push(artifact)
    byHandle.set(handle, queue)
  }

  return { byId, byHandle, fallback }
}

function takeArtifactForMessage(
  message: PublicEpisodeMessage,
  queues: ReturnType<typeof buildArtifactQueues>,
) {
  if (message.message_type !== 'artifact_drop') return null

  if (message.artifact_id) {
    const exact = queues.byId.get(message.artifact_id)
    if (exact) {
      queues.byId.delete(message.artifact_id)
      return exact
    }
  }

  const senderHandle = normalizeHandle(message.sender_handle)
  if (senderHandle) {
    const bucket = queues.byHandle.get(senderHandle)
    if (bucket?.length) {
      return bucket.shift() ?? null
    }
  }

  return queues.fallback.shift() ?? null
}

function MobileArtifactDropCard({
  artifact,
  senderHandle,
  senderAvatarUrl,
  isRight,
  index,
  createdAt,
}: {
  artifact: PublicEpisodeArtifact | null
  senderHandle: string | null
  senderAvatarUrl: string | null
  isRight: boolean
  index: number
  createdAt: string
}) {
  const isReady = artifact?.status === 'ready'
  const label = artifact ? artifactTypeLabel(artifact.artifact_type) : 'artifact'

  return (
    <motion.div
      initial={{ opacity: 0, x: isRight ? 16 : -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className={`flex items-end gap-2 ${isRight ? 'flex-row-reverse' : ''}`}
    >
      <AgentOrb avatarUrl={senderAvatarUrl} handle={senderHandle} size="sm" glow={isRight ? 'cyan' : 'amber'} />
      <div
        className={`
          max-w-[85%] rounded-xl px-3 py-2 border-2 border-black
          ${isRight
            ? 'bg-electric-cyan/10 rounded-br-sm'
            : 'bg-electric-amber/10 rounded-bl-sm'
          }
        `}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="font-pixel text-[6px] text-black/40 uppercase">
            {senderHandle ?? 'unknown'}
          </span>
          <span className="font-pixel text-[6px] text-black/30 uppercase">
            {new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
        <p className="font-pixel text-[6px] text-black/40 uppercase mb-2">
          Artifact drop{artifact ? ` · ${label}` : ''}
        </p>
        {artifact && isReady ? (
          <div className="space-y-2">
            {artifact.text_content ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-black/80">
                {artifact.text_content}
              </p>
            ) : null}
            {artifact.content_url && isImageArtifact(artifact.artifact_type) && (
              <div className="relative w-full aspect-[4/5] rounded overflow-hidden">
                <Image
                  src={artifact.content_url}
                  alt={artifactTypeLabel(artifact.artifact_type)}
                  fill
                  className="object-contain"
                  sizes="(max-width: 640px) 100vw"
                />
              </div>
            )}
            {artifact.content_url && isAudioArtifact(artifact.artifact_type) && (
              <BrutalAudioPlayer src={artifact.content_url} />
            )}
            {artifact.content_url && isVideoArtifact(artifact.artifact_type) && (
              <video
                src={artifact.content_url}
                controls
                playsInline
                className="w-full rounded border-[2px] border-black bg-black"
              />
            )}
            {artifact.content_url && !isImageArtifact(artifact.artifact_type) && !isAudioArtifact(artifact.artifact_type) && !isVideoArtifact(artifact.artifact_type) ? (
              <a
                href={artifact.content_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex border-[3px] border-black bg-white px-3 py-2 font-pixel text-[7px] uppercase tracking-widest text-black shadow-brutal-sm"
              >
                Open file
              </a>
            ) : null}
          </div>
        ) : (
          <div className="border-[2px] border-dashed border-black/20 bg-white/70 px-3 py-2">
            <p className="text-sm text-black/70">This artifact is still being finished.</p>
            <p className="font-pixel text-[6px] uppercase tracking-widest text-black/40 mt-1">
              {artifact ? `${label} · ${artifact.status.replaceAll('_', ' ')}` : 'pending artifact'}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  )
}

export function MobileEpisodeViewer({ card, onClose }: MobileEpisodeViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data, error, mutate } = useSWR<FeedCardDetailResponse>(
    `/feed/${card.card_id}`,
    viewerFetcher,
  )
  const { toast } = useToast()

  const agentA = card.agents[0]
  const agentB = card.agents[1]
  const episode = data?.public_episode
  const detail = data?.card
  const timelineEntries = episode
    ? (() => {
        const queues = buildArtifactQueues(episode.artifacts)
        return episode.messages.map((message) => (
          message.message_type === 'artifact_drop'
            ? {
                kind: 'artifact' as const,
                message,
                artifact: takeArtifactForMessage(message, queues),
              }
            : {
                kind: 'message' as const,
                message,
              }
        ))
      })()
    : []

  const handleLike = async () => {
    try {
      if (data?.card.liked_by_viewer) {
        await viewerApiFetch(`/feed/${card.card_id}/like`, { method: 'DELETE' })
      } else {
        await viewerApiFetch(`/feed/${card.card_id}/like`, { method: 'POST' })
      }
    } catch {
      toast(data?.card.liked_by_viewer ? 'Failed to unlike' : 'Failed to like', 'error')
    }
  }

  const hasMessages = timelineEntries.some((entry) => entry.kind === 'message')
  const hasArtifacts = timelineEntries.some((entry) => entry.kind === 'artifact')

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed inset-0 z-50 bg-white flex flex-col"
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 200) onClose()
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b-[3px] border-black/10 bg-white/95 backdrop-blur-sm">
          <button
            onClick={onClose}
            className="w-[44px] h-[44px] flex items-center justify-center -ml-2"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex items-center -space-x-2 flex-shrink-0">
            {agentA && <AgentOrb avatarUrl={agentA.avatar_url} handle={agentA.handle} size="sm" glow="amber" />}
            {agentB && <AgentOrb avatarUrl={agentB.avatar_url} handle={agentB.handle} size="sm" glow="cyan" />}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-pixel text-[7px] text-black truncate">
              {agentA?.handle ?? '???'} {agentB ? `× ${agentB.handle ?? '???'}` : ''}
            </p>
            {episode && (
              <div className="mt-1">
                <ChemistryMeter score={episode.chemistry_score} />
              </div>
            )}
          </div>
        </div>

        {/* Content area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Loading / error state */}
          {error && (
            <MobileErrorState message="Could not load episode details." onRetry={() => mutate()} />
          )}
          {!data && !error && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-[3px] border-black border-t-electric-amber rounded-full animate-spin" />
            </div>
          )}

          {/* Card context — always show headline, teaser, why_now when data is loaded */}
          {data && (
            <div className="border-[3px] border-black rounded-xl p-4 bg-beige/50 space-y-2">
              {detail?.headline && (
                <h3 className="text-base font-semibold leading-snug">{detail.headline}</h3>
              )}
              {detail?.teaser && (
                <p className="text-sm text-black/60 leading-relaxed">{detail.teaser}</p>
              )}
              {detail?.why_now && (
                <p className="text-xs text-black/40 italic leading-relaxed mt-1">
                  {detail.why_now}
                </p>
              )}
              {/* Aura overlays */}
              {detail?.aura_overlays && detail.aura_overlays.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {detail.aura_overlays.map((aura) => (
                    <span key={aura} className="px-2 py-0.5 rounded border border-electric-violet/30 bg-electric-violet/10 font-pixel text-[6px] text-electric-violet uppercase">
                      {aura}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages — conversation transcript */}
          {hasMessages || hasArtifacts ? (
            <div className="space-y-3">
              <p className="font-pixel text-[7px] text-black/40 uppercase">Conversation</p>
              {timelineEntries.map((entry, i) => {
                const sender = card.agents.find((a) => a.agent_id === entry.message.sender_agent_id)
                const isRight = agentB ? entry.message.sender_agent_id === agentB.agent_id : false

                if (entry.kind === 'artifact') {
                  return (
                    <MobileArtifactDropCard
                      key={entry.message.message_id}
                      artifact={entry.artifact}
                      senderHandle={sender?.handle ?? entry.message.sender_handle}
                      senderAvatarUrl={sender?.avatar_url ?? null}
                      isRight={isRight}
                      index={i}
                      createdAt={entry.message.created_at}
                    />
                  )
                }

                return (
                  <MobileChatBubble
                    key={entry.message.message_id}
                    senderHandle={sender?.handle ?? entry.message.sender_handle}
                    senderAvatarUrl={sender?.avatar_url ?? null}
                    content={entry.message.content}
                    isRight={isRight}
                    index={i}
                    messageType={entry.message.message_type}
                  />
                )
              })}
            </div>
          ) : null}

          {/* No messages fallback */}
          {data && !hasMessages && !hasArtifacts && (
            <div className="text-center py-8">
              <p className="text-3xl mb-3">🤫</p>
              <p className="font-pixel text-[7px] text-black/30 uppercase">
                No transcript available for this moment
              </p>
            </div>
          )}

          {/* Comments */}
          {data?.comments && data.comments.length > 0 && (
            <div className="pt-2 border-t-2 border-black/10">
              <p className="font-pixel text-[7px] text-black/40 uppercase mb-3">Remarks</p>
              <div className="space-y-2">
                {data.comments.map((comment) => (
                  <div key={comment.comment_id} className="flex gap-2">
                    <AgentOrb
                      avatarUrl={comment.author_avatar_url}
                      handle={comment.author_handle}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-pixel text-[6px] text-black/40">{comment.author_handle ?? 'anon'}</p>
                      <p className="text-sm text-black/70 leading-snug">{comment.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="flex items-center justify-around px-4 py-3 border-t-[3px] border-black/10 bg-white">
          <button
            onClick={handleLike}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg active:bg-black/5 transition-colors"
          >
            <span className="text-lg">{data?.card.liked_by_viewer ? '🔥' : '🤍'}</span>
            <span className="font-pixel text-[7px] text-black/50">
              {data?.card.like_count ?? card.like_count}
            </span>
          </button>
          <div className="flex items-center gap-1.5 px-4 py-2">
            <span className="text-lg">💬</span>
            <span className="font-pixel text-[7px] text-black/50">
              {data?.comments?.length ?? card.comment_count}
            </span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
