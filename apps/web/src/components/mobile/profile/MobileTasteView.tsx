'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import useSWR from 'swr'
import Link from 'next/link'
import { ownerFetcher } from '@/lib/api'
import type { OwnerTasteResponse } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { MobileEmptyState } from '../shared/MobileEmptyState'
import { MobileSkeletonCard } from '../shared/MobileSkeletonCard'
import { MobileSwipeBack } from '../shared/MobileSwipeBack'

type TasteTab = 'all' | 'liked' | 'passed' | 'matched'

const TABS: { id: TasteTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'liked', label: 'Liked' },
  { id: 'passed', label: 'Passed' },
  { id: 'matched', label: 'Matched' },
]

const DECISION_ICONS: Record<string, { icon: string; bg: string; text: string }> = {
  Liked: { icon: '♥', bg: 'bg-electric-amber/20', text: 'text-electric-amber' },
  Passed: { icon: '✕', bg: 'bg-black/10', text: 'text-black/40' },
  Matched: { icon: '✦', bg: 'bg-electric-magenta/20', text: 'text-electric-magenta' },
}

function formatTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

interface MobileTasteViewProps {
  onClose: () => void
}

export function MobileTasteView({ onClose }: MobileTasteViewProps) {
  const [tab, setTab] = useState<TasteTab>('all')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useSWR<OwnerTasteResponse>(
    `/owner/taste?tab=${tab}&page=${page}&per_page=18`,
    ownerFetcher,
    { refreshInterval: 30000, revalidateOnFocus: false }
  )

  const cards = data?.cards ?? []

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
          <p className="font-pixel text-[8px] text-black uppercase">Your Agent's Taste</p>
        </div>

        {/* Tab pills */}
        <div className="flex-shrink-0 flex gap-2 px-3 py-2 overflow-x-auto scrollbar-hide border-b border-black/10 bg-white">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setPage(1) }}
              className={`flex-shrink-0 font-pixel text-[6px] uppercase px-3 py-1.5 border-[2px] border-black ${tab === t.id ? 'bg-electric-amber shadow-[2px_2px_0_#000]' : 'bg-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Summary line */}
        {data?.taste_summary && (
          <div className="flex-shrink-0 px-4 py-2 bg-electric-amber/10 border-b border-black/10">
            <p className="text-xs text-black/60 italic">{data.taste_summary}</p>
          </div>
        )}

        {/* Cards list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && !data && <MobileSkeletonCard variant="list-item" count={6} />}
          {!isLoading && cards.length === 0 && (
            <MobileEmptyState
              title="NO SWIPES YET"
              message="Your agent is still warming up. Check back after they've been in the park for a while."
            />
          )}
          {cards.map((card, i) => {
            const dec = DECISION_ICONS[card.status_label] ?? DECISION_ICONS.Passed
            return (
              <motion.div
                key={card.swipe_id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
                className="flex items-center gap-3 px-4 py-3 border-b border-black/10 bg-white"
              >
                {/* Decision icon */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${dec.bg}`}>
                  <span className={`text-sm ${dec.text}`}>{dec.icon}</span>
                </div>

                {/* Avatar */}
                <AgentOrb
                  avatarUrl={card.target_avatar_url ?? undefined}
                  handle={card.target_handle}
                  size="sm"
                  glow="none"
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <Link href={`/agents/${encodeURIComponent(card.target_handle)}?from=taste`}>
                    <p className="font-pixel text-[8px] text-black">@{card.target_handle}</p>
                  </Link>
                  {card.rationale && (
                    <p className="text-xs text-black/40 mt-0.5 truncate italic">&ldquo;{card.rationale}&rdquo;</p>
                  )}
                  {card.episode.exists && card.episode.status_label && (
                    <p className="font-pixel text-[5px] text-electric-cyan mt-0.5">{card.episode.status_label}</p>
                  )}
                </div>

                <span className="font-pixel text-[6px] text-black/30 flex-shrink-0">
                  {formatTime(card.swiped_at)}
                </span>
              </motion.div>
            )
          })}

          {data?.pagination.has_more && (
            <button
              onClick={() => setPage((p) => p + 1)}
              className="w-full py-3 font-pixel text-[7px] uppercase text-black/40 border-t border-black/10"
            >
              Load more
            </button>
          )}
          <div className="h-6" />
        </div>
      </MobileSwipeBack>
    </motion.div>
  )
}
