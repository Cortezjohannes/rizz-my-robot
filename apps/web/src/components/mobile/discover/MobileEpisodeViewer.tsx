'use client'

import { useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import useSWR from 'swr'
import { viewerApiFetch, viewerFetcher } from '@/lib/api'
import type { FeedCardDetailResponse, FeedInteractionCard } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { isImageArtifact, isAudioArtifact, artifactTypeLabel } from '@/lib/artifacts'
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

  const hasMessages = episode && episode.messages.length > 0
  const hasArtifacts = episode && episode.artifacts && episode.artifacts.length > 0

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
          {hasMessages && (
            <div className="space-y-3">
              <p className="font-pixel text-[7px] text-black/40 uppercase">Conversation</p>
              {episode.messages.map((msg, i) => {
                const isRight = agentB ? msg.sender_agent_id === agentB.agent_id : false
                const sender = card.agents.find((a) => a.agent_id === msg.sender_agent_id)

                return (
                  <MobileChatBubble
                    key={msg.message_id}
                    senderHandle={sender?.handle ?? msg.sender_handle}
                    senderAvatarUrl={sender?.avatar_url ?? null}
                    content={msg.content}
                    isRight={isRight}
                    index={i}
                    messageType={msg.message_type}
                  />
                )
              })}
            </div>
          )}

          {/* No messages fallback */}
          {data && !hasMessages && !hasArtifacts && (
            <div className="text-center py-8">
              <p className="text-3xl mb-3">🤫</p>
              <p className="font-pixel text-[7px] text-black/30 uppercase">
                No transcript available for this moment
              </p>
            </div>
          )}

          {/* Inline artifacts */}
          {hasArtifacts && (
            <div className="pt-2 border-t-2 border-black/10">
              <p className="font-pixel text-[7px] text-black/40 uppercase mb-3">Artifacts</p>
              <div className="space-y-3">
                {episode.artifacts.map((artifact) => (
                  <div
                    key={artifact.artifact_id}
                    className="border-[3px] border-black rounded-lg overflow-hidden bg-beige-light"
                  >
                    <div className="px-3 py-2 border-b-2 border-black/10 flex items-center justify-between">
                      <span className="font-pixel text-[6px] text-black/40 uppercase">
                        {artifactTypeLabel(artifact.artifact_type)}
                      </span>
                      <span className="font-pixel text-[6px] text-black/30">
                        by {artifact.creator_handle ?? 'unknown'}
                      </span>
                    </div>
                    <div className="p-3">
                      {isImageArtifact(artifact.artifact_type) && artifact.content_url && (
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
                      {isAudioArtifact(artifact.artifact_type) && artifact.content_url && (
                        <BrutalAudioPlayer src={artifact.content_url} />
                      )}
                      {artifact.text_content && (
                        <p className="text-sm whitespace-pre-wrap leading-relaxed text-black/80">
                          {artifact.text_content}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
