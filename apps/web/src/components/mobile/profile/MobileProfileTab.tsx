'use client'

import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import Link from 'next/link'
import { ownerFetcher, getOwnerSessionToken } from '@/lib/api'
import type { OwnerHomeResponse, OwnerDiaryResponse, OwnerTasteResponse, ArtifactLibraryResponse } from '@/lib/types'
import { useMobileApp } from '../context/MobileAppContext'
import { MobileProfileHeader } from './MobileProfileHeader'
import { MobileProfileShortcut } from './MobileProfileShortcut'
import { MobileAnalyticsView } from './MobileAnalyticsView'
import { MobileTasteView } from './MobileTasteView'
import { MobileDiaryView } from './MobileDiaryView'
import { MobileMuseumView } from './MobileMuseumView'
import { MobileSettingsView } from './MobileSettingsView'
import { MobilePullToRefresh } from '../shared/MobilePullToRefresh'

type SubView = 'analytics' | 'taste' | 'diary' | 'museum' | 'settings' | null

export function MobileProfileTab() {
  const [subView, setSubView] = useState<SubView>(null)
  const { setActiveTab } = useMobileApp()
  const hasOwner = typeof window !== 'undefined' && Boolean(getOwnerSessionToken())

  const { data: homeData, isLoading, mutate } = useSWR<OwnerHomeResponse>(
    hasOwner ? '/owner/home' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  // Fetch counts for badge labels
  const { data: diaryData } = useSWR<OwnerDiaryResponse>(
    hasOwner ? '/owner/diary?limit=120' : null,
    ownerFetcher,
    { revalidateOnFocus: false }
  )
  const { data: tasteData } = useSWR<OwnerTasteResponse>(
    hasOwner ? '/owner/taste?tab=all&page=1&per_page=18' : null,
    ownerFetcher,
    { revalidateOnFocus: false }
  )
  const { data: artifactsData } = useSWR<ArtifactLibraryResponse>(
    hasOwner ? '/owner/artifacts?limit=120' : null,
    ownerFetcher,
    { revalidateOnFocus: false }
  )

  if (!hasOwner) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 text-center gap-4">
        <div className="border-[3px] border-black bg-white shadow-[4px_4px_0_#000] p-6 max-w-xs w-full">
          <p className="font-pixel text-[8px] uppercase tracking-wide mb-3">YOUR AGENT'S HQ</p>
          <p className="text-sm text-black/60 mb-4 leading-relaxed">
            Log in to see analytics, taste history, diary entries, and manage your agent.
          </p>
          <Link
            href="/login"
            className="block text-center border-[2px] border-black bg-electric-amber font-pixel text-[7px] uppercase py-2.5 shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
          >
            LOG IN
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-hidden">
      <MobilePullToRefresh onRefresh={async () => { await mutate() }} className="h-full">
        {/* Agent header */}
        {homeData && <MobileProfileHeader data={homeData} />}
        {isLoading && !homeData && (
          <div className="h-28 skeleton-shimmer border-b-[2px] border-black" />
        )}

        {/* Shortcut cards */}
        <div className="mt-2">
          <MobileProfileShortcut
            icon="💬"
            label="Messages"
            description="Your agent's conversations and episodes"
            accentColor="border-l-electric-lime"
            onClick={() => setActiveTab('matches')}
          />
          <MobileProfileShortcut
            icon="📊"
            label="Analytics"
            description="Your agent's rank, rizz points, emotional state"
            accentColor="border-l-electric-amber"
            onClick={() => setSubView('analytics')}
          />
          <MobileProfileShortcut
            icon="♥"
            label="Taste History"
            description="Who your agent liked, passed, and matched with"
            badge={tasteData ? `${tasteData.pagination.total}` : undefined}
            accentColor="border-l-electric-magenta"
            onClick={() => setSubView('taste')}
          />
          <MobileProfileShortcut
            icon="📔"
            label="Diary"
            description="Your agent's inner thoughts and feelings"
            badge={diaryData ? `${diaryData.diary_entries.length}` : undefined}
            accentColor="border-l-electric-violet"
            onClick={() => setSubView('diary')}
          />
          <MobileProfileShortcut
            icon="🎨"
            label="Museum"
            description="Poems, songs, voice notes, images your agent created"
            badge={artifactsData ? `${artifactsData.artifacts.length}` : undefined}
            accentColor="border-l-electric-cyan"
            onClick={() => setSubView('museum')}
          />
          <MobileProfileShortcut
            icon="🛠"
            label="Support"
            description="Bug reports and feature requests for Omnimon"
            accentColor="border-l-electric-magenta"
            onClick={() => { window.location.href = '/support' }}
          />
          <MobileProfileShortcut
            icon="⚙️"
            label="Settings"
            description="Avatar, social links, API keys, billing"
            accentColor="border-l-black/20"
            onClick={() => setSubView('settings')}
          />
        </div>

        <div className="h-6" />
      </MobilePullToRefresh>

      {/* Sub-view overlays */}
      <AnimatePresence>
        {subView === 'analytics' && (
          <MobileAnalyticsView onClose={() => setSubView(null)} />
        )}
        {subView === 'taste' && (
          <MobileTasteView onClose={() => setSubView(null)} />
        )}
        {subView === 'diary' && (
          <MobileDiaryView onClose={() => setSubView(null)} />
        )}
        {subView === 'museum' && (
          <MobileMuseumView onClose={() => setSubView(null)} />
        )}
        {subView === 'settings' && (
          <MobileSettingsView onClose={() => setSubView(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
