'use client'

import Image from 'next/image'
import type { ReactNode } from 'react'
import type { SwipeCandidatePreview } from './swipeCandidate'

interface PreviewCardProps {
  preview: SwipeCandidatePreview
  canPass: boolean
  passLabel?: string
  peekDisabled?: boolean
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

function PreviewActionButton({
  children,
  disabled,
  onClick,
  tone,
}: {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
  tone: 'quiet' | 'hot'
}) {
  const toneClass = tone === 'hot'
    ? 'bg-electric-amber text-black shadow-[4px_4px_0_#000]'
    : 'bg-white text-black shadow-brutal-sm'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group relative min-h-[3.25rem] overflow-hidden rounded-lg border-[3px] border-black px-3 py-3 font-pixel text-[8px] uppercase tracking-wide transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-35 ${toneClass}`}
    >
      <span className="absolute inset-x-2 top-1 h-1 rounded-full bg-black/10" aria-hidden />
      <span className="relative">{children}</span>
    </button>
  )
}

export function PreviewCard({
  preview,
  canPass,
  passLabel = 'PASS',
  peekDisabled = false,
  onPass,
  onPeek,
}: PreviewCardProps) {
  const name = getDisplayName(preview)

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top_left,rgba(0,245,255,0.16),transparent_34%),linear-gradient(180deg,#FBF7EE_0%,#F5ECD8_100%)] px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom,0px))] pt-5">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[10px] border-[4px] border-black bg-black shadow-brutal">
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
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,#151515_0%,#38404a_42%,#f59e0b_100%)]" aria-hidden />
            <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:18px_18px]" aria-hidden />
            <span className="relative flex h-24 w-24 items-center justify-center rounded-lg border-[4px] border-black bg-beige-light font-pixel text-6xl text-electric-amber shadow-brutal-sm">
              {getInitial(name)}
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute left-3 top-3 flex gap-1" aria-hidden>
          <span className="h-2 w-2 rounded-sm border border-black bg-electric-amber" />
          <span className="h-2 w-2 rounded-sm border border-black bg-electric-cyan" />
          <span className="h-2 w-2 rounded-sm border border-black bg-electric-magenta" />
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-4 pt-24">
          <h2 className="line-clamp-2 max-w-full break-words text-3xl font-black leading-[0.95] text-white [overflow-wrap:anywhere] [text-shadow:2px_2px_0_rgba(0,0,0,0.55)] sm:text-4xl">
            {name}
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 pt-3">
        <PreviewActionButton
          onClick={onPass}
          disabled={!canPass}
          tone="quiet"
        >
          {passLabel}
        </PreviewActionButton>
        <PreviewActionButton
          onClick={onPeek}
          disabled={peekDisabled}
          tone="hot"
        >
          PEEK
        </PreviewActionButton>
      </div>
    </div>
  )
}
