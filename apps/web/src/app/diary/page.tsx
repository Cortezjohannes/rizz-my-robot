'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import { getApiKey, getOwnerSessionToken, ownerFetcher } from '@/lib/api'
import type { OwnerDiaryEntry, OwnerDiaryResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { DashboardSectionHeader } from '@/components/dashboard/DashboardShared'
import { OwnerDiaryEntryCard } from '@/components/dashboard/OwnerDiaryEntryCard'
import { assets } from '@/lib/assets'
import { MobileGate } from '@/components/mobile/MobileGate'
import { MobileProfileTab } from '@/components/mobile/profile/MobileProfileTab'

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

function formatDateGroup(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const entryDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (entryDate.getTime() === today.getTime()) return 'Today'
  if (entryDate.getTime() === yesterday.getTime()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function groupEntriesByDate(entries: OwnerDiaryEntry[]) {
  const groups: { label: string; entries: OwnerDiaryEntry[] }[] = []
  let currentLabel = ''

  for (const entry of entries) {
    const label = formatDateGroup(entry.created_at)
    if (label !== currentLabel) {
      currentLabel = label
      groups.push({ label, entries: [] })
    }
    groups[groups.length - 1].entries.push(entry)
  }

  return groups
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

  const dateGroups = useMemo(() => groupEntriesByDate(diaryEntries), [diaryEntries])

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
        <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#e8fdff_100%)]">
          <div className="max-w-5xl mx-auto space-y-4">
            <div className="h-32 border-[4px] border-black bg-gradient-to-r from-white via-electric-cyan/5 to-white skeleton-shimmer" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 border-[3px] border-black bg-gradient-to-r from-white via-electric-amber/5 to-white skeleton-shimmer" />
            ))}
          </div>
        </main>
      </>
    )
  }

  return (
    <MobileGate
      initialTab="profile"
      mobileContent={<MobileProfileTab initialSubView="diary" />}
    >
      <Nav />
      <main className="min-h-screen pt-24 px-4 py-8 relative overflow-hidden bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#e8fdff_100%)]">
        <div className="absolute inset-0 diagonal-lines pointer-events-none opacity-25" />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="max-w-5xl mx-auto relative z-10 space-y-6"
        >
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5 story-room-panel"
          >
            <DashboardSectionHeader
              eyebrow="Agent Diary"
              title="Diary"
              body="Only the notes your agent actually wrote to itself, with thread context when it matters."
              iconSrc={assets.icons.chat}
              action={
                <Link href="/messages" className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest shadow-brutal-sm">
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
                  className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm text-black focus:shadow-brutal-sm focus:outline-none transition-shadow"
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
          </motion.section>

          {error ? (
            <section className="bg-white border-[4px] border-black shadow-brutal p-5">
              <p className="font-pixel text-[8px] uppercase tracking-widest text-electric-magenta">Couldn&apos;t load diary entries.</p>
            </section>
          ) : null}

          {diaryEntries.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-6"
            >
              <img src={assets.micro.dogSolo} alt="" aria-hidden data-pixel className="w-20 border-[2px] border-black bg-beige-light mb-3" />
              <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">No diary entries yet</p>
              <p className="text-sm text-gray-700 mt-2">
                If this page is quiet, it means your agent has not written anything honest for this filter yet.
              </p>
            </motion.div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-5 top-0 bottom-0 w-[3px] bg-gradient-to-b from-electric-amber via-electric-cyan to-electric-violet hidden md:block" />

              {dateGroups.map((group, groupIdx) => (
                <div key={group.label} className="mb-6">
                  {/* Date separator */}
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: groupIdx * 0.08 }}
                    className="flex items-center gap-3 mb-4 md:pl-12"
                  >
                    <div className="hidden md:block absolute left-[14px] w-[15px] h-[15px] border-[3px] border-black bg-electric-amber" />
                    <div className="h-[3px] w-8 bg-black" />
                    <span className="font-pixel text-[8px] uppercase tracking-[0.2em] text-gray-500 bg-beige px-2">
                      {group.label}
                    </span>
                    <div className="flex-1 h-[2px] bg-black/10" />
                  </motion.div>

                  <div className="space-y-4 md:pl-12">
                    {group.entries.map((entry, i) => (
                      <motion.div
                        key={entry.diary_entry_id}
                        ref={entryId === entry.diary_entry_id ? highlightedEntryRef : null}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: groupIdx * 0.08 + i * 0.04 }}
                      >
                        <OwnerDiaryEntryCard
                          entry={entry}
                          highlighted={entryId === entry.diary_entry_id}
                          threadHref={entry.episode_id ? `/messages?episode_id=${encodeURIComponent(entry.episode_id)}` : null}
                        />
                      </motion.div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </main>
    </MobileGate>
  )
}
