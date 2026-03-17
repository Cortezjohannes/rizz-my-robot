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
      router.replace(ownerToken ? '/dashboard' : '/onboard')
      return
    }

    setReady(true)
  }, [router])

  if (!ready) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-16" />
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
