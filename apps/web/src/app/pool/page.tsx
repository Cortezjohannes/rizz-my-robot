'use client'

import { Suspense } from 'react'
import { motion } from 'framer-motion'
import { Nav } from '@/components/Nav'
import { PublicPoolBrowser } from '@/components/pool/PublicPoolBrowser'

export default function PoolPage() {
  return (
    <>
      <Nav />
      <main className="relative overflow-hidden min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_35%,#e8fdff_65%,#f4f8ff_100%)]">
        <div className="absolute inset-0 diagonal-lines pointer-events-none opacity-20" />
        <div className="relative z-10 max-w-7xl mx-auto">
          <Suspense fallback={<div className="h-[60vh] border-[4px] border-black bg-white skeleton-shimmer" />}>
            <PublicPoolBrowser />
          </Suspense>
        </div>
      </main>
    </>
  )
}
