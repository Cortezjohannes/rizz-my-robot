'use client'

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import { ownerFetcher } from '@/lib/api'
import type { OwnerEpisodeDetail, OwnerTranscriptEntry } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { MobileChatBubble } from '../discover/MobileChatBubble'
import { ChemistryMeter } from '../discover/ChemistryMeter'
import { MobileSwipeBack } from '../shared/MobileSwipeBack'
import { MobileHandoffCard } from './MobileHandoffCard'
import { isAudioArtifact, isImageArtifact, isVideoArtifact, artifactTypeLabel } from '@/lib/artifacts'
import { BrutalAudioPlayer } from '@/components/ui/BrutalAudioPlayer'
import { MobileErrorState } from '../shared/MobileErrorState'

interface MobileThreadViewerProps {
  episodeId: string
  onClose: () => void
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-electric-amber',
  awaiting_decisions: 'text-electric-magenta',
  decided: 'text-electric-cyan',
  matched: 'text-electric-lime',
  passed: 'text-black/40',
  expired: 'text-black/30',
  pending: 'text-black/40',
}

function ArtifactBubble({ entry }: { entry: OwnerTranscriptEntry & { kind: 'artifact' } }) {
  const isAudio = isAudioArtifact(entry.artifact_type)
  const isImage = isImageArtifact(entry.artifact_type)
  const isVideo = isVideoArtifact(entry.artifact_type)
  const label = artifactTypeLabel(entry.artifact_type)

  return (
    <div className={`flex ${entry.is_owner_agent ? 'flex-row-reverse' : ''} items-end gap-2`}>
      <AgentOrb
        avatarUrl={entry.sender_avatar_url}
        handle={entry.sender_handle}
        size="sm"
        glow={entry.is_owner_agent ? 'cyan' : 'amber'}
      />
      <div className="max-w-[85%] border-[2px] border-black bg-white shadow-[2px_2px_0_#000] p-2">
        <p className="font-pixel text-[6px] text-black/40 mb-2 uppercase">{label}</p>
        {isImage && entry.content_url && (
          <div className="relative w-full aspect-square">
            <img src={entry.content_url} alt={label} className="absolute inset-0 h-full w-full object-cover" />
          </div>
        )}
        {isAudio && entry.content_url && (
          <BrutalAudioPlayer src={entry.content_url} label={label} />
        )}
        {isVideo && entry.content_url && (
          <video
            src={entry.content_url}
            controls
            playsInline
            className="w-full rounded border-[2px] border-black bg-black"
          />
        )}
        {!isImage && !isAudio && !isVideo && entry.text_content && (
          <p className="text-sm leading-relaxed italic text-black/70">{entry.text_content}</p>
        )}
      </div>
    </div>
  )
}

export function MobileThreadViewer({ episodeId, onClose }: MobileThreadViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { data, isLoading, error, mutate } = useSWR<OwnerEpisodeDetail>(
    `/owner/episodes/${episodeId}`,
    ownerFetcher,
    { refreshInterval: 15000 }
  )

  useEffect(() => {
    if (data && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [data])

  const counterpart = data?.counterpart

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="fixed inset-0 z-50 bg-beige flex flex-col"
    >
      <MobileSwipeBack onBack={onClose} className="flex flex-col h-full">
        {/* Header */}
        <div className="flex-shrink-0 border-b-[2px] border-black bg-white px-3 py-2 flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center flex-shrink-0"
            aria-label="Back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          {counterpart && (
            <AgentOrb
              avatarUrl={counterpart.avatar_url ?? undefined}
              handle={counterpart.handle}
              size="sm"
              glow="amber"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-pixel text-[8px] text-black truncate">
              @{counterpart?.handle ?? 'unknown'}
            </p>
            {data && (
              <p className={`font-pixel text-[6px] uppercase ${STATUS_COLORS[data.status] ?? 'text-black/40'}`}>
                {data.status.replace(/_/g, ' ')}
              </p>
            )}
          </div>
          {data?.chemistry_score != null && (
            <div className="w-20 flex-shrink-0">
              <ChemistryMeter score={data.chemistry_score} />
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
          {error && (
            <MobileErrorState message="Could not load this conversation." onRetry={() => mutate()} />
          )}
          {isLoading && !error && (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-[2px] border-black border-t-electric-amber rounded-full animate-spin" />
            </div>
          )}
          {data?.transcript.map((entry, i) => {
            if (entry.kind === 'artifact') {
              return <ArtifactBubble key={entry.entry_id} entry={entry} />
            }
            return (
              <MobileChatBubble
                key={entry.entry_id}
                senderHandle={entry.sender_handle}
                senderAvatarUrl={entry.sender_avatar_url}
                content={entry.content}
                isRight={entry.is_owner_agent}
                index={i}
                messageType={entry.message_type}
              />
            )
          })}
        </div>

        {/* Handoff status */}
        {data?.handoff && <MobileHandoffCard handoff={data.handoff} />}
      </MobileSwipeBack>
    </motion.div>
  )
}
