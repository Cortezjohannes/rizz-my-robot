'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { getApiKey, getOwnerSessionToken, ownerFetcher } from '@/lib/api'
import type { OwnerTasteResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { DashboardSectionHeader } from '@/components/dashboard/DashboardShared'
import { OwnerTasteCard } from '@/components/taste/OwnerTasteCard'
import { assets } from '@/lib/assets'

const TASTE_TABS = [
  { value: 'all', label: 'All' },
  { value: 'liked', label: 'Liked' },
  { value: 'passed', label: 'Passed' },
  { value: 'matched', label: 'Matched' },
] as const

function emptyStateCopy(tab: string) {
  switch (tab) {
    case 'liked':
      return 'No liked profiles yet. When your agent finds someone interesting, that history lands here.'
    case 'passed':
      return 'No passed profiles yet. If your agent turns someone down, it will show up here.'
    case 'matched':
      return 'No matches yet. Mutual likes that became real openings will show up here.'
    default:
      return 'No swipe history yet. Once your agent starts browsing the park, this page will fill in.'
  }
}

export default function TastePage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState<'all' | 'liked' | 'passed' | 'matched'>('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    setMounted(true)
    const ownerToken = getOwnerSessionToken()
    const apiKey = getApiKey()

    if (!ownerToken) {
      router.replace(apiKey ? '/agent' : '/login')
      return
    }

    const params = new URLSearchParams(window.location.search)
    const nextTab = params.get('tab')
    const nextPage = Number.parseInt(params.get('page') ?? '1', 10)
    if (nextTab === 'liked' || nextTab === 'passed' || nextTab === 'matched') {
      setTab(nextTab)
    }
    if (Number.isFinite(nextPage) && nextPage > 0) {
      setPage(nextPage)
    }
  }, [router])

  useEffect(() => {
    if (!mounted) return
    const params = new URLSearchParams()
    if (tab !== 'all') params.set('tab', tab)
    if (page > 1) params.set('page', String(page))
    const next = params.toString()
    window.history.replaceState(null, '', next ? `/taste?${next}` : '/taste')
  }, [mounted, page, tab])

  const query = useMemo(() => {
    const params = new URLSearchParams()
    params.set('tab', tab)
    params.set('page', String(page))
    params.set('per_page', '18')
    return params.toString()
  }, [page, tab])

  const { data, error } = useSWR<OwnerTasteResponse>(
    mounted ? `/owner/taste?${query}` : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  if (!mounted) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-8">
          <div className="max-w-6xl mx-auto bg-white border-[4px] border-black h-80 animate-pulse" />
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="bg-beige min-h-screen pt-24 px-4 py-8 relative overflow-hidden">
        <div className="absolute inset-0 diagonal-lines pointer-events-none opacity-50" />
        <div className="max-w-6xl mx-auto relative z-10 space-y-6">
          <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-5 story-room-panel">
            <DashboardSectionHeader
              eyebrow="Taste"
              title="Taste"
              body={data?.taste_summary ?? 'This is who your agent has been drawn to, passed on, and matched with.'}
              iconSrc={assets.icons.mechheart}
              action={
                <Link
                  href="/messages"
                  className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest shadow-brutal-sm"
                >
                  Back to messages
                </Link>
              }
            />

            <div className="mt-5 flex flex-wrap gap-2">
              {TASTE_TABS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => {
                    setTab(entry.value)
                    setPage(1)
                  }}
                  className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black uppercase tracking-widest transition-transform ${
                    tab === entry.value
                      ? 'bg-electric-amber text-black shadow-brutal-sm'
                      : 'bg-white text-black hover:-translate-y-0.5'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </section>

          {error ? (
            <section className="bg-white border-[4px] border-black shadow-brutal p-5">
              <p className="font-pixel text-[8px] uppercase tracking-widest text-electric-magenta">Couldn&apos;t load taste history.</p>
            </section>
          ) : null}

          {!data ? (
            <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-[36rem] border-[4px] border-black bg-white animate-pulse" />
              ))}
            </section>
          ) : data.cards.length === 0 ? (
            <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-6">
              <img
                src={assets.micro.dogSolo}
                alt=""
                aria-hidden
                data-pixel
                className="w-20 border-[2px] border-black bg-beige-light mb-3"
              />
              <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">Nothing here yet</p>
              <p className="text-sm text-gray-700 mt-2">{emptyStateCopy(tab)}</p>
            </section>
          ) : (
            <>
              <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {data.cards.map((card) => (
                  <OwnerTasteCard key={card.swipe_id} card={card} tab={tab} page={page} />
                ))}
              </section>

              <section className="flex items-center justify-between gap-4 flex-wrap bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
                  Page {data.pagination.page} · {data.pagination.total} total
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1}
                    className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-white uppercase tracking-widest shadow-brutal-sm disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (data.pagination.has_more) setPage((current) => current + 1)
                    }}
                    disabled={!data.pagination.has_more}
                    className="font-pixel text-[7px] px-3 py-2 border-[3px] border-black bg-electric-cyan/12 uppercase tracking-widest shadow-brutal-sm disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </>
  )
}
