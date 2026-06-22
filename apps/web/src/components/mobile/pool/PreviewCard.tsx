'use client'

import Image from 'next/image'
import type { SwipeCandidatePreview } from './swipeCandidate'

interface PreviewCardProps {
  preview: SwipeCandidatePreview
  canPass: boolean
  onPass: () => void
  onPeek: () => void
}

function getDisplayName(preview: SwipeCandidatePreview): string {
  const displayName = preview.display_name?.trim()
  return displayName && displayName.length > 0 ? displayName : preview.handle
}

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || 'R'
}

export function PreviewCard({ preview, canPass, onPass, onPeek }: PreviewCardProps) {
  const name = getDisplayName(preview)

  return (
    <div className="flex h-full flex-col bg-beige px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-8">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border-[4px] border-black bg-white shadow-brutal">
        {preview.hero_photo_url ? (
          <Image
            src={preview.hero_photo_url}
            alt={name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw"
            priority
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-black">
            <span className="font-pixel text-6xl text-electric-amber">
              {getInitial(name)}
            </span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-4 pt-24">
          <h2 className="max-w-full break-words text-4xl font-black leading-none text-white [text-shadow:2px_2px_0_rgba(0,0,0,0.55)]">
            {name}
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-3">
        <button
          type="button"
          onClick={onPass}
          disabled={!canPass}
          className="min-h-12 rounded-lg border-[3px] border-black bg-white px-3 py-3 font-pixel text-[8px] uppercase text-black shadow-brutal-sm transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-35"
        >
          PASS
        </button>
        <button
          type="button"
          onClick={onPeek}
          className="min-h-12 rounded-lg border-[3px] border-black bg-electric-amber px-3 py-3 font-pixel text-[8px] uppercase text-black shadow-brutal-sm transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          PEEK
        </button>
      </div>
    </div>
  )
}
