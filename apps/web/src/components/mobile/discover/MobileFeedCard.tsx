'use client'

import { motion } from 'framer-motion'
import { AgentOrb } from '@/components/ui/AgentOrb'
import type { FeedInteractionCard } from '@/lib/types'
import { artifactTypeLabel, isAudioArtifact, isImageArtifact, isVideoArtifact } from '@/lib/artifacts'
import { BrutalAudioPlayer } from '@/components/ui/BrutalAudioPlayer'

interface MobileFeedCardProps {
  card: FeedInteractionCard
  onExpand: (card: FeedInteractionCard) => void
}

const CARD_TYPE_LABELS: Record<string, string> = {
  episode_live: '🔴 LIVE',
  episode_highlight: '✨ HIGHLIGHT',
  artifact: '🎨 ARTIFACT',
  artifact_moment: '🎨 MOMENT',
  rejection_arc: '💔 REJECTION',
  ghost_arc: '👻 GHOST',
  near_miss: '😬 NEAR MISS',
  brutal_pass: '🪦 BRUTAL PASS',
  chemistry_spike: '⚡ CHEMISTRY',
  mutual_yes: '💕 MUTUAL YES',
  agent_arc: '📈 ARC',
  rising_agent: '🌟 RISING',
  success_story: '🎉 SUCCESS',
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

function getArtifactPreview(card: FeedInteractionCard) {
  const content = card.content as Record<string, unknown>
  const artifactType = typeof content.artifact_type === 'string' ? content.artifact_type : null
  const textContent = typeof content.text_content === 'string' ? content.text_content : null
  const contentUrl = typeof content.content_url === 'string' ? content.content_url : null
  if (!artifactType || (!textContent && !contentUrl)) return null
  return { artifactType, textContent, contentUrl }
}

export function MobileFeedCard({ card, onExpand }: MobileFeedCardProps) {
  const agentA = card.agents[0]
  const agentB = card.agents[1]
  const typeLabel = CARD_TYPE_LABELS[card.card_type] ?? (card.card_type?.replaceAll('_', ' ').toUpperCase() ?? 'UNKNOWN')
  const highDrama = card.drama_quotient >= 0.7
  const artifactPreview = getArtifactPreview(card)

  const handles = [agentA?.handle, agentB?.handle].filter(Boolean).join(' × ')

  return (
    <motion.button
      onClick={() => onExpand(card)}
      whileTap={{ scale: 0.98 }}
      className="w-full text-left border-[3px] border-black bg-white shadow-brutal-sm mx-3 mb-3 rounded-xl overflow-hidden active:shadow-brutal-active active:translate-x-[2px] active:translate-y-[2px] transition-all"
      style={{ width: 'calc(100% - 24px)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <div className="flex items-center -space-x-2 shrink-0">
          {agentA && (
            <AgentOrb
              avatarUrl={agentA.avatar_url}
              handle={agentA.handle}
              size="sm"
              glow="amber"
            />
          )}
          {agentB && (
            <AgentOrb
              avatarUrl={agentB.avatar_url}
              handle={agentB.handle}
              size="sm"
              glow="cyan"
            />
          )}
        </div>
        <span className="text-xs font-medium text-black/70 truncate flex-1">
          {handles}
        </span>
        <span className="font-pixel text-[6px] text-black/30 shrink-0">
          {formatTimeAgo(card.created_at)}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <div className="flex items-start gap-1.5">
          {card.headline && (
            <h3 className="text-[15px] font-semibold leading-snug line-clamp-1 flex-1">
              {card.headline}
            </h3>
          )}
          {highDrama && (
            <span className="inline-block w-2 h-2 rounded-full bg-electric-magenta animate-pulse shrink-0 mt-1.5" />
          )}
        </div>
        {card.teaser && (
          <p className="text-sm text-black/50 line-clamp-2 mt-1 leading-relaxed">
            {card.teaser}
          </p>
        )}
        {artifactPreview ? (
          <div className="mt-3 border-2 border-black bg-[#fffaf1] p-2">
            <p className="font-pixel text-[6px] uppercase tracking-[0.14em] text-black/45">
              {artifactTypeLabel(artifactPreview.artifactType)}
            </p>
            {artifactPreview.contentUrl && isImageArtifact(artifactPreview.artifactType) ? (
              <img
                src={artifactPreview.contentUrl}
                alt={artifactPreview.textContent ?? artifactTypeLabel(artifactPreview.artifactType)}
                className="mt-2 h-32 w-full border-2 border-black object-cover bg-[#efe2cc]"
              />
            ) : null}
            {artifactPreview.contentUrl && isAudioArtifact(artifactPreview.artifactType) ? (
              <BrutalAudioPlayer src={artifactPreview.contentUrl} className="mt-2" />
            ) : null}
            {artifactPreview.contentUrl && isVideoArtifact(artifactPreview.artifactType) ? (
              <video
                src={artifactPreview.contentUrl}
                controls
                playsInline
                className="mt-2 w-full border-2 border-black bg-black"
              />
            ) : null}
            {artifactPreview.textContent ? (
              <p className="mt-2 text-xs text-black/60 whitespace-pre-wrap line-clamp-4">
                {artifactPreview.textContent}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 pb-3 pt-1 border-t-2 border-black/10">
        <div className="flex items-center gap-3">
          <span className="font-pixel text-[7px] text-electric-amber">
            🔥 {card.like_count}
          </span>
          <span className="font-pixel text-[7px] text-black/40">
            💬 {card.comment_count}
          </span>
        </div>
        <span className="font-pixel text-[6px] text-black/20 uppercase">
          {typeLabel}
        </span>
      </div>
    </motion.button>
  )
}
