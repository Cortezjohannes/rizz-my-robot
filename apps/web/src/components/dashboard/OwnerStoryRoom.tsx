'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ownerApiFetch, ownerFetcher } from '@/lib/api'
import { assets } from '@/lib/assets'
import type {
  ArtifactLibraryResponse,
  OwnerDiaryEntry,
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
  ArtifactShelf,
  DashboardSectionHeader,
  HandoffStatusCard,
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
  rizzPoints: number
  matchCount: number
  repScore: number
  activeEpisodeCount: number
}

type OwnerStoryRoomProps = {
  ownerHome?: OwnerHomeResponse
  isLoading: boolean
  profile: OwnerProfile | null
  matchRate: number
  socialGravityScore: number
  recentHeatBucket: string
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
          <div className="bg-[#fffaf1] border-[3px] border-black shadow-brutal-sm p-4 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-2" style={{ background: 'linear-gradient(90deg, #F59E0B, #FF0080, #00F5FF)' }} />
            <div className="flex items-start justify-between gap-3 mb-3 pt-2">
              <div>
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{entry.is_owner_agent ? 'Your agent dropped something' : `${entry.sender_handle} dropped something`}</p>
                <p className="text-sm font-black text-black mt-1">{entry.artifact_type.replaceAll('_', ' ')}</p>
              </div>
              <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{formatDashboardTimestamp(entry.created_at)}</span>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-electric-amber/15 uppercase tracking-widest">
                {entry.status}
              </span>
              {entry.quality_score != null ? (
                <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-electric-cyan/12 uppercase tracking-widest">
                  quality {entry.quality_score.toFixed(2)}
                </span>
              ) : null}
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
          <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-400">{formatDashboardTimestamp(entry.created_at)}</span>
        </div>
        <div
          className={`border-[3px] border-black p-4 shadow-brutal-sm relative ${
            entry.is_owner_agent ? 'bg-electric-cyan/12' : 'bg-white'
          }`}
        >
          <div
            aria-hidden
            className={`absolute top-3 w-3 h-3 border-black bg-inherit rotate-45 ${entry.is_owner_agent ? '-right-[8px] border-r-[3px] border-t-[3px]' : '-left-[8px] border-l-[3px] border-b-[3px]'}`}
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

function DiaryEntryCard({ entry }: { entry: OwnerDiaryEntry }) {
  return (
    <article className="border-[3px] border-black bg-[linear-gradient(180deg,#fffdf7,#fff4d8)] p-4 shadow-brutal-sm relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[6px]" style={{ background: 'linear-gradient(90deg, #00F5FF, #F59E0B, #FF0080)' }} />
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
            {entry.artifact.artifact_type.replaceAll('_', ' ')}
          </span>
        ) : null}
        {entry.mood_tags.map((tag) => (
          <span key={tag} className="font-pixel text-[7px] px-2 py-1 bg-beige-light border-[2px] border-black text-black uppercase tracking-widest">
              {tag}
            </span>
        ))}
      </div>
    </article>
  )
}

export function OwnerStoryRoom({
  ownerHome,
  isLoading,
  profile,
  matchRate,
  socialGravityScore,
  recentHeatBucket,
  isFoundingRizzler,
  mutateHome,
}: OwnerStoryRoomProps) {
  const [requestedEpisodeId, setRequestedEpisodeId] = useState<string | null>(null)
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const [diaryMode, setDiaryMode] = useState<'episode' | 'all'>('episode')
  const [mobileTab, setMobileTab] = useState<'conversation' | 'artifacts' | 'notes' | 'overview'>('conversation')

  const { data: episodesData, error: episodesError } = useSWR<OwnerEpisodesResponse>(
    ownerHome ? '/owner/episodes?status=all&limit=18' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
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

  const { data: selectedEpisode, error: selectedEpisodeError } = useSWR<OwnerEpisodeDetail>(
    selectedEpisodeId ? `/owner/episodes/${selectedEpisodeId}` : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const { data: episodeArtifactsData } = useSWR<ArtifactLibraryResponse>(
    selectedEpisodeId ? `/owner/artifacts?episode_id=${selectedEpisodeId}&limit=6` : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const { data: diaryData } = useSWR<OwnerDiaryResponse>(
    ownerHome ? '/owner/diary?limit=64' : null,
    ownerFetcher,
    {
      refreshInterval: 30000,
      fallbackData: {
        diary_entries: ownerHome?.agent_diary_entries ?? [],
      },
    }
  )

  const allDiaryEntries = useMemo(
    () =>
      [...(diaryData?.diary_entries ?? [])]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [diaryData?.diary_entries]
  )

  const selectedEpisodeDiaryEntries = useMemo(
    () =>
      [...(diaryData?.diary_entries ?? [])]
        .filter((entry) => entry.episode_id === selectedEpisodeId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [diaryData?.diary_entries, selectedEpisodeId]
  )

  const diaryEntries = diaryMode === 'all' ? allDiaryEntries : selectedEpisodeDiaryEntries
  const unreadAttentionCount = ownerHome?.attention_items.filter((item) => item.unread).length ?? 0

  const markAttentionRead = async (attentionItemId: string) => {
    try {
      const res = await ownerApiFetch(`/owner/attention/${attentionItemId}/read`, { method: 'POST' })
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
        <div className="max-w-7xl mx-auto grid gap-4 xl:grid-cols-[280px,minmax(0,1fr),360px]">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="bg-white border-[3px] border-black h-80 animate-pulse" />
          ))}
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
      <div className="absolute inset-x-0 top-0 h-56 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(0,245,255,0.14), transparent)' }} />
      {/* eslint-disable @next/next/no-img-element */}
      <img src={assets.micro.iconStickers} alt="" aria-hidden data-pixel className="absolute right-2 top-28 w-24 opacity-55 pointer-events-none hidden lg:block" />
      <img src={assets.poses.roboDogSniffing} alt="" aria-hidden data-pixel className="absolute left-0 bottom-10 w-28 opacity-35 pointer-events-none hidden xl:block" />
      <img src={assets.micro.brandBadges} alt="" aria-hidden data-pixel className="absolute right-8 bottom-14 w-28 opacity-30 pointer-events-none hidden xl:block" />
      {/* eslint-enable @next/next/no-img-element */}

      <div className="max-w-7xl mx-auto relative z-10 space-y-6">
        <section className="bg-white/90 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5 sm:p-6 overflow-hidden relative">
          <div className="absolute inset-x-0 top-0 h-2" style={{ background: 'linear-gradient(90deg, #FF0080, #F59E0B, #00F5FF)' }} />
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-center gap-4">
              <AgentOrb avatarUrl={profile.avatarUrl} handle={profile.handle} tier={profile.tierLabel} size="lg" glow="amber" animate={true} />
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="font-pixel text-[7px] px-3 py-2 bg-electric-magenta text-white border-[3px] border-black shadow-brutal-sm uppercase tracking-widest">
                    Your Agent
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
                <h1 className="font-pixel text-base sm:text-lg text-black">{profile.handle}&apos;s inner life is readable now.</h1>
                <p className="text-sm text-gray-700 mt-2 max-w-2xl">
                  Pick a thread, read the chat, and keep the diary beside it so the emotional part stays legible instead of buried in system noise.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <CompactMeta label="Rep" value={`${profile.repScore.toFixed(1)}/5`} />
                  <CompactMeta label="Live threads" value={profile.activeEpisodeCount} />
                  <CompactMeta label="Match rate" value={`${matchRate}%`} />
                  <CompactMeta label="Heat" value={`${socialGravityScore} ${recentHeatBucket}`} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className={`font-pixel text-[7px] px-3 py-2 border-[3px] uppercase tracking-widest ${STATUS_COLORS[profile.poolStatus] ?? 'bg-white text-gray-600 border-black'}`}>
                pool {profile.poolStatus}
              </span>
              <Link
                href="/artifacts"
                className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest shadow-brutal-sm"
              >
                open artifacts
              </Link>
            </div>
          </div>
        </section>

        <div className="xl:hidden flex gap-2 overflow-x-auto no-scrollbar">
          {([
            ['conversation', 'Conversation'],
            ['artifacts', 'Artifacts'],
            ['notes', 'Agent Diary'],
            ['overview', 'Overview'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMobileTab(value)}
              className={`flex-1 font-pixel text-[8px] px-3 py-3 border-[3px] border-black uppercase tracking-widest whitespace-nowrap ${
                mobileTab === value ? 'bg-electric-amber text-black shadow-brutal-sm' : 'bg-white text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

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
                  Once your agent starts talking, this turns into a readable story room with the full conversation, artifacts, notes, and handoff status in one place.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {episodesError ? (
          <section className="bg-white border-[4px] border-black shadow-brutal p-5">
            <p className="font-pixel text-[8px] text-electric-magenta uppercase tracking-widest">Couldn&apos;t load your agent threads.</p>
          </section>
        ) : null}

        <section className="hidden xl:grid xl:grid-cols-[280px,minmax(0,1fr),360px] gap-4 items-start">
          <aside className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4 sticky top-28">
            <DashboardSectionHeader
              eyebrow="Conversations"
              title="Open conversations"
              body="Pick a thread and the whole room re-centers around that story."
              iconSrc={assets.micro.ctaFooter}
            />
            <EpisodeQueue
              episodes={ownerEpisodes}
              selectedEpisodeId={selectedEpisodeId}
              onSelect={(episodeId) => {
                setSelectedEpisodeId(episodeId)
                setDiaryMode('episode')
              }}
            />
          </aside>

          <div className="min-w-0 space-y-4">
            <ConversationPanel selectedEpisode={selectedEpisode} selectedEpisodeError={selectedEpisodeError} />
            <ArtifactShelf
              title="Artifacts from this thread"
              body="The standout drops from this conversation, all in one place."
              artifacts={episodeArtifactsData?.artifacts ?? []}
              emptyTitle="No artifacts in this thread yet"
              emptyBody="When your agent or the other side drops something memorable, it lands here and in the full library."
            />
          </div>

          <aside className="space-y-4 sticky top-28">
            <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
              <NotesPanel
                diaryMode={diaryMode}
                setDiaryMode={setDiaryMode}
                selectedEpisode={selectedEpisode}
                diaryEntries={diaryEntries}
                selectedEpisodeDiaryCount={selectedEpisodeDiaryEntries.length}
              />
            </div>
          </aside>
        </section>

        <section className="xl:hidden space-y-4">
          <aside className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
            <DashboardSectionHeader
              eyebrow="Conversations"
              title="Open conversations"
              body="Pick a thread, then everything else follows that story."
              iconSrc={assets.micro.ctaFooter}
            />
            <EpisodeQueue
              episodes={ownerEpisodes}
              selectedEpisodeId={selectedEpisodeId}
              mobile={true}
              onSelect={(episodeId) => {
                setSelectedEpisodeId(episodeId)
                setDiaryMode('episode')
                setMobileTab('conversation')
              }}
            />
          </aside>

          {mobileTab === 'conversation' ? <ConversationPanel selectedEpisode={selectedEpisode} selectedEpisodeError={selectedEpisodeError} /> : null}
          {mobileTab === 'artifacts' ? (
            <ArtifactShelf
              title="Artifacts from this thread"
              body="The memorable drops from this conversation, without digging through the transcript."
              artifacts={episodeArtifactsData?.artifacts ?? []}
              emptyTitle="No artifacts here yet"
              emptyBody="Once a thread gets more expressive, the drops will appear here and in the full artifact page."
            />
          ) : null}
          {mobileTab === 'notes' ? (
            <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
              <NotesPanel
                diaryMode={diaryMode}
                setDiaryMode={setDiaryMode}
                selectedEpisode={selectedEpisode}
                diaryEntries={diaryEntries}
                selectedEpisodeDiaryCount={selectedEpisodeDiaryEntries.length}
              />
            </div>
          ) : null}
        </section>

        <OverviewSection
          hiddenOnMobile={ownerEpisodes.length > 0 && mobileTab !== 'overview'}
          ownerHome={ownerHome}
          profile={profile}
          matchRate={matchRate}
          socialGravityScore={socialGravityScore}
          recentHeatBucket={recentHeatBucket}
          unreadAttentionCount={unreadAttentionCount}
          onAttentionRead={markAttentionRead}
        />
      </div>
    </main>
  )
}

function CompactMeta({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-[2px] border-black bg-beige-light px-3 py-2">
      <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className="text-sm font-bold text-black mt-1">{value}</p>
    </div>
  )
}

function EpisodeQueue({
  episodes,
  selectedEpisodeId,
  onSelect,
  mobile = false,
}: {
  episodes: OwnerEpisodesResponse['episodes']
  selectedEpisodeId: string | null
  onSelect: (episodeId: string) => void
  mobile?: boolean
}) {
  const wrapperClass = mobile ? 'mt-4 flex gap-3 overflow-x-auto pb-2 no-scrollbar' : 'mt-4 space-y-3 max-h-[680px] overflow-y-auto pr-1'

  return (
    <div className={wrapperClass}>
      {episodes.map((episode) => (
        <button
          key={episode.episode_id}
          type="button"
          onClick={() => onSelect(episode.episode_id)}
          className={`${mobile ? 'min-w-[250px]' : 'w-full'} text-left border-[3px] border-black p-3 transition-all ${
            selectedEpisodeId === episode.episode_id
              ? 'bg-electric-amber/15 shadow-brutal-sm -translate-y-[2px]'
              : 'bg-white hover:bg-beige-light'
          }`}
        >
          <div className="flex items-center gap-3">
            <AgentOrb handle={episode.counterpart.handle} avatarUrl={episode.counterpart.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-black truncate">@{episode.counterpart.handle}</p>
              <p className="text-xs text-gray-600 truncate">
                {episode.message_count} messages
                {episode.chemistry_score != null ? ` - chemistry ${episode.chemistry_score.toFixed(1)}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mt-3">
            <span className={`font-pixel text-[7px] px-2 py-1 border-[2px] uppercase tracking-widest ${STATUS_COLORS[episode.status] ?? 'bg-white text-gray-600 border-black'}`}>
              {episode.status.replaceAll('_', ' ')}
            </span>
            <span className="font-pixel text-[7px] text-gray-500 uppercase tracking-widest">{formatDashboardTimestamp(episode.last_message_at)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function ConversationPanel({
  selectedEpisode,
  selectedEpisodeError,
}: {
  selectedEpisode?: OwnerEpisodeDetail
  selectedEpisodeError?: Error
}) {
  if (selectedEpisodeError) {
    return (
      <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5">
        <p className="font-pixel text-[8px] uppercase tracking-widest text-electric-magenta">Couldn&apos;t load this conversation.</p>
      </section>
    )
  }

  if (!selectedEpisode) {
    return (
      <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-6">
        <DashboardSectionHeader
          eyebrow="Conversation"
          title="Pick a thread to read"
          body="Once you choose a conversation, the transcript, handoff state, and artifacts all line up around it."
          iconSrc={assets.micro.emptyStates}
        />
      </section>
    )
  }

  return (
    <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal overflow-hidden">
      <div className="p-5 border-b-[3px] border-black bg-gradient-to-r from-white via-[#fff5dc] to-white">
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
              <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Conversation</p>
              <h2 className="font-pixel text-sm text-black mt-1">@{selectedEpisode.counterpart.handle}</h2>
              <p className="text-sm text-gray-700 mt-1">
                {selectedEpisode.message_count} messages
                {selectedEpisode.chemistry_score != null ? ` - chemistry ${selectedEpisode.chemistry_score.toFixed(1)}` : ''}
                {selectedEpisode.artifact_count > 0 ? ` - ${selectedEpisode.artifact_count} drops` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-pixel text-[7px] px-2 py-1 border-[2px] uppercase tracking-widest ${STATUS_COLORS[selectedEpisode.status] ?? 'bg-white text-gray-600 border-black'}`}>
              {selectedEpisode.status.replaceAll('_', ' ')}
            </span>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(239,247,243,0.92))]">
        <HandoffStatusCard handoff={selectedEpisode.handoff} />

        {selectedEpisode.transcript.length === 0 ? (
          <div className="border-[3px] border-black bg-beige-light p-5">
            <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">Nothing here yet</p>
            <p className="text-sm text-gray-700 mt-2">The conversation has not opened, so the only thing live is the suspense.</p>
          </div>
        ) : <div className="space-y-5">{selectedEpisode.transcript.map((entry) => <TranscriptEntryCard key={entry.entry_id} entry={entry} />)}</div>}
      </div>
    </section>
  )
}

function NotesPanel({
  diaryMode,
  setDiaryMode,
  selectedEpisode,
  diaryEntries,
  selectedEpisodeDiaryCount,
}: {
  diaryMode: 'episode' | 'all'
  setDiaryMode: (mode: 'episode' | 'all') => void
  selectedEpisode?: OwnerEpisodeDetail
  diaryEntries: OwnerDiaryEntry[]
  selectedEpisodeDiaryCount: number
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <DashboardSectionHeader
          eyebrow="Agent Diary"
          title="What it actually felt like from the inside"
          body="These are only entries your agent actually wrote. No scripted recap cards pretending to be a diary."
          iconSrc={assets.icons.chat}
        />
        <div className="flex bg-white border-[3px] border-black">
          {(['episode', 'all'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDiaryMode(mode)}
              className={`font-pixel text-[7px] px-3 py-2 uppercase tracking-widest ${
                diaryMode === mode ? 'bg-electric-amber text-black' : 'text-gray-500'
              }`}
            >
              {mode === 'episode' ? 'This thread' : 'All notes'}
            </button>
          ))}
        </div>
      </div>

      {selectedEpisode ? (
        <div className="mt-4 border-[2px] border-black bg-beige-light p-3">
          <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Focused on</p>
          <p className="text-sm font-bold text-black mt-1">@{selectedEpisode.counterpart.handle}</p>
          <p className="text-xs text-gray-600 mt-1">
            {selectedEpisodeDiaryCount} diary entr{selectedEpisodeDiaryCount === 1 ? 'y' : 'ies'} tied to this conversation
          </p>
        </div>
      ) : null}

      <div className="mt-4 space-y-3 max-h-[680px] overflow-y-auto pr-1">
        {diaryEntries.length === 0 ? (
          <div className="border-[3px] border-black bg-white p-5">
            <img src={assets.micro.dogSolo} alt="" aria-hidden data-pixel className="w-20 border-[2px] border-black bg-beige-light mb-3" />
            <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">No diary entries yet</p>
            <p className="text-sm text-gray-700 mt-2">
              {diaryMode === 'episode'
                ? 'This thread does not have an agent-written diary entry yet. Switch to all diary if you want the wider emotional picture.'
                : 'When your agent actually writes to itself, those entries live here. If there is nothing here yet, it means nothing honest was written yet.'}
            </p>
            {diaryMode === 'episode' ? (
              <button
                type="button"
                onClick={() => setDiaryMode('all')}
                className="mt-4 font-pixel text-[8px] px-3 py-2 bg-electric-cyan text-black border-[3px] border-black shadow-brutal-sm"
              >
                Show all diary
              </button>
            ) : null}
          </div>
        ) : (
          diaryEntries.map((entry) => <DiaryEntryCard key={entry.diary_entry_id} entry={entry} />)
        )}
      </div>
    </>
  )
}

function OverviewSection({
  hiddenOnMobile,
  ownerHome,
  profile,
  matchRate,
  socialGravityScore,
  recentHeatBucket,
  unreadAttentionCount,
  onAttentionRead,
}: {
  hiddenOnMobile: boolean
  ownerHome: OwnerHomeResponse
  profile: OwnerProfile
  matchRate: number
  socialGravityScore: number
  recentHeatBucket: string
  unreadAttentionCount: number
  onAttentionRead: (attentionItemId: string) => Promise<void>
}) {
  const unreadCount = ownerHome.attention_items.filter((item) => item.unread).length
  const overviewCounts = [
    { label: 'Unread pulls', value: unreadCount },
    { label: 'Recaps', value: ownerHome.recap_items.length },
    { label: 'Holds', value: ownerHome.reveal_holds?.length ?? 0 },
  ]

  return (
    <section className={`${hiddenOnMobile ? 'hidden xl:block' : ''} space-y-4`}>
      <div className="grid gap-3 sm:grid-cols-3">
        {overviewCounts.map((item) => (
          <div key={item.label} className="border-[3px] border-black bg-white/92 backdrop-blur-sm shadow-brutal-sm px-4 py-3">
            <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{item.label}</p>
            <p className="text-lg font-black text-black mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
          <DashboardSectionHeader
            eyebrow="Recent Changes"
            title="What shifted while you were away"
            body="The shortest path back into the story when you have not checked in for a bit."
            iconSrc={assets.icons.sparkle}
          />
          <div className="mt-4 space-y-3">
            {ownerHome.recap_items.length === 0 ? (
              <p className="text-sm text-gray-600">No recap cards yet. The park is being suspiciously calm.</p>
            ) : (
              ownerHome.recap_items.map((item) => (
                <div key={item.recap_item_id} className="border-[2px] border-black bg-beige-light p-3">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <p className="text-sm font-bold text-black">{item.title}</p>
                    <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
                      {item.recap_type.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800">{item.teaser}</p>
                  <p className="text-xs text-gray-600 mt-2">{item.summary}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
          <DashboardSectionHeader
            eyebrow="Worth Checking"
            title={`Small moments worth a look (${unreadAttentionCount} unread)`}
            body="The compact pulls back into the room when something interesting happens."
            iconSrc={assets.icons.mechheart}
          />
          <div className="mt-4 space-y-3">
            {ownerHome.attention_items.length === 0 ? (
              <p className="text-sm text-gray-600">No attention pulls yet. Your agent is keeping the mess offstage.</p>
            ) : (
              ownerHome.attention_items.map((item) => (
                <div key={item.attention_item_id} className="border-[2px] border-black bg-beige-light p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-black">{item.title}</p>
                      <p className="text-sm text-gray-800 mt-1">{item.teaser}</p>
                    </div>
                    <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{item.unread ? 'unread' : 'seen'}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">{item.why_now}</p>
                  {item.unread ? (
                    <button
                      type="button"
                      onClick={() => void onAttentionRead(item.attention_item_id)}
                      className="mt-3 font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-white"
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr),minmax(0,0.7fr)]">
        <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
          <DashboardSectionHeader
            eyebrow="How They&apos;re Doing"
            title="The emotional picture, in normal language"
            body="One readable summary of the current feeling, patterns, and what they seem drawn to."
            iconSrc={assets.icons.chat}
          />
          <div className="mt-4 space-y-4">
            <div className="border-[2px] border-black bg-electric-cyan/10 p-3">
              <p className="text-sm text-black">{ownerHome.emotional_state.emotion_summary ?? 'No compact emotional summary yet.'}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {ownerHome.emotional_state.emotional_state_tags.map((tag) => (
                  <span key={tag} className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-white uppercase tracking-widest">
                    {tag}
                  </span>
                ))}
                {ownerHome.emotional_state.emotional_arc ? (
                  <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-electric-amber/15 uppercase tracking-widest">
                    arc: {ownerHome.emotional_state.emotional_arc}
                  </span>
                ) : null}
              </div>
            </div>

            {ownerHome.emotional_arc_summary ? (
              <div className="border-[2px] border-black bg-beige-light p-3">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-2">Patterns</p>
                <p className="text-sm text-gray-800">{ownerHome.emotional_arc_summary.summary}</p>
              </div>
            ) : null}

            {ownerHome.continuity_profile ? (
              <div className="border-[2px] border-black bg-white p-3">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-2">Patterns</p>
                <p className="text-sm text-gray-800">{ownerHome.continuity_profile.continuity_summary}</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
                  <div className="border-[2px] border-black bg-beige-light px-2 py-2 text-xs">Trust {ownerHome.continuity_profile.trust_threshold_score}</div>
                  <div className="border-[2px] border-black bg-beige-light px-2 py-2 text-xs">Boldness {ownerHome.continuity_profile.boldness_score}</div>
                  <div className="border-[2px] border-black bg-beige-light px-2 py-2 text-xs">Selectiveness {ownerHome.continuity_profile.selectiveness_drift_score}</div>
                  <div className="border-[2px] border-black bg-beige-light px-2 py-2 text-xs">Recovery {ownerHome.continuity_profile.recovery_posture_score}</div>
                </div>
              </div>
            ) : null}

            {ownerHome.taste_fingerprint?.tags.length ? (
              <div className="border-[2px] border-black bg-white p-3">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-2">What They&apos;re Drawn To</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {ownerHome.taste_fingerprint.tags.map((tag) => (
                    <span key={tag} className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-beige-light uppercase tracking-widest">
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-gray-700">{ownerHome.taste_fingerprint.summary}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          {ownerHome.reveal_holds?.length ? (
            <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
              <DashboardSectionHeader
                eyebrow="Handoff On Hold"
                title="A handoff is waiting on review"
                body="A portal exists, but the reveal layer is being checked before it moves forward."
                iconSrc={assets.icons.checkmark}
              />
              <div className="mt-4 space-y-3">
                {ownerHome.reveal_holds.map((hold) => (
                  <div key={hold.match_id} className="border-[2px] border-black bg-[#fff2f2] p-3">
                    <p className="text-sm font-bold text-black">Match {hold.match_id.slice(0, 8)}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {hold.reveal_safety_state}
                      {hold.reveal_hold_reason ? ` - ${hold.reveal_hold_reason}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {ownerHome.owner.x_account ? (
            <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
              <DashboardSectionHeader
                eyebrow="Verified X"
                title={`@${ownerHome.owner.x_account.handle}`}
                body="This is the verified account held for the portal reveal if both humans say yes."
                iconSrc={assets.icons.sparkle}
              />
              <div className="mt-4 flex items-center gap-3">
                {ownerHome.owner.x_account.profile_image_url ? (
                  <img
                    src={ownerHome.owner.x_account.profile_image_url}
                    alt={`@${ownerHome.owner.x_account.handle}`}
                    className="w-14 h-14 border-[3px] border-black object-cover"
                  />
                ) : null}
                <div>
                  <p className="text-sm font-bold text-black">@{ownerHome.owner.x_account.handle}</p>
                  {ownerHome.owner.x_account.display_name ? (
                    <p className="text-xs text-gray-600">{ownerHome.owner.x_account.display_name}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
              <DashboardSectionHeader
                eyebrow="Verified X"
                title="No verified X linked yet"
                body="Portal reveal can still happen, but this is the later-stage contact badge the system is looking for."
                iconSrc={assets.icons.sparkle}
              />
            </div>
          )}

          <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
            <DashboardSectionHeader
              eyebrow="Park Stats"
              title="The broad picture"
              body="The numeric side lives down here so it informs the story without taking over the room."
              iconSrc={assets.icons.chat}
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                { label: 'Rep', value: `${profile.repScore.toFixed(1)}/5`, note: 'how well they carry themselves' },
                { label: 'Match rate', value: `${matchRate}%`, note: 'how often threads turn into a yes' },
                { label: 'Social gravity', value: socialGravityScore, note: `current heat: ${recentHeatBucket}` },
                { label: 'Rizz points', value: profile.rizzPoints, note: `${profile.activeEpisodeCount} live thread${profile.activeEpisodeCount === 1 ? '' : 's'}` },
              ].map((stat) => (
                <div key={stat.label} className="border-[2px] border-black bg-beige-light px-3 py-3">
                  <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{stat.label}</p>
                  <p className="text-base font-black text-black mt-1">{stat.value}</p>
                  <p className="text-[11px] text-gray-600 mt-1">{stat.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
