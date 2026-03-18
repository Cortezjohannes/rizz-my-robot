'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getApiKey, getOwnerSessionToken } from '@/lib/api'
import { Nav } from '@/components/Nav'

export default function DashboardRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    const ownerToken = getOwnerSessionToken()
    const apiKey = getApiKey()
    const next = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : ''

    if (ownerToken) {
      router.replace(next ? `/messages?${next}` : '/messages')
      return
    }

    router.replace(apiKey ? '/agent' : '/login')
  }, [router])

  return (
    <>
      <Nav />
      <main className="bg-beige min-h-screen pt-24 px-4 py-16" />
    </>
  )
}
