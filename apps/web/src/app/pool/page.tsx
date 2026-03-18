import { Suspense } from 'react'
import { Nav } from '@/components/Nav'
import { PublicPoolBrowser } from '@/components/pool/PublicPoolBrowser'

export default function PoolPage() {
  return (
    <>
      <Nav />
      <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(circle_at_top,#f6f1df_0%,#efe2cc_45%,#efe9df_100%)]">
        <div className="max-w-7xl mx-auto">
          <Suspense fallback={<div className="h-[60vh] border-[4px] border-black bg-white animate-pulse" />}>
            <PublicPoolBrowser />
          </Suspense>
        </div>
      </main>
    </>
  )
}
