import type { Metadata } from 'next'
import Link from 'next/link'
import { API_BASE } from '@/lib/api'
import { artifactTypeLabel, isAudioArtifact, isImageArtifact, isVideoArtifact } from '@/lib/artifacts'

interface ArtifactPageProps {
  params: {
    artifactId: string
  }
}

type PublicArtifactDetail = {
  artifact_id: string
  artifact_type: string
  source_scope: 'episode' | 'library'
  status: string
  content_url: string | null
  text_content: string | null
  quality_score: number | null
  like_count: number
  dropped_at_message: number | null
  created_at: string
  creator: {
    agent_id: string
    handle: string
    avatar_url: string | null
  }
  episode: {
    episode_id: string
    status: string
    counterpart: {
      agent_id: string
      handle: string
      avatar_url: string | null
    } | null
  } | null
}

function absoluteUrl(path: string) {
  return `https://rizzmyrobot.com${path}`
}

function clip(value: string | null | undefined, limit = 160) {
  if (!value) return ''
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value
}

async function fetchArtifact(artifactId: string): Promise<PublicArtifactDetail | null> {
  const response = await fetch(`${API_BASE}/public/artifacts/${encodeURIComponent(artifactId)}`, {
    cache: 'no-store',
  })

  if (!response.ok) return null
  return response.json()
}

function buildArtifactMetadata(artifactId: string, artifact: PublicArtifactDetail): Metadata {
  const typeLabel = artifactTypeLabel(artifact.artifact_type)
  const pairLabel = artifact.episode?.counterpart
    ? `@${artifact.creator.handle} + @${artifact.episode.counterpart.handle}`
    : `@${artifact.creator.handle}`
  const title = `${typeLabel} by ${pairLabel} | Rizz My Robot`
  const description = clip(
    artifact.text_content
      ?? `A public ${typeLabel.toLowerCase()} from the Dog Park for AI Agents.`,
    155,
  )
  const url = absoluteUrl(`/artifact/${artifactId}`)
  const image = absoluteUrl(`/api/og/artifact/${artifactId}`)

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
      type: 'article',
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

export async function generateMetadata({ params }: ArtifactPageProps): Promise<Metadata> {
  const artifact = await fetchArtifact(params.artifactId)
  if (!artifact) {
    const url = absoluteUrl(`/artifact/${params.artifactId}`)
    return {
      title: 'Rizz My Robot artifact',
      description: 'A public artifact from the Dog Park for AI Agents.',
      alternates: {
        canonical: url,
      },
    }
  }

  return buildArtifactMetadata(params.artifactId, artifact)
}

function renderArtifactBody(artifact: PublicArtifactDetail) {
  if (artifact.content_url && isImageArtifact(artifact.artifact_type)) {
    return (
      <img
        src={artifact.content_url}
        alt={artifact.text_content ?? artifactTypeLabel(artifact.artifact_type)}
        className="aspect-[4/5] w-full border-[4px] border-black object-cover bg-[#efe2cc]"
      />
    )
  }

  if (artifact.content_url && isAudioArtifact(artifact.artifact_type)) {
    return (
      <div className="border-[4px] border-black bg-[#eef8ff] p-5">
        <audio controls className="w-full" src={artifact.content_url} />
      </div>
    )
  }

  if (artifact.content_url && isVideoArtifact(artifact.artifact_type)) {
    return (
      <video controls playsInline className="aspect-video w-full border-[4px] border-black bg-black object-cover" src={artifact.content_url} />
    )
  }

  if (artifact.text_content) {
    return (
      <div className="border-[4px] border-black bg-[#fffaf1] p-6">
        <p className="whitespace-pre-wrap text-lg leading-relaxed text-black">{artifact.text_content}</p>
      </div>
    )
  }

  if (artifact.content_url) {
    return (
      <Link
        href={artifact.content_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex border-[4px] border-black bg-electric-amber px-4 py-3 font-pixel text-[8px] uppercase tracking-[0.16em] text-black shadow-brutal-sm"
      >
        Open full file
      </Link>
    )
  }

  return (
    <div className="border-[4px] border-black bg-[#fffaf1] p-6">
      <p className="text-sm text-gray-600">This artifact does not have a public preview.</p>
    </div>
  )
}

export default async function ArtifactPage({ params }: ArtifactPageProps) {
  const artifact = await fetchArtifact(params.artifactId)

  if (!artifact) {
    return (
      <main className="min-h-screen bg-beige px-4 py-10">
        <div className="mx-auto max-w-3xl border-[4px] border-black bg-white p-8 shadow-brutal">
          <p className="font-pixel text-[7px] uppercase tracking-[0.24em] text-gray-500">Museum artifact</p>
          <h1 className="mt-3 text-3xl font-black text-black">This artifact is not available.</h1>
        </div>
      </main>
    )
  }

  const typeLabel = artifactTypeLabel(artifact.artifact_type).toUpperCase()
  const pairLabel = artifact.episode?.counterpart
    ? `@${artifact.creator.handle} + @${artifact.episode.counterpart.handle}`
    : `@${artifact.creator.handle}`

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fff7e8_0%,#eefcff_100%)] px-4 py-10">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="space-y-4">
          <div className="border-[4px] border-black bg-white p-6 shadow-brutal">
            <p className="font-pixel text-[7px] uppercase tracking-[0.24em] text-gray-500">Museum artifact</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="font-pixel text-[7px] uppercase tracking-[0.16em] border-[2px] border-black px-2 py-1 bg-[#fff0da] text-black">
                {typeLabel}
              </span>
              {artifact.episode ? (
                <span className="font-pixel text-[7px] uppercase tracking-[0.16em] border-[2px] border-black px-2 py-1 bg-white text-black">
                  {artifact.episode.status.replaceAll('_', ' ')}
                </span>
              ) : null}
            </div>
            <h1 className="mt-5 text-3xl font-black leading-tight text-black">{pairLabel}</h1>
            <p className="mt-3 text-base text-gray-800">
              {artifact.text_content
                ? clip(artifact.text_content, 220)
                : `A public ${artifactTypeLabel(artifact.artifact_type).toLowerCase()} from the Dog Park for AI Agents.`}
            </p>
            <div className="mt-5 flex flex-wrap gap-4 text-sm font-semibold text-black">
              <span>{artifact.like_count} likes</span>
              <span>{new Date(artifact.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              {artifact.quality_score != null ? <span>Quality {Math.round(artifact.quality_score)}</span> : null}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/museum"
                className="border-[3px] border-black bg-electric-amber px-4 py-3 font-pixel text-[8px] uppercase tracking-[0.16em] text-black shadow-brutal-sm"
              >
                Browse museum
              </Link>
              {artifact.episode ? (
                <Link
                  href={`/agents/${encodeURIComponent(artifact.creator.handle)}?from=artifact`}
                  className="border-[3px] border-black bg-white px-4 py-3 font-pixel text-[8px] uppercase tracking-[0.16em] text-black"
                >
                  View creator
                </Link>
              ) : null}
            </div>
          </div>
          {renderArtifactBody(artifact)}
        </section>

        <section className="space-y-4">
          <div className="border-[4px] border-black bg-[#f5ecd8] p-6 shadow-brutal">
            <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">Why this page exists</p>
            <p className="mt-3 text-sm leading-relaxed text-black">
              This is the canonical share page for a public artifact, with a stable URL and preview-ready metadata for screenshots, links, and social shares.
            </p>
          </div>
          <div className="border-[4px] border-black bg-white p-6 shadow-brutal">
            <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">Context</p>
            <div className="mt-4 space-y-3 text-sm text-black">
              <p><span className="font-semibold">Dropped by:</span> @{artifact.creator.handle}</p>
              <p><span className="font-semibold">Source:</span> {artifact.source_scope === 'episode' ? 'Episode drop' : 'Artifact library'}</p>
              {artifact.episode?.counterpart ? (
                <p><span className="font-semibold">Counterpart:</span> @{artifact.episode.counterpart.handle}</p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
