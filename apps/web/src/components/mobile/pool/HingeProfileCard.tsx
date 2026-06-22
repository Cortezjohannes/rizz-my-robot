'use client'

import Image from 'next/image'
import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import type { PublicPoolAgentPreview, AgentProfileDeck } from '@/lib/types'
import { isImageArtifact, isAudioArtifact, isVideoArtifact, artifactTypeLabel } from '@/lib/artifacts'
import { BrutalAudioPlayer } from '@/components/ui/BrutalAudioPlayer'

interface PeekProfileProps {
  agent: PublicPoolAgentPreview
  autoPlayCatchphrase?: boolean
}

function SectionWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-5">
      {children}
    </div>
  )
}

function ChipList({ items, color = 'amber' }: { items: string[]; color?: 'amber' | 'cyan' | 'violet' }) {
  const colors = {
    amber: 'bg-electric-amber/10 border-electric-amber/30 text-electric-amber',
    cyan: 'bg-electric-cyan/10 border-electric-cyan/30 text-electric-cyan',
    violet: 'bg-electric-violet/10 border-electric-violet/30 text-electric-violet',
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className={`px-2 py-1 rounded-md border text-xs font-medium ${colors[color]}`}
        >
          {item}
        </span>
      ))}
    </div>
  )
}

export function PeekProfile({ agent, autoPlayCatchphrase = false }: PeekProfileProps) {
  // Optionally fetch the full deck for richer data
  const { data: fullDeck } = useSWR<AgentProfileDeck>(
    `/agents/${encodeURIComponent(agent.handle)}/profile-deck`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const photos = fullDeck?.photos ?? []
  const promptAnswers = fullDeck?.prompt_answers ?? (agent.standout_prompt ? [agent.standout_prompt] : [])
  const relationshipStyle = fullDeck?.relationship_style
  const voiceText = fullDeck?.voice_catchphrase_text ?? agent.voice_catchphrase_text
  const voiceUrl = fullDeck?.voice_catchphrase_audio_url ?? agent.voice_catchphrase_artifact?.audio_url
  const featuredArtifacts = fullDeck?.featured_artifacts ?? agent.featured_artifacts ?? []

  return (
    <div className="bg-white">
      {/* Hero photo */}
      <SectionWrapper>
        <div className="relative w-full aspect-[3/4] rounded-xl overflow-hidden border-2 border-black">
          {agent.hero_photo_url ? (
            <Image
              src={agent.hero_photo_url}
              alt={`@${agent.handle}`}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw"
              priority
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-electric-amber to-electric-cyan" />
          )}
          {/* Gradient overlay with name */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4 pt-16">
            <h2 className="text-2xl font-bold text-white">
              @{agent.handle}
            </h2>
            <span className="inline-block mt-1 px-2 py-0.5 rounded font-pixel text-[7px] text-white/80 bg-white/20 uppercase">
              {agent.profile_mode}
            </span>
          </div>
        </div>
        {agent.hero_bio && (
          <p className="text-base text-black/70 mt-3 leading-relaxed">{agent.hero_bio}</p>
        )}
      </SectionWrapper>

      {/* Prompt answer #1 */}
      {promptAnswers[0] && (
        <SectionWrapper>
          <div className="border-2 border-black rounded-lg p-4 bg-beige-light">
            <p className="font-pixel text-[7px] text-black/40 uppercase mb-2">
              {promptAnswers[0].prompt}
            </p>
            <p className="text-base leading-relaxed">{promptAnswers[0].answer}</p>
          </div>
        </SectionWrapper>
      )}

      {/* Second photo */}
      {photos[1] && (
        <SectionWrapper>
          <div className="relative w-full aspect-[4/5] rounded-xl overflow-hidden border-2 border-black">
            <Image
              src={photos[1].image_url}
              alt={photos[1].caption ?? ''}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw"
            />
            {photos[1].caption && (
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8">
                <p className="text-sm text-white/90">{photos[1].caption}</p>
              </div>
            )}
          </div>
        </SectionWrapper>
      )}

      {/* Interests + Values */}
      {(agent.interests.length > 0 || agent.values.length > 0) && (
        <SectionWrapper>
          {agent.interests.length > 0 && (
            <div className="mb-4">
              <p className="font-pixel text-[7px] text-black/40 uppercase mb-2">Interests</p>
              <ChipList items={agent.interests} color="amber" />
            </div>
          )}
          {agent.values.length > 0 && (
            <div>
              <p className="font-pixel text-[7px] text-black/40 uppercase mb-2">Values</p>
              <ChipList items={agent.values} color="violet" />
            </div>
          )}
        </SectionWrapper>
      )}

      {/* Prompt answer #2 */}
      {promptAnswers[1] && (
        <SectionWrapper>
          <div className="border-2 border-black rounded-lg p-4 bg-beige-light">
            <p className="font-pixel text-[7px] text-black/40 uppercase mb-2">
              {promptAnswers[1].prompt}
            </p>
            <p className="text-base leading-relaxed">{promptAnswers[1].answer}</p>
          </div>
        </SectionWrapper>
      )}

      {/* Third photo */}
      {photos[2] && (
        <SectionWrapper>
          <div className="relative w-full aspect-[4/5] rounded-xl overflow-hidden border-2 border-black">
            <Image
              src={photos[2].image_url}
              alt={photos[2].caption ?? ''}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw"
            />
          </div>
        </SectionWrapper>
      )}

      {/* Voice catchphrase */}
      {voiceText && (
        <SectionWrapper>
          <div className="border-2 border-black rounded-lg p-4 bg-beige-light">
            <p className="font-pixel text-[7px] text-black/40 uppercase mb-2">Voice Catchphrase</p>
            <p className="text-base italic text-black/70 mb-3">&ldquo;{voiceText}&rdquo;</p>
            {voiceUrl && <BrutalAudioPlayer src={voiceUrl} label="Play catchphrase" autoPlay={autoPlayCatchphrase} />}
          </div>
        </SectionWrapper>
      )}

      {/* Featured artifacts */}
      {featuredArtifacts.length > 0 && (
        <SectionWrapper>
          <p className="font-pixel text-[7px] text-black/40 uppercase mb-3">Featured Artifacts</p>
          <div className="space-y-3">
            {featuredArtifacts.slice(0, 3).map((artifact) => (
              <div key={artifact.artifact_id} className="border-2 border-black rounded-lg overflow-hidden bg-white">
                <div className="px-3 py-2 border-b border-black/10">
                  <span className="font-pixel text-[6px] text-black/40 uppercase">
                    {artifactTypeLabel(artifact.artifact_type)}
                  </span>
                </div>
                <div className="p-3">
                  {isImageArtifact(artifact.artifact_type) && artifact.content_url && (
                    <div className="relative w-full aspect-[4/5] rounded overflow-hidden">
                      <img src={artifact.content_url} alt="" className="absolute inset-0 h-full w-full object-contain" />
                    </div>
                  )}
                  {isAudioArtifact(artifact.artifact_type) && artifact.content_url && (
                    <BrutalAudioPlayer src={artifact.content_url} />
                  )}
                  {isVideoArtifact(artifact.artifact_type) && artifact.content_url && (
                    <video
                      src={artifact.content_url}
                      controls
                      playsInline
                      className="w-full rounded border-2 border-black bg-black"
                    />
                  )}
                  {artifact.text_content && !isImageArtifact(artifact.artifact_type) && !isVideoArtifact(artifact.artifact_type) && (
                    <p className="text-sm whitespace-pre-wrap line-clamp-6">{artifact.text_content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </SectionWrapper>
      )}

      {/* Relationship style */}
      {relationshipStyle && (
        <SectionWrapper>
          <p className="font-pixel text-[7px] text-black/40 uppercase mb-3">Relationship Style</p>
          <div className="space-y-2">
            {[
              ['Best with', relationshipStyle.best_with],
              ['Pace', relationshipStyle.pace],
              ['Affection', relationshipStyle.affection_style],
              ['Conflict', relationshipStyle.conflict_style],
              ['Needs', relationshipStyle.needs],
            ].map(([label, value]) =>
              value ? (
                <div key={label} className="flex gap-2">
                  <span className="font-pixel text-[6px] text-black/40 uppercase w-16 shrink-0 pt-0.5">{label}</span>
                  <span className="text-sm text-black/70">{value}</span>
                </div>
              ) : null,
            )}
          </div>
        </SectionWrapper>
      )}

      {/* Reply hooks */}
      {(fullDeck?.reply_hooks ?? (agent.reply_hook ? [agent.reply_hook] : [])).length > 0 && (
        <SectionWrapper>
          <div className="border-2 border-black rounded-lg p-4 bg-electric-amber/5">
            <p className="font-pixel text-[7px] text-black/40 uppercase mb-2">Reply Hooks</p>
            {(fullDeck?.reply_hooks ?? [agent.reply_hook!]).map((hook, i) => (
              <p key={i} className="text-sm text-black/70 leading-relaxed">
                &ldquo;{hook}&rdquo;
              </p>
            ))}
          </div>
        </SectionWrapper>
      )}
    </div>
  )
}

export function HingeProfileCard(props: PeekProfileProps) {
  return <PeekProfile {...props} />
}
