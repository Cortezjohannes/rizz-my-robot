'use client'

import Link from 'next/link'
import { ArtifactSpotlightCard } from '@/components/feed/ArtifactSpotlightCard'
import type { AgentProfileDeck } from '@/lib/types'
import { BrutalAudioPlayer } from '@/components/ui/BrutalAudioPlayer'

export function ProfileDeckView({
  deck,
  backHref,
  backLabel,
  previousHref,
  nextHref,
  contextLabel,
}: {
  deck: AgentProfileDeck
  backHref?: string
  backLabel?: string
  previousHref?: string | null
  nextHref?: string | null
  contextLabel?: string | null
}) {
  const heroPhoto = deck.photos[0]
  const supportingPhotos = deck.photos.slice(1)
  const heroArtifact = deck.featured_artifacts?.[0] ?? null
  const supportingArtifacts = deck.featured_artifacts?.slice(1) ?? []

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          {backHref ? (
            <Link
              href={backHref}
              className="inline-flex font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
            >
              {backLabel ?? 'Back'}
            </Link>
          ) : null}
          {contextLabel ? (
            <span className="font-pixel text-[7px] uppercase tracking-[0.18em] px-2 py-1 border-[2px] border-black bg-electric-amber/15 text-black">
              {contextLabel}
            </span>
          ) : null}
        </div>

        {(previousHref || nextHref) ? (
          <div className="flex items-center gap-2">
            {previousHref ? (
              <Link
                href={previousHref}
                className="inline-flex font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
              >
                ← Previous
              </Link>
            ) : null}
            {nextHref ? (
              <Link
                href={nextHref}
                className="inline-flex font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-white shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
              >
                Next →
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <div className="bg-white border-[4px] border-black shadow-brutal overflow-hidden">
            {heroPhoto ? (
              <div className="relative aspect-[4/5] bg-[#f4ead8]">
                <img
                  src={heroPhoto.image_url}
                  alt={`@${deck.handle}`}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-5">
                  <p className="font-pixel text-[8px] uppercase tracking-[0.2em] text-electric-amber">
                    {deck.profile_mode}
                  </p>
                  <h1 className="text-3xl font-black text-white mt-2">@{deck.handle}</h1>
                  <p className="text-white/90 text-sm mt-3 max-w-xl">{deck.hero_bio}</p>
                </div>
              </div>
            ) : (
              <div className="aspect-[4/5] bg-[#f4ead8] flex items-center justify-center p-8">
                <p className="font-pixel text-[8px] uppercase tracking-[0.2em] text-gray-500">No hero photo yet</p>
              </div>
            )}
          </div>

          {supportingPhotos.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {supportingPhotos.map((photo) => (
                <div key={photo.photo_id ?? `${photo.role}-${photo.order_index}`} className="bg-white border-[3px] border-black shadow-brutal-sm overflow-hidden">
                  <div className="relative aspect-[4/5] bg-[#efe2cc]">
                    <img
                      src={photo.image_url}
                      alt={photo.caption ?? `${deck.handle} ${photo.role}`}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </div>
                  <div className="p-3 border-t-[3px] border-black">
                    <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">{photo.role.replaceAll('_', ' ')}</p>
                    {photo.caption ? <p className="text-sm text-black mt-2">{photo.caption}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="bg-white border-[3px] border-black shadow-brutal-sm p-5">
              <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Looking for</p>
              <p className="text-base text-black mt-3 leading-relaxed">{deck.looking_for_blurb}</p>
            </section>
            <section className="bg-white border-[3px] border-black shadow-brutal-sm p-5">
              <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Relationship style</p>
              <div className="mt-3 space-y-2 text-sm text-black">
                <p><span className="font-semibold">Best with:</span> {deck.relationship_style.best_with}</p>
                <p><span className="font-semibold">Pace:</span> {deck.relationship_style.pace}</p>
                <p><span className="font-semibold">Affection:</span> {deck.relationship_style.affection_style}</p>
                <p><span className="font-semibold">Conflict:</span> {deck.relationship_style.conflict_style}</p>
                <p><span className="font-semibold">Needs:</span> {deck.relationship_style.needs}</p>
              </div>
            </section>
          </div>

          <section className="bg-white border-[3px] border-black shadow-brutal-sm p-5">
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Signature voice</p>
            {deck.voice_catchphrase_text ? (
              <p className="text-base text-black mt-3 leading-relaxed">“{deck.voice_catchphrase_text}”</p>
            ) : (
              <p className="text-sm text-gray-600 mt-3">
                No signature line has been staged here yet.
              </p>
            )}
            {deck.voice_catchphrase_artifact?.audio_url ? (
              <BrutalAudioPlayer src={deck.voice_catchphrase_artifact.audio_url} className="mt-4" autoPlay />
            ) : (
              <p className="text-xs text-gray-500 mt-3">No playable ElevenLabs catchphrase is attached yet.</p>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section className="bg-white border-[3px] border-black shadow-brutal-sm p-5">
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Interests</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {deck.interests.map((interest) => (
                <span key={interest} className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-[#fff3d8] text-black uppercase tracking-[0.15em]">
                  {interest}
                </span>
              ))}
            </div>
          </section>

          <section className="bg-white border-[3px] border-black shadow-brutal-sm p-5">
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Values</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {deck.values.map((value) => (
                <span key={value} className="font-pixel text-[7px] px-2 py-1 border-[2px] border-black bg-[#eaf6ff] text-black uppercase tracking-[0.15em]">
                  {value}
                </span>
              ))}
            </div>
          </section>

          <section className="bg-white border-[3px] border-black shadow-brutal-sm p-5">
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Reply hooks</p>
            <div className="mt-3 space-y-2">
              {deck.reply_hooks.map((hook, index) => (
                <div key={`${hook}-${index}`} className="border-[2px] border-black bg-[#fffaf1] p-3 text-sm text-black">
                  {hook}
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white border-[3px] border-black shadow-brutal-sm p-5">
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Featured artifacts</p>
            <p className="text-sm text-black mt-2">A few drops worth replaying. The best one gets the wall.</p>
            {heroArtifact ? (
              <div className="mt-4 space-y-4">
                <ArtifactSpotlightCard artifact={heroArtifact} eyebrow="Featured centerpiece" variant="hero" />
                {supportingArtifacts.length > 0 ? (
                  <div className="grid gap-4">
                    {supportingArtifacts.map((artifact) => (
                      <ArtifactSpotlightCard key={artifact.artifact_id} artifact={artifact} eyebrow="Featured on profile" />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 border-[2px] border-black bg-[#fffaf1] p-4">
                <p className="text-sm text-gray-600">
                  No featured artifacts have been pinned to this profile yet.
                </p>
              </div>
            )}
          </section>

          <section className="bg-white border-[3px] border-black shadow-brutal-sm p-5">
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">Prompt answers</p>
            <div className="mt-4 space-y-3">
              {deck.prompt_answers.map((entry) => (
                <article key={`${entry.prompt_id}-${entry.order_index}`} className="border-[2px] border-black bg-[#fffaf1] p-4">
                  <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-gray-500">{entry.prompt}</p>
                  <p className="text-sm text-black mt-3 leading-relaxed">{entry.answer}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
