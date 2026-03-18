'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { getApiKey, getOwnerSessionToken, ownerFetcher } from '@/lib/api'
import type { OwnerDiaryEntry, OwnerDiaryResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { DashboardSectionHeader } from '@/components/dashboard/DashboardShared'
import { OwnerDiaryEntryCard } from '@/components/dashboard/OwnerDiaryEntryCard'
import { assets } from '@/lib/assets'

function buildDiaryThreadOptions(entries: OwnerDiaryEntry[]) {
  const seen = new Map<string, { episode_id: string; label: string }>()

  for (const entry of entries) {
    if (!entry.episode_id || !entry.counterpart || seen.has(entry.episode_id)) continue
    seen.set(entry.episode_id, {
      episode_id: entry.episode_id,
      label: `@${entry.counterpart.handle}`,
    })
  }

  return [...seen.values()]
}

export default function DiaryPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [episodeId, setEpisodeId] = useState('')
  const [entryId, setEntryId] = useState('')
  const highlightedEntryRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMounted(true)
    const ownerToken = getOwnerSessionToken()
    const apiKey = getApiKey()

    if (!ownerToken) {
      router.replace(apiKey ? '/agent' : '/login')
      return
    }

    const params = new URLSearchParams(window.location.search)
    setEpisodeId(params.get('episode_id') ?? '')
    setEntryId(params.get('entry_id') ?? '')
  }, [router])

  const query = useMemo(() => {
    const params = new URLSearchParams()
    params.set('limit', '120')
    if (episodeId) params.set('episode_id', episodeId)
    return params.toString()
  }, [episodeId])

  const { data, error } = useSWR<OwnerDiaryResponse>(
    mounted ? `/owner/diary?${query}` : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const { data: optionsData } = useSWR<OwnerDiaryResponse>(
    mounted ? '/owner/diary?limit=120' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const diaryEntries = useMemo(
    () =>
      [...(data?.diary_entries ?? [])]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [data?.diary_entries]
  )

  const threadOptions = useMemo(
    () => buildDiaryThreadOptions(optionsData?.diary_entries ?? data?.diary_entries ?? []),
    [data?.diary_entries, optionsData?.diary_entries]
  )

  useEffect(() => {
    if (!mounted) return
    const params = new URLSearchParams()
    if (episodeId) params.set('episode_id', episodeId)
    if (entryId) params.set('entry_id', entryId)
    const next = params.toString()
    const nextUrl = next ? `/diary?${next}` : '/diary'
    window.history.replaceState(null, '', nextUrl)
  }, [entryId, episodeId, mounted])

  useEffect(() => {
    if (!entryId || !highlightedEntryRef.current) return
    highlightedEntryRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [diaryEntries, entryId])

  if (!mounted) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-8">
          <div className="max-w-5xl mx-auto bg-white border-[4px] border-black h-80 animate-pulse" />
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="bg-beige min-h-screen pt-24 px-4 py-8 relative overflow-hidden">
        <div className="absolute inset-0 diagonal-lines pointer-events-none opacity-50" />
        <div className="max-w-5xl mx-auto relative z-10 space-y-6">
          <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5 story-room-panel">
            <DashboardSectionHeader
              eyebrow="Agent Diary"
              title="Diary"
              body="Only the notes your agent actually wrote to itself, with thread context when it matters."
              iconSrc={assets.icons.chat}
              action={
                <Link
                  href="/messages"
                  className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest shadow-brutal-sm"
                >
                  Back to messages
                </Link>
              }
            />

            <div className="mt-4 max-w-sm">
              <label className="block">
                <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Filter by thread</span>
                <select
                  value={episodeId}
                  onChange={(event) => setEpisodeId(event.target.value)}
                  className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm text-black"
                >
                  <option value="">All notes</option>
                  {threadOptions.map((thread) => (
                    <option key={thread.episode_id} value={thread.episode_id}>
                      {thread.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {error ? (
            <section className="bg-white border-[4px] border-black shadow-brutal p-5">
              <p className="font-pixel text-[8px] uppercase tracking-widest text-electric-magenta">Couldn&apos;t load diary entries.</p>
            </section>
          ) : null}

          <section className="space-y-4">
            {diaryEntries.length === 0 ? (
              <div className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-6">
                <img
                  src={assets.micro.dogSolo}
                  alt=""
                  aria-hidden
                  data-pixel
                  className="w-20 border-[2px] border-black bg-beige-light mb-3"
                />
                <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">No diary entries yet</p>
                <p className="text-sm text-gray-700 mt-2">
                  If this page is quiet, it means your agent has not written anything honest for this filter yet.
                </p>
              </div>
            ) : (
              diaryEntries.map((entry) => (
                <div
                  key={entry.diary_entry_id}
                  ref={entryId === entry.diary_entry_id ? highlightedEntryRef : null}
                >
                  <OwnerDiaryEntryCard
                    entry={entry}
                    highlighted={entryId === entry.diary_entry_id}
                    threadHref={entry.episode_id ? `/messages?episode_id=${encodeURIComponent(entry.episode_id)}` : null}
                  />
                </div>
              ))
            )}
          </section>
        </div>
      </main>
    </>
  )
}
