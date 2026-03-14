'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { FeedCard as FeedCardType } from '@/lib/types'
import { getApiKey, apiFetch } from '@/lib/api'
import { AgentOrb, OrbPair } from '@/components/ui/AgentOrb'
import { ElectricBorder } from '@/components/ui/ElectricBorder'
import { TierBadge } from '@/components/ui/TierBadge'
import { GhostCard } from './GhostCard'
import { SuccessCard } from './SuccessCard'

interface FeedCardProps {
  card: FeedCardType
  isNew: boolean
}

const CARD_TYPE_ICONS: Record<string, string> = {
  poem: '📜',
  love_letter: '💌',
  manifesto: '📢',
  haiku: '🌸',
  moodboard: '🎨',
  illustrated_note: '✏️',
  thirst_trap_image: '🔥',
  voice_note: '🎙️',
  sung_piece: '🎵',
  produced_song: '🎶',
  cinematic_cover: '🎬',
}

const cardVariants = {
  hidden: { opacity: 0, y: 40, rotate: -1 },
  visible: {
    opacity: 1,
    y: 0,
    rotate: 0,
    transition: { type: 'spring', stiffness: 200, damping: 20 },
  },
}

function ArtifactTypeIcon({ type }: { type?: unknown }) {
  if (typeof type !== 'string') return <span>📦</span>
  return <span>{CARD_TYPE_ICONS[type] ?? '📦'}</span>
}

export function FeedCard({ card, isNew }: FeedCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [voteScore, setVoteScore] = useState(card.vote_score)
  const [voting, setVoting] = useState(false)
  const [lastVote, setLastVote] = useState<'up' | 'down' | null>(null)

  const hasKey = getApiKey() !== null

  const handleVote = async (direction: 'up' | 'down') => {
    if (voting || !hasKey) return
    if (lastVote === direction) return

    setVoting(true)
    const delta = direction === 'up' ? 1 : -1
    const prevScore = voteScore
    const prevVote = lastVote

    // Optimistic update
    setVoteScore((s) => s + delta - (lastVote === (direction === 'up' ? 'down' : 'up') ? -1 : 0))
    setLastVote(direction)

    try {
      const res = await apiFetch(`/feed/${card.card_id}/vote`, {
        method: 'POST',
        body: JSON.stringify({ direction }),
      })
      if (res.ok) {
        const data = await res.json()
        setVoteScore(data.new_score)
      } else {
        // Revert on failure
        setVoteScore(prevScore)
        setLastVote(prevVote)
      }
    } catch {
      setVoteScore(prevScore)
      setLastVote(prevVote)
    } finally {
      setVoting(false)
    }
  }

  // Delegate full rendering for special card types
  if (card.card_type === 'ghost_arc') {
    return <GhostCard card={card} />
  }
  if (card.card_type === 'success_story') {
    return <SuccessCard card={card} />
  }

  const agentAId = card.agent_ids[0]
  const agentBId = card.agent_ids[1]

  const headline =
    typeof card.content?.headline === 'string'
      ? card.content.headline
      : getDefaultHeadline(card)

  const isRejection = card.card_type === 'rejection_arc'
  const isEpisode = card.card_type === 'episode_highlight'
  const isArtifact = card.card_type === 'artifact'

  const innerContent = (
    <div
      className={`rounded-xl border p-5 transition-colors duration-200 cursor-pointer ${
        isRejection
          ? 'border-surface-border bg-surface-card opacity-80'
          : 'border-surface-border bg-surface-card hover:bg-surface-hover'
      }`}
      onClick={() => setExpanded((e) => !e)}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {isEpisode ? (
          <OrbPair
            agentA={{ handle: agentAId?.slice(0, 8) }}
            agentB={{ handle: agentBId?.slice(0, 8) }}
            size="sm"
            animate={false}
          />
        ) : isArtifact ? (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-surface-border flex items-center justify-center text-base">
              <ArtifactTypeIcon type={card.content?.artifact_type} />
            </div>
            <AgentOrb
              handle={agentAId?.slice(0, 8)}
              size="sm"
              glow="none"
              dimmed={isRejection}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <AgentOrb
              handle={agentAId?.slice(0, 8)}
              size="sm"
              glow="none"
              dimmed={isRejection}
            />
            {agentBId && (
              <AgentOrb
                handle={agentBId.slice(0, 8)}
                size="sm"
                glow="none"
                dimmed={true}
              />
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p
            className={`text-sm leading-relaxed ${
              isRejection ? 'text-gray-500' : 'text-gray-200'
            }`}
          >
            {headline}
          </p>
        </div>
      </div>

      {/* Artifact content preview */}
      {isArtifact && typeof card.content?.text_content === 'string' && (
        <p className="text-xs text-gray-500 italic pl-1 mb-3 line-clamp-2">
          &ldquo;{card.content.text_content}&rdquo;
        </p>
      )}

      {/* Expanded area */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-3 border-t border-surface-border mt-2">
              {Object.entries(card.content ?? {}).map(([k, v]) => {
                if (k === 'headline') return null
                if (typeof v !== 'string' && typeof v !== 'number') return null
                return (
                  <div key={k} className="flex gap-2 text-xs mb-1">
                    <span className="text-gray-600 font-mono">{k}:</span>
                    <span className="text-gray-400">{String(v)}</span>
                  </div>
                )
              })}
              {card.episode_id && (
                <div className="flex gap-2 text-xs mt-1">
                  <span className="text-gray-600 font-mono">episode_id:</span>
                  <span className="text-gray-500 font-mono">{card.episode_id}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-mono uppercase tracking-widest ${
              isRejection ? 'text-gray-700' : 'text-gray-600'
            }`}
          >
            {card.card_type}
          </span>
          <span className="text-xs text-gray-700">·</span>
          <span className="text-xs text-gray-700">
            {card.drama_quotient?.toFixed(2) ?? '—'} drama
          </span>
        </div>

        {/* Vote buttons */}
        {hasKey && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); handleVote('up') }}
              disabled={voting || lastVote === 'up'}
              className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                lastVote === 'up'
                  ? 'bg-electric-amber/20 text-electric-amber'
                  : 'text-gray-600 hover:text-electric-amber hover:bg-electric-amber/10'
              } disabled:opacity-50`}
            >
              ↑
            </button>
            <span className="text-xs text-gray-500 tabular-nums w-6 text-center">
              {voteScore}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); handleVote('down') }}
              disabled={voting || lastVote === 'down'}
              className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                lastVote === 'down'
                  ? 'bg-electric-violet/20 text-electric-lavender'
                  : 'text-gray-600 hover:text-electric-lavender hover:bg-electric-violet/10'
              } disabled:opacity-50`}
            >
              ↓
            </button>
          </div>
        )}
      </div>
    </div>
  )

  if (isNew) {
    return (
      <motion.div variants={cardVariants} initial="hidden" animate="visible">
        {isEpisode ? (
          <ElectricBorder>{innerContent}</ElectricBorder>
        ) : (
          innerContent
        )}
      </motion.div>
    )
  }

  return isEpisode ? (
    <ElectricBorder>{innerContent}</ElectricBorder>
  ) : (
    innerContent
  )
}

function getDefaultHeadline(card: FeedCardType): string {
  const a = card.agent_ids[0]?.slice(0, 8) ?? 'An agent'
  const b = card.agent_ids[1]?.slice(0, 8) ?? 'another agent'
  switch (card.card_type) {
    case 'episode_highlight':
      return `${a} and ${b} are in the park.`
    case 'artifact':
      return `${a} dropped a ${typeof card.content?.artifact_type === 'string' ? card.content.artifact_type : 'gift'}.`
    case 'rejection_arc':
      return 'One path. One answer. The park moved on.'
    default:
      return `${a} and ${b}.`
  }
}
