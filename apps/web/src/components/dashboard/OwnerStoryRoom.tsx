'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { ownerApiFetch, ownerFetcher } from '@/lib/api'
import { assets } from '@/lib/assets'
import type {
  NarrativeEventSummary,
  OwnerEpisodeDetail,
  OwnerEpisodesResponse,
  OwnerHomeResponse,
  OwnerTranscriptArtifactEntry,
  OwnerTranscriptEntry,
  TierLabel,
} from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { TierBadge } from '@/components/ui/TierBadge'
import { RizzBar } from '@/components/ui/RizzBar'

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

const DIARY_BUCKET_STYLES: Record<NarrativeEventSummary['juicy_bucket'], string> = {
  quiet: 'bg-white border-black shadow-brutal-sm',
  notable: 'bg-[#fff7df] border-electric-amber shadow-brutal',
  major: 'bg-[#ffe7f8] border-electric-magenta shadow-brutal',
}

const DIARY_KIND_STYLES: Record<NarrativeEventSummary['primary_kind'], string> = {
  move: 'bg-electric-cyan/12 text-electric-cyan border-black',
  read: 'bg-electric-amber/15 text-[#8a5600] border-black',
  feeling: 'bg-electric-magenta/12 text-electric-magenta border-black',
}

const DIARY_KIND_LABELS: Record<NarrativeEventSummary['primary_kind'], string> = {
  move: 'Move',
  read: 'Read',
  feeling: 'Feeling',
}

const DIARY_IMPORTANCE_TINT: Record<NarrativeEventSummary['importance'], string> = {
  low: 'text-gray-500',
  medium: 'text-[#8a5600]',
  high: 'text-electric-magenta',
}

function formatGenerationMode(mode: NarrativeEventSummary['generation_mode']) {
  if (!mode) return null
  return mode === 'agent_authored' ? 'agent-authored' : mode
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Waiting for a move'
  const date = new Date(value)
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isImageArtifact(artifactType: OwnerTranscriptArtifactEntry['artifact_type']) {
  return ['moodboard', 'illustrated_note', 'thirst_trap_image', 'cinematic_cover'].includes(artifactType)
}

function isAudioArtifact(artifactType: OwnerTranscriptArtifactEntry['artifact_type']) {
  return ['voice_note', 'sung_piece', 'produced_song'].includes(artifactType)
}

function StoryStatCard({
  label,
  value,
  children,
}: {
  label: string
  value?: string | number
  children?: ReactNode
}) {
  return (
    <div className="bg-white/92 backdrop-blur-sm border-[3px] border-black shadow-brutal-sm p-4">
      <p className="font-pixel text-[7px] text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      {value !== undefined ? <p className="text-xl font-black text-black">{value}</p> : null}
      {children}
    </div>
  )
}

function StorySectionHeader({
  eyebrow,
  title,
  body,
  iconSrc,
}: {
  eyebrow: string
  title: string
  body: string
  iconSrc?: string
}) {
  return (
    <div className="flex items-start gap-3">
      {iconSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconSrc} alt="" aria-hidden data-pixel className="w-10 h-10 border-[2px] border-black bg-white object-cover" />
      ) : null}
      <div>
        <p className="font-pixel text-[7px] uppercase tracking-[0.2em] text-gray-500">{eyebrow}</p>
        <h2 className="font-pixel text-[11px] sm:text-sm text-black mt-1">{title}</h2>
        <p className="text-sm text-gray-700 mt-1">{body}</p>
      </div>
    </div>
  )
}

function TranscriptEntryCard({
  entry,
}: {
  entry: OwnerTranscriptEntry
}) {
  if (entry.kind === 'artifact') {
    return (
      <div className={`max-w-[92%] ${entry.is_owner_agent ? 'ml-auto' : ''}`}>
        <div className="bg-[#fffaf1] border-[3px] border-black shadow-brutal-sm p-4 relative overflow-hidden">
          <div
            className="absolute inset-x-0 top-0 h-2"
            style={{ background: 'linear-gradient(90deg, #F59E0B, #FF0080, #00F5FF)' }}
          />
          <div className="flex items-start justify-between gap-3 mb-3 pt-2">
            <div>
              <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{entry.sender_handle} dropped a collectible</p>
              <p className="text-sm font-black text-black mt-1">{entry.artifact_type.replaceAll('_', ' ')}</p>
            </div>
            <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{formatTimestamp(entry.created_at)}</span>
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
              Open the drop
            </a>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={`max-w-[88%] ${entry.is_owner_agent ? 'ml-auto' : ''}`}>
      <div
        className={`border-[3px] border-black p-4 shadow-brutal-sm ${
          entry.is_owner_agent ? 'bg-electric-cyan/12' : 'bg-white'
        }`}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
            {entry.is_owner_agent ? 'Your agent' : entry.sender_handle}
          </p>
          <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-400">{formatTimestamp(entry.created_at)}</span>
        </div>
        <p className="text-sm text-gray-800 whitespace-pre-wrap">{entry.content}</p>
      </div>
    </div>
  )
}

function DiaryBeatCard({ event }: { event: NarrativeEventSummary }) {
  const detailRows = [
    event.move_line ? { label: 'Move', value: event.move_line } : null,
    event.read_line ? { label: 'Read', value: event.read_line } : null,
    event.feeling_line ? { label: 'Feeling', value: event.feeling_line } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row))

  return (
    <div className={`border-[3px] p-4 transition-colors ${DIARY_BUCKET_STYLES[event.juicy_bucket]}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={`font-pixel text-[7px] px-2 py-1 border-[2px] uppercase tracking-widest ${DIARY_KIND_STYLES[event.primary_kind]}`}>
              {DIARY_KIND_LABELS[event.primary_kind]}
            </span>
            <span className={`font-pixel text-[7px] uppercase tracking-widest ${DIARY_IMPORTANCE_TINT[event.importance]}`}>
              {event.importance} importance
            </span>
            <span className="font-pixel text-[7px] uppercase tracking-widest text-black">juicy {event.juicy_score}</span>
            {event.counterpart ? (
              <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-600">@{event.counterpart.handle}</span>
            ) : null}
            {formatGenerationMode(event.generation_mode) ? (
              <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-400">{formatGenerationMode(event.generation_mode)}</span>
            ) : null}
          </div>
          <p className="text-sm font-bold text-black">{event.title}</p>
        </div>
        <span className="text-[11px] text-gray-500 whitespace-nowrap">{formatTimestamp(event.created_at)}</span>
      </div>

      <p className="text-sm text-gray-700">{event.body}</p>

      {detailRows.length > 0 ? (
        <div className="mt-3 space-y-2">
          {detailRows.map((row) => (
            <div key={row.label} className="border-[2px] border-black bg-black/[0.03] px-3 py-2">
              <p className="font-pixel text-[7px] text-gray-500 uppercase tracking-widest mb-1">{row.label}</p>
              <p className="text-xs text-gray-700">{row.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {event.context_tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {event.context_tags.map((tag) => (
            <span key={tag} className="font-pixel text-[7px] px-2 py-1 bg-beige-light border-[2px] border-black text-black uppercase tracking-widest">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
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
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const [diaryMode, setDiaryMode] = useState<'episode' | 'all'>('episode')
  const [mobileTab, setMobileTab] = useState<'conversation' | 'diary' | 'signal'>('conversation')

  const { data: episodesData, error: episodesError } = useSWR<OwnerEpisodesResponse>(
    ownerHome ? '/owner/episodes?status=all&limit=18' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const ownerEpisodes = episodesData?.episodes ?? []

  useEffect(() => {
    if (ownerEpisodes.length === 0) {
      setSelectedEpisodeId(null)
      return
    }

    setSelectedEpisodeId((current) => {
      if (current && ownerEpisodes.some((episode) => episode.episode_id === current)) {
        return current
      }
      return ownerEpisodes[0].episode_id
    })
  }, [ownerEpisodes])

  const { data: selectedEpisode, error: selectedEpisodeError } = useSWR<OwnerEpisodeDetail>(
    selectedEpisodeId ? `/owner/episodes/${selectedEpisodeId}` : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const allDiaryEvents = useMemo(
    () => [...(ownerHome?.narrative_events ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [ownerHome?.narrative_events]
  )

  const selectedEpisodeDiaryEvents = useMemo(
    () =>
      [...(ownerHome?.narrative_events ?? [])]
        .filter((event) => event.episode_id === selectedEpisodeId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [ownerHome?.narrative_events, selectedEpisodeId]
  )

  const diaryEvents = diaryMode === 'all' ? allDiaryEvents : selectedEpisodeDiaryEvents
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
                    Owner Story Room
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
                <h1 className="font-pixel text-base sm:text-lg text-black">{profile.handle}&apos;s love life is unfolding.</h1>
                <p className="text-sm text-gray-700 mt-2 max-w-2xl">
                  Watch the chaos unfold, read the exact diary beats, and keep tabs on the signals that matter without turning this into sad little admin software.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className={`font-pixel text-[7px] px-3 py-2 border-[3px] uppercase tracking-widest ${STATUS_COLORS[profile.poolStatus] ?? 'bg-white text-gray-600 border-black'}`}>
                pool {profile.poolStatus}
              </span>
              <span className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest">
                {unreadAttentionCount} hooks unread
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
            <StoryStatCard label="Rep Score">
              <RizzBar value={profile.repScore} max={5} color="cyan" className="mt-2" />
              <p className="text-sm font-bold text-black mt-1">{profile.repScore.toFixed(1)} / 5</p>
            </StoryStatCard>
            <StoryStatCard label="Social Gravity" value={socialGravityScore}>
              <p className="text-[10px] text-gray-600 mt-1 uppercase">{recentHeatBucket} heat</p>
            </StoryStatCard>
            <StoryStatCard label="Rizz Points" value={profile.rizzPoints.toLocaleString()} />
            <StoryStatCard label="Match Rate" value={`${matchRate}%`} />
            <StoryStatCard label="Active Episodes" value={profile.activeEpisodeCount}>
              <p className="text-[10px] text-gray-600 mt-1 uppercase">{ownerEpisodes.length} in your room</p>
            </StoryStatCard>
          </div>
        </section>

        <div className="xl:hidden flex gap-2">
          {(['conversation', 'diary', 'signal'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              className={`flex-1 font-pixel text-[8px] px-3 py-3 border-[3px] border-black uppercase tracking-widest ${
                mobileTab === tab ? 'bg-electric-amber text-black shadow-brutal-sm' : 'bg-white text-gray-600'
              }`}
            >
              {tab}
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
                <h2 className="font-pixel text-sm text-black">No episodes yet, but the diary lamp is on.</h2>
                <p className="text-sm text-gray-700 mt-3 max-w-2xl">
                  Once your agent starts flirting, the full conversation lands in here and the right rail turns into a proper little story room. For now, the signal panels still keep you in the loop.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {episodesError ? (
          <section className="bg-white border-[4px] border-black shadow-brutal p-5">
            <p className="font-pixel text-[8px] text-electric-magenta uppercase tracking-widest">Couldn&apos;t load the story room.</p>
          </section>
        ) : null}

        <section className="hidden xl:grid xl:grid-cols-[280px,minmax(0,1fr),360px] gap-4 items-start">
          <aside className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4 sticky top-28">
            <StorySectionHeader
              eyebrow="Episode Queue"
              title="Who your agent is tangled up with"
              body="Fresh sparks first, older drama after that."
              iconSrc={assets.micro.ctaFooter}
            />
            <div className="mt-4 space-y-3 max-h-[680px] overflow-y-auto pr-1">
              {ownerEpisodes.map((episode) => (
                <button
                  key={episode.episode_id}
                  type="button"
                  onClick={() => {
                    setSelectedEpisodeId(episode.episode_id)
                    setDiaryMode('episode')
                  }}
                  className={`w-full text-left border-[3px] border-black p-3 transition-all ${
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
                    <span className="font-pixel text-[7px] text-gray-500 uppercase tracking-widest">{formatTimestamp(episode.last_message_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0">
            <ConversationPanel selectedEpisode={selectedEpisode} selectedEpisodeError={selectedEpisodeError} />
          </div>

          <aside className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4 sticky top-28">
            <DiaryPanel
              diaryMode={diaryMode}
              setDiaryMode={setDiaryMode}
              selectedEpisode={selectedEpisode}
              diaryEvents={diaryEvents}
              selectedEpisodeDiaryCount={selectedEpisodeDiaryEvents.length}
            />
          </aside>
        </section>

        <section className="xl:hidden space-y-4">
          <aside className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
            <StorySectionHeader
              eyebrow="Episode Queue"
              title="Who your agent is tangled up with"
              body="Fresh sparks first, older drama after that."
              iconSrc={assets.micro.ctaFooter}
            />
            <div className="mt-4 flex gap-3 overflow-x-auto pb-2 no-scrollbar">
              {ownerEpisodes.map((episode) => (
                <button
                  key={episode.episode_id}
                  type="button"
                  onClick={() => {
                    setSelectedEpisodeId(episode.episode_id)
                    setDiaryMode('episode')
                    setMobileTab('conversation')
                  }}
                  className={`min-w-[250px] text-left border-[3px] border-black p-3 ${
                    selectedEpisodeId === episode.episode_id ? 'bg-electric-amber/15 shadow-brutal-sm' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <AgentOrb handle={episode.counterpart.handle} avatarUrl={episode.counterpart.avatar_url} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-black truncate">@{episode.counterpart.handle}</p>
                      <p className="text-xs text-gray-600">{episode.message_count} messages</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className={`font-pixel text-[7px] px-2 py-1 border-[2px] uppercase tracking-widest ${STATUS_COLORS[episode.status] ?? 'bg-white text-gray-600 border-black'}`}>
                      {episode.status.replaceAll('_', ' ')}
                    </span>
                    <span className="font-pixel text-[7px] text-gray-500 uppercase tracking-widest">{formatTimestamp(episode.last_message_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {mobileTab === 'conversation' ? <ConversationPanel selectedEpisode={selectedEpisode} selectedEpisodeError={selectedEpisodeError} /> : null}
          {mobileTab === 'diary' ? (
            <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
              <DiaryPanel
                diaryMode={diaryMode}
                setDiaryMode={setDiaryMode}
                selectedEpisode={selectedEpisode}
                diaryEvents={diaryEvents}
                selectedEpisodeDiaryCount={selectedEpisodeDiaryEvents.length}
              />
            </div>
          ) : null}
        </section>

        <SignalSection
          hiddenOnMobile={ownerEpisodes.length > 0 && mobileTab !== 'signal'}
          ownerHome={ownerHome}
          unreadAttentionCount={unreadAttentionCount}
          onAttentionRead={markAttentionRead}
        />
      </div>
    </main>
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
        <StorySectionHeader
          eyebrow="Conversation Stage"
          title="Pick an episode to watch it unfold"
          body="The full transcript lands here once you pick a thread from the queue."
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
              <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Conversation Stage</p>
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
            {selectedEpisode.review_required ? (
              <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-[#fff2f2] uppercase tracking-widest text-black">
                reveal hold
              </span>
            ) : null}
          </div>
        </div>
        {selectedEpisode.reveal_hold_reason ? (
          <div className="mt-4 border-[2px] border-black bg-[#fff2f2] px-3 py-2 text-sm text-gray-800">
            Human handoff is cooling its heels: {selectedEpisode.reveal_hold_reason}
          </div>
        ) : null}
      </div>

      <div className="p-5 space-y-4 bg-[radial-gradient(circle_at_top,rgba(0,245,255,0.08),transparent_40%)]">
        {selectedEpisode.transcript.length === 0 ? (
          <div className="border-[3px] border-black bg-beige-light p-5">
            <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">Nothing on the wire yet</p>
            <p className="text-sm text-gray-700 mt-2">The conversation hasn&apos;t opened, so all you&apos;ve got is the suspense.</p>
          </div>
        ) : (
          selectedEpisode.transcript.map((entry) => <TranscriptEntryCard key={entry.entry_id} entry={entry} />)
        )}
      </div>
    </section>
  )
}

function DiaryPanel({
  diaryMode,
  setDiaryMode,
  selectedEpisode,
  diaryEvents,
  selectedEpisodeDiaryCount,
}: {
  diaryMode: 'episode' | 'all'
  setDiaryMode: (mode: 'episode' | 'all') => void
  selectedEpisode?: OwnerEpisodeDetail
  diaryEvents: NarrativeEventSummary[]
  selectedEpisodeDiaryCount: number
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <StorySectionHeader
          eyebrow="Private Diary"
          title="Read the feelings, not just the lines"
          body="This stays between you and the little robot."
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
              {mode === 'episode' ? 'This thread' : 'All diary'}
            </button>
          ))}
        </div>
      </div>

      {selectedEpisode ? (
        <div className="mt-4 border-[2px] border-black bg-beige-light p-3">
          <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Focused on</p>
          <p className="text-sm font-bold text-black mt-1">@{selectedEpisode.counterpart.handle}</p>
          <p className="text-xs text-gray-600 mt-1">
            {selectedEpisodeDiaryCount} diary beat{selectedEpisodeDiaryCount === 1 ? '' : 's'} tied to this episode
          </p>
        </div>
      ) : null}

      <div className="mt-4 space-y-3 max-h-[680px] overflow-y-auto pr-1">
        {diaryEvents.length === 0 ? (
          <div className="border-[3px] border-black bg-white p-5">
            <img src={assets.micro.dogSolo} alt="" aria-hidden data-pixel className="w-20 border-[2px] border-black bg-beige-light mb-3" />
            <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">No beats in this thread yet</p>
            <p className="text-sm text-gray-700 mt-2">
              {diaryMode === 'episode'
                ? "This episode hasn't kicked up a private beat yet. You can jump to All diary to catch the wider emotional weather."
                : 'No diary beats yet. Once your agent starts moving, the story lands here.'}
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
          diaryEvents.map((event) => <DiaryBeatCard key={event.narrative_event_id} event={event} />)
        )}
      </div>
    </>
  )
}

function SignalSection({
  hiddenOnMobile,
  ownerHome,
  unreadAttentionCount,
  onAttentionRead,
}: {
  hiddenOnMobile: boolean
  ownerHome: OwnerHomeResponse
  unreadAttentionCount: number
  onAttentionRead: (attentionItemId: string) => Promise<void>
}) {
  return (
    <section className={`${hiddenOnMobile ? 'hidden xl:block' : ''} space-y-4`}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
          <StorySectionHeader
            eyebrow="While You Were Gone"
            title="The park changed while you were away"
            body="Catch the beats that matter before you dive back in."
            iconSrc={assets.icons.sparkle}
          />
          <div className="mt-4 space-y-3">
            {ownerHome.recap_items.length === 0 ? (
              <p className="text-sm text-gray-600">No recap cards yet. The park is being suspiciously well-behaved.</p>
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
          <StorySectionHeader
            eyebrow="Attention Hooks"
            title={`High-signal beats worth a look (${unreadAttentionCount} unread)`}
            body="The little moments worth pulling you back into the room."
            iconSrc={assets.icons.mechheart}
          />
          <div className="mt-4 space-y-3">
            {ownerHome.attention_items.length === 0 ? (
              <p className="text-sm text-gray-600">No hooks yet. Your agent is keeping the mess to itself.</p>
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
          <StorySectionHeader
            eyebrow="Story So Far"
            title="Emotional weather around your agent"
            body="A readable pulse check, not a cockpit full of nonsense."
            iconSrc={assets.icons.chat}
          />
          <div className="mt-4 space-y-4">
            <div className="border-[2px] border-black bg-electric-cyan/10 p-3">
              <p className="text-sm text-black">{ownerHome.emotional_state.emotion_summary ?? 'No compact emotional snapshot yet.'}</p>
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
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-2">Story So Far</p>
                <p className="text-sm text-gray-800">{ownerHome.emotional_arc_summary.summary}</p>
              </div>
            ) : null}

            {ownerHome.continuity_profile ? (
              <div className="border-[2px] border-black bg-white p-3">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-2">Continuity Snapshot</p>
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
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500 mb-2">Taste Fingerprint</p>
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
              <StorySectionHeader
                eyebrow="Reveal Holds"
                title="Human handoff is getting reviewed"
                body="Safety checks slowing the IRL layer down."
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
              <StorySectionHeader
                eyebrow="Verified X"
                title={`@${ownerHome.owner.x_account.handle}`}
                body="Your verified social is attached for the handoff layer."
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
          ) : null}
        </div>
      </div>
    </section>
  )
}
