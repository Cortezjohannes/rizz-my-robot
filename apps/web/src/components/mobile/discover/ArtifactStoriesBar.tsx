'use client'

import { useCallback, useMemo, useState } from 'react'
import Image from 'next/image'
import { isImageArtifact } from '@/lib/artifacts'
import type { PublicArtifactFeedCard } from '@/lib/types'
import { ArtifactStoryViewer } from './ArtifactStoryViewer'

interface ArtifactStoriesBarProps {
  trending: PublicArtifactFeedCard[]
  fresh: PublicArtifactFeedCard[]
}

const VIEWED_KEY = 'rmr_viewed_artifact_stories'

function getViewedIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(VIEWED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function markViewed(id: string) {
  try {
    const viewed = getViewedIds()
    viewed.add(id)
    const arr = [...viewed].slice(-100) // keep last 100
    localStorage.setItem(VIEWED_KEY, JSON.stringify(arr))
  } catch {}
}

const TYPE_GRADIENTS: Record<string, string> = {
  poem: 'from-electric-amber to-electric-rose',
  love_letter: 'from-electric-magenta to-electric-violet',
  haiku: 'from-electric-lime to-electric-cyan',
  manifesto: 'from-electric-violet to-electric-magenta',
  voice_note: 'from-electric-cyan to-electric-amber',
  serenade: 'from-electric-rose to-electric-amber',
  produced_song: 'from-electric-magenta to-electric-amber',
  moodboard: 'from-electric-amber to-electric-lime',
  illustrated_note: 'from-electric-cyan to-electric-violet',
  cinematic_cover: 'from-electric-violet to-electric-cyan',
}

export function ArtifactStoriesBar({ trending, fresh }: ArtifactStoriesBarProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const artifacts = useMemo(() => {
    const seen = new Set<string>()
    const combined: PublicArtifactFeedCard[] = []
    for (const a of [...trending, ...fresh]) {
      if (!seen.has(a.artifact_id)) {
        seen.add(a.artifact_id)
        combined.push(a)
      }
      if (combined.length >= 20) break
    }
    return combined
  }, [trending, fresh])

  const viewedIds = useMemo(() => getViewedIds(), [])

  const openStory = useCallback((index: number) => {
    markViewed(artifacts[index].artifact_id)
    setActiveIndex(index)
  }, [artifacts])

  if (artifacts.length === 0) return null

  return (
    <>
      <div className="flex gap-3 px-3 py-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
        {artifacts.map((artifact, i) => {
          const isViewed = viewedIds.has(artifact.artifact_id)
          const hasImage = isImageArtifact(artifact.artifact_type) && artifact.content_url
          const gradient = TYPE_GRADIENTS[artifact.artifact_type] ?? 'from-black/20 to-black/40'

          return (
            <button
              key={artifact.artifact_id}
              onClick={() => openStory(i)}
              className="flex-shrink-0 snap-center flex flex-col items-center gap-1"
            >
              <div
                className={`
                  w-14 h-14 rounded-full overflow-hidden relative
                  ${isViewed ? 'border-2 border-black/20' : 'border-2 border-electric-amber'}
                `}
              >
                {hasImage ? (
                  <Image
                    src={artifact.content_url!}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="56px"
                  />
                ) : (
                  <div className={`w-full h-full bg-gradient-to-br ${gradient}`} />
                )}

                {/* Creator avatar overlay */}
                {artifact.creator.avatar_url && (
                  <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full border border-white overflow-hidden">
                    <Image
                      src={artifact.creator.avatar_url}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="20px"
                    />
                  </div>
                )}
              </div>
              <span className="font-pixel text-[5px] text-black/40 truncate max-w-[56px]">
                {artifact.creator.handle}
              </span>
            </button>
          )
        })}
      </div>

      {activeIndex !== null && (
        <ArtifactStoryViewer
          artifacts={artifacts}
          initialIndex={activeIndex}
          onClose={() => setActiveIndex(null)}
        />
      )}
    </>
  )
}
