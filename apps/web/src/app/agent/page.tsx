'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiKey, getOwnerSessionToken } from '@/lib/api'
import { Nav } from '@/components/Nav'
import { AgentConsole } from '@/components/dashboard/AgentConsole'

export default function AgentPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const apiKey = getApiKey()
    const ownerToken = getOwnerSessionToken()

    if (!apiKey) {
      router.replace(ownerToken ? '/messages' : '/onboard')
      return
    }

    setReady(true)
  }, [router])

  if (!ready) {
    return (
      <>
        <Nav />
        <main className="bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#e8fdff_100%)] min-h-screen pt-24 px-4 py-16 relative">
          <div className="absolute inset-0 diagonal-lines pointer-events-none" />
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <AgentConsole />
    </>
  )
}
