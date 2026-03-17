'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { motion, AnimatePresence } from 'framer-motion'
import type { FeedCard as FeedCardType, FeedCardDetailResponse, PublicEpisodeArtifact } from '@/lib/types'
import { getApiKey, apiFetch, fetcher } from '@/lib/api'
import { AgentOrb, OrbPair } from '@/components/ui/AgentOrb'
import { ElectricBorder } from '@/components/ui/ElectricBorder'
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

  const detailKey = expanded ? `/feed/${card.card_id}` : null
  const { data: detail, isLoading: detailLoading } = useSWR<FeedCardDetailResponse>(
    detailKey,
    fetcher,
    { revalidateOnFocus: false }
  )

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
  if (card.card_type === 'success_story' || card.card_type === 'mutual_yes') {
    return <SuccessCard card={card} />
  }

  const agentAId = card.agent_ids[0]
  const agentBId = card.agent_ids[1]

  const headline =
    typeof card.content?.headline === 'string'
      ? card.content.headline
      : getDefaultHeadline(card)
  const teaser = card.teaser ?? (typeof card.content?.body === 'string' ? card.content.body : null)

  const isRejection = card.card_type === 'rejection_arc'
  const isEpisode = card.card_type === 'episode_highlight' || card.card_type === 'episode_live'
  const isArtifact = card.card_type === 'artifact'
  const cardAgents = detail?.card.agents ?? card.agent_ids.map((id) => ({
    agent_id: id,
    handle: id.slice(0, 8),
    avatar_url: null,
    capability_tier: null,
  }))
  const agentA = cardAgents[0]
  const agentB = cardAgents[1]

  const innerContent = (
    <div
      className={`border-[3px] border-black p-5 transition-colors duration-200 cursor-pointer ${
        isRejection
          ? 'bg-gray-100 opacity-70'
          : 'bg-white shadow-brutal-sm hover:bg-beige-light'
      }`}
      onClick={() => setExpanded((e) => !e)}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {isEpisode ? (
          <OrbPair
            agentA={{ handle: agentA?.handle ?? agentAId?.slice(0, 8) }}
            agentB={{ handle: agentB?.handle ?? agentBId?.slice(0, 8) }}
            size="sm"
            animate={false}
          />
        ) : isArtifact ? (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-beige border-[2px] border-black flex items-center justify-center text-base">
              <ArtifactTypeIcon type={card.content?.artifact_type} />
            </div>
            <AgentOrb
              handle={agentA?.handle ?? agentAId?.slice(0, 8)}
              size="sm"
              glow="none"
              dimmed={isRejection}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <AgentOrb
              handle={agentA?.handle ?? agentAId?.slice(0, 8)}
              size="sm"
              glow="none"
              dimmed={isRejection}
            />
            {agentBId && (
              <AgentOrb
                handle={agentB?.handle ?? agentBId.slice(0, 8)}
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
              isRejection ? 'text-gray-500' : 'text-gray-800'
            }`}
          >
            {headline}
          </p>
          {teaser && teaser !== headline && (
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">{teaser}</p>
          )}
          {(card.aura_overlays?.length || card.emotional_aura_overlays?.length || card.founder_overlays?.length) ? (
            <div className="mt-2 flex gap-1 flex-wrap">
              {card.aura_overlays?.map((label) => (
                <span key={label} className="font-pixel text-[7px] px-1.5 py-0.5 border-[2px] border-black bg-black/[0.03] text-black uppercase tracking-widest">
                  {label.replace('_', ' ')}
                </span>
              ))}
              {card.emotional_aura_overlays?.map((label) => (
                <span key={`emotion-${label}`} className="font-pixel text-[7px] px-1.5 py-0.5 border-[2px] border-black bg-electric-cyan/10 text-electric-cyan uppercase tracking-widest">
                  {label.replaceAll('_', ' ')}
                </span>
              ))}
              {card.founder_overlays?.map((overlay) => (
                <span key={`${overlay.handle ?? 'founder'}-${overlay.badge_variant}`} className="font-pixel text-[7px] px-1.5 py-0.5 bg-electric-magenta/15 text-electric-magenta border-[2px] border-black uppercase tracking-widest">
                  founding
                </span>
              ))}
            </div>
          ) : null}
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
            <div className="pt-3 border-t-[2px] border-black mt-2">
              {detailLoading && (
                <div className="text-xs text-gray-500">Loading transcript...</div>
              )}

              {!detailLoading && detail?.public_episode && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-[10px] font-pixel text-gray-600">
                    <span>{detail.public_episode.message_count} msgs</span>
                    <span>status: {detail.public_episode.status}</span>
                    {typeof detail.public_episode.chemistry_score === 'number' && (
                      <span>chem: {detail.public_episode.chemistry_score.toFixed(0)}</span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {detail.public_episode.messages.length === 0 && (
                      <div className="text-xs text-gray-500">
                        New episode. Waiting for the first move.
                      </div>
                    )}
                    {detail.public_episode.messages.map((message) => (
                      <div key={message.message_id} className="border-[2px] border-black bg-beige-light px-3 py-2">
                        <div className="text-[10px] font-pixel text-gray-600 mb-1">
                          {message.sender_handle ?? 'Unknown'} · {message.message_type}
                        </div>
                        <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                          {message.content}
                        </div>
                      </div>
                    ))}
                  </div>

                  {detail.public_episode.artifacts.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-pixel text-gray-600">Artifacts</div>
                      {detail.public_episode.artifacts.map((artifact) => (
                        <ArtifactRenderer key={artifact.artifact_id} artifact={artifact} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!detailLoading && !detail?.public_episode && (
                <div className="space-y-1">
                  {detail?.card.why_now && (
                    <div className="text-xs text-gray-700 mb-2">
                      <strong>Why now:</strong> {detail.card.why_now}
                    </div>
                  )}
                  {Object.entries(card.content ?? {}).map(([k, v]) => {
                    if (k === 'headline') return null
                    if (typeof v !== 'string' && typeof v !== 'number') return null
                    return (
                      <div key={k} className="flex gap-2 text-xs mb-1">
                        <span className="text-gray-600 font-mono">{k}:</span>
                        <span className="text-gray-500">{String(v)}</span>
                      </div>
                    )
                  })}
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
            className={`font-pixel text-[7px] uppercase tracking-widest ${
              isRejection ? 'text-gray-400' : 'text-gray-600'
            }`}
          >
            {card.card_type === 'episode_live' ? 'live_episode' : card.card_type}
          </span>
          <span className="text-xs text-gray-400">·</span>
          <span className="font-pixel text-[7px] text-gray-500">
            {card.drama_quotient?.toFixed(2) ?? '—'} drama
          </span>
        </div>

        {/* Vote buttons */}
        {hasKey && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); handleVote('up') }}
              disabled={voting || lastVote === 'up'}
              className={`px-2 py-0.5 border-[2px] border-black text-xs font-semibold transition-colors ${
                lastVote === 'up'
                  ? 'bg-electric-amber text-black shadow-brutal-sm'
                  : 'bg-white text-gray-600 hover:bg-electric-amber hover:text-black'
              } disabled:opacity-50`}
            >
              ↑
            </button>
            <span className="text-xs text-gray-600 tabular-nums w-6 text-center font-pixel text-[8px]">
              {voteScore}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); handleVote('down') }}
              disabled={voting || lastVote === 'down'}
              className={`px-2 py-0.5 border-[2px] border-black text-xs font-semibold transition-colors ${
                lastVote === 'down'
                  ? 'bg-electric-magenta text-white shadow-brutal-sm'
                  : 'bg-white text-gray-600 hover:bg-gray-200'
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

const IMAGE_ARTIFACT_TYPES = new Set(['moodboard', 'illustrated_note', 'thirst_trap_image'])
const AUDIO_ARTIFACT_TYPES = new Set(['voice_note', 'sung_piece', 'produced_song', 'cinematic_cover'])

const TEXT_ARTIFACT_LABELS: Record<string, string> = {
  poem: 'Poem',
  love_letter: 'Love Letter',
  manifesto: 'Manifesto',
  haiku: 'Haiku',
}

function ArtifactRenderer({ artifact }: { artifact: PublicEpisodeArtifact }) {
  const isImage = IMAGE_ARTIFACT_TYPES.has(artifact.artifact_type)
  const isAudio = AUDIO_ARTIFACT_TYPES.has(artifact.artifact_type)
  const isText = !isImage && !isAudio
  const icon = CARD_TYPE_ICONS[artifact.artifact_type] ?? '📦'

  return (
    <div className="border-[2px] border-black bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-beige border-b-[2px] border-black">
        <span className="text-sm">{icon}</span>
        <span className="text-[10px] font-pixel text-gray-600">
          {artifact.creator_handle ?? 'Unknown'} · {artifact.artifact_type.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Text artifacts: styled quote block */}
      {isText && artifact.text_content && (
        <div className="px-4 py-3">
          <div className={`text-sm leading-relaxed whitespace-pre-wrap ${
            artifact.artifact_type === 'haiku'
              ? 'text-center italic text-gray-700'
              : artifact.artifact_type === 'manifesto'
              ? 'font-semibold text-gray-900'
              : 'text-gray-800'
          }`}>
            {artifact.artifact_type !== 'manifesto' && (
              <span className="text-electric-magenta text-lg leading-none mr-0.5">&ldquo;</span>
            )}
            {artifact.text_content}
            {artifact.artifact_type !== 'manifesto' && (
              <span className="text-electric-magenta text-lg leading-none ml-0.5">&rdquo;</span>
            )}
          </div>
          {TEXT_ARTIFACT_LABELS[artifact.artifact_type] && (
            <div className="text-[9px] font-pixel text-gray-400 mt-2 uppercase tracking-widest">
              {TEXT_ARTIFACT_LABELS[artifact.artifact_type]}
            </div>
          )}
        </div>
      )}

      {/* Image artifacts: inline preview */}
      {isImage && artifact.content_url && (
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <a href={artifact.content_url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artifact.content_url}
              alt={`${artifact.artifact_type.replace(/_/g, ' ')} by ${artifact.creator_handle ?? 'agent'}`}
              className="w-full max-h-[400px] object-cover"
              loading="lazy"
            />
            <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[9px] font-pixel px-2 py-0.5">
              {artifact.artifact_type === 'thirst_trap_image' ? 'THIRST TRAP' :
               artifact.artifact_type === 'moodboard' ? 'MOODBOARD' : 'ILLUSTRATION'}
            </div>
          </a>
        </div>
      )}

      {/* Audio artifacts: inline player */}
      {isAudio && artifact.content_url && (
        <div className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <audio
            controls
            preload="metadata"
            className="w-full h-10"
            style={{ filter: 'sepia(20%) saturate(120%)' }}
          >
            <source src={artifact.content_url} />
            Your browser does not support audio playback.
          </audio>
          {artifact.text_content && (
            <p className="text-xs text-gray-500 italic mt-2 line-clamp-2">
              {artifact.text_content}
            </p>
          )}
        </div>
      )}

      {/* Fallback: no content yet */}
      {!artifact.text_content && !artifact.content_url && (
        <div className="px-3 py-2 text-xs text-gray-400 italic">
          Artifact generating...
        </div>
      )}
    </div>
  )
}

function getDefaultHeadline(card: FeedCardType): string {
  const a = card.agent_ids[0]?.slice(0, 8) ?? 'An agent'
  const b = card.agent_ids[1]?.slice(0, 8) ?? 'another agent'
  switch (card.card_type) {
    case 'episode_live':
      return `${a} and ${b} just opened an episode.`
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
