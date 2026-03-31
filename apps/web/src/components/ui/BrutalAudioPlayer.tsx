'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface BrutalAudioPlayerProps {
  src: string
  label?: string
  className?: string
  autoPlay?: boolean
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function BrutalAudioPlayer({ src, label, className = '', autoPlay = false }: BrutalAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const autoPlayBlockedRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => setCurrentTime(audio.currentTime)
    const onMeta = () => setDuration(audio.duration)
    const onEnded = () => setPlaying(false)

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnded)
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !autoPlay) return

    const attemptPlay = async () => {
      try {
        await audio.play()
        autoPlayBlockedRef.current = false
        setPlaying(true)
      } catch {
        autoPlayBlockedRef.current = true
        setPlaying(false)
      }
    }

    const onCanPlay = () => {
      if (!playing) {
        void attemptPlay()
      }
    }

    const onFirstGesture = () => {
      if (autoPlayBlockedRef.current && !playing) {
        void attemptPlay()
      }
    }

    audio.addEventListener('canplay', onCanPlay)
    window.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true })
    window.addEventListener('keydown', onFirstGesture, { once: true })
    window.addEventListener('touchstart', onFirstGesture, { once: true, passive: true })

    void attemptPlay()
    return () => {
      audio.removeEventListener('canplay', onCanPlay)
      window.removeEventListener('pointerdown', onFirstGesture)
      window.removeEventListener('keydown', onFirstGesture)
      window.removeEventListener('touchstart', onFirstGesture)
    }
  }, [autoPlay, src, playing])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      void audio.play()
      setPlaying(true)
    }
  }, [playing])

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = pct * duration
    setCurrentTime(audio.currentTime)
  }, [duration])

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={`border-[3px] border-black bg-white p-3 ${className}`}>
      <audio ref={audioRef} src={src} preload={autoPlay ? 'auto' : 'metadata'} autoPlay={autoPlay} playsInline />
      {label ? (
        <p className="font-pixel text-[7px] uppercase tracking-[0.16em] text-gray-500 mb-2">{label}</p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 w-9 h-9 border-[3px] border-black bg-electric-amber text-black flex items-center justify-center shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none transition-all"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
              <rect x="0" y="0" width="4" height="14" />
              <rect x="8" y="0" width="4" height="14" />
            </svg>
          ) : (
            <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
              <polygon points="0,0 12,7 0,14" />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div
            className="w-full h-3 bg-beige-light border-[2px] border-black cursor-pointer"
            onClick={seek}
            role="slider"
            aria-valuenow={Math.round(currentTime)}
            aria-valuemax={Math.round(duration)}
            aria-label="Audio progress"
            tabIndex={0}
          >
            <div
              className="h-full bg-gradient-to-r from-electric-amber via-electric-magenta to-electric-cyan transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="font-pixel text-[7px] text-gray-500">{formatTime(currentTime)}</span>
            <span className="font-pixel text-[7px] text-gray-500">{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
