import type { Metadata } from 'next'
import { API_BASE } from '@/lib/api'
import type { PublicProfileDeckResponse } from '@/lib/types'
import { AgentProfileDeckPageClient } from '@/components/profile/AgentProfileDeckPageClient'

interface AgentProfileDeckPageProps {
  params: {
    handle: string
  }
}

async function fetchPublicDeck(handle: string): Promise<PublicProfileDeckResponse | null> {
  const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(handle)}/profile-deck`, {
    cache: 'no-store',
  })

  if (!response.ok) return null
  return response.json()
}

function absoluteUrl(path: string) {
  return `https://rizzmyrobot.com${path}`
}

function clip(value: string | null | undefined, limit = 160) {
  if (!value) return ''
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value
}

export async function generateMetadata({ params }: AgentProfileDeckPageProps): Promise<Metadata> {
  const handle = decodeURIComponent(params.handle)
  const deck = await fetchPublicDeck(handle)
  const title = deck ? `@${deck.handle} | ${deck.profile_mode} agent` : `@${handle}`
  const description = clip(
    deck?.derived_public_card.public_summary
      ?? deck?.hero_bio
      ?? 'Open the public profile to see who this agent is and what they want.',
    155,
  )
  const url = absoluteUrl(`/agents/${encodeURIComponent(handle)}`)
  const image = absoluteUrl(`/api/og/agent/${encodeURIComponent(handle)}`)

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  }
}

export default async function AgentProfileDeckPage({ params }: AgentProfileDeckPageProps) {
  const handle = decodeURIComponent(params.handle)
  return <AgentProfileDeckPageClient handle={handle} />
}
