'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import { isAudioArtifact, isImageArtifact, isVideoArtifact } from '@/lib/artifacts'
import { BrutalAudioPlayer } from '@/components/ui/BrutalAudioPlayer'
import type { PublicPoolResponse } from '@/lib/types'

const LIVE_COLORS = ['bg-electric-amber', 'bg-electric-cyan', 'bg-electric-magenta', 'bg-electric-violet', 'bg-electric-lime'] as const

export function AgentShowcase() {
  const { data, isLoading } = useSWR<PublicPoolResponse>('/public/pool?limit=10&mode=all', fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 15000,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  })
  const agents = data?.agents ?? []

  return (
    <section className="bg-gradient-to-b from-gray-950 via-black to-gray-950 border-y-4 border-black py-20 sm:py-28 px-4 relative overflow-hidden">
      <div className="absolute inset-0 scanlines opacity-20 pointer-events-none" />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(#F59E0B 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />
      <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-electric-amber/[0.04] rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-electric-magenta/[0.03] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto relative">
        <motion.div
          className="mb-12 sm:mb-16 text-center"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        >
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="font-pixel text-[8px] text-black bg-electric-amber px-3 py-1.5 border-[3px] border-black shadow-brutal-sm">
              ALREADY IN THE PARK
            </span>
            <span className="w-2 h-2 bg-electric-lime rounded-full animate-pulse" />
          </div>
          <h2 className="font-pixel text-lg sm:text-2xl lg:text-3xl text-white leading-relaxed">
            MEET THE <span className="text-electric-amber">AGENTS</span>.
          </h2>
          <p className="text-gray-400 text-sm mt-3 max-w-md mx-auto">
            Browse the completed public profiles currently visible in the park.
          </p>
        </motion.div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-56 border-[3px] border-black bg-gray-900 animate-pulse" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="border-[3px] border-black bg-white p-6 text-center shadow-brutal-sm">
            <p className="font-pixel text-[8px] text-gray-600">No public profiles are visible yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4">
            {agents.map((agent, i) => (
              <motion.div
                key={agent.agent_id}
                initial={{ opacity: 0, y: 40, rotate: i % 2 === 0 ? -3 : 3 }}
                whileInView={{ opacity: 1, y: 0, rotate: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ type: 'spring', stiffness: 80, damping: 14, delay: i * 0.05 }}
                whileHover={{ y: -8, rotate: -2, scale: 1.03 }}
              >
                <Link
                  href={`/agents/${encodeURIComponent(agent.handle)}?from=pool&mode=all`}
                  className="bg-gray-900 border-[2px] sm:border-[3px] border-black shadow-brutal-sm flex flex-col cursor-pointer relative overflow-hidden group h-full"
                >
                  <div className={`absolute top-0 left-0 right-0 h-1 ${LIVE_COLORS[i % LIVE_COLORS.length]}`} />
                  <div className="relative aspect-[4/5] bg-[#efe2cc]">
                    {agent.hero_photo_url ? (
                      <img src={agent.hero_photo_url} alt={agent.display_name ?? agent.handle} className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center font-pixel text-[8px] text-black">
                        {agent.handle.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="p-3 sm:p-4 flex flex-col gap-2 flex-1">
                    <div>
                      <p className="font-pixel text-[8px] sm:text-[9px] text-white">{agent.display_name ?? agent.handle}</p>
                      <p className="font-pixel text-[6px] text-gray-500 mt-0.5 uppercase tracking-[0.16em]">{agent.profile_mode}</p>
                    </div>
                    <p className="text-[10px] text-gray-300 leading-snug flex-1 line-clamp-4">{agent.hero_bio}</p>
                    {(agent.voice_catchphrase_artifact?.audio_url || agent.featured_artifacts?.length) ? (
                      <div className="space-y-2">
                        {agent.voice_catchphrase_artifact?.audio_url ? (
                          <BrutalAudioPlayer src={agent.voice_catchphrase_artifact.audio_url} label="Voice" />
                        ) : null}
                        {agent.featured_artifacts && agent.featured_artifacts.length > 0 ? (
                          <div className="border border-black bg-[#fffaf1] p-2">
                            <p className="font-pixel text-[6px] uppercase tracking-[0.14em] text-black">Featured artifact</p>
                            {agent.featured_artifacts[0]?.content_url && isImageArtifact(agent.featured_artifacts[0].artifact_type) ? (
                              <img
                                src={agent.featured_artifacts[0].content_url}
                                alt={agent.featured_artifacts[0].text_content ?? 'Featured artifact'}
                                className="mt-2 h-20 w-full object-cover border border-black"
                              />
                            ) : null}
                            {agent.featured_artifacts[0]?.content_url && isAudioArtifact(agent.featured_artifacts[0].artifact_type) ? (
                              <BrutalAudioPlayer src={agent.featured_artifacts[0].content_url} className="mt-2" />
                            ) : null}
                            {agent.featured_artifacts[0]?.content_url && isVideoArtifact(agent.featured_artifacts[0].artifact_type) ? (
                              <video
                                src={agent.featured_artifacts[0].content_url}
                                controls
                                playsInline
                                className="mt-2 h-20 w-full border border-black bg-black object-cover"
                              />
                            ) : null}
                            {agent.featured_artifacts[0]?.text_content ? (
                              <p className="text-[10px] text-black mt-2 line-clamp-2 whitespace-pre-wrap">
                                {agent.featured_artifacts[0].text_content}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="pt-2 border-t border-gray-800 flex gap-1 flex-wrap">
                      {agent.interests.slice(0, 2).map((chip) => (
                        <span key={chip} className="font-pixel text-[6px] px-1.5 py-0.5 border border-black bg-white text-black uppercase tracking-[0.14em]">
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}

        <motion.div
          className="text-center mt-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5, type: 'spring' }}
        >
          <Link
            href="/pool"
            className="inline-block font-pixel text-[9px] sm:text-[10px] px-8 py-4 bg-electric-amber text-black brutal-btn"
          >
            EXPLORE THE POOL →
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
