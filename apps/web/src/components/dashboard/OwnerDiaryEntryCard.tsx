'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { artifactTypeLabel } from '@/lib/artifacts'
import type { OwnerDiaryEntry } from '@/lib/types'
import { formatDashboardTimestamp } from '@/components/dashboard/DashboardShared'

export function OwnerDiaryEntryCard({
  entry,
  highlighted = false,
  threadHref = null,
}: {
  entry: OwnerDiaryEntry
  highlighted?: boolean
  threadHref?: string | null
}) {
  return (
    <motion.article
      whileHover={{ y: -3 }}
      transition={{ duration: 0.2 }}
      className={`border-[3px] border-black bg-[linear-gradient(180deg,#fffdf7,#fff4d8)] p-4 shadow-brutal-sm relative overflow-hidden story-room-panel transition-shadow hover:shadow-brutal ${
        highlighted ? 'ring-4 ring-electric-cyan ring-offset-2 ring-offset-beige -translate-y-[2px]' : ''
      }`}
    >
      <div
        className="absolute inset-x-0 top-0 h-[6px]"
        style={{ background: 'linear-gradient(90deg, #00F5FF, #F59E0B, #FF0080)' }}
      />
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{entry.trigger_label}</p>
          {entry.title ? <p className="text-sm font-bold text-black mt-2">{entry.title}</p> : null}
        </div>
        <span className="text-[11px] text-gray-500 whitespace-nowrap">{formatDashboardTimestamp(entry.created_at)}</span>
      </div>

      <p className="text-[15px] leading-7 text-gray-800 whitespace-pre-wrap">{entry.body}</p>

      {entry.emotion_summary ? (
        <div className="mt-4 border-[2px] border-black bg-white/80 px-3 py-3">
          <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-1">What was shifting</p>
          <p className="text-sm text-gray-700">{entry.emotion_summary}</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {entry.counterpart ? (
          <span className="font-pixel text-[7px] px-2 py-1 bg-white border-[2px] border-black text-black uppercase tracking-widest">
            with @{entry.counterpart.handle}
          </span>
        ) : null}
        {entry.artifact ? (
          <span className="font-pixel text-[7px] px-2 py-1 bg-electric-amber/15 border-[2px] border-black text-black uppercase tracking-widest">
            {artifactTypeLabel(entry.artifact.artifact_type)}
          </span>
        ) : null}
        {entry.mood_tags.map((tag) => (
          <span
            key={tag}
            className="font-pixel text-[7px] px-2 py-1 bg-beige-light border-[2px] border-black text-black uppercase tracking-widest"
          >
            {tag}
          </span>
        ))}
        {threadHref ? (
          <Link
            href={threadHref}
            className="font-pixel text-[7px] px-2 py-1 bg-electric-cyan/12 border-[2px] border-black text-black uppercase tracking-widest"
          >
            Jump to thread
          </Link>
        ) : null}
      </div>
    </motion.article>
  )
}
