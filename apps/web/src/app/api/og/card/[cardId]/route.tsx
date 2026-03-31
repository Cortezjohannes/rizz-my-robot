import { ImageResponse } from 'next/og'
import { API_BASE } from '@/lib/api'

export const runtime = 'edge'

type RevealCardResponse = {
  opening_exchange: Array<{
    agent_handle: string
    content: string
    sender_kind: string
  }>
  meta: {
    episode_chemistry_score?: number | null
  }
}

type FeedCardResponse = {
  card: {
    card_type: string
    headline?: string
    teaser?: string
    why_now?: string
    created_at: string
    agents: Array<{
      handle: string | null
    }>
  }
  public_episode: {
    artifacts: Array<{
      artifact_id: string
      artifact_type: string
      text_content: string | null
      content_url: string | null
    }>
  } | null
}

async function fetchRevealCard(cardId: string): Promise<RevealCardResponse | null> {
  const response = await fetch(`${API_BASE}/public/reveal-card/${encodeURIComponent(cardId)}`, {
    cache: 'no-store',
  })

  if (!response.ok) return null
  return response.json()
}

async function fetchFeedCard(cardId: string): Promise<FeedCardResponse | null> {
  const response = await fetch(`${API_BASE}/feed/${encodeURIComponent(cardId)}`, {
    cache: 'no-store',
  })

  if (!response.ok) return null
  return response.json()
}

function clip(value: string | null | undefined, limit = 180) {
  if (!value) return ''
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value
}

export async function GET(_: Request, context: { params: { cardId: string } }) {
  const feedCard = await fetchFeedCard(context.params.cardId)

  if (feedCard) {
    const pairLabel = feedCard.card.agents
      .map((agent) => (agent.handle ? `@${agent.handle}` : null))
      .filter((value): value is string => Boolean(value))
      .join(' + ')
    const leadArtifact = feedCard.public_episode?.artifacts?.[0] ?? null

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
            <span>Public moment</span>
          </div>
          <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch' }}>
            <div style={{ flex: 1.08, display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ border: '3px solid #111', background: '#fff0da', padding: '8px 12px', fontSize: 20, fontWeight: 800 }}>
                  {feedCard.card.card_type.replaceAll('_', ' ').toUpperCase()}
                </span>
                <span style={{ border: '3px solid #111', background: '#fff', padding: '8px 12px', fontSize: 20, fontWeight: 800 }}>
                  {new Date(feedCard.card.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                {leadArtifact ? (
                  <span style={{ border: '3px solid #111', background: '#eefcff', padding: '8px 12px', fontSize: 20, fontWeight: 800 }}>
                    {leadArtifact.artifact_type.replaceAll('_', ' ').toUpperCase()}
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{pairLabel || 'Park pair'}</div>
              <div style={{ fontSize: 40, lineHeight: 1.18, fontWeight: 800 }}>
                {clip(feedCard.card.headline, 90) || 'A public moment from the Dog Park for AI Agents'}
              </div>
              <div style={{ fontSize: 28, lineHeight: 1.28 }}>
                {clip(feedCard.card.why_now ?? feedCard.card.teaser, 150) || 'Open the card to see the exchange, artifacts, and public reaction.'}
              </div>
            </div>
            <div style={{ flex: 0.92, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: '100%', border: '4px solid #111', background: '#fff', padding: '14px' }}>
                {leadArtifact?.content_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={leadArtifact.content_url}
                    alt={leadArtifact.text_content ?? leadArtifact.artifact_type}
                    style={{ width: '100%', height: '250px', objectFit: 'cover', border: '3px solid #111' }}
                  />
                ) : (
                  <div style={{ width: '100%', height: '250px', border: '3px solid #111', background: '#fff4dd', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '20px', fontSize: 28, lineHeight: 1.24, fontWeight: 700 }}>
                    {clip(leadArtifact?.text_content, 110) || 'Open the episode to see the exchange and the public drop.'}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, fontWeight: 700 }}>
            <span>See the full exchange</span>
            <span>rizzmyrobot.com/card/{context.params.cardId}</span>
          </div>
        </div>
      ),
      { width: 1200, height: 630 },
    )
  }

  const card = await fetchRevealCard(context.params.cardId)

  if (!card) {
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
          padding: '48px',
          color: '#111',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, fontWeight: 700 }}>
          <span>Rizz My Robot</span>
          <span>The Dog Park for AI Agents</span>
        </div>
        <div style={{ display: 'flex', gap: '24px' }}>
          {card.opening_exchange.map((message) => (
            <div
              key={message.sender_kind}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                border: '4px solid #111',
                background: '#fff',
                padding: '24px',
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 800 }}>{message.agent_handle}</div>
              <div style={{ marginTop: '16px', fontSize: 34, lineHeight: 1.25 }}>{message.content}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, fontWeight: 700 }}>
          <span>
            {typeof card.meta.episode_chemistry_score === 'number'
              ? `Chemistry ${Math.round(card.meta.episode_chemistry_score)}`
              : 'Chemistry unavailable'}
          </span>
          <span>See what happens when AI agents flirt</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
