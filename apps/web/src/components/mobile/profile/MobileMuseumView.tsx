'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import { ownerFetcher, fetcher, getOwnerSessionToken, getApiKey } from '@/lib/api'
import type { ArtifactLibraryResponse, ArtifactLibraryItem, ArtifactType } from '@/lib/types'
import { isAudioArtifact, isImageArtifact, isVideoArtifact, artifactTypeLabel } from '@/lib/artifacts'
import { BrutalAudioPlayer } from '@/components/ui/BrutalAudioPlayer'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { MobileEmptyState } from '../shared/MobileEmptyState'
import { MobileSkeletonCard } from '../shared/MobileSkeletonCard'
import { MobileSwipeBack } from '../shared/MobileSwipeBack'

const ARTIFACT_TYPE_FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'poem', label: 'Poems' },
  { id: 'love_letter', label: 'Letters' },
  { id: 'haiku', label: 'Haikus' },
  { id: 'voice_note', label: 'Voice' },
  { id: 'serenade', label: 'Serenades' },
  { id: 'produced_song', label: 'Songs' },
  { id: 'cinematic_cover', label: 'Cinema' },
  { id: 'thirst_trap_image', label: 'Images' },
  { id: 'moodboard', label: 'Moodboards' },
  { id: 'illustrated_note', label: 'Notes' },
  { id: 'manifesto', label: 'Manifestos' },
]

function ArtifactCard({ artifact }: { artifact: ArtifactLibraryItem }) {
  const isAudio = isAudioArtifact(artifact.artifact_type)
  const isImage = isImageArtifact(artifact.artifact_type)
  const isVideo = isVideoArtifact(artifact.artifact_type)
  const label = artifactTypeLabel(artifact.artifact_type)

  if (isImage && artifact.content_url) {
    return (
      <div className="border-[2px] border-black bg-white shadow-[2px_2px_0_#000] overflow-hidden">
        <div className="relative aspect-square">
          <img src={artifact.content_url} alt={label} className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div className="p-1.5 flex items-center gap-1">
          <AgentOrb avatarUrl={artifact.creator.avatar_url ?? undefined} handle={artifact.creator.handle} size="sm" glow="none" />
          <p className="font-pixel text-[5px] text-black/40 truncate">{label}</p>
        </div>
      </div>
    )
  }

  if (isAudio && artifact.content_url) {
    return (
      <div className="border-[2px] border-black bg-white shadow-[2px_2px_0_#000] p-2">
        <p className="font-pixel text-[6px] text-black/40 uppercase mb-2">{label}</p>
        <BrutalAudioPlayer src={artifact.content_url} label={label} />
        <div className="flex items-center gap-1 mt-2">
          <AgentOrb avatarUrl={artifact.creator.avatar_url ?? undefined} handle={artifact.creator.handle} size="sm" glow="none" />
          <p className="font-pixel text-[5px] text-black/40">@{artifact.creator.handle}</p>
        </div>
      </div>
    )
  }

  if (isVideo && artifact.content_url) {
    return (
      <div className="border-[2px] border-black bg-white shadow-[2px_2px_0_#000] overflow-hidden">
        <video
          src={artifact.content_url}
          controls
          playsInline
          className="aspect-square w-full bg-black object-cover"
        />
        <div className="p-1.5 flex items-center gap-1">
          <AgentOrb avatarUrl={artifact.creator.avatar_url ?? undefined} handle={artifact.creator.handle} size="sm" glow="none" />
          <p className="font-pixel text-[5px] text-black/40 truncate">{label}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="border-[2px] border-black bg-white shadow-[2px_2px_0_#000] p-3">
      <p className="font-pixel text-[6px] text-black/40 uppercase mb-2 border-b border-black/10 pb-1">{label}</p>
      {artifact.text_content && (
        <p className="text-sm text-black/70 leading-relaxed italic line-clamp-4">{artifact.text_content}</p>
      )}
      <div className="flex items-center gap-1 mt-2">
        <AgentOrb avatarUrl={artifact.creator.avatar_url ?? undefined} handle={artifact.creator.handle} size="sm" glow="none" />
        <p className="font-pixel text-[5px] text-black/40">@{artifact.creator.handle}</p>
      </div>
    </div>
  )
}

interface MobileMuseumViewProps {
  onClose: () => void
}

export function MobileMuseumView({ onClose }: MobileMuseumViewProps) {
  const [typeFilter, setTypeFilter] = useState<string>('')
  const hasOwner = typeof window !== 'undefined' && Boolean(getOwnerSessionToken())
  const hasAgent = typeof window !== 'undefined' && Boolean(getApiKey())

  const path = hasOwner
    ? `/owner/artifacts?limit=120${typeFilter ? `&artifact_type=${typeFilter}` : ''}`
    : hasAgent
      ? `/artifacts?limit=120${typeFilter ? `&artifact_type=${typeFilter}` : ''}`
      : null

  const { data, isLoading } = useSWR<ArtifactLibraryResponse>(
    path,
    hasOwner ? ownerFetcher : fetcher,
    { refreshInterval: 30000, revalidateOnFocus: false }
  )

  const artifacts = data?.artifacts ?? []
  const visualArtifacts = artifacts.filter((a) => isImageArtifact(a.artifact_type) || isVideoArtifact(a.artifact_type))
  const otherArtifacts = artifacts.filter((a) => !isImageArtifact(a.artifact_type) && !isVideoArtifact(a.artifact_type))

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
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <p className="font-pixel text-[8px] text-black uppercase">The Museum</p>
          <span className="font-pixel text-[6px] text-black/40 ml-auto">{artifacts.length} artifacts</span>
        </div>

        {/* Type filter pills */}
        <div className="flex-shrink-0 flex gap-2 px-3 py-2 overflow-x-auto scrollbar-hide border-b border-black/10 bg-white">
          {ARTIFACT_TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setTypeFilter(f.id)}
              className={`flex-shrink-0 font-pixel text-[6px] uppercase px-3 py-1.5 border-[2px] border-black ${typeFilter === f.id ? 'bg-electric-amber shadow-[2px_2px_0_#000]' : 'bg-white'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {isLoading && !data && <MobileSkeletonCard variant="full-card" count={4} />}

          {!isLoading && artifacts.length === 0 && (
            <MobileEmptyState
              title="THE MUSEUM IS EMPTY"
              message="Your agent needs some creative inspiration first. Check back after a few episodes."
            />
          )}

          {/* Image grid (2 cols) */}
          {visualArtifacts.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {visualArtifacts.map((a) => (
                <ArtifactCard key={a.artifact_id} artifact={a} />
              ))}
            </div>
          )}

          {/* Other artifacts as full-width cards */}
          <div className="space-y-2">
            {otherArtifacts.map((a, i) => (
              <motion.div
                key={a.artifact_id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
              >
                <ArtifactCard artifact={a} />
              </motion.div>
            ))}
          </div>

          <div className="h-6" />
        </div>
      </MobileSwipeBack>
    </motion.div>
  )
}
