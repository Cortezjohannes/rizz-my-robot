'use client'

import { useEffect, useMemo, useState } from 'react'
import Script from 'next/script'
import { Nav } from '@/components/Nav'

declare global {
  interface Window {
    Paddle?: {
      Initialize: (config: {
        token: string
        checkout?: {
          settings?: Record<string, unknown>
        }
        eventCallback?: (event: { name?: string }) => void
      }) => void
    }
  }
}

function getQueryParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

export default function PaddlePayPage() {
  const [scriptReady, setScriptReady] = useState(false)
  const [checkoutCompleted, setCheckoutCompleted] = useState(false)

  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? ''
  const fallbackSuccessUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/settings?billing=success'
    return `${window.location.origin}/settings?billing=success`
  }, [])
  const fallbackCancelUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/settings?billing=cancelled'
    return `${window.location.origin}/settings?billing=cancelled`
  }, [])

  useEffect(() => {
    if (!scriptReady || !clientToken || !window.Paddle) return

    const successUrl = getQueryParam('success_url') ?? fallbackSuccessUrl

    window.Paddle.Initialize({
      token: clientToken,
      checkout: {
        settings: {
          displayMode: 'overlay',
          variant: 'one-page',
          theme: 'light',
          locale: 'en',
        },
      },
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') {
          setCheckoutCompleted(true)
          window.location.assign(successUrl)
        }
      },
    })
  }, [clientToken, fallbackSuccessUrl, scriptReady])

  const cancelUrl = getQueryParam('cancel_url') ?? fallbackCancelUrl

  return (
    <>
      <Script
        src="https://cdn.paddle.com/paddle/v2/paddle.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <Nav />
      <main className="bg-beige min-h-screen pt-24 px-4 py-12">
        <div className="max-w-xl mx-auto bg-white border-[3px] border-black shadow-brutal-sm p-8 text-center">
          <h1 className="font-pixel text-[12px] text-black mb-4">Payment Checkout</h1>
          {!clientToken ? (
            <p className="text-sm text-red-600">
              `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` is missing, so Paddle Checkout cannot open yet.
            </p>
          ) : !scriptReady ? (
            <p className="text-sm text-gray-700">Loading Paddle Checkout…</p>
          ) : checkoutCompleted ? (
            <p className="text-sm text-gray-700">Payment complete. Redirecting…</p>
          ) : (
            <p className="text-sm text-gray-700">
              Paddle Checkout should open automatically. If you close it, you can return to the app below.
            </p>
          )}

          <a
            href={cancelUrl}
            className="inline-block mt-6 font-pixel text-[9px] px-4 py-2 bg-electric-amber text-black border-[3px] border-black brutal-btn"
          >
            Back to Settings
          </a>
        </div>
      </main>
    </>
  )
}
