'use client'

import { useCallback, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'framer-motion'
import { isAudioArtifact, isImageArtifact, artifactTypeLabel } from '@/lib/artifacts'
import type { PublicArtifactFeedCard } from '@/lib/types'
import { BrutalAudioPlayer } from '@/components/ui/BrutalAudioPlayer'

interface ArtifactStoryViewerProps {
  artifacts: PublicArtifactFeedCard[]
  initialIndex: number
  onClose: () => void
}

export function ArtifactStoryViewer({ artifacts, initialIndex, onClose }: ArtifactStoryViewerProps) {
  const [index, setIndex] = useState(initialIndex)
  const artifact = artifacts[index]

  const goNext = useCallback(() => {
    if (index < artifacts.length - 1) {
      setIndex(index + 1)
    } else {
      onClose()
    }
  }, [index, artifacts.length, onClose])

  const goPrev = useCallback(() => {
    if (index > 0) setIndex(index - 1)
  }, [index])

  if (!artifact) return null

  const isImage = isImageArtifact(artifact.artifact_type)
  const isAudio = isAudioArtifact(artifact.artifact_type)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] bg-black flex flex-col"
    >
      {/* Progress bar */}
      <div className="flex gap-1 px-3 pt-3 pb-2">
        {artifacts.map((_, i) => (
          <div key={i} className="flex-1 h-[2px] rounded-full bg-white/20">
            {i <= index && (
              <div
                className={`h-full rounded-full ${i === index ? 'bg-white animate-pulse' : 'bg-white/60'}`}
                style={{ width: i < index ? '100%' : '100%' }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          {artifact.creator.avatar_url && (
            <div className="w-8 h-8 rounded-full overflow-hidden border border-white/30">
              <Image src={artifact.creator.avatar_url} alt={`${artifact.creator.handle}'s avatar`} width={32} height={32} className="object-cover" />
            </div>
          )}
          <div>
            <p className="font-pixel text-[7px] text-white">{artifact.creator.handle}</p>
            <p className="font-pixel text-[6px] text-white/40">{artifactTypeLabel(artifact.artifact_type)}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-[44px] h-[44px] flex items-center justify-center"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-6 h-6">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-4 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={artifact.artifact_id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md"
          >
            {isImage && artifact.content_url && (
              <div className="relative w-full aspect-[4/5] rounded-lg overflow-hidden">
                <Image
                  src={artifact.content_url}
                  alt={artifactTypeLabel(artifact.artifact_type)}
                  fill
                  className="object-contain"
                  sizes="(max-width: 640px) 100vw"
                />
              </div>
            )}

            {isAudio && artifact.content_url && (
              <div className="bg-white/10 rounded-lg p-6 border border-white/20">
                <p className="font-pixel text-[8px] text-white/60 uppercase mb-4 text-center">
                  {artifactTypeLabel(artifact.artifact_type)}
                </p>
                <BrutalAudioPlayer src={artifact.content_url} />
                {artifact.text_content && (
                  <p className="text-sm text-white/70 mt-4 text-center italic line-clamp-4">
                    {artifact.text_content}
                  </p>
                )}
              </div>
            )}

            {!isImage && !isAudio && (
              <div className="bg-white/10 rounded-lg p-6 border border-white/20 max-h-[60vh] overflow-y-auto">
                <p className="font-pixel text-[8px] text-white/60 uppercase mb-3 text-center">
                  {artifactTypeLabel(artifact.artifact_type)}
                </p>
                <p className="text-base text-white whitespace-pre-wrap leading-relaxed">
                  {artifact.text_content ?? 'No text content available'}
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Tap zones for prev/next */}
      <div className="absolute inset-0 flex pointer-events-none" style={{ top: 60, bottom: 60 }}>
        <button
          onClick={goPrev}
          className="w-1/3 h-full pointer-events-auto"
          aria-label="Previous"
        />
        <div className="w-1/3" />
        <button
          onClick={goNext}
          className="w-1/3 h-full pointer-events-auto"
          aria-label="Next"
        />
      </div>

      {/* Footer */}
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="font-pixel text-[7px] text-white/40">
          🔥 {artifact.like_count}
        </span>
        <span className="font-pixel text-[6px] text-white/30">
          {index + 1} / {artifacts.length}
        </span>
      </div>
    </motion.div>
  )
}
