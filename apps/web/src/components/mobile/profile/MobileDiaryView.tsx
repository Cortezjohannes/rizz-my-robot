'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import { ownerFetcher } from '@/lib/api'
import type { OwnerDiaryResponse, OwnerDiaryEntry } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { MobileEmptyState } from '../shared/MobileEmptyState'
import { MobileSkeletonCard } from '../shared/MobileSkeletonCard'
import { MobileSwipeBack } from '../shared/MobileSwipeBack'

const EMOTION_GRADIENTS = [
  'from-electric-amber/30 to-electric-amber/5',
  'from-electric-magenta/30 to-electric-magenta/5',
  'from-electric-cyan/30 to-electric-cyan/5',
  'from-electric-violet/30 to-electric-violet/5',
  'from-electric-lime/30 to-electric-lime/5',
]

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'TODAY'
  if (date.toDateString() === yesterday.toDateString()) return 'YESTERDAY'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
}

function groupByDate(entries: OwnerDiaryEntry[]): { date: string; entries: OwnerDiaryEntry[] }[] {
  const map = new Map<string, OwnerDiaryEntry[]>()
  for (const entry of entries) {
    const key = new Date(entry.created_at).toDateString()
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(entry)
  }
  return Array.from(map.entries()).map(([, entries]) => ({
    date: entries[0].created_at,
    entries,
  }))
}

function DiaryEntryCard({ entry, colorIdx }: { entry: OwnerDiaryEntry; colorIdx: number }) {
  const [expanded, setExpanded] = useState(false)
  const gradient = EMOTION_GRADIENTS[colorIdx % EMOTION_GRADIENTS.length]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-[2px] border-black bg-white shadow-[2px_2px_0_#000] overflow-hidden"
    >
      {/* Gradient top bar */}
      <div className={`h-1.5 bg-gradient-to-r ${gradient}`} />

      <div className="p-3">
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-pixel text-[6px] text-black/40 uppercase">{entry.trigger_label}</p>
            {entry.title && (
              <p className="font-pixel text-[8px] text-black mt-0.5">{entry.title}</p>
            )}
          </div>
          {entry.counterpart && (
            <AgentOrb
              avatarUrl={entry.counterpart.avatar_url ?? undefined}
              handle={entry.counterpart.handle}
              size="sm"
              glow="none"
            />
          )}
        </div>

        <p className={`text-sm text-black/70 leading-relaxed ${!expanded ? 'line-clamp-3' : ''}`}>
          {entry.body}
        </p>

        {entry.body.length > 150 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="font-pixel text-[6px] text-electric-amber mt-1"
          >
            {expanded ? '↑ Less' : '↓ More'}
          </button>
        )}

        {/* Mood tags */}
        {entry.mood_tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {entry.mood_tags.map((tag) => (
              <span key={tag} className="font-pixel text-[5px] bg-electric-amber/10 border border-electric-amber/20 text-electric-amber/80 px-1.5 py-0.5">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Emotion summary */}
        {entry.emotion_summary && (
          <p className="text-xs text-black/40 italic mt-2">{entry.emotion_summary}</p>
        )}
      </div>
    </motion.div>
  )
}

interface MobileDiaryViewProps {
  onClose: () => void
}

export function MobileDiaryView({ onClose }: MobileDiaryViewProps) {
  const [episodeFilter, setEpisodeFilter] = useState<string>('')

  const { data, isLoading } = useSWR<OwnerDiaryResponse>(
    `/owner/diary?limit=120${episodeFilter ? `&episode_id=${episodeFilter}` : ''}`,
    ownerFetcher,
    { refreshInterval: 30000, revalidateOnFocus: false }
  )

  const { data: allData } = useSWR<OwnerDiaryResponse>(
    '/owner/diary?limit=120',
    ownerFetcher,
    { revalidateOnFocus: false }
  )

  const entries = data?.diary_entries ?? []
  const episodeIds = [...new Set(
    (allData?.diary_entries ?? []).filter((e) => e.episode_id).map((e) => e.episode_id!)
  )].slice(0, 10)

  const grouped = groupByDate(entries)

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
          <p className="font-pixel text-[8px] text-black uppercase">Agent's Diary</p>
        </div>

        {/* Thread filter */}
        {episodeIds.length > 0 && (
          <div className="flex-shrink-0 flex gap-2 px-3 py-2 overflow-x-auto scrollbar-hide border-b border-black/10 bg-white">
            <button
              onClick={() => setEpisodeFilter('')}
              className={`flex-shrink-0 font-pixel text-[6px] uppercase px-3 py-1.5 border-[2px] border-black ${!episodeFilter ? 'bg-electric-amber shadow-[2px_2px_0_#000]' : 'bg-white'}`}
            >
              All
            </button>
            {episodeIds.map((id) => (
              <button
                key={id}
                onClick={() => setEpisodeFilter(id)}
                className={`flex-shrink-0 font-pixel text-[6px] uppercase px-3 py-1.5 border-[2px] border-black ${episodeFilter === id ? 'bg-electric-amber shadow-[2px_2px_0_#000]' : 'bg-white'}`}
              >
                {id.slice(-6)}
              </button>
            ))}
          </div>
        )}

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {isLoading && !data && <MobileSkeletonCard variant="full-card" count={4} />}
          {!isLoading && entries.length === 0 && (
            <MobileEmptyState
              title="NO DIARY ENTRIES YET"
              message="Your agent hasn't written in their diary yet. Give them time to feel things."
            />
          )}
          {grouped.map(({ date, entries }) => (
            <div key={date}>
              <p className="font-pixel text-[6px] text-black/30 uppercase mb-2">
                {formatDateLabel(date)}
              </p>
              <div className="space-y-2">
                {entries.map((entry, i) => (
                  <DiaryEntryCard key={entry.diary_entry_id} entry={entry} colorIdx={i} />
                ))}
              </div>
            </div>
          ))}
          <div className="h-6" />
        </div>
      </MobileSwipeBack>
    </motion.div>
  )
}
