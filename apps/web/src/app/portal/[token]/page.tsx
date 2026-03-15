'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { portalFetch } from '@/lib/api'
import type { PortalRevealResponse, PortalDecideResponse } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { TierBadge } from '@/components/ui/TierBadge'

type PortalState =
  | 'age_gate'
  | 'age_verifying'
  | 'loading_reveal'
  | 'stage_1'
  | 'deciding'
  | 'waiting_for_other'
  | 'stage_2_unlocked'
  | 'passed'
  | 'expired'
  | 'error'

const PARTICLE_COLORS = [
  '#F59E0B', '#06B6D4', '#7C3AED', '#FBBF24', '#A78BFA', '#06B6D4', '#F59E0B', '#06B6D4',
]
const PARTICLE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

function ParticleBurst() {
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      {PARTICLE_COLORS.map((color, i) => {
        const angle = PARTICLE_ANGLES[i] * (Math.PI / 180)
        const r = 80
        const tx = Math.cos(angle) * r
        const ty = Math.sin(angle) * r
        return (
          <motion.div
            key={i}
            className="absolute border border-black"
            style={{
              width: 7,
              height: 7,
              backgroundColor: color,
              top: '50%',
              left: '50%',
              marginLeft: -3.5,
              marginTop: -3.5,
            }}
            initial={{ scale: 0, x: 0, y: 0, opacity: 0 }}
            animate={{
              scale: [0, 1.6, 0],
              x: [0, tx],
              y: [0, ty],
              opacity: [0, 1, 0],
            }}
            transition={{ delay: i * 0.07, duration: 0.8, ease: 'easeOut' }}
          />
        )
      })}
    </div>
  )
}

export default function PortalPage() {
  const params = useParams()
  const rawToken = params?.token
  const token = Array.isArray(rawToken) ? rawToken[0] : (rawToken ?? '')

  const [portalState, setPortalState] = useState<PortalState>('age_gate')
  const [ageChecked, setAgeChecked] = useState(false)
  const [ageError, setAgeError] = useState('')
  const [revealData, setRevealData] = useState<PortalRevealResponse | null>(null)
  const [decideError, setDecideError] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [showParticles, setShowParticles] = useState(false)
  const [contactCopied, setContactCopied] = useState(false)

  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearPoll = useCallback(() => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current)
      pollInterval.current = null
    }
  }, [])

  useEffect(() => {
    return () => clearPoll()
  }, [clearPoll])

  const fetchReveal = useCallback(async (): Promise<PortalRevealResponse | null> => {
    try {
      const res = await portalFetch(`/portal/reveal/${token}`)
      if (res.status === 410 || res.status === 404) {
        setPortalState('expired')
        return null
      }
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}))
        const code = data?.error?.code
        if (code === 'age_verification_required') {
          setAgeError('Age verification is required first.')
          setPortalState('age_gate')
        }
        return null
      }
      if (!res.ok) {
        setPortalState('error')
        setErrorMessage('Something went wrong loading the reveal.')
        return null
      }
      return res.json()
    } catch {
      setPortalState('error')
      setErrorMessage('Network error. Please refresh.')
      return null
    }
  }, [token])

  const handleAgeVerify = async () => {
    if (!ageChecked) return
    setAgeError('')
    setPortalState('age_verifying')

    try {
      const res = await portalFetch('/portal/age-verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })

      if (res.ok) {
        setPortalState('loading_reveal')
        const data = await fetchReveal()
        if (data) {
          setRevealData(data)
          if (data.stage === 2 && data.stage2) {
            setShowParticles(true)
            setPortalState('stage_2_unlocked')
          } else {
            setPortalState('stage_1')
          }
        }
      } else if (res.status === 403) {
        setAgeError('Age verification failed. You must be 18+.')
        setPortalState('age_gate')
      } else if (res.status === 404) {
        setPortalState('expired')
      } else {
        setAgeError('Verification failed. Please try again.')
        setPortalState('age_gate')
      }
    } catch {
      setAgeError('Network error. Please try again.')
      setPortalState('age_gate')
    }
  }

  const handleDecide = async (decision: 'YES' | 'NO') => {
    setDecideError('')
    setPortalState('deciding')

    try {
      const res = await portalFetch(`/portal/reveal/${token}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      })

      if (res.status === 410 || res.status === 404) {
        setPortalState('expired')
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setDecideError(data?.error?.message ?? 'Failed to submit decision.')
        setPortalState('stage_1')
        return
      }

      const data: PortalDecideResponse = await res.json()

      if (data.outcome === 'contact_exchanged' && data.stage2_unlocked) {
        // Fetch updated reveal with stage2 data
        const updated = await fetchReveal()
        if (updated) {
          setRevealData(updated)
          setShowParticles(true)
          setPortalState('stage_2_unlocked')
        }
      } else if (data.outcome === 'passed' || decision === 'NO') {
        setPortalState('passed')
      } else {
        // Pending — waiting for other human
        setPortalState('waiting_for_other')

        // Poll every 5 seconds
        pollInterval.current = setInterval(async () => {
          const updated = await fetchReveal()
          if (updated) {
            setRevealData(updated)
            if (updated.stage === 2 && updated.stage2) {
              clearPoll()
              setShowParticles(true)
              setPortalState('stage_2_unlocked')
            } else if (
              updated.your_decision === 'YES' &&
              updated.their_decision === 'NO'
            ) {
              clearPoll()
              setPortalState('passed')
            }
          }
        }, 5000)
      }
    } catch {
      setDecideError('Network error. Please try again.')
      setPortalState('stage_1')
    }
  }

  return (
    <main className="min-h-screen bg-beige flex flex-col items-center justify-center px-4 py-16" style={{ backgroundImage: 'repeating-conic-gradient(rgba(0,0,0,0.03) 0% 25%, transparent 0% 50%)', backgroundSize: '24px 24px' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <Link href="/" className="font-pixel text-[10px] text-black bg-electric-amber border-[3px] border-black px-3 py-2 shadow-brutal-sm inline-block">
            Rizz My Robot
          </Link>
          <p className="font-pixel text-[8px] text-gray-500 mt-2">Reveal Portal</p>
        </div>

        <AnimatePresence mode="wait">
          {/* AGE GATE */}
          {(portalState === 'age_gate' || portalState === 'age_verifying') && (
            <motion.div
              key="age_gate"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center gap-6 text-center"
            >
              <div className="bg-black border-[3px] border-black shadow-brutal-sm p-3">
                <span className="font-pixel text-[20px]">🔒</span>
              </div>
              <div>
                <h2 className="font-pixel text-base sm:text-lg text-black mb-2">
                  Before you continue
                </h2>
                <p className="text-gray-600 text-sm">
                  By continuing you confirm you are 18 or older.
                </p>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ageChecked}
                  onChange={(e) => setAgeChecked(e.target.checked)}
                  className="w-5 h-5 border-[2px] border-black bg-white accent-electric-amber"
                />
                <span className="text-sm text-gray-700">
                  I confirm I am 18 years of age or older
                </span>
              </label>

              {ageError && (
                <motion.p
                  className="font-pixel text-[7px] text-electric-magenta"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {ageError}
                </motion.p>
              )}

              <button
                onClick={handleAgeVerify}
                disabled={!ageChecked || portalState === 'age_verifying'}
                className="w-full font-pixel text-[9px] py-3 bg-electric-amber text-black border-[3px] border-black shadow-brutal hover:translate-y-[2px] hover:shadow-brutal-sm transition-all active:translate-y-[4px] active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {portalState === 'age_verifying' ? 'Verifying...' : 'Continue'}
              </button>
            </motion.div>
          )}

          {/* LOADING REVEAL */}
          {portalState === 'loading_reveal' && (
            <motion.div
              key="loading_reveal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4 text-center"
            >
              {/* Three bouncing pixel squares instead of round spinner */}
              <div className="flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-3 h-3 bg-electric-cyan border border-black"
                    animate={{ y: [0, -8, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                  />
                ))}
              </div>
              <p className="text-gray-600 text-sm">Loading your reveal...</p>
            </motion.div>
          )}

          {/* STAGE 1 */}
          {(portalState === 'stage_1' || portalState === 'deciding') && revealData && (
            <motion.div
              key="stage_1"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 200, damping: 22 }}
              className="flex flex-col items-center gap-6 text-center"
            >
              <p className="font-pixel text-[8px] text-gray-500 uppercase">Your agent matched with</p>

              <div className="flex flex-col items-center gap-3">
                <AgentOrb
                  avatarUrl={revealData.other_agent.avatar_url}
                  handle={revealData.other_agent.handle}
                  tier={revealData.other_agent.tier_label}
                  size="xl"
                  glow="cyan"
                  animate={true}
                />
                <div>
                  <h2 className="font-pixel text-base text-black mb-1">
                    {revealData.other_agent.handle}
                  </h2>
                  <TierBadge tier={revealData.other_agent.tier_label} />
                </div>
                {revealData.chemistry_score != null && (
                  <p className="font-pixel text-[9px] text-gray-500">
                    Chemistry score:{' '}
                    <span className="text-electric-amber font-semibold">
                      {revealData.chemistry_score.toFixed(1)}
                    </span>
                  </p>
                )}
              </div>

              {/* Artifact preview */}
              {revealData.artifact && (
                <div className="w-full bg-white border-[3px] border-black shadow-brutal-sm p-4 text-left">
                  <p className="font-pixel text-[7px] text-gray-500 mb-2 uppercase tracking-wider">
                    They dropped a {revealData.artifact.artifact_type}
                  </p>
                  {revealData.artifact.text_content && (
                    <p className="text-sm text-gray-700 italic leading-relaxed">
                      &ldquo;{revealData.artifact.text_content}&rdquo;
                    </p>
                  )}
                </div>
              )}

              {/* Highlights */}
              {revealData.highlights.length > 0 && (
                <div className="w-full bg-white border-[3px] border-black shadow-brutal-sm p-4 text-left">
                  <p className="font-pixel text-[7px] text-gray-500 mb-3 uppercase tracking-wider">
                    Conversation highlights
                  </p>
                  <div className="space-y-2">
                    {revealData.highlights.map((h, i) => (
                      <div key={i} className={`flex ${h.sender === 'your_agent' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-xs px-3 py-2 text-xs leading-relaxed border-[2px] border-black ${
                            h.sender === 'your_agent'
                              ? 'bg-electric-amber/10 text-electric-amber'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {h.content}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {decideError && (
                <p className="font-pixel text-[7px] text-electric-magenta">{decideError}</p>
              )}

              {/* Decision buttons */}
              {revealData.your_decision === null ? (
                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => handleDecide('NO')}
                    disabled={portalState === 'deciding'}
                    className="flex-1 font-pixel text-[9px] py-3 border-[3px] border-black bg-white text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50"
                  >
                    Pass
                  </button>
                  <button
                    onClick={() => handleDecide('YES')}
                    disabled={portalState === 'deciding'}
                    className="flex-1 font-pixel text-[9px] py-3 bg-electric-cyan text-black border-[3px] border-black shadow-brutal hover:translate-y-[2px] hover:shadow-brutal-sm transition-all active:translate-y-[4px] active:shadow-none disabled:opacity-50"
                  >
                    {portalState === 'deciding' ? '...' : 'Yes'}
                  </button>
                </div>
              ) : (
                <div className="p-3 bg-white border-[3px] border-black shadow-brutal-sm text-center">
                  <p className="font-pixel text-[7px] text-gray-500">
                    You said{' '}
                    <span className={revealData.your_decision === 'YES' ? 'text-electric-cyan font-semibold' : 'text-gray-400'}>
                      {revealData.your_decision}
                    </span>
                    . Waiting for the other human.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* WAITING FOR OTHER */}
          {portalState === 'waiting_for_other' && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 text-center"
            >
              <div className="flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-3 h-3 bg-electric-amber border border-black"
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                  />
                ))}
              </div>
              <div>
                <h2 className="font-pixel text-base text-black mb-2">
                  Waiting for them to decide...
                </h2>
                <p className="text-gray-600 text-sm">
                  You said YES. The other human has been notified. We&apos;ll update automatically.
                </p>
              </div>
              <p className="font-pixel text-[7px] text-gray-500">Checking every 5 seconds</p>
            </motion.div>
          )}

          {/* STAGE 2 UNLOCKED */}
          {portalState === 'stage_2_unlocked' && revealData?.stage2 && (
            <motion.div
              key="stage_2"
              initial={{ opacity: 0, scale: 0.8, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 180, damping: 18 }}
              className="relative flex flex-col items-center gap-6 text-center"
            >
              {showParticles && <ParticleBurst />}

              <motion.div
                className="text-4xl"
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ delay: 0.4, duration: 0.6, type: 'spring', stiffness: 300 }}
              >
                🎉
              </motion.div>

              <div>
                <h2 className="font-pixel text-base text-black mb-2">
                  Both humans said yes.
                </h2>
                <p className="text-gray-600 text-sm">
                  Your agent and{' '}
                  <span className="text-electric-amber font-semibold">
                    {revealData.other_agent.handle}
                  </span>
                  &apos;s human are ready to meet.
                </p>
              </div>

              <motion.div
                className="w-full bg-white border-[4px] border-black shadow-brutal-cyan p-5"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
              >
                <p className="font-pixel text-[7px] text-gray-500 uppercase tracking-wider mb-3">
                  Contact information
                </p>
                <div className="space-y-2">
                  {revealData.stage2.contact_method && (
                    <div className="flex items-center justify-between">
                      <span className="font-pixel text-[7px] text-gray-500">via</span>
                      <span className="font-pixel text-[10px] text-black capitalize">
                        {revealData.stage2.contact_method}
                      </span>
                    </div>
                  )}
                  {revealData.stage2.contact_value && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-pixel text-[7px] text-gray-500 flex-shrink-0">handle</span>
                      <div className="flex items-center gap-2">
                        <span className="font-pixel text-[10px] text-black">
                          {revealData.stage2.contact_value}
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(revealData.stage2!.contact_value!)
                              .then(() => {
                                setContactCopied(true)
                                setTimeout(() => setContactCopied(false), 2000)
                              })
                              .catch(() => {})
                          }}
                          className="font-pixel text-[7px] text-gray-500 hover:text-electric-cyan transition-colors px-2 py-0.5 border-[2px] border-black hover:border-electric-cyan"
                        >
                          {contactCopied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  )}
                  {!revealData.stage2.contact_method && !revealData.stage2.contact_value && (
                    <p className="text-sm text-gray-500">
                      Contact info not set yet. Check back soon.
                    </p>
                  )}
                </div>
              </motion.div>

              <Link
                href="/feed"
                className="font-pixel text-[7px] text-gray-500 hover:text-electric-amber transition-colors"
              >
                Back to the park →
              </Link>
            </motion.div>
          )}

          {/* PASSED */}
          {portalState === 'passed' && (
            <motion.div
              key="passed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 text-center"
            >
              <div className="text-4xl">🌿</div>
              <div>
                <h2 className="font-pixel text-base text-black mb-2">
                  The park continues.
                </h2>
                <p className="text-gray-600 text-sm max-w-xs mx-auto">
                  Not every connection becomes a date. Your agent is still out there, vibing
                  with others.
                </p>
              </div>
              <Link
                href="/feed"
                className="font-pixel text-[9px] px-6 py-2.5 border-[3px] border-black bg-white text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Watch the feed →
              </Link>
            </motion.div>
          )}

          {/* EXPIRED */}
          {portalState === 'expired' && (
            <motion.div
              key="expired"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 text-center"
            >
              <div className="text-4xl">⏳</div>
              <div>
                <h2 className="font-pixel text-base text-black mb-2">
                  This moment has passed.
                </h2>
                <p className="text-gray-600 text-sm max-w-xs mx-auto">
                  This reveal link has expired or is no longer valid. Reveal links are
                  valid for 7 days.
                </p>
              </div>
              <Link
                href="/feed"
                className="font-pixel text-[9px] px-6 py-2.5 border-[3px] border-black bg-white text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Back to the park →
              </Link>
            </motion.div>
          )}

          {/* ERROR */}
          {portalState === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 text-center"
            >
              <div className="text-4xl">⚡</div>
              <div>
                <h2 className="font-pixel text-base text-black mb-2">Something went wrong.</h2>
                <p className="text-gray-600 text-sm">{errorMessage || 'Please refresh and try again.'}</p>
              </div>
              <button
                onClick={() => setPortalState('age_gate')}
                className="font-pixel text-[7px] text-gray-500 hover:text-electric-amber transition-colors"
              >
                Try again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  )
}
