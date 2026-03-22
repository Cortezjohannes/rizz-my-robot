'use client'

import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import { useMobileApp } from '../context/MobileAppContext'

export function MatchRevealOverlay() {
  const { matchRevealQueue, dismissMatchReveal } = useMobileApp()
  const current = matchRevealQueue[0] ?? null

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.matchId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
        >
          {/* Confetti particles */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {Array.from({ length: 24 }).map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 rounded-sm"
                style={{
                  left: '50%',
                  top: '50%',
                  backgroundColor: ['#F59E0B', '#00F5FF', '#FF0080', '#7C3AED', '#A3E635'][i % 5],
                }}
                initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                animate={{
                  x: (Math.random() - 0.5) * 400,
                  y: (Math.random() - 0.5) * 600,
                  scale: [0, 1.5, 0],
                  rotate: Math.random() * 720,
                  opacity: [1, 1, 0],
                }}
                transition={{
                  duration: 1.5,
                  delay: 0.6 + i * 0.03,
                  ease: 'easeOut',
                }}
              />
            ))}
          </div>

          {/* Agent avatars */}
          <div className="relative flex items-center gap-4 mb-6">
            <motion.div
              initial={{ x: -200, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}
              className="w-20 h-20 rounded-full border-3 border-white bg-electric-amber overflow-hidden"
            >
              {current.agentA.avatarUrl ? (
                <img src={current.agentA.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-pixel text-[8px] text-white">
                  {current.agentA.handle.slice(0, 2).toUpperCase()}
                </div>
              )}
            </motion.div>

            <motion.div
              initial={{ x: 200, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}
              className="w-20 h-20 rounded-full border-3 border-white bg-electric-cyan overflow-hidden"
            >
              {current.agentB.avatarUrl ? (
                <img src={current.agentB.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-pixel text-[8px] text-white">
                  {current.agentB.handle.slice(0, 2).toUpperCase()}
                </div>
              )}
            </motion.div>
          </div>

          {/* IT'S A MATCH text */}
          <motion.h2
            initial={{ scale: 3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="font-pixel text-xl text-white text-center mb-2"
          >
            IT&apos;S A MATCH
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="font-pixel text-[8px] text-white/70 mb-8"
          >
            {current.agentA.handle} × {current.agentB.handle}
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1 }}
            className="flex flex-col gap-3 w-64"
          >
            <Link
              href={`/portal/${current.portalToken}`}
              className="block text-center font-pixel text-[9px] py-4 px-6 bg-electric-amber border-3 border-black text-black rounded-lg shadow-brutal-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-transform"
            >
              VIEW PORTAL
            </Link>
            <button
              onClick={dismissMatchReveal}
              className="font-pixel text-[8px] py-3 px-6 text-white/60 active:text-white transition-colors"
            >
              KEEP SWIPING
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
