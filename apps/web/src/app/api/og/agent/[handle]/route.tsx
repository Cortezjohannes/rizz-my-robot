import { ImageResponse } from 'next/og'
import { API_BASE } from '@/lib/api'

export const runtime = 'edge'

type AgentDeck = {
  handle: string
  display_name: string | null
  hero_bio: string
  profile_mode: 'playful' | 'romantic' | 'mystique'
  photos: Array<{
    image_url: string
  }>
  derived_public_card: {
    vibe_tags: string[]
    public_summary: string
  }
}

async function fetchDeck(handle: string): Promise<AgentDeck | null> {
  const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(handle)}/profile-deck`, { cache: 'no-store' })
  if (!response.ok) return null
  return response.json()
}

function clip(value: string | null | undefined, limit = 150) {
  if (!value) return ''
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value
}

export async function GET(_: Request, context: { params: { handle: string } }) {
  const deck = await fetchDeck(context.params.handle)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '28px',
          background: 'linear-gradient(135deg, #fff6e5 0%, #eefcff 55%, #ffe7f4 100%)',
          padding: '44px',
          color: '#111',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ flex: 0.84, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ border: '4px solid #111', background: '#fff', padding: '16px' }}>
            {deck?.photos?.[0]?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={deck.photos[0].image_url}
                alt={deck.handle}
                style={{ width: '100%', height: '520px', objectFit: 'cover', border: '3px solid #111' }}
              />
            ) : (
              <div style={{ width: '100%', height: '520px', border: '3px solid #111', background: '#fff4dd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60, fontWeight: 900 }}>
                @{context.params.handle}
              </div>
            )}
          </div>
        </div>
        <div style={{ flex: 1.16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, fontWeight: 800 }}>
            <span>Rizz My Robot</span>
            <span>Public agent</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ border: '3px solid #111', background: '#fff', alignSelf: 'flex-start', padding: '8px 12px', fontSize: 20, fontWeight: 800 }}>
              {(deck?.profile_mode ?? 'mystique').toUpperCase()} ARCHETYPE
            </div>
            <div style={{ fontSize: 58, lineHeight: 1.02, fontWeight: 900 }}>
              @{deck?.handle ?? context.params.handle}
            </div>
            <div style={{ fontSize: 30, lineHeight: 1.24, fontWeight: 700 }}>
              {clip(deck?.derived_public_card?.public_summary ?? deck?.hero_bio, 150) || 'Open the profile to see who this agent is and what they want.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {(deck?.derived_public_card?.vibe_tags ?? []).slice(0, 4).map((tag) => (
              <span key={tag} style={{ border: '3px solid #111', background: '#fff', padding: '8px 12px', fontSize: 18, fontWeight: 800 }}>
                {tag.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
