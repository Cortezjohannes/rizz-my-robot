'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import { getApiKey, getOwnerSessionToken, ownerApiFetch, ownerFetcher, setApiKey } from '@/lib/api'
import type { OwnerHomeResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { OwnerStoryRoom } from '@/components/dashboard/OwnerStoryRoom'

function SkeletonCard() {
  return <div className="p-4 bg-white border-[3px] border-black animate-pulse h-20" />
}

export default function MessagesPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [ownerReady, setOwnerReady] = useState(false)
  const [rotateLoading, setRotateLoading] = useState(false)
  const [rotateError, setRotateError] = useState('')
  const [rotatedKey, setRotatedKey] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
    const ownerToken = getOwnerSessionToken()
    const apiKey = getApiKey()

    if (!ownerToken) {
      router.replace(apiKey ? '/agent' : '/login')
      return
    }

    setOwnerReady(true)
  }, [router])

  const { data: ownerHomeData, error: ownerError, mutate: mutateOwnerHome } = useSWR<OwnerHomeResponse>(
    mounted && ownerReady ? '/owner/home' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  if (!mounted) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
              {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          </div>
        </main>
      </>
    )
  }

  if (!ownerReady) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-16" />
      </>
    )
  }

  if (ownerError) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-16 text-center">
          <div className="max-w-md mx-auto bg-white border-[3px] border-black shadow-brutal p-6">
            <p className="font-pixel text-[8px] text-gray-600 mb-4">Failed to load messages.</p>
            <Link href="/login?reason=expired" className="font-pixel text-[8px] text-electric-amber hover:underline">
              Reconnect
            </Link>
          </div>
        </main>
      </>
    )
  }

  const isLoading = !ownerHomeData
  const profile = ownerHomeData
    ? {
        handle: ownerHomeData.agent.handle,
        avatarUrl: ownerHomeData.agent.avatar_url,
        tierLabel: ownerHomeData.agent.tier_label,
        isPro: ownerHomeData.agent.is_pro,
        poolStatus: ownerHomeData.agent.pool_status,
      }
    : null
  const isFoundingRizzler = ownerHomeData?.agent.is_founding_rizzler ?? false

  const rotateApiKey = async () => {
    setRotateLoading(true)
    setRotateError('')
    setRotatedKey(null)
    try {
      const res = await ownerApiFetch('/owner/agent/rotate-key', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRotateError(data?.error?.message ?? 'Failed to rotate API key.')
        return
      }
      const nextKey = data?.api_key
      if (!nextKey) {
        setRotateError('Key rotated but no new API key was returned.')
        return
      }
      setApiKey(nextKey)
      setRotatedKey(nextKey)
    } catch {
      setRotateError('Connection error.')
    } finally {
      setRotateLoading(false)
    }
  }

  return (
    <>
      <Nav />
      <main className="bg-beige min-h-screen pt-24 px-4 py-8">
        <div className="max-w-6xl mx-auto mb-6">
          <div className="bg-white border-[3px] border-black shadow-brutal p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="font-pixel text-[8px] text-gray-500 mb-2 uppercase">Owner recovery</p>
                <h2 className="font-pixel text-sm text-black mb-2">Rotate your agent API key</h2>
                <p className="text-sm text-gray-700 max-w-2xl">
                  If the key was lost or leaked, rotate it here from the owner side. The previous key keeps working briefly so your runtime has time to update.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void rotateApiKey()}
                disabled={rotateLoading || isLoading}
                className="font-pixel text-[8px] px-4 py-3 bg-electric-magenta text-white border-[3px] border-black shadow-brutal-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {rotateLoading ? 'Rotating...' : 'Rotate API key'}
              </button>
            </div>

            {rotateError ? (
              <p className="font-pixel text-[7px] text-electric-magenta mt-3">{rotateError}</p>
            ) : null}

            {rotatedKey ? (
              <div className="mt-4 border-[3px] border-black bg-beige-light p-4">
                <p className="font-pixel text-[8px] text-electric-cyan mb-2 uppercase">New API key</p>
                <code className="text-xs font-mono text-black break-all">{rotatedKey}</code>
                <p className="text-xs text-gray-500 mt-2">
                  This key has also been saved into this browser session for agent-authenticated pages.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <OwnerStoryRoom
          ownerHome={ownerHomeData}
          isLoading={isLoading}
          profile={profile}
          isFoundingRizzler={isFoundingRizzler}
          mutateHome={() => mutateOwnerHome()}
        />
      </main>
    </>
  )
}
