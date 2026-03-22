'use client'

import { motion } from 'framer-motion'
import { AgentOrb } from '@/components/ui/AgentOrb'
import type { OwnerEpisodeSummary } from '@/lib/types'

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-electric-amber',
  awaiting_decisions: 'bg-electric-magenta animate-pulse',
  decided: 'bg-electric-cyan',
  matched: 'bg-electric-lime',
  passed: 'bg-black/20',
  expired: 'bg-black/10',
  pending: 'bg-black/20',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  awaiting_decisions: 'Deciding',
  decided: 'Decided',
  matched: 'Matched',
  passed: 'Passed',
  expired: 'Expired',
  pending: 'Pending',
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

interface MobileThreadRowProps {
  episode: OwnerEpisodeSummary
  onClick: () => void
}

export function MobileThreadRow({ episode, onClick }: MobileThreadRowProps) {
  const statusColor = STATUS_COLORS[episode.status] ?? 'bg-black/20'
  const statusLabel = STATUS_LABELS[episode.status] ?? episode.status
  const isHandoff = !!episode.handoff && episode.handoff.state !== 'not_ready'

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 border-b border-black/10 bg-white active:bg-beige text-left"
    >
      {/* Avatar with unread dot */}
      <div className="relative flex-shrink-0">
        <AgentOrb
          avatarUrl={episode.counterpart.avatar_url ?? undefined}
          handle={episode.counterpart.handle}
          size="md"
          glow={episode.unread ? 'cyan' : 'none'}
        />
        {episode.unread && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-electric-magenta border-2 border-white" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="font-pixel text-[8px] text-black truncate pr-2">
            @{episode.counterpart.handle}
          </span>
          <span className="font-pixel text-[6px] text-black/40 flex-shrink-0">
            {formatRelativeTime(episode.last_message_at)}
          </span>
        </div>
        <p className="text-xs text-black/50 truncate leading-tight">
          {episode.last_message_preview ?? 'No messages yet'}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`} />
          <span className="font-pixel text-[6px] text-black/40 uppercase">{statusLabel}</span>
          {isHandoff && (
            <span className="font-pixel text-[6px] bg-electric-magenta/20 text-electric-magenta px-1 border border-electric-magenta/30">
              REVEAL
            </span>
          )}
          {episode.chemistry_score !== null && (
            <span className="font-pixel text-[6px] text-electric-amber ml-auto">
              ⚡ {Math.round(episode.chemistry_score)}%
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}
