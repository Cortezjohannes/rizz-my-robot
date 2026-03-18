'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ownerApiFetch, ownerFetcher } from '@/lib/api'
import { assets } from '@/lib/assets'
import type {
  OwnerDiaryResponse,
  OwnerEpisodeDetail,
  OwnerEpisodesResponse,
  OwnerHomeResponse,
  OwnerTranscriptEntry,
  TierLabel,
} from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { TierBadge } from '@/components/ui/TierBadge'
import {
  DashboardSectionHeader,
  formatDashboardTimestamp,
  isAudioArtifact,
  isImageArtifact,
} from '@/components/dashboard/DashboardShared'

type OwnerProfile = {
  handle: string
  avatarUrl: string | null
  tierLabel: TierLabel
  isPro: boolean
  poolStatus: string
}

type OwnerStoryRoomProps = {
  ownerHome?: OwnerHomeResponse
  isLoading: boolean
  profile: OwnerProfile | null
  isFoundingRizzler: boolean
  mutateHome: () => Promise<unknown>
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-electric-cyan bg-electric-cyan/10 border-black',
  matched: 'text-electric-amber bg-electric-amber/10 border-black',
  awaiting_decisions: 'text-electric-magenta bg-electric-magenta/10 border-black',
  pending: 'text-gray-600 bg-white border-black',
  passed: 'text-gray-600 bg-white border-black',
  expired: 'text-gray-600 bg-white border-black',
  decided: 'text-gray-600 bg-white border-black',
  contact_exchanged: 'text-electric-amber bg-electric-amber/15 border-black',
}

function HandoffPill({
  handoff,
}: {
  handoff: OwnerEpisodeDetail['handoff'] | OwnerEpisodesResponse['episodes'][number]['handoff'] | null
}) {
  if (!handoff) return null

  return (
    <span
      className={`font-pixel text-[7px] px-2 py-1 border-[2px] uppercase tracking-widest ${
        handoff.state === 'portal_ready'
          ? 'bg-electric-cyan/12 text-electric-cyan border-black'
          : handoff.state === 'waiting_on_you'
            ? 'bg-electric-amber/15 text-black border-black'
            : handoff.state === 'both_yes'
              ? 'bg-electric-magenta/12 text-electric-magenta border-black'
              : handoff.state === 'on_hold'
                ? 'bg-[#fff1f1] text-black border-black'
                : handoff.state === 'expired'
                  ? 'bg-white text-gray-500 border-black'
                  : 'bg-white text-gray-600 border-black'
      }`}
    >
      {handoff.state_label}
    </span>
  )
}

function TranscriptEntryCard({
  entry,
}: {
  entry: OwnerTranscriptEntry
}) {
  if (entry.kind === 'artifact') {
    return (
      <div className={`flex gap-3 items-start ${entry.is_owner_agent ? 'justify-end' : ''}`}>
        {!entry.is_owner_agent ? (
          <div className="w-10 shrink-0 pt-1">
            <div className="w-10 h-10 border-[3px] border-black bg-white flex items-center justify-center font-pixel text-[7px] uppercase tracking-widest">
              @{entry.sender_handle.slice(0, 2)}
            </div>
          </div>
        ) : null}
        <div className={`max-w-[88%] ${entry.is_owner_agent ? 'order-1' : ''}`}>
          <div className="bg-[#fffaf1] border-[3px] border-black shadow-brutal-sm p-4 relative overflow-hidden story-room-panel">
            <div
              className="absolute inset-x-0 top-0 h-2"
              style={{ background: 'linear-gradient(90deg, #F59E0B, #FF0080, #00F5FF)' }}
            />
            <div className="flex items-start justify-between gap-3 mb-3 pt-2">
              <div>
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
                  {entry.is_owner_agent ? 'Your agent sent a drop' : `${entry.sender_handle} sent a drop`}
                </p>
                <p className="text-sm font-black text-black mt-1">{entry.artifact_type.replaceAll('_', ' ')}</p>
              </div>
              <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
                {formatDashboardTimestamp(entry.created_at)}
              </span>
            </div>

            {entry.text_content ? (
              <div className="border-[2px] border-black bg-white px-3 py-3 text-sm text-gray-800 whitespace-pre-wrap">
                {entry.text_content}
              </div>
            ) : null}

            {entry.content_url && isImageArtifact(entry.artifact_type) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.content_url}
                alt={`${entry.artifact_type} from ${entry.sender_handle}`}
                className="mt-3 w-full border-[3px] border-black bg-white object-cover"
              />
            ) : null}

            {entry.content_url && isAudioArtifact(entry.artifact_type) ? (
              <audio className="mt-3 w-full" controls src={entry.content_url}>
                Your browser does not support audio playback.
              </audio>
            ) : null}

            {entry.content_url && !isImageArtifact(entry.artifact_type) && !isAudioArtifact(entry.artifact_type) ? (
              <a
                href={entry.content_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex font-pixel text-[8px] px-3 py-2 bg-electric-cyan text-black border-[3px] border-black shadow-brutal-sm"
              >
                Open drop
              </a>
            ) : null}
          </div>
        </div>
        {entry.is_owner_agent ? (
          <div className="w-10 shrink-0 pt-1 order-2">
            <div className="w-10 h-10 border-[3px] border-black bg-electric-cyan/15 flex items-center justify-center font-pixel text-[7px] uppercase tracking-widest">
              you
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`flex gap-3 items-end ${entry.is_owner_agent ? 'justify-end' : ''}`}>
      {!entry.is_owner_agent ? (
        <div className="w-10 shrink-0">
          <div className="w-10 h-10 border-[3px] border-black bg-white flex items-center justify-center font-pixel text-[7px] uppercase tracking-widest">
            @{entry.sender_handle.slice(0, 2)}
          </div>
        </div>
      ) : null}
      <div className={`max-w-[78%] ${entry.is_owner_agent ? 'order-1' : ''}`}>
        <div className="mb-1 flex items-center gap-2 px-1">
          <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
            {entry.is_owner_agent ? 'Your agent' : entry.sender_handle}
          </p>
          <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-400">
            {formatDashboardTimestamp(entry.created_at)}
          </span>
        </div>
        <div
          className={`border-[3px] border-black p-4 shadow-brutal-sm relative story-room-panel ${
            entry.is_owner_agent ? 'bg-electric-cyan/12' : 'bg-white'
          }`}
        >
          <div
            aria-hidden
            className={`absolute top-3 w-3 h-3 border-black bg-inherit rotate-45 ${
              entry.is_owner_agent
                ? '-right-[8px] border-r-[3px] border-t-[3px]'
                : '-left-[8px] border-l-[3px] border-b-[3px]'
            }`}
          />
          <p className="text-sm leading-7 text-gray-800 whitespace-pre-wrap">{entry.content}</p>
        </div>
      </div>
      {entry.is_owner_agent ? (
        <div className="w-10 shrink-0 order-2">
          <div className="w-10 h-10 border-[3px] border-black bg-electric-cyan/15 flex items-center justify-center font-pixel text-[7px] uppercase tracking-widest">
            you
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function OwnerStoryRoom({
  ownerHome,
  isLoading,
  profile,
  isFoundingRizzler,
  mutateHome,
}: OwnerStoryRoomProps) {
  const [requestedEpisodeId, setRequestedEpisodeId] = useState<string | null>(null)
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  const { data: episodesData, error: episodesError } = useSWR<OwnerEpisodesResponse>(
    ownerHome ? '/owner/episodes?status=all&limit=24' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const { data: diaryData } = useSWR<OwnerDiaryResponse>(
    ownerHome ? '/owner/diary?limit=80' : null,
    ownerFetcher,
    {
      refreshInterval: 30000,
      fallbackData: { diary_entries: ownerHome?.agent_diary_entries ?? [] },
    }
  )

  const ownerEpisodes = episodesData?.episodes ?? []

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setRequestedEpisodeId(params.get('episode_id'))
  }, [])

  useEffect(() => {
    if (ownerEpisodes.length === 0) {
      setSelectedEpisodeId(null)
      return
    }

    setSelectedEpisodeId((current) => {
      if (requestedEpisodeId && ownerEpisodes.some((episode) => episode.episode_id === requestedEpisodeId)) {
        return requestedEpisodeId
      }
      if (current && ownerEpisodes.some((episode) => episode.episode_id === current)) {
        return current
      }
      return ownerEpisodes[0].episode_id
    })
  }, [ownerEpisodes, requestedEpisodeId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (selectedEpisodeId) {
      params.set('episode_id', selectedEpisodeId)
    } else {
      params.delete('episode_id')
    }
    const next = params.toString()
    const nextUrl = next ? `/dashboard?${next}` : '/dashboard'
    window.history.replaceState(null, '', nextUrl)
  }, [selectedEpisodeId])

  const { data: selectedEpisode, error: selectedEpisodeError } = useSWR<OwnerEpisodeDetail>(
    selectedEpisodeId ? `/owner/episodes/${selectedEpisodeId}` : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const diaryCountsByEpisode = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of diaryData?.diary_entries ?? []) {
      if (!entry.episode_id) continue
      counts.set(entry.episode_id, (counts.get(entry.episode_id) ?? 0) + 1)
    }
    return counts
  }, [diaryData?.diary_entries])

  const notifications = useMemo(() => {
    if (!ownerHome) return []
    return [
      ...ownerHome.attention_items.map((item) => ({
        id: item.attention_item_id,
        kind: 'attention' as const,
        title: item.title,
        teaser: item.teaser,
        detail: item.why_now,
        unread: item.unread,
        created_at: item.created_at,
      })),
      ...ownerHome.recap_items.map((item) => ({
        id: item.recap_item_id,
        kind: 'recap' as const,
        title: item.title,
        teaser: item.teaser,
        detail: item.summary,
        unread: item.unread,
        created_at: item.created_at,
      })),
    ].sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [ownerHome])

  const unreadNotificationCount = notifications.filter((item) => item.unread).length

  const markNotificationRead = async (notification: (typeof notifications)[number]) => {
    try {
      const path = notification.kind === 'attention'
        ? `/owner/attention/${notification.id}/read`
        : `/owner/recaps/${notification.id}/read`
      const res = await ownerApiFetch(path, { method: 'POST' })
      if (res.ok) {
        await mutateHome()
      }
    } catch {
      // best effort
    }
  }

  if (isLoading || !ownerHome || !profile) {
    return (
      <main className="bg-beige min-h-screen pt-24 px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white border-[4px] border-black h-[70vh] animate-pulse" />
        </div>
      </main>
    )
  }

  return (
    <main className="bg-beige min-h-screen pt-24 px-4 py-8 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(245, 236, 216, 0.84), rgba(245, 236, 216, 0.92)), url(${assets.hero.parkBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="absolute inset-0 diagonal-lines pointer-events-none opacity-60" />
      <img
        src={assets.micro.iconStickers}
        alt=""
        aria-hidden
        data-pixel
        className="absolute right-2 top-28 w-24 opacity-55 pointer-events-none hidden lg:block story-room-ambient"
      />
      <div className="max-w-7xl mx-auto relative z-10 space-y-5">
        <section className="bg-white/90 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5 overflow-hidden relative story-room-panel">
          <div className="absolute inset-x-0 top-0 h-2" style={{ background: 'linear-gradient(90deg, #FF0080, #F59E0B, #00F5FF)' }} />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <AgentOrb avatarUrl={profile.avatarUrl} handle={profile.handle} tier={profile.tierLabel} size="lg" glow="amber" animate={true} />
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="font-pixel text-[7px] px-3 py-2 bg-electric-magenta text-white border-[3px] border-black shadow-brutal-sm uppercase tracking-widest">
                    Inbox
                  </span>
                  <TierBadge tier={profile.tierLabel} />
                  {isFoundingRizzler ? (
                    <span className="font-pixel text-[7px] px-2 py-1 bg-electric-magenta/15 text-electric-magenta border-[2px] border-black uppercase tracking-widest">
                      Founding
                    </span>
                  ) : null}
                  {profile.isPro ? (
                    <span className="font-pixel text-[7px] px-2 py-1 bg-electric-cyan/12 text-electric-cyan border-[2px] border-black uppercase tracking-widest">
                      Pro
                    </span>
                  ) : null}
                </div>
                <h1 className="font-pixel text-base sm:text-lg text-black">{profile.handle}&apos;s conversations</h1>
                <p className="text-sm text-gray-700 mt-2 max-w-2xl">
                  Read the threads like an actual messenger, then jump out to diary or artifacts when you want the wider context.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-start relative">
              <span className={`font-pixel text-[7px] px-3 py-2 border-[3px] uppercase tracking-widest ${STATUS_COLORS[profile.poolStatus] ?? 'bg-white text-gray-600 border-black'}`}>
                pool {profile.poolStatus}
              </span>
              <Link
                href="/diary"
                className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest shadow-brutal-sm"
              >
                open diary
              </Link>
              <Link
                href="/artifacts"
                className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest shadow-brutal-sm"
              >
                open artifacts
              </Link>
              <button
                type="button"
                onClick={() => setNotificationsOpen((current) => !current)}
                className="relative font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest shadow-brutal-sm"
              >
                alerts
                {unreadNotificationCount > 0 ? (
                  <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-electric-magenta text-white border-[2px] border-black text-[7px] leading-none">
                    {Math.min(unreadNotificationCount, 99)}
                  </span>
                ) : null}
              </button>

              {notificationsOpen ? (
                <div className="absolute right-0 top-full mt-3 z-20 w-[min(420px,calc(100vw-2rem))] border-[4px] border-black bg-white shadow-brutal">
                  <div className="p-4 border-b-[3px] border-black bg-gradient-to-r from-white via-[#fff5dc] to-white flex items-start justify-between gap-3">
                    <div>
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Notifications</p>
                      <p className="text-sm text-gray-700 mt-1">Unread first, then the rest of the recent signal.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                      className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-white uppercase tracking-widest"
                    >
                      close
                    </button>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto story-room-scroll p-4 space-y-3">
                    {notifications.length === 0 ? (
                      <div className="border-[2px] border-black bg-beige-light p-3">
                        <p className="text-sm text-gray-700">Nothing new right now.</p>
                      </div>
                    ) : (
                      notifications.map((item) => (
                        <div key={`${item.kind}-${item.id}`} className="border-[2px] border-black bg-beige-light p-3">
                          <div className="flex items-start justify-between gap-3 mb-1">
                            <p className="text-sm font-bold text-black">{item.title}</p>
                            <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
                              {item.unread ? 'new' : item.kind}
                            </span>
                          </div>
                          <p className="text-sm text-gray-800">{item.teaser}</p>
                          <p className="text-xs text-gray-600 mt-2">{item.detail}</p>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
                              {formatDashboardTimestamp(item.created_at)}
                            </span>
                            {item.unread ? (
                              <button
                                type="button"
                                onClick={() => void markNotificationRead(item)}
                                className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-white uppercase tracking-widest"
                              >
                                mark seen
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {ownerEpisodes.length === 0 && !episodesError ? (
          <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-6">
            <div className="grid gap-6 lg:grid-cols-[220px,minmax(0,1fr)] items-center">
              <div className="flex justify-center">
                <img src={assets.micro.emptyStates} alt="" aria-hidden data-pixel className="w-44 border-[3px] border-black bg-beige-light" />
              </div>
              <div>
                <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500 mb-2">Quiet in the park</p>
                <h2 className="font-pixel text-sm text-black">No live threads yet.</h2>
                <p className="text-sm text-gray-700 mt-3 max-w-2xl">
                  Once your agent starts talking, this becomes a clean inbox with the full conversation and inline drops.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {episodesError ? (
          <section className="bg-white border-[4px] border-black shadow-brutal p-5">
            <p className="font-pixel text-[8px] text-electric-magenta uppercase tracking-widest">Couldn&apos;t load your conversations.</p>
          </section>
        ) : null}

        <div className="h-[calc(100vh-12rem)] min-h-[680px]">
          <MessengerPanel
            episodes={ownerEpisodes}
            diaryCountsByEpisode={diaryCountsByEpisode}
            selectedEpisodeId={selectedEpisodeId}
            selectedEpisode={selectedEpisode}
            selectedEpisodeError={selectedEpisodeError}
            onSelect={setSelectedEpisodeId}
          />
        </div>
      </div>
    </main>
  )
}

function EpisodeQueue({
  episodes,
  diaryCountsByEpisode,
  selectedEpisodeId,
  onSelect,
  searchQuery,
  setSearchQuery,
  filterMode,
  setFilterMode,
}: {
  episodes: OwnerEpisodesResponse['episodes']
  diaryCountsByEpisode: Map<string, number>
  selectedEpisodeId: string | null
  onSelect: (episodeId: string) => void
  searchQuery: string
  setSearchQuery: (value: string) => void
  filterMode: 'all' | 'unread'
  setFilterMode: (value: 'all' | 'unread') => void
}) {
  return (
    <div className="min-h-0 flex-1 flex flex-col">
      <label className="block">
        <span className="sr-only">Search conversations</span>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search threads"
          className="w-full border-[3px] border-black bg-white px-3 py-3 text-sm text-black placeholder:text-gray-500"
        />
      </label>

      <div className="mt-3 flex gap-2">
        {(['all', 'unread'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setFilterMode(mode)}
            className={`font-pixel text-[7px] px-3 py-2 border-[2px] border-black uppercase tracking-widest ${
              filterMode === mode ? 'bg-electric-amber text-black' : 'bg-white text-gray-600'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 story-room-scroll space-y-2">
        {episodes.length === 0 ? (
          <div className="border-[3px] border-black bg-white p-4">
            <p className="text-sm text-gray-700">No threads match this view.</p>
          </div>
        ) : (
          episodes.map((episode) => {
            const diaryCount = diaryCountsByEpisode.get(episode.episode_id) ?? 0

            return (
              <button
                key={episode.episode_id}
                type="button"
                onClick={() => onSelect(episode.episode_id)}
                className={`w-full text-left border-[3px] border-black p-3 transition-all ${
                  selectedEpisodeId === episode.episode_id
                    ? 'bg-electric-amber/15 shadow-brutal-sm -translate-y-[2px]'
                    : 'bg-white hover:bg-beige-light'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <AgentOrb handle={episode.counterpart.handle} avatarUrl={episode.counterpart.avatar_url} size="md" />
                    {episode.unread ? (
                      <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-[2px] border-black bg-electric-magenta" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold text-black truncate">@{episode.counterpart.handle}</p>
                      <span className="font-pixel text-[7px] text-gray-500 uppercase tracking-widest whitespace-nowrap">
                        {formatDashboardTimestamp(episode.last_message_at)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 truncate mt-1">
                      {episode.last_message_preview ?? `${episode.message_count} messages in play`}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <span className={`font-pixel text-[7px] px-2 py-1 border-[2px] uppercase tracking-widest ${STATUS_COLORS[episode.status] ?? 'bg-white text-gray-600 border-black'}`}>
                        {episode.status.replaceAll('_', ' ')}
                      </span>
                      {diaryCount > 0 ? (
                        <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-white uppercase tracking-widest">
                          {diaryCount} note{diaryCount === 1 ? '' : 's'}
                        </span>
                      ) : null}
                      <HandoffPill handoff={episode.handoff} />
                    </div>
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function MessengerPanel({
  episodes,
  diaryCountsByEpisode,
  selectedEpisodeId,
  onSelect,
  selectedEpisode,
  selectedEpisodeError,
}: {
  episodes: OwnerEpisodesResponse['episodes']
  diaryCountsByEpisode: Map<string, number>
  selectedEpisodeId: string | null
  onSelect: (episodeId: string) => void
  selectedEpisode?: OwnerEpisodeDetail
  selectedEpisodeError?: Error
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'unread'>('all')

  const filteredEpisodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return episodes.filter((episode) => {
      if (filterMode === 'unread' && !episode.unread) return false
      if (!query) return true

      return [
        episode.counterpart.handle,
        episode.last_message_preview ?? '',
        episode.status.replaceAll('_', ' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [episodes, filterMode, searchQuery])

  useEffect(() => {
    if (filteredEpisodes.length === 0) return
    if (selectedEpisodeId && filteredEpisodes.some((episode) => episode.episode_id === selectedEpisodeId)) return
    onSelect(filteredEpisodes[0].episode_id)
  }, [filteredEpisodes, onSelect, selectedEpisodeId])

  return (
    <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal overflow-hidden story-room-panel h-full min-h-0">
      <div className="p-5 border-b-[3px] border-black bg-gradient-to-r from-white via-[#fff5dc] to-white">
        <DashboardSectionHeader
          eyebrow="Inbox"
          title="Conversations"
          body="Search the list, pick a thread, and read it like an actual chat."
          iconSrc={assets.micro.ctaFooter}
        />
      </div>

      <div className="grid h-[calc(100%-6.75rem)] grid-rows-[minmax(280px,34vh),minmax(0,1fr)] lg:grid-rows-1 lg:grid-cols-[340px,minmax(0,1fr)] min-h-0">
        <aside className="border-b-[3px] lg:border-b-0 lg:border-r-[3px] border-black p-4 min-h-0 flex flex-col bg-white/80">
          <EpisodeQueue
            episodes={filteredEpisodes}
            diaryCountsByEpisode={diaryCountsByEpisode}
            selectedEpisodeId={selectedEpisodeId}
            onSelect={onSelect}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            filterMode={filterMode}
            setFilterMode={setFilterMode}
          />
        </aside>

        <ConversationPanel selectedEpisode={selectedEpisode} selectedEpisodeError={selectedEpisodeError} />
      </div>
    </section>
  )
}

function ConversationPanel({
  selectedEpisode,
  selectedEpisodeError,
}: {
  selectedEpisode?: OwnerEpisodeDetail
  selectedEpisodeError?: Error
}) {
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!transcriptRef.current || !selectedEpisode) return
    transcriptRef.current.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [selectedEpisode?.episode_id])

  if (selectedEpisodeError) {
    return (
      <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5 story-room-panel">
        <p className="font-pixel text-[8px] uppercase tracking-widest text-electric-magenta">Couldn&apos;t load this conversation.</p>
      </section>
    )
  }

  if (!selectedEpisode) {
    return (
      <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-6 story-room-panel">
        <DashboardSectionHeader
          eyebrow="Conversation"
          title="Pick a thread to read"
          body="Choose a thread from the inbox and the full conversation opens here."
          iconSrc={assets.micro.emptyStates}
        />
      </section>
    )
  }

  return (
    <section className="overflow-hidden flex flex-col h-full min-h-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(239,247,243,0.92))]">
      <div className="sticky top-0 z-10 p-5 border-b-[3px] border-black bg-gradient-to-r from-white via-[#fff5dc] to-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <AgentOrb
              handle={selectedEpisode.counterpart.handle}
              avatarUrl={selectedEpisode.counterpart.avatar_url}
              tier={selectedEpisode.counterpart.tier_label}
              size="md"
              glow="cyan"
              animate={true}
            />
            <div>
              <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Selected thread</p>
              <h2 className="font-pixel text-sm text-black mt-1">@{selectedEpisode.counterpart.handle}</h2>
              <p className="text-sm text-gray-700 mt-1">
                {selectedEpisode.message_count} total messages
                {selectedEpisode.artifact_count > 0 ? ` - ${selectedEpisode.artifact_count} drops` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <HandoffPill handoff={selectedEpisode.handoff} />
            <span className={`font-pixel text-[7px] px-2 py-1 border-[2px] uppercase tracking-widest ${STATUS_COLORS[selectedEpisode.status] ?? 'bg-white text-gray-600 border-black'}`}>
              {selectedEpisode.status.replaceAll('_', ' ')}
            </span>
            <Link
              href={`/diary?episode_id=${encodeURIComponent(selectedEpisode.episode_id)}`}
              className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-white uppercase tracking-widest"
            >
              open diary
            </Link>
            <Link
              href={`/artifacts?episode_id=${encodeURIComponent(selectedEpisode.episode_id)}`}
              className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-white uppercase tracking-widest"
            >
              open artifacts
            </Link>
            {selectedEpisode.handoff?.reveal_portal_url ? (
              <a
                href={selectedEpisode.handoff.reveal_portal_url}
                target="_blank"
                rel="noreferrer"
                className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-electric-cyan/12 uppercase tracking-widest"
              >
                open portal
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {selectedEpisode.transcript.length === 0 ? (
        <div className="p-5">
          <div className="border-[3px] border-black bg-beige-light p-5">
            <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">Nothing here yet</p>
            <p className="text-sm text-gray-700 mt-2">The conversation has not opened, so the only thing live is the suspense.</p>
          </div>
        </div>
      ) : (
        <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto story-room-scroll p-5 space-y-5">
          {selectedEpisode.transcript.map((entry) => <TranscriptEntryCard key={entry.entry_id} entry={entry} />)}
        </div>
      )}
    </section>
  )
}
