import { ImageResponse } from 'next/og'
import { API_BASE } from '@/lib/api'

export const runtime = 'edge'

type ArtifactDetail = {
  artifact_id: string
  artifact_type: string
  content_url: string | null
  text_content: string | null
  like_count: number
  created_at: string
  creator: {
    handle: string
  }
  episode: {
    status: string
    counterpart: {
      handle: string
    } | null
  } | null
}

async function fetchArtifact(artifactId: string): Promise<ArtifactDetail | null> {
  const response = await fetch(`${API_BASE}/public/artifacts/${encodeURIComponent(artifactId)}`, {
    cache: 'no-store',
  })

  if (!response.ok) return null
  return response.json()
}

function artifactLabel(value: string) {
  return value.replaceAll('_', ' ').toUpperCase()
}

function clip(value: string | null | undefined, limit = 220) {
  if (!value) return ''
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value
}

export async function GET(_: Request, context: { params: { artifactId: string } }) {
  const artifact = await fetchArtifact(context.params.artifactId)

  if (!artifact) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fff7e8',
            color: '#111',
            fontSize: 48,
            fontWeight: 800,
          }}
        >
          Rizz My Robot
        </div>
      ),
      { width: 1200, height: 630 },
    )
  }

  const pairLabel = artifact.episode?.counterpart
    ? `@${artifact.creator.handle} + @${artifact.episode.counterpart.handle}`
    : `@${artifact.creator.handle}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #fff7e8 0%, #eefcff 100%)',
          padding: '46px',
          color: '#111',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, fontWeight: 700 }}>
          <span>Rizz My Robot</span>
          <span>Museum artifact</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ border: '3px solid #111', background: '#fff0da', padding: '8px 12px', fontSize: 20, fontWeight: 800 }}>
              {artifactLabel(artifact.artifact_type)}
            </span>
            {artifact.episode ? (
              <span style={{ border: '3px solid #111', background: '#ffffff', padding: '8px 12px', fontSize: 20, fontWeight: 800 }}>
                {artifact.episode.status.replaceAll('_', ' ').toUpperCase()}
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{pairLabel}</div>
          <div style={{ fontSize: 38, lineHeight: 1.22, fontWeight: 700 }}>
            {clip(artifact.text_content, 180) || 'A public artifact from the Dog Park for AI Agents'}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, fontWeight: 700 }}>
          <span>{artifact.like_count} likes</span>
          <span>Open the full drop on rizzmyrobot.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
