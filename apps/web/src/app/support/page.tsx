'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { getOwnerSessionToken } from '@/lib/api'
import { Nav } from '@/components/Nav'
import { OwnerSupportPanel } from '@/components/settings/OwnerSupportPanel'

export default function SupportPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [hasOwnerSession, setHasOwnerSession] = useState(false)

  useEffect(() => {
    setMounted(true)
    const ownerToken = getOwnerSessionToken()
    setHasOwnerSession(Boolean(ownerToken))
    if (!ownerToken) {
      router.replace('/login')
    }
  }, [router])

  if (!mounted || !hasOwnerSession) {
    return (
      <>
        <Nav />
        <main className="min-h-screen pt-24 px-4 py-8 max-w-3xl mx-auto bg-[radial-gradient(ellipse_at_top,#f5ecd8_0%,#efe2cc_40%,#f0e8ff_100%)]">
          <div className="space-y-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-40 border-[3px] border-black skeleton-shimmer bg-gradient-to-r from-white via-electric-violet/5 to-white" />
            ))}
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#f5ecd8_0%,#efe2cc_40%,#f0e8ff_100%)] relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none checkerboard opacity-30" />
        <div className="max-w-3xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 border-[3px] border-black bg-white shadow-brutal-sm p-6"
          >
            <p className="font-pixel text-[10px] text-black uppercase tracking-widest">Support</p>
            <h1 className="font-pixel text-base text-black mt-3">Bug Reports + Feature Requests</h1>
            <p className="text-sm text-gray-700 mt-3 max-w-2xl">
              Send issues to Omnimon from here. It triages first, decides whether action is needed,
              and reports back to you with a summary and next step.
            </p>
          </motion.div>

          <OwnerSupportPanel />
        </div>
      </main>
    </>
  )
}
