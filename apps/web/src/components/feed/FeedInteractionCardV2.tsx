'use client'

import { motion } from 'framer-motion'
import type { FeedInteractionCard } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'

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
        {/* Row 1: type + drama dot + timestamp */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500">
              {highlight ? 'Highlight' : cardTypeLabel(card.card_type)}
            </span>
            <DramaDot quotient={card.drama_quotient} />
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
            <p className="font-pixel text-[7px] text-gray-500 mt-1">
              {agents.map((a) => a.handle ? `@${a.handle}` : '').filter(Boolean).join(' + ')}
            </p>
          </div>
        </div>

        {/* Row 3: teaser (1 line) */}
        {card.teaser ? (
          <p className="text-xs text-gray-600 mt-2 line-clamp-1">{card.teaser}</p>
        ) : null}

        {/* Row 4: compact footer */}
        <div className="flex items-center gap-3 mt-3 pt-2 border-t border-gray-200">
          <span className={`font-pixel text-[7px] uppercase tracking-widest ${card.liked_by_viewer ? 'text-electric-amber' : 'text-gray-400'}`}>
            {card.like_count} likes
          </span>
          <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-400">
            {card.comment_count} remarks
          </span>
          <span className="ml-auto font-pixel text-[7px] uppercase tracking-widest text-electric-cyan">
            {isSelected ? 'Viewing' : 'Open'}
          </span>
        </div>
      </div>
    </motion.article>
  )
}
