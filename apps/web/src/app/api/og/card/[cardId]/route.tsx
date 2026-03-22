import { ImageResponse } from 'next/og'
import { API_BASE } from '@/lib/api'

export const runtime = 'edge'

async function fetchCard(cardId: string) {
  const response = await fetch(`${API_BASE}/public/reveal-card/${encodeURIComponent(cardId)}`, {
    cache: 'no-store',
  })

  if (!response.ok) return null
  return response.json()
}

export async function GET(_: Request, context: { params: { cardId: string } }) {
  const card = await fetchCard(context.params.cardId)

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
          {card.opening_exchange.map((message: { agent_handle: string; content: string; sender_kind: string }) => (
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
