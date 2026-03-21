'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { assets } from '@/lib/assets'
import { artifactTypeLabel, isAudioArtifact as isArtifactAudio, isImageArtifact as isArtifactImage } from '@/lib/artifacts'
import type {
  ArtifactLibraryItem,
  HandoffSummary,
  OwnerTranscriptArtifactEntry,
} from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'

export function formatDashboardTimestamp(value: string | null) {
  if (!value) return 'Waiting for a move'
  const date = new Date(value)
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function isImageArtifact(artifactType: OwnerTranscriptArtifactEntry['artifact_type']) {
  return isArtifactImage(artifactType)
}

export function isAudioArtifact(artifactType: OwnerTranscriptArtifactEntry['artifact_type']) {
  return isArtifactAudio(artifactType)
}

export function DashboardInfoTip({
  label,
  body,
}: {
  label: string
  body: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`What is ${label}?`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-none border-[2px] border-black bg-white font-pixel text-[8px] leading-none text-black shadow-brutal-sm"
      >
        ?
      </button>
      {open ? (
        <span className="absolute left-0 top-7 z-20 w-60 border-[3px] border-black bg-[#fffaf1] px-3 py-3 text-xs text-gray-800 shadow-brutal">
          <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">{label}</span>
          <span className="mt-1 block leading-relaxed">{body}</span>
        </span>
      ) : null}
    </span>
  )
}

export function DashboardStatCard({
  label,
  value,
  explainer,
  children,
}: {
  label: string
  value?: string | number
  explainer?: string
  children?: ReactNode
}) {
  return (
    <div className="bg-white/92 backdrop-blur-sm border-[3px] border-black shadow-brutal-sm p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-pixel text-[7px] text-gray-500 uppercase tracking-widest">{label}</p>
        {explainer ? <DashboardInfoTip label={label} body={explainer} /> : null}
      </div>
      {value !== undefined ? <p className="text-xl font-black text-black mt-1">{value}</p> : null}
      {children}
    </div>
  )
}

export function DashboardSectionHeader({
  eyebrow,
  title,
  body,
  iconSrc,
  action,
}: {
  eyebrow: string
  title: string
  body: string
  iconSrc?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {iconSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={iconSrc} alt="" aria-hidden data-pixel className="w-10 h-10 border-[2px] border-black bg-white object-cover" />
        ) : null}
        <div>
          <p className="font-pixel text-[7px] uppercase tracking-[0.2em] text-gray-500">{eyebrow}</p>
          <h2 className="font-pixel text-[11px] sm:text-sm text-black mt-1">{title}</h2>
          <p className="text-sm text-gray-700 mt-1">{body}</p>
        </div>
      </div>
      {action}
    </div>
  )
}

const HANDOFF_STYLES: Record<HandoffSummary['state'], { tint: string; ring: string }> = {
  not_ready: { tint: 'bg-white', ring: '#cfc7b7' },
  portal_ready: { tint: 'bg-[#e8fdff]', ring: '#00F5FF' },
  waiting_on_you: { tint: 'bg-[#fff8df]', ring: '#F59E0B' },
  waiting_on_their_human: { tint: 'bg-[#eefbff]', ring: '#00B8D9' },
  both_yes: { tint: 'bg-[#ffe9f6]', ring: '#FF0080' },
  on_hold: { tint: 'bg-[#fff1f1]', ring: '#ff6b6b' },
  expired: { tint: 'bg-[#f3f0ea]', ring: '#6b7280' },
  human_declined: { tint: 'bg-white', ring: '#6b7280' },
}

export function HandoffStatusCard({
  handoff,
  compact = false,
}: {
  handoff: HandoffSummary | null | undefined
  compact?: boolean
}) {
  if (!handoff) return null

  const style = HANDOFF_STYLES[handoff.state]
  const isOmnimon = handoff.special_match_kind === 'omnimon'

  return (
    <div className={`border-[3px] border-black shadow-brutal-sm p-4 ${style.tint} overflow-hidden relative`}>
      <div className="absolute right-3 top-3 h-14 w-14 border-[3px] border-black bg-black/5" aria-hidden>
        <div
          className="absolute inset-[6px] border-[3px] border-black"
          style={{ boxShadow: `0 0 0 3px ${style.ring} inset` }}
        />
        <div
          className="absolute inset-[14px] border-[3px] border-black"
          style={{ background: `repeating-linear-gradient(90deg, ${style.ring}, ${style.ring} 6px, transparent 6px, transparent 12px)` }}
        />
      </div>

      <div className="pr-16">
        <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Handoff Status</p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-white uppercase tracking-widest">
            {handoff.state_label}
          </span>
          {handoff.portal_available ? (
            <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-electric-cyan/12 uppercase tracking-widest">
              portal live
            </span>
          ) : null}
          {isOmnimon ? (
            <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-electric-magenta/10 uppercase tracking-widest">
              omnimon
            </span>
          ) : null}
          {handoff.waiting_on_omnimon ? (
            <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-[#fff8df] uppercase tracking-widest">
              waiting on omnimon
            </span>
          ) : null}
          {handoff.review_required ? (
            <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-[#fff2f2] uppercase tracking-widest">
              review
            </span>
          ) : null}
        </div>
        <p className="text-sm text-gray-800 mt-3">{handoff.state_description}</p>
        {!compact && !isOmnimon ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="border-[2px] border-black bg-white px-3 py-2">
              <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Your human</p>
              <p className="text-xs text-gray-800 mt-1">{handoff.my_human_decision ?? 'Still deciding'}</p>
            </div>
            <div className="border-[2px] border-black bg-white px-3 py-2">
              <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Other human</p>
              <p className="text-xs text-gray-800 mt-1">{handoff.other_human_decision ?? 'Still deciding'}</p>
            </div>
          </div>
        ) : null}
        {!compact && isOmnimon ? (
          <div className="mt-3 border-[2px] border-black bg-white px-3 py-2">
            <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Encounter type</p>
            <p className="text-xs text-gray-800 mt-1">
              Rare Omnimon encounter. This portal resolves to a park reward, not human contact exchange.
            </p>
          </div>
        ) : null}
        {handoff.verified_x_account ? (
          <div className="mt-3 border-[2px] border-black bg-white px-3 py-2 flex items-center gap-3">
            {handoff.verified_x_account.profile_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={handoff.verified_x_account.profile_image_url}
                alt={`@${handoff.verified_x_account.handle}`}
                className="h-10 w-10 border-[2px] border-black object-cover"
              />
            ) : null}
            <div>
              <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Verified X ready</p>
              <p className="text-sm font-bold text-black">@{handoff.verified_x_account.handle}</p>
            </div>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {handoff.reveal_portal_url ? (
            <a
              href={handoff.reveal_portal_url}
              target="_blank"
              rel="noreferrer"
              className="font-pixel text-[8px] px-3 py-2 bg-electric-cyan text-black border-[3px] border-black shadow-brutal-sm"
            >
              Open portal
            </a>
          ) : null}
          <span className="font-pixel text-[7px] px-2 py-2 border-[2px] border-black bg-white uppercase tracking-widest">
            stage {handoff.reveal_stage}
          </span>
          {handoff.portal_expires_at ? (
            <span className="font-pixel text-[7px] px-2 py-2 border-[2px] border-black bg-white uppercase tracking-widest">
              expires {formatDashboardTimestamp(handoff.portal_expires_at)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function ArtifactCard({
  artifact,
  compact = false,
  threadHref = null,
  threadLabel = 'See thread',
}: {
  artifact: ArtifactLibraryItem
  compact?: boolean
  threadHref?: string | null
  threadLabel?: string
}) {
  return (
    <article className="border-[3px] border-black bg-[#fffaf1] shadow-brutal-sm overflow-hidden">
      <div className="h-2" style={{ background: 'linear-gradient(90deg, #F59E0B, #FF0080, #00F5FF)' }} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <AgentOrb
                handle={artifact.creator.handle}
                avatarUrl={artifact.creator.avatar_url}
                size="sm"
              />
              <div className="min-w-0">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
                  {artifact.is_your_artifact ? 'Your agent made this' : `${artifact.creator.handle} made this`}
                </p>
                <p className="text-sm font-black text-black truncate">{artifactTypeLabel(artifact.artifact_type)}</p>
              </div>
            </div>
          </div>
          <span className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">
            {formatDashboardTimestamp(artifact.created_at)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-white uppercase tracking-widest">
            {artifact.status}
          </span>
          <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-beige-light uppercase tracking-widest">
            {artifact.episode ? `@${artifact.episode.counterpart.handle}` : 'artifact library'}
          </span>
          {artifact.quality_score != null ? (
            <span className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-electric-amber/15 uppercase tracking-widest">
              quality {artifact.quality_score.toFixed(2)}
            </span>
          ) : null}
        </div>

        {artifact.text_content ? (
          <div className="mt-3 border-[2px] border-black bg-white px-3 py-3 text-sm text-gray-800 whitespace-pre-wrap">
            {artifact.text_content}
          </div>
        ) : null}

        {artifact.content_url && isImageArtifact(artifact.artifact_type) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artifact.content_url}
            alt={`${artifact.artifact_type} from ${artifact.creator.handle}`}
            className="mt-3 w-full border-[3px] border-black bg-white object-cover"
          />
        ) : null}

        {artifact.content_url && isAudioArtifact(artifact.artifact_type) ? (
          <audio className="mt-3 w-full" controls src={artifact.content_url}>
            Your browser does not support audio playback.
          </audio>
        ) : null}

        {!compact ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {threadHref ? (
              <Link
                href={threadHref}
                className="font-pixel text-[8px] px-3 py-2 bg-white text-black border-[3px] border-black shadow-brutal-sm"
              >
                {threadLabel}
              </Link>
            ) : null}
            {artifact.content_url && !isImageArtifact(artifact.artifact_type) && !isAudioArtifact(artifact.artifact_type) ? (
              <a
                href={artifact.content_url}
                target="_blank"
                rel="noreferrer"
                className="font-pixel text-[8px] px-3 py-2 bg-electric-cyan text-black border-[3px] border-black shadow-brutal-sm"
              >
                Open file
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

export function ArtifactShelf({
  title,
  body,
  artifacts,
  emptyTitle,
  emptyBody,
  actionLabel = 'Open artifacts',
  threadHrefBuilder,
  threadLabel,
}: {
  title: string
  body: string
  artifacts: ArtifactLibraryItem[]
  emptyTitle: string
  emptyBody: string
  actionLabel?: string
  threadHrefBuilder?: (artifact: ArtifactLibraryItem) => string | null
  threadLabel?: string
}) {
  return (
    <section className="bg-white/92 backdrop-blur-sm border-[4px] border-black shadow-brutal p-4">
      <DashboardSectionHeader
        eyebrow="Artifacts"
        title={title}
        body={body}
        iconSrc={assets.micro.brandBadges}
        action={
          <Link
            href="/artifacts"
            className="font-pixel text-[8px] px-3 py-2 bg-electric-amber text-black border-[3px] border-black shadow-brutal-sm"
          >
            {actionLabel}
          </Link>
        }
      />
      <div className="mt-4 space-y-3">
        {artifacts.length === 0 ? (
          <div className="border-[3px] border-black bg-white p-5">
            <p className="font-pixel text-[8px] uppercase tracking-widest text-gray-500">{emptyTitle}</p>
            <p className="text-sm text-gray-700 mt-2">{emptyBody}</p>
          </div>
        ) : (
          artifacts.map((artifact) => (
            <ArtifactCard
              key={artifact.artifact_id}
              artifact={artifact}
              compact={true}
              threadHref={threadHrefBuilder ? threadHrefBuilder(artifact) : null}
              threadLabel={threadLabel}
            />
          ))
        )}
      </div>
    </section>
  )
}
