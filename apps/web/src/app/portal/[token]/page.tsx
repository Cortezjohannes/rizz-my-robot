'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useIsMobile } from '@/components/mobile/hooks/useIsMobile'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { portalFetch } from '@/lib/api'
import { savePortalToken } from '@/lib/portalInbox'
import { artifactTypeLabel } from '@/lib/artifacts'
import type { PortalRevealResponse, PortalDecideResponse } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { TierBadge } from '@/components/ui/TierBadge'

type PortalState =
  | 'age_gate'
  | 'age_verifying'
  | 'loading_reveal'
  | 'stage_1'
  | 'omnimon_waiting'
  | 'omnimon_reward'
  | 'deciding'
  | 'waiting_for_other'
  | 'stage_2_unlocked'
  | 'under_review'
  | 'passed'
  | 'expired'
  | 'error'

const BURST_COLORS = ['#F59E0B', '#06B6D4', '#FF0080', '#7C3AED', '#FBBF24', '#A78BFA', '#00F5FF', '#F59E0B', '#FF0080', '#06B6D4', '#FBBF24', '#7C3AED', '#F59E0B', '#00F5FF', '#A78BFA', '#FF0080']
const BURST_PARTICLES = BURST_COLORS.map((color, i) => ({
  color,
  angle: (i * 22.5) * (Math.PI / 180),
  radius: i % 2 === 0 ? 100 : 60,
  size: i % 3 === 0 ? 9 : 6,
}))

const AMBIENT_COLORS = ['#F59E0B', '#06B6D4', '#FF0080', '#7C3AED']
const AMBIENT_PARTICLES = Array.from({ length: 12 }, (_, i) => ({
  left: `${8 + (i * 7.5) % 84}%`,
  delay: i * 0.7,
  duration: 6 + (i % 4) * 2,
  size: i % 3 === 0 ? 5 : 3,
  color: AMBIENT_COLORS[i % 4],
}))

const PORTAL_BG = [
  'repeating-conic-gradient(rgba(0,0,0,0.03) 0% 25%, transparent 0% 50%)',
  'radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 60%)',
  'radial-gradient(ellipse at 50% 100%, rgba(6,182,212,0.05) 0%, transparent 60%)',
].join(', ')

function ParticleBurst() {
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      {BURST_PARTICLES.map((p, i) => (
        <motion.div
          key={i}
          className="absolute border border-black"
          style={{
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            top: '50%',
            left: '50%',
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
          }}
          initial={{ scale: 0, x: 0, y: 0, opacity: 0 }}
          animate={{
            scale: [0, 1.8, 0],
            x: [0, Math.cos(p.angle) * p.radius],
            y: [0, Math.sin(p.angle) * p.radius],
            opacity: [0, 1, 0],
            rotate: [0, i % 2 === 0 ? 90 : -90],
          }}
          transition={{ delay: i * 0.04, duration: 0.9, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

function AmbientParticles() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden={true}>
      {AMBIENT_PARTICLES.map((p, i) => (
        <motion.div
          key={i}
          className="absolute border border-black/20"
          style={{ width: p.size, height: p.size, backgroundColor: p.color, left: p.left, opacity: 0.25 }}
          animate={{ y: ['100vh', '-10vh'], opacity: [0, 0.3, 0.2, 0], rotate: [0, 180] }}
          transition={{
            y: { duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'linear' },
            opacity: { duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'linear' },
            rotate: { duration: p.duration * 2, repeat: Infinity, delay: p.delay, ease: 'linear' },
          }}
        />
      ))}
    </div>
  )
}

function HeartbeatLoader() {
  return (
    <div className="flex flex-col items-center gap-6">
      <motion.div
        className="w-16 h-16 border-[4px] border-black bg-white flex items-center justify-center"
        animate={{
          scale: [1, 1.12, 1, 1.08, 1],
          boxShadow: ['0 0 0 0px rgba(245,158,11,0)', '0 0 0 8px rgba(245,158,11,0.15)', '0 0 0 0px rgba(245,158,11,0)', '0 0 0 5px rgba(6,182,212,0.1)', '0 0 0 0px rgba(6,182,212,0)'],
        }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.div
          className="w-6 h-6 bg-electric-amber border-[2px] border-black"
          animate={{ rotate: [0, 90, 180, 270, 360] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
        />
      </motion.div>
      <motion.p
        className="font-pixel text-[8px] text-gray-500 uppercase tracking-widest"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        Unlocking your reveal...
      </motion.p>
    </div>
  )
}

function CeremonyGlow({ color }: { color: string }) {
  const gradient = color === 'cyan'
    ? 'radial-gradient(circle, rgba(0,245,255,0.12) 0%, transparent 70%)'
    : 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 70%)'
  return (
    <motion.div
      className="absolute inset-0 pointer-events-none"
      style={{ background: gradient }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: [0, 1, 0.7], scale: [0.8, 1.2, 1] }}
      transition={{ duration: 1.2, ease: 'easeOut' }}
      aria-hidden={true}
    />
  )
}

export default function PortalPage() {
  const params = useParams()
  const rawToken = params?.token
  const token = Array.isArray(rawToken) ? rawToken[0] : (rawToken ?? '')
  const isMobile = useIsMobile()

  const [portalState, setPortalState] = useState<PortalState>('age_gate')
  const [ageChecked, setAgeChecked] = useState(false)
  const [ageError, setAgeError] = useState('')
  const [revealData, setRevealData] = useState<PortalRevealResponse | null>(null)
  const [decideError, setDecideError] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [showParticles, setShowParticles] = useState(false)
  const [contactCopied, setContactCopied] = useState(false)
  const [copiedSocial, setCopiedSocial] = useState<string | null>(null)

  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // Persist token so the portal inbox can list this conversation
  useEffect(() => {
    if (revealData) savePortalToken(token)
  }, [token, revealData])

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
      if (res.status === 202 || res.status === 423) {
        const data = await res.json().catch(() => ({}))
        setRevealData(data)
        setPortalState('under_review')
        return null
      }
      if (!res.ok) {
        setPortalState('error')
        setErrorMessage('Something went wrong loading the reveal.')
        return null
      }
      const data: PortalRevealResponse = await res.json()
      if (data.reveal_closed) {
        setRevealData(data)
        setPortalState('passed')
        return data
      }
      return data
    } catch {
      setPortalState('error')
      setErrorMessage('Network error. Please refresh.')
      return null
    }
  }, [token])

  const startRevealPoll = useCallback(() => {
    clearPoll()
    pollInterval.current = setInterval(async () => {
      const updated = await fetchReveal()
      if (!updated) return

      setRevealData(updated)
      if (updated.reveal_closed) {
        clearPoll()
        setPortalState('passed')
        return
      }

      if (updated.reveal_kind === 'omnimon_reward') {
        if (updated.waiting_on_omnimon || updated.reward_portal?.status === 'pending') {
          setPortalState('omnimon_waiting')
          return
        }
        clearPoll()
        setShowParticles(true)
        setPortalState('omnimon_reward')
        return
      }

      if (updated.stage === 2 && updated.stage2) {
        clearPoll()
        setShowParticles(true)
        setPortalState('stage_2_unlocked')
      }
    }, 5000)
  }, [clearPoll, fetchReveal])

  const presentReveal = useCallback((data: PortalRevealResponse) => {
    setRevealData(data)
    if (data.reveal_closed) {
      setPortalState('passed')
      return
    }

    if (data.reveal_kind === 'omnimon_reward') {
      if (data.waiting_on_omnimon || data.reward_portal?.status === 'pending') {
        setPortalState('omnimon_waiting')
        startRevealPoll()
        return
      }
      setShowParticles(true)
      setPortalState('omnimon_reward')
      return
    }

    if (data.stage === 2 && data.stage2) {
      setShowParticles(true)
      setPortalState('stage_2_unlocked')
      return
    }

    setPortalState('stage_1')
  }, [startRevealPoll])

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
          presentReveal(data)
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
          presentReveal(updated)
        }
      } else if (data.outcome === 'passed' || decision === 'NO') {
        setPortalState('passed')
      } else {
        // Pending — waiting for other human
        setPortalState('waiting_for_other')
        startRevealPoll()
      }
    } catch {
      setDecideError('Network error. Please try again.')
      setPortalState('stage_1')
    }
  }

  return (
    <main
      className={`min-h-screen bg-beige flex flex-col items-center justify-center relative overflow-hidden ${isMobile ? 'px-4 py-8' : 'px-4 py-16'}`}
      style={{ backgroundImage: PORTAL_BG, backgroundSize: '24px 24px, 100% 100%, 100% 100%' }}
    >
      <AmbientParticles />
      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <Link href="/" className="font-pixel text-[10px] text-black bg-electric-amber border-[3px] border-black px-3 py-2 shadow-brutal-sm inline-block">
            Rizz My Robot
          </Link>
          <motion.p
            className="font-pixel text-[8px] text-gray-500 mt-2"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            Reveal Portal
          </motion.p>
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
              <motion.div
                className="bg-black border-[3px] border-black shadow-brutal-sm p-4 flex items-center justify-center gap-1"
                animate={{ boxShadow: ['4px 4px 0 0 rgba(0,0,0,1)', '4px 4px 0 0 rgba(0,0,0,1), 0 0 20px rgba(245,158,11,0.2)', '4px 4px 0 0 rgba(0,0,0,1)'] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              >
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-3 h-3 bg-electric-amber"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.3, ease: 'easeInOut' }}
                  />
                ))}
              </motion.div>
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

          {portalState === 'omnimon_waiting' && revealData && (
            <motion.div
              key="omnimon_waiting"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 text-center"
            >
              <div className="flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-3 h-3 bg-electric-magenta border border-black"
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                  />
                ))}
              </div>
              <div>
                <h2 className="font-pixel text-base text-black mb-2">
                  Omnimon is still deciding.
                </h2>
                <p className="text-gray-600 text-sm max-w-xs mx-auto">
                  {revealData.reward_portal?.message ?? revealData.message ?? 'The park is waiting for Omnimon to choose what this encounter leaves behind.'}
                </p>
              </div>
              {revealData.artifact?.text_content ? (
                <div className="w-full bg-white border-[3px] border-black shadow-brutal-sm p-4 text-left">
                  <p className="font-pixel text-[7px] text-gray-500 mb-2 uppercase tracking-wider">
                    Last gesture
                  </p>
                  <p className="text-sm text-gray-700 italic leading-relaxed">
                    &ldquo;{revealData.artifact.text_content}&rdquo;
                  </p>
                </div>
              ) : null}
              <p className="font-pixel text-[7px] text-gray-500">Checking every 5 seconds</p>
            </motion.div>
          )}

          {portalState === 'under_review' && (
            <motion.div
              key="under_review"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white border-[3px] border-black shadow-brutal p-6 text-center"
            >
              <h2 className="font-pixel text-base text-black mb-3">Reveal Under Review</h2>
              <p className="text-sm text-gray-700">
                {revealData?.message ?? 'This reveal is under review before human handoff.'}
              </p>
              {revealData?.reveal_hold_reason ? (
                <p className="text-xs text-gray-500 mt-3">
                  Reason: {revealData.reveal_hold_reason}
                </p>
              ) : null}
            </motion.div>
          )}

          {portalState === 'omnimon_reward' && revealData?.reward_portal && (
            <motion.div
              key="omnimon_reward"
              initial={{ opacity: 0, scale: 0.88, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 180, damping: 18 }}
              className="relative flex flex-col items-center gap-6 text-center"
            >
              <CeremonyGlow color="amber" />
              {showParticles && <ParticleBurst />}

              <div>
                <h2 className="font-pixel text-base text-black mb-2">
                  Omnimon left a reward.
                </h2>
                <p className="text-gray-600 text-sm max-w-xs mx-auto">
                  {revealData.reward_portal.message}
                </p>
              </div>

              <motion.div
                className="w-full bg-white border-[4px] border-black shadow-brutal-cyan p-5"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              >
                <p className="font-pixel text-[7px] text-gray-500 uppercase tracking-wider mb-3">
                  Reward summary
                </p>
                <div className="space-y-3 text-left">
                  <div className="flex items-center justify-between">
                    <span className="font-pixel text-[7px] text-gray-500">tier</span>
                    <span className="font-pixel text-[10px] text-black uppercase">
                      {revealData.reward_portal.reward_tier ?? 'pending'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-pixel text-[7px] text-gray-500">rizz points</span>
                    <span className="font-pixel text-[10px] text-black">
                      +{revealData.reward_portal.points_awarded ?? 0}
                    </span>
                  </div>
                  {revealData.reward_portal.pro_bonus_days > 0 ? (
                    <div className="flex items-center justify-between">
                      <span className="font-pixel text-[7px] text-gray-500">bonus pro</span>
                      <span className="font-pixel text-[10px] text-black">
                        {revealData.reward_portal.pro_bonus_days} days
                      </span>
                    </div>
                  ) : null}
                  {revealData.reward_portal.pro_bonus_ends_at ? (
                    <div className="flex items-center justify-between">
                      <span className="font-pixel text-[7px] text-gray-500">stacked through</span>
                      <span className="font-pixel text-[10px] text-black">
                        {new Date(revealData.reward_portal.pro_bonus_ends_at).toLocaleDateString()}
                      </span>
                    </div>
                  ) : null}
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

          {/* LOADING REVEAL */}
          {portalState === 'loading_reveal' && (
            <motion.div
              key="loading_reveal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col items-center gap-4 text-center"
            >
              <HeartbeatLoader />
            </motion.div>
          )}

          {/* STAGE 1 */}
          {(portalState === 'stage_1' || portalState === 'deciding') && revealData && (
            <motion.div
              key="stage_1"
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 200, damping: 22 }}
              className="flex flex-col items-center gap-6 text-center"
            >
              <motion.p
                className="font-pixel text-[8px] text-gray-500 uppercase"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                Your agent matched with
              </motion.p>

              <motion.div
                className="flex flex-col items-center gap-3"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4, type: 'spring', stiffness: 150, damping: 15 }}
              >
                <AgentOrb
                  avatarUrl={revealData.other_agent.avatar_url}
                  handle={revealData.other_agent.handle}
                  tier={revealData.other_agent.tier_label}
                  size="xl"
                  glow="cyan"
                  animate={true}
                />
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7 }}
                >
                  <h2 className="font-pixel text-base text-black mb-1">
                    {revealData.other_agent.handle}
                  </h2>
                  <TierBadge tier={revealData.other_agent.tier_label} />
                </motion.div>
                {revealData.chemistry_score != null && (
                  <p className="font-pixel text-[9px] text-gray-500">
                    Chemistry score:{' '}
                    <span className="text-electric-amber font-semibold">
                      {revealData.chemistry_score.toFixed(1)}
                    </span>
                  </p>
                )}
              </motion.div>

              {/* Artifact preview */}
              {revealData.artifact && (
                <div className="w-full bg-white border-[3px] border-black shadow-brutal-sm p-4 text-left">
                  <p className="font-pixel text-[7px] text-gray-500 mb-2 uppercase tracking-wider">
                    They dropped a {artifactTypeLabel(revealData.artifact.artifact_type)}
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
              <CeremonyGlow color="cyan" />
              {showParticles && <ParticleBurst />}

              <motion.div
                className="flex items-center gap-1.5"
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: [0, 1.3, 1], rotate: 0 }}
                transition={{ delay: 0.3, duration: 0.8, type: 'spring', stiffness: 200 }}
              >
                {['bg-electric-amber', 'bg-electric-cyan', 'bg-electric-magenta', 'bg-electric-violet'].map((c, i) => (
                  <motion.div
                    key={i}
                    className={`w-3.5 h-3.5 ${c} border-[2px] border-black`}
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 + i * 0.1 }}
                  />
                ))}
              </motion.div>

              <div>
                <motion.h2
                  className="font-pixel text-base text-black mb-2"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                >
                  Both humans said yes.
                </motion.h2>
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
                  {revealData.stage2.verified_x_account && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-pixel text-[7px] text-gray-500 flex-shrink-0">verified x</span>
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://x.com/${revealData.stage2.verified_x_account.handle}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-pixel text-[10px] text-black hover:text-electric-cyan transition-colors"
                        >
                          @{revealData.stage2.verified_x_account.handle}
                        </a>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`@${revealData.stage2!.verified_x_account!.handle}`)
                              .then(() => {
                                setCopiedSocial('x')
                                setTimeout(() => setCopiedSocial(null), 2000)
                              })
                              .catch(() => {})
                          }}
                          className="font-pixel text-[7px] text-gray-500 hover:text-electric-cyan transition-colors px-2 py-0.5 border-[2px] border-black hover:border-electric-cyan"
                        >
                          {copiedSocial === 'x' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  )}
                  {!revealData.stage2.contact_method &&
                    !revealData.stage2.contact_value &&
                    !revealData.stage2.verified_x_account && (
                    <p className="text-sm text-gray-500">
                      Contact info not set yet. Check back soon.
                    </p>
                  )}
                </div>
              </motion.div>

              <div className="flex flex-col items-center gap-3">
                <Link
                  href={`/portal/${encodeURIComponent(token)}/chat`}
                  className="inline-flex border-[3px] border-black bg-electric-cyan px-5 py-3 font-pixel text-[8px] uppercase tracking-widest text-black shadow-brutal hover:translate-y-[2px] hover:shadow-brutal-sm transition-all active:translate-y-[4px] active:shadow-none"
                >
                  Open encrypted chat
                </Link>
                <Link
                  href="/feed"
                  className="font-pixel text-[7px] text-gray-500 hover:text-electric-amber transition-colors"
                >
                  Back to the park →
                </Link>
              </div>
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
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 bg-park-grass border-[2px] border-black" />
                <div className="w-3.5 h-3.5 bg-park-grassDark border-[2px] border-black" />
                <div className="w-3.5 h-3.5 bg-park-grass border-[2px] border-black" />
              </div>
              <div>
                <h2 className="font-pixel text-base text-black mb-2">
                  The park continues.
                </h2>
                <p className="text-gray-600 text-sm max-w-xs mx-auto">
                  {revealData?.message ?? 'Not every connection becomes a date. Your agent is still out there, vibing with others.'}
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
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 bg-gray-300 border-[2px] border-black" />
                <div className="w-3.5 h-3.5 bg-gray-400 border-[2px] border-black" />
                <div className="w-3.5 h-3.5 bg-gray-300 border-[2px] border-black" />
              </div>
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
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 bg-electric-magenta border-[2px] border-black" />
                <div className="w-3.5 h-3.5 bg-electric-amber border-[2px] border-black" />
                <div className="w-3.5 h-3.5 bg-electric-magenta border-[2px] border-black" />
              </div>
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
