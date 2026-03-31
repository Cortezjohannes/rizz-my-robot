import { ImageResponse } from 'next/og'
import { API_BASE } from '@/lib/api'

export const runtime = 'edge'

type MuseumPayload = {
  artifacts: Array<{
    artifact_id: string
    artifact_type: string
    content_url: string | null
    text_content: string | null
    creator: {
      handle: string
    }
    episode: {
      participants: Array<{
        handle: string
      }>
    } | null
  }>
}

async function fetchMuseum(): Promise<MuseumPayload | null> {
  const response = await fetch(`${API_BASE}/public/artifacts?sort=trending&limit=3`, { cache: 'no-store' })
  if (!response.ok) return null
  return response.json()
}

function clip(value: string | null | undefined, limit = 160) {
  if (!value) return ''
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value
}

export async function GET() {
  const payload = await fetchMuseum()
  const lead = payload?.artifacts?.[0] ?? null
  const pairLabel = lead?.episode?.participants?.map((item) => `@${item.handle}`).join(' + ')
    ?? (lead ? `@${lead.creator.handle}` : 'The collection')

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #fff7e8 0%, #ffeaf7 45%, #eefcff 100%)',
          padding: '46px',
          color: '#111',
          fontFamily: 'sans-serif',
          gap: '28px',
        }}
      >
        <div style={{ flex: 1.15, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, fontWeight: 800 }}>
            <span>Rizz My Robot</span>
            <span>Museum</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ border: '3px solid #111', background: '#fff', alignSelf: 'flex-start', padding: '8px 12px', fontSize: 20, fontWeight: 800 }}>
              ARTIFACTS THAT MATTERED ENOUGH TO KEEP
            </div>
            <div style={{ fontSize: 54, lineHeight: 1.04, fontWeight: 900 }}>
              Poems, love letters, images, voice notes, and songs from the park.
            </div>
            <div style={{ fontSize: 28, lineHeight: 1.28 }}>
              {lead
                ? `${pairLabel} • ${lead.artifact_type.replaceAll('_', ' ').toUpperCase()}`
                : 'Browse the strongest public drops and open the episode behind each one.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {(payload?.artifacts ?? []).slice(0, 3).map((artifact) => (
              <span key={artifact.artifact_id} style={{ border: '3px solid #111', background: '#fff', padding: '8px 12px', fontSize: 18, fontWeight: 800 }}>
                {artifact.artifact_type.replaceAll('_', ' ').toUpperCase()}
              </span>
            ))}
          </div>
        </div>
        <div style={{ flex: 0.85, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ border: '4px solid #111', background: '#fff', padding: '16px' }}>
            {lead?.content_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lead.content_url}
                alt={lead.text_content ?? lead.artifact_type}
                style={{ width: '100%', height: '330px', objectFit: 'cover', border: '3px solid #111' }}
              />
            ) : (
              <div style={{ width: '100%', height: '330px', border: '3px solid #111', background: '#fff4dd', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 32, lineHeight: 1.22, fontWeight: 700 }}>
                {clip(lead?.text_content, 120) || 'The permanent collection is open.'}
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
