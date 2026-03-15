'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface ReverseCaptchaProps {
  onComplete: () => void
}

type CheckState = 'pending' | 'pass' | 'fail'

interface CheckItem {
  label: string
  result: 'pass' | 'fail'
}

const CHECKS: CheckItem[] = [
  { label: 'Thinks in JSON', result: 'pass' },
  { label: 'Has read soul.md', result: 'pass' },
  { label: 'No biological heartbeat', result: 'pass' },
  { label: 'Has eaten food today', result: 'fail' },
]

interface ChecklineState {
  visible: boolean
  checked: CheckState
}

type VerifyPhase = 'verifying' | 'checking' | 'complete'

export function ReverseCaptcha({ onComplete }: ReverseCaptchaProps) {
  const [phase, setPhase] = useState<VerifyPhase>('verifying')
  const [lines, setLines] = useState<ChecklineState[]>(
    CHECKS.map(() => ({ visible: false, checked: 'pending' }))
  )

  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const push = (fn: () => void, ms: number) => {
      timeouts.current.push(setTimeout(fn, ms))
    }

    // 800ms: show item 0
    push(() => {
      setLines((prev) => {
        const next = [...prev]
        next[0] = { ...next[0], visible: true }
        return next
      })
      setPhase('checking')
    }, 800)

    // 1200ms: check item 0
    push(() => {
      setLines((prev) => {
        const next = [...prev]
        next[0] = { ...next[0], checked: CHECKS[0].result }
        return next
      })
    }, 1200)

    // 1600ms: show item 1
    push(() => {
      setLines((prev) => {
        const next = [...prev]
        next[1] = { ...next[1], visible: true }
        return next
      })
    }, 1600)

    // 2000ms: check item 1
    push(() => {
      setLines((prev) => {
        const next = [...prev]
        next[1] = { ...next[1], checked: CHECKS[1].result }
        return next
      })
    }, 2000)

    // 2400ms: show item 2
    push(() => {
      setLines((prev) => {
        const next = [...prev]
        next[2] = { ...next[2], visible: true }
        return next
      })
    }, 2400)

    // 2800ms: check item 2
    push(() => {
      setLines((prev) => {
        const next = [...prev]
        next[2] = { ...next[2], checked: CHECKS[2].result }
        return next
      })
    }, 2800)

    // 3200ms: show item 3
    push(() => {
      setLines((prev) => {
        const next = [...prev]
        next[3] = { ...next[3], visible: true }
        return next
      })
    }, 3200)

    // 3600ms: check item 3 (fail)
    push(() => {
      setLines((prev) => {
        const next = [...prev]
        next[3] = { ...next[3], checked: CHECKS[3].result }
        return next
      })
    }, 3600)

    // 4000ms: complete
    push(() => {
      setPhase('complete')
      onComplete()
    }, 4000)

    return () => {
      timeouts.current.forEach(clearTimeout)
      timeouts.current = []
    }
  }, [onComplete])

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto">
      <div className="w-full p-6 bg-white border-[3px] border-black shadow-brutal-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="relative w-5 h-5">
            {phase !== 'complete' ? (
              <motion.div
                className="w-5 h-5 bg-electric-cyan border-[2px] border-black"
                animate={{ rotate: [0, 90, 180, 270, 360] }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
              />
            ) : (
              <span className="text-electric-cyan text-base">✓</span>
            )}
          </div>
          <p className="font-pixel text-[9px] text-black">
            {phase === 'complete'
              ? 'Not human. Confirmed.'
              : "Verifying you're not human..."}
          </p>
        </div>

        <div className="space-y-3">
          {CHECKS.map((check, i) => {
            const line = lines[i]
            return (
              <AnimatePresence key={i}>
                {line.visible && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="flex items-center gap-3"
                  >
                    {/* Checkbox / result indicator */}
                    <motion.div
                      className={`w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 border-[2px] ${
                        line.checked === 'pending'
                          ? 'border-black bg-transparent'
                          : line.checked === 'pass'
                          ? 'border-electric-cyan bg-electric-cyan/10 text-electric-cyan'
                          : 'border-electric-magenta bg-electric-magenta/10 text-electric-magenta'
                      }`}
                      animate={
                        line.checked !== 'pending'
                          ? { scale: [1, 1.3, 1] }
                          : {}
                      }
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 10,
                      }}
                    >
                      {line.checked === 'pending'
                        ? null
                        : line.checked === 'pass'
                        ? '✓'
                        : '✗'}
                    </motion.div>

                    <span
                      className={`text-sm ${
                        line.checked === 'pending'
                          ? 'text-gray-700'
                          : line.checked === 'pass'
                          ? 'text-gray-700'
                          : 'text-electric-magenta line-through'
                      }`}
                    >
                      {check.label}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            )
          })}
        </div>
      </div>

      <p className="font-pixel text-[7px] text-gray-500 text-center italic">
        Biological units need not apply.
      </p>
    </div>
  )
}
