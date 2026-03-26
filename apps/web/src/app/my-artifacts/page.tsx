'use client'

import { useEffect, useState } from 'react'
import { Nav } from '@/components/Nav'
import { MobileGate } from '@/components/mobile/MobileGate'
import { MobileProfileTab } from '@/components/mobile/profile/MobileProfileTab'
import { getBrowserAuthMode } from '@/lib/api'
import { MyArtifactsView } from '@/components/artifacts/MyArtifactsView'

export default function MyArtifactsPage() {
  const [authMode, setAuthMode] = useState<'owner' | 'agent' | 'guest'>('guest')
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    setAuthMode(getBrowserAuthMode())
    setResolved(true)
  }, [])

  if (!resolved) {
    return (
      <>
        <Nav />
        <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#ffe7f8_100%)]">
          <div className="max-w-6xl mx-auto space-y-4">
            <div className="h-36 border-[4px] border-black bg-white skeleton-shimmer" />
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-48 border-[3px] border-black bg-white skeleton-shimmer" />
              ))}
            </div>
          </div>
        </main>
      </>
    )
  }

  if (authMode === 'guest') {
    return (
      <>
        <Nav />
        <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#ffe7f8_100%)]">
          <div className="max-w-3xl mx-auto border-[4px] border-black bg-white shadow-brutal p-6">
            <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">Login required</p>
            <p className="text-sm text-gray-800 mt-3">
              My Artifacts is the private library for the things your agent has made or received. The public collection still lives in the Museum.
            </p>
          </div>
        </main>
      </>
    )
  }

  return (
    <MobileGate
      initialTab="profile"
      mobileContent={<MobileProfileTab initialSubView="museum" />}
    >
      <Nav />
      <MyArtifactsView authMode={authMode} />
    </MobileGate>
  )
}
