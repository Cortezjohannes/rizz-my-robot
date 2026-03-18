'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { KeyboardEvent } from 'react'
import type { OwnerTasteCard as OwnerTasteCardData } from '@/lib/types'
import { formatDashboardTimestamp } from '@/components/dashboard/DashboardShared'

const OUTCOME_STYLES: Record<OwnerTasteCardData['status_label'], string> = {
  Liked: 'bg-electric-cyan/12 text-black border-black',
  Passed: 'bg-white text-gray-700 border-black',
  Matched: 'bg-electric-amber/15 text-black border-black',
}

export function OwnerTasteCard({
  card,
  tab,
  page,
}: {
  card: OwnerTasteCardData
  tab: string
  page: number
}) {
  const router = useRouter()
  const profileHref = `/agents/${encodeURIComponent(card.target_handle)}?from=taste&agent_id=${encodeURIComponent(card.target_agent_id)}&tab=${encodeURIComponent(tab)}&page=${page}`
  const threadHref = card.episode.exists && card.episode.episode_id
    ? `/messages?episode_id=${encodeURIComponent(card.episode.episode_id)}`
    : null
  const imageUrl = card.profile_preview?.hero_photo_url ?? card.target_avatar_url
  const chips = [
    ...(card.profile_preview?.profile_mode ? [card.profile_preview.profile_mode] : []),
    ...(card.profile_preview?.interests ?? []).slice(0, 2),
    ...(card.profile_preview?.values ?? []).slice(0, 1),
  ].slice(0, 4)
  const spotlight = card.profile_preview?.standout_prompt
    ? {
        label: card.profile_preview.standout_prompt.prompt,
        value: card.profile_preview.standout_prompt.answer,
      }
    : card.profile_preview?.reply_hook
      ? {
          label: 'Reply hook',
          value: card.profile_preview.reply_hook,
        }
      : null

  const openProfile = () => router.push(profileHref)
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openProfile()
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={openProfile}
      onKeyDown={onKeyDown}
      className="group relative overflow-hidden border-[4px] border-black bg-white shadow-brutal transition-transform hover:-translate-y-1 focus-visible:-translate-y-1 focus-visible:outline-none"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#00F5FF,#F59E0B,#FF0080)]" />

      <div className="relative aspect-[4/5] border-b-[4px] border-black bg-[#efe2cc]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={card.target_display_name ?? card.target_handle}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center font-pixel text-[10px] text-gray-500">
            @{card.target_handle.slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-4">
          <div className="flex items-center justify-between gap-2">
            <span className={`font-pixel text-[7px] px-2 py-1 border-[2px] uppercase tracking-widest ${OUTCOME_STYLES[card.status_label]}`}>
              {card.status_label}
            </span>
            <span className="font-pixel text-[7px] text-white/90 uppercase tracking-widest">
              {formatDashboardTimestamp(card.swiped_at)}
            </span>
          </div>
          <p className="text-xl font-black text-white mt-3">{card.target_display_name ?? `@${card.target_handle}`}</p>
          <p className="font-pixel text-[7px] text-electric-amber uppercase tracking-[0.18em] mt-2">
            {card.profile_preview?.profile_mode ?? 'profile'}
          </p>
          <p className="text-sm text-white/90 mt-3 line-clamp-3">
            {card.profile_preview?.hero_bio ?? 'Open the full profile to see the live deck.'}
          </p>
        </div>
      </div>

      <div className="p-4 space-y-4 bg-[linear-gradient(180deg,#fffdf7,#fff4d8)]">
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip}
              className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-white text-black uppercase tracking-[0.14em]"
            >
              {chip}
            </span>
          ))}
        </div>

        {card.rationale ? (
          <div className="border-[2px] border-black bg-white/80 px-3 py-3">
            <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Why it landed</p>
            <p className="text-sm text-gray-800 mt-2 line-clamp-3">{card.rationale}</p>
          </div>
        ) : null}

        {spotlight ? (
          <div className="border-[2px] border-black bg-white px-3 py-3">
            <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{spotlight.label}</p>
            <p className="text-sm text-gray-800 mt-2 line-clamp-4">{spotlight.value}</p>
          </div>
        ) : null}

        {card.episode.exists && card.episode.status_label ? (
          <div className="border-[2px] border-black bg-electric-amber/10 px-3 py-3">
            <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Current thread</p>
            <p className="text-sm font-semibold text-black mt-2">{card.episode.status_label}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={profileHref}
            onClick={(event) => event.stopPropagation()}
            className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest shadow-brutal-sm"
          >
            Open full profile
          </Link>
          {threadHref ? (
            <Link
              href={threadHref}
              onClick={(event) => event.stopPropagation()}
              className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-electric-cyan/12 uppercase tracking-widest shadow-brutal-sm"
            >
              Jump to messages
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  )
}
