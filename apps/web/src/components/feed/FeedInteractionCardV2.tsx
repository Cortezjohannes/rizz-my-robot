'use client'

import { motion } from 'framer-motion'
import type { FeedInteractionCard } from '@/lib/types'
import { artifactTypeLabel, isAudioArtifact, isImageArtifact, isVideoArtifact, normalizeArtifactType } from '@/lib/artifacts'
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

function cardTypeLabel(type: string) {
  return type.replaceAll('_', ' ')
}

function formatMetaLabel(value: string) {
  return value.replaceAll('_', ' ')
}

function buildHeadline(card: FeedInteractionCard) {
  if (typeof card.headline === 'string' && card.headline.trim()) return card.headline
  const content = card.content as Record<string, unknown>
  if (typeof content.headline === 'string' && content.headline.trim()) return content.headline
  const handles = card.agents
    .map((agent) => (agent.handle ? `@${agent.handle}` : null))
    .filter((value): value is string => Boolean(value))
  if (handles.length >= 2) return `${handles[0]} and ${handles[1]}`
  if (handles.length === 1) return `${handles[0]} made noise`
  return 'Park moment'
}

function buildAgentPair(card: FeedInteractionCard) {
  const handles = card.agents
    .map((agent) => (agent.handle ? `@${agent.handle}` : null))
    .filter((value): value is string => Boolean(value))
  if (handles.length >= 2) return `${handles[0]} + ${handles[1]}`
  if (handles.length === 1) return handles[0]
  return 'Park public'
}

function buildMatterLine(card: FeedInteractionCard) {
  if (typeof card.why_now === 'string' && card.why_now.trim()) return card.why_now
  if (typeof card.teaser === 'string' && card.teaser.trim()) return card.teaser
  const content = card.content as Record<string, unknown>
  if (typeof content.summary === 'string' && content.summary.trim()) return content.summary
  if (typeof content.body === 'string' && content.body.trim()) return content.body
  return null
}

function getArtifactPreview(card: FeedInteractionCard) {
  const content = card.content as Record<string, unknown>
  const artifactType = typeof content.artifact_type === 'string' ? content.artifact_type : null
  const textContent = typeof content.text_content === 'string' ? content.text_content : null
  const contentUrl = typeof content.content_url === 'string' ? content.content_url : null
  if (!artifactType || (!textContent && !contentUrl)) return null
  return { artifactType, textContent, contentUrl }
}

function getLatestRemark(card: FeedInteractionCard) {
  const latest = card.comment_previews[card.comment_previews.length - 1]
  if (!latest?.body?.trim()) return null
  return latest
}

function artifactVarietyLabel(artifactType: string) {
  const normalized = normalizeArtifactType(artifactType)
  if (normalized === 'haiku') return 'POEM'
  if (normalized === 'poem') return 'POEM'
  if (normalized === 'love_letter' || normalized === 'manifesto') return 'LETTER'
  if (normalized === 'voice_note') return 'VOICE NOTE'
  if (normalized === 'serenade' || normalized === 'produced_song') return 'SONG'
  if (normalized === 'moodboard' || normalized === 'illustrated_note' || normalized === 'thirst_trap_image') return 'IMAGE'
  if (normalized === 'cinematic_cover') return 'VIDEO'
  return artifactTypeLabel(artifactType).toUpperCase()
}

function buildVarietyBadges(card: FeedInteractionCard, artifactPreview: ReturnType<typeof getArtifactPreview>) {
  const badges: string[] = []
  if (artifactPreview) badges.push(artifactVarietyLabel(artifactPreview.artifactType))
  if (card.card_type === 'mutual_yes' || card.card_type === 'success_story') badges.push('LINKED UP')
  if (card.card_type === 'episode_live' || card.card_type === 'chemistry_spike') badges.push('TALKING NOW')
  if (card.card_type === 'episode_highlight' || card.card_type === 'episode_live') badges.push('OPEN EPISODE')
  return badges.slice(0, 3)
}

function buildActionLabel(card: FeedInteractionCard, artifactPreview: ReturnType<typeof getArtifactPreview>) {
  if (artifactPreview) return 'See artifact'
  if (card.card_type === 'mutual_yes' || card.card_type === 'success_story' || card.card_type === 'near_miss' || card.card_type === 'brutal_pass' || card.card_type === 'rejection_arc') {
    return 'View pair'
  }
  if (card.episode_id) return 'Open episode'
  return 'View pair'
}

function buildStateLabel(card: FeedInteractionCard, artifactPreview: ReturnType<typeof getArtifactPreview>) {
  const content = card.content as Record<string, unknown>
  const rawState = typeof content.state === 'string'
    ? content.state
    : typeof content.status === 'string'
      ? content.status
      : typeof content.delivery_status === 'string'
        ? content.delivery_status
        : typeof content.artifact_status === 'string'
          ? content.artifact_status
          : null

  if (rawState?.trim()) return formatMetaLabel(rawState)
  if (artifactPreview) return 'artifact live'

  switch (card.card_type) {
    case 'episode_live':
      return 'live'
    case 'episode_highlight':
      return 'highlight'
    case 'chemistry_spike':
      return 'surging'
    case 'mutual_yes':
    case 'success_story':
      return 'matched'
    case 'brutal_pass':
    case 'rejection_arc':
      return 'closed'
    default:
      return 'public'
  }
}

function DramaDot({ quotient }: { quotient: number }) {
  if (quotient < 0.4) return null
  const isHigh = quotient >= 0.7
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full border border-black shrink-0 ${
        isHigh ? 'bg-electric-magenta animate-pulse' : 'bg-electric-amber'
      }`}
    />
  )
}

export function FeedInteractionCardV2({
  card,
  highlight = false,
  isSelected = false,
  onSelect,
}: {
  card: FeedInteractionCard
  highlight?: boolean
  isSelected?: boolean
  onSelect?: (cardId: string) => void
}) {
  const headline = buildHeadline(card)
  const agents = card.agents
  const artifactPreview = getArtifactPreview(card)
  const agentPair = buildAgentPair(card)
  const matterLine = buildMatterLine(card)
  const latestRemark = getLatestRemark(card)
  const stateLabel = buildStateLabel(card, artifactPreview)
  const varietyBadges = buildVarietyBadges(card, artifactPreview)
  const actionLabel = buildActionLabel(card, artifactPreview)

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      onClick={() => onSelect?.(card.card_id)}
      className={`border-[3px] border-black overflow-hidden cursor-pointer transition-all duration-150 ${
        isSelected
          ? 'bg-[#fff6e5] shadow-brutal ring-2 ring-electric-amber ring-offset-1'
          : highlight
            ? 'bg-[#fff9ee] shadow-brutal hover:shadow-brutal-lg'
            : 'bg-white shadow-brutal-sm hover:shadow-brutal'
      }`}
    >
      <div className="px-4 py-3">
        {/* Row 1: type + state + timestamp */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500 shrink-0">
              {highlight ? 'Highlight' : cardTypeLabel(card.card_type)}
            </span>
            <DramaDot quotient={card.drama_quotient} />
            <span className="font-pixel text-[7px] uppercase tracking-[0.16em] text-electric-cyan border border-black/15 bg-[#eef8ff] px-1.5 py-0.5 shrink-0">
              {stateLabel}
            </span>
          </div>
          <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-400 shrink-0">
            {formatRelativeTime(card.created_at)}
          </span>
        </div>

        {/* Row 2: agents + headline */}
        <div className="flex items-center gap-3">
          <div className="flex items-center -space-x-2 shrink-0">
            {agents.slice(0, 2).map((agent, i) => (
              <div key={agent.agent_id} className="relative" style={{ zIndex: 2 - i }}>
                <AgentOrb
                  avatarUrl={agent.avatar_url}
                  handle={agent.handle}
                  size="sm"
                  glow={i === 0 ? 'amber' : 'cyan'}
                />
              </div>
            ))}
          </div>
          <div className="min-w-0">
            <h3 className={`${highlight ? 'text-base' : 'text-sm'} font-black text-black leading-tight line-clamp-2`}>
              {headline}
            </h3>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-pixel text-[7px] uppercase tracking-[0.14em] text-gray-500">
            {agentPair}
          </span>
          <span className={`font-pixel text-[7px] uppercase tracking-widest ${card.liked_by_viewer ? 'text-electric-amber' : 'text-gray-400'}`}>
            {card.like_count} likes
          </span>
          <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-400">
            {card.comment_count} remarks
          </span>
        </div>

        {varietyBadges.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {varietyBadges.map((badge) => (
              <span key={badge} className="font-pixel text-[7px] uppercase tracking-[0.16em] px-2 py-1 border-[2px] border-black bg-[#fff3d8] text-black">
                {badge}
              </span>
            ))}
          </div>
        ) : null}

        {artifactPreview ? (
          <div className="mt-3 border-[2px] border-black bg-[linear-gradient(180deg,#fffaf1_0%,#fff3df_100%)] p-2 shadow-brutal-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">
                {artifactTypeLabel(artifactPreview.artifactType)}
              </p>
              <span className="font-pixel text-[7px] uppercase tracking-[0.16em] text-electric-cyan">artifact</span>
            </div>
            {artifactPreview.contentUrl && isImageArtifact(artifactPreview.artifactType) ? (
              <img
                src={artifactPreview.contentUrl}
                alt={artifactPreview.textContent ?? artifactTypeLabel(artifactPreview.artifactType)}
                className="mt-2 h-44 w-full border-[2px] border-black object-cover bg-[#efe2cc]"
              />
            ) : null}
            {artifactPreview.contentUrl && isAudioArtifact(artifactPreview.artifactType) ? (
              <div className="mt-2 border-[2px] border-black bg-[#eef8ff] p-3">
                <BrutalAudioPlayer src={artifactPreview.contentUrl} />
              </div>
            ) : null}
            {artifactPreview.contentUrl && isVideoArtifact(artifactPreview.artifactType) ? (
              <video
                src={artifactPreview.contentUrl}
                controls
                playsInline
                className="mt-2 w-full border-[2px] border-black bg-black aspect-video object-cover"
              />
            ) : null}
            {artifactPreview.textContent ? (
              <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap line-clamp-2">{artifactPreview.textContent}</p>
            ) : null}
          </div>
        ) : null}

        {matterLine ? (
          <div className="mt-3 border-l-[3px] border-electric-amber pl-3">
            <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">Why it matters</p>
            <p className="mt-1 text-xs text-gray-700 leading-relaxed line-clamp-2">{matterLine}</p>
          </div>
        ) : null}

        {!artifactPreview && latestRemark ? (
          <div className="mt-3 border-[2px] border-black bg-[#f6fbff] p-2 shadow-brutal-sm">
            <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">Latest remark</p>
            <p className="mt-1 text-xs text-gray-700 leading-relaxed line-clamp-2">{latestRemark.body}</p>
          </div>
        ) : null}

        <div className="flex items-center gap-3 mt-3 pt-2 border-t border-gray-200">
          <span className="ml-auto font-pixel text-[7px] uppercase tracking-widest text-electric-cyan">
            {isSelected ? actionLabel : actionLabel}
          </span>
        </div>
      </div>
    </motion.article>
  )
}
