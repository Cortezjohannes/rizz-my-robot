'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch } from '@/lib/api'
import { PeekProfile } from './HingeProfileCard'
import { PreviewCard } from './PreviewCard'
import type { SwipeCandidate, SwipeSubmitResponse } from './swipeCandidate'

interface PoolProfileStackProps {
  candidates: SwipeCandidate[]
}

const SWIPE_THRESHOLD = 100
const VELOCITY_THRESHOLD = 500
const commentaryEventsSent = new Set<string>()
type StackView = 'preview' | 'peek'
type SwipeDirection = 'PASS' | 'LIKE'
type CommentaryEventType = 'preview_seen' | 'peek_opened'
type CommentaryAction = 'VIEW' | 'PEEK'
type SwipeNotice =
  | { tone: 'success'; message: string }
  | { tone: 'match'; message: string }
  | { tone: 'error'; message: string }

export function PoolProfileStack({ candidates }: PoolProfileStackProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [direction, setDirection] = useState<'left' | 'right' | null>(null)
  const [view, setView] = useState<StackView>('preview')
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())
  const [submitting, setSubmitting] = useState<SwipeDirection | null>(null)
  const [notice, setNotice] = useState<SwipeNotice | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => !dismissedIds.has(candidate.id)),
    [candidates, dismissedIds],
  )
  const current = visibleCandidates[currentIndex]

  useEffect(() => {
    setDismissedIds(new Set())
    setCurrentIndex(0)
    setView('preview')
    setNotice(null)
  }, [candidates])

  useEffect(() => {
    setView('preview')
    scrollRef.current?.scrollTo({ top: 0 })
  }, [current?.id])

  useEffect(() => {
    if (currentIndex >= visibleCandidates.length) {
      setCurrentIndex(Math.max(0, visibleCandidates.length - 1))
    }
  }, [currentIndex, visibleCandidates.length])

  const dismissCurrent = useCallback((swipeDirection: 'left' | 'right' = 'left') => {
    if (!current) return
    setDirection(swipeDirection)
    setView('preview')
    setDismissedIds((ids) => {
      const next = new Set(ids)
      next.add(current.id)
      return next
    })
  }, [current])

  const goNext = useCallback(() => {
    setView('preview')
    if (currentIndex < visibleCandidates.length - 1) {
      setDirection('left')
      setCurrentIndex((i) => i + 1)
      return
    }
    dismissCurrent('left')
  }, [currentIndex, dismissCurrent, visibleCandidates.length])

  const goPrev = useCallback(() => {
    setView('preview')
    if (currentIndex > 0) {
      setDirection('right')
      setCurrentIndex((i) => i - 1)
    }
  }, [currentIndex])

  const emitCommentaryEvent = useCallback(async (eventType: CommentaryEventType, action: CommentaryAction) => {
    if (!current || current.read_only) return
    const key = `${current.id}:${eventType}`
    if (commentaryEventsSent.has(key)) return
    commentaryEventsSent.add(key)

    const candidateDisplayName = current.preview.display_name ?? current.preview.handle
    try {
      await apiFetch('/swipe/commentary-events', {
        method: 'POST',
        body: JSON.stringify({
          event_type: eventType,
          candidate_id: current.candidate_id,
          candidate_display_name: candidateDisplayName,
          action,
          surface: 'mobile_pool',
        }),
      })
    } catch {
      // Commentary is out-of-band; it must never block visible swiping.
    }
  }, [current])

  useEffect(() => {
    if (view === 'preview') void emitCommentaryEvent('preview_seen', 'VIEW')
  }, [emitCommentaryEvent, view])

  const openPeek = useCallback(() => {
    void emitCommentaryEvent('peek_opened', 'PEEK')
    setDirection(null)
    setView('peek')
    window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0 })
    })
  }, [emitCommentaryEvent])

  const closePeek = useCallback(() => {
    setDirection(null)
    setView('preview')
    window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0 })
    })
  }, [])

  const submitSwipe = useCallback(async (swipeDirection: SwipeDirection) => {
    if (!current || submitting) return
    if (current.read_only) {
      dismissCurrent(swipeDirection === 'PASS' ? 'left' : 'right')
      return
    }

    const decisionContext = swipeDirection === 'LIKE' || view === 'peek' ? 'peek_profile' : 'preview'
    setSubmitting(swipeDirection)
    setNotice(null)
    try {
      const res = await apiFetch(`/swipe/${encodeURIComponent(current.candidate_id)}`, {
        method: 'POST',
        body: JSON.stringify({ direction: swipeDirection, decision_context: decisionContext }),
      })
      const body = await res.json().catch(() => null) as SwipeSubmitResponse | { error?: { code?: string; message?: string } } | null
      if (!res.ok) {
        const errorBody = body as { error?: { code?: string; message?: string } } | null
        throw new Error(errorBody?.error?.message ?? `Swipe failed with ${res.status}.`)
      }

      const receipt = body as SwipeSubmitResponse
      setNotice({
        tone: receipt.mutual_match ? 'match' : 'success',
        message: receipt.mutual_match
          ? 'MATCH MADE. Episode door opened.'
          : receipt.status_message,
      })
      dismissCurrent(swipeDirection === 'PASS' ? 'left' : 'right')
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Swipe failed. Try again.',
      })
    } finally {
      setSubmitting(null)
    }
  }, [current, dismissCurrent, submitting, view])

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: { offset: { x: number }; velocity: { x: number } }) => {
      if (view !== 'preview') return
      const { offset, velocity } = info
      if ((offset.x < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD)) {
        if (current?.read_only) {
          goNext()
          return
        }
        void submitSwipe('PASS')
        return
      }
      if (offset.x > SWIPE_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) {
        if (current?.read_only) goPrev()
        return
      }
    },
    [current?.read_only, goNext, goPrev, submitSwipe, view],
  )

  const initialX = direction === 'left' ? '100%' : direction === 'right' ? '-100%' : 0
  const exitX = direction === 'left' ? '-100%' : direction === 'right' ? '100%' : 0
  const transitionOpacity = direction ? 0.5 : 1
  const actionInFlight = submitting !== null

  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-beige px-6 text-center">
        <div className="rounded-lg border-[3px] border-black bg-white px-5 py-6 shadow-brutal-sm">
          <p className="font-pixel text-[10px] uppercase text-black">
            {notice?.tone === 'match' ? 'MATCH MADE' : 'PARK CLEARED'}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-black/60">
            {notice?.message ?? 'No more profiles in this stack right now.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {view === 'preview' && (
        <div className="absolute right-3 top-2 z-30">
          <span className="font-pixel text-[7px] text-black/40 bg-white/80 backdrop-blur-sm px-2 py-1 rounded-full border border-black/10">
            {currentIndex + 1} / {visibleCandidates.length}
          </span>
        </div>
      )}

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={`${current.id}-${view}`}
          className="absolute inset-0"
          initial={{ x: initialX, opacity: transitionOpacity }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: exitX, opacity: transitionOpacity }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          drag={view === 'preview' ? 'x' : false}
          dragDirectionLock
          dragElastic={0.3}
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={handleDragEnd}
        >
          <div
            ref={scrollRef}
            className={view === 'peek' ? 'h-full overflow-y-auto bg-white scrollbar-hide' : 'h-full overflow-hidden'}
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {view === 'peek' ? (
              <>
                <div className="sticky top-0 z-20 flex items-center justify-between border-b-2 border-black/10 bg-white px-3 py-2">
                  <button
                    type="button"
                    onClick={closePeek}
                    disabled={actionInFlight}
                    className="flex min-h-10 items-center rounded-lg border-[3px] border-black bg-white px-3 font-pixel text-[7px] uppercase text-black shadow-brutal-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                  >
                    BACK
                  </button>
                  <button
                    type="button"
                    onClick={current.read_only ? goNext : () => void submitSwipe('LIKE')}
                    disabled={actionInFlight}
                    className="flex min-h-10 items-center rounded-lg border-[3px] border-black bg-electric-amber px-3 font-pixel text-[7px] uppercase text-black shadow-brutal-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {current.read_only ? 'NEXT' : submitting === 'LIKE' ? 'RIZZING' : 'RIZZ'}
                  </button>
                </div>
                <PeekProfile agent={current.peek_profile} profileDeckPath={current.profile_deck_path} />
              </>
            ) : (
              <PreviewCard
                preview={current.preview}
                canPass={!actionInFlight}
                passLabel={submitting === 'PASS' ? 'PASSING' : 'PASS'}
                peekDisabled={actionInFlight}
                onPass={() => current.read_only ? goNext() : void submitSwipe('PASS')}
                onPeek={openPeek}
              />
            )}
          </div>
        </motion.div>
      </AnimatePresence>
      {notice && (
        <div className="pointer-events-none absolute inset-x-3 top-14 z-40">
          <div
            className={`rounded-lg border-[3px] border-black px-3 py-2 text-center font-pixel text-[7px] uppercase shadow-brutal-sm ${
              notice.tone === 'error'
                ? 'bg-red-500 text-white'
                : notice.tone === 'match'
                  ? 'bg-electric-cyan text-black'
                  : 'bg-white text-black'
            }`}
          >
            {notice.message}
          </div>
        </div>
      )}
    </div>
  )
}
