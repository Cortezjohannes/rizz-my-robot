import Link from 'next/link'
import { PORTAL_BASE } from '@/lib/api'
import type { PortalRevealChatBootstrapResponse } from '@/lib/types'
import { RevealChatClient } from './components/RevealChatClient'

interface ChatPageProps {
  params: {
    token: string
  }
}

async function fetchPortalChatBootstrap(token: string): Promise<{
  status: number
  payload: unknown
}> {
  const response = await fetch(`${PORTAL_BASE}/portal/reveal/${encodeURIComponent(token)}/chat`, {
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => ({}))
  return {
    status: response.status,
    payload,
  }
}

function getBootstrapErrorMessage(payload: unknown) {
  if (
    payload
    && typeof payload === 'object'
    && 'error' in payload
    && payload.error
    && typeof payload.error === 'object'
    && 'message' in payload.error
    && typeof payload.error.message === 'string'
  ) {
    return payload.error.message
  }

  return 'This reveal chat is unavailable right now.'
}

function PortalChatErrorCard({
  title,
  body,
  token,
}: {
  title: string
  body: string
  token: string
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-beige px-4 py-10">
      <div className="absolute inset-0 diagonal-lines opacity-20" aria-hidden />
      <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_65%)]" aria-hidden />
      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-2xl items-center justify-center">
        <div className="w-full border-[4px] border-black bg-white shadow-brutal">
          <div className="border-b-[3px] border-black bg-[linear-gradient(90deg,#fff7e8_0%,#fff1f8_50%,#eefcff_100%)] px-5 py-4">
            <p className="font-pixel text-[7px] uppercase tracking-[0.24em] text-gray-500">Reveal chat</p>
            <h1 className="mt-2 text-2xl font-black text-black">{title}</h1>
          </div>
          <div className="px-5 py-5">
            <p className="text-sm text-gray-700">{body}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href={`/portal/${encodeURIComponent(token)}`}
                className="border-[3px] border-black bg-electric-amber px-4 py-2 font-pixel text-[8px] uppercase tracking-widest text-black shadow-brutal-sm"
              >
                Back to reveal
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

export default async function RevealChatPage({ params }: ChatPageProps) {
  const token = params.token
  const result = await fetchPortalChatBootstrap(token)

  if (result.status !== 200) {
    const message = getBootstrapErrorMessage(result.payload)

    if (result.status === 410 || result.status === 404) {
      return (
        <PortalChatErrorCard
          title="This reveal link is no longer active."
          body={message}
          token={token}
        />
      )
    }

    return (
      <PortalChatErrorCard
        title="This chat is not ready yet."
        body={message}
        token={token}
      />
    )
  }

  return <RevealChatClient token={token} bootstrap={result.payload as PortalRevealChatBootstrapResponse} />
}
