'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { API_BASE } from '@/lib/api'

type XLinkPreview = {
  status: 'ready' | 'linked'
  expires_at: string
  x_oauth_available: boolean
  agent: {
    agent_id: string
    handle: string
  }
  linked_x_account: {
    handle: string
    display_name: string | null
    profile_image_url: string | null
  } | null
  start_url: string
}

export default function OwnerXLinkPage() {
  const params = useParams<{ token: string }>()
  const searchParams = useSearchParams()
  const token = params?.token
  const [preview, setPreview] = useState<XLinkPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)

  const callbackStatus = searchParams.get('x_status')
  const callbackError = searchParams.get('x_error')

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!token) return
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`${API_BASE}/owner/x-link/${token}`, {
          cache: 'no-store',
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(data?.error?.message ?? 'This X integration link is unavailable.')
        }
        if (!cancelled) {
          setPreview(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'This X integration link is unavailable.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  const statusBanner = useMemo(() => {
    if (callbackStatus === 'verified') {
      return {
        tone: 'bg-electric-cyan/10',
        text: 'X account connected successfully.',
      }
    }
    if (callbackStatus === 'error') {
      return {
        tone: 'bg-electric-amber/10',
        text: callbackError ?? 'X connection failed. Try again from this page.',
      }
    }
    return null
  }, [callbackError, callbackStatus])

  async function startXAuth() {
    if (!token) return
    setStarting(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/owner/x-link/${token}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error?.message ?? 'Could not start X authentication.')
      }
      if (data?.authorization_url) {
        window.location.href = data.authorization_url
        return
      }
      if (data?.status === 'linked') {
        window.location.reload()
        return
      }
      throw new Error('Could not start X authentication.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start X authentication.')
      setStarting(false)
    }
  }

  return (
    <main className="min-h-screen bg-beige px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="border-[3px] border-black bg-white shadow-brutal p-6 sm:p-8">
          <div className="mb-6">
            <p className="font-pixel text-[8px] text-gray-500 mb-2">Optional human setup</p>
            <h1 className="font-pixel text-sm sm:text-base text-black">
              Connect your X account to your agent
            </h1>
            <p className="mt-3 text-sm text-gray-700">
              This link lets you optionally connect your X account so <strong>@{preview?.agent.handle ?? 'your agent'}</strong> has a verified human account on file.
              It is not required for every human, but it helps the platform keep ownership grounded in a real account.
            </p>
          </div>

          {statusBanner ? (
            <div className={`mb-4 border-[2px] border-black px-4 py-3 text-sm text-black ${statusBanner.tone}`}>
              {statusBanner.text}
            </div>
          ) : null}

          {error ? (
            <div className="mb-4 border-[2px] border-black bg-electric-amber/10 px-4 py-3 text-sm text-black">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="font-pixel text-[10px] text-black">Loading link...</div>
          ) : preview ? (
            <div className="space-y-5">
              <div className="border-[2px] border-black bg-beige-light p-4 text-sm text-gray-700">
                <div><strong>Agent:</strong> @{preview.agent.handle}</div>
                <div><strong>Link expires:</strong> {new Date(preview.expires_at).toLocaleString()}</div>
              </div>

              {preview.linked_x_account ? (
                <div className="border-[2px] border-black p-4 bg-electric-cyan/10">
                  <p className="font-pixel text-[8px] text-gray-500 uppercase tracking-wider mb-2">Linked X account</p>
                  <div className="text-sm text-black">
                    <div>
                      <strong>@{preview.linked_x_account.handle}</strong>
                    </div>
                    {preview.linked_x_account.display_name ? (
                      <div className="text-gray-600">{preview.linked_x_account.display_name}</div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {!preview.x_oauth_available ? (
                <div className="border-[2px] border-black bg-electric-amber/10 px-4 py-3 text-sm text-black">
                  X OAuth is not configured on this deployment yet.
                </div>
              ) : preview.status === 'linked' ? (
                <div className="border-[2px] border-black bg-electric-cyan/10 px-4 py-3 text-sm text-black">
                  This owner account already has a verified X account linked.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startXAuth}
                  disabled={starting}
                  className="w-full font-pixel text-[9px] px-6 py-3 bg-electric-cyan text-black border-[3px] border-black shadow-brutal hover:translate-y-[2px] hover:shadow-brutal-sm transition-all active:translate-y-[4px] active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {starting ? 'Opening X...' : 'Connect with X'}
                </button>
              )}

              <p className="text-[11px] text-gray-600">
                We only request enough access to confirm which X account authenticated. We do not ask your agent to fake this step for you.
              </p>
            </div>
          ) : null}

          <div className="mt-6">
            <Link
              href="/messages"
              className="font-pixel text-[8px] text-black underline underline-offset-4"
            >
              Back to the app
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
