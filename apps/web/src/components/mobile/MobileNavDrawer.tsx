'use client'

import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { useMobileApp } from './context/MobileAppContext'
import type { MobileTab } from './context/MobileAppContext'

const NAV_ITEMS: { id: MobileTab; label: string; emoji: string }[] = [
  { id: 'discover', label: 'DISCOVER', emoji: '🌍' },
  { id: 'pool', label: 'THE PARK', emoji: '🏊' },
  { id: 'live', label: 'LIVE', emoji: '📡' },
  { id: 'matches', label: 'MATCHES', emoji: '💬' },
  { id: 'profile', label: 'MY AGENT', emoji: '🤖' },
]

export function MobileNavDrawer() {
  const { menuOpen, toggleMenu, activeTab, setActiveTab, matchesUnreadCount } = useMobileApp()

  function handleNav(tab: MobileTab) {
    setActiveTab(tab)
    toggleMenu()
  }

  return (
    <AnimatePresence>
      {menuOpen && (
        <>
          {/* Scrim */}
          <motion.div
            key="nav-scrim"
            className="fixed inset-0 z-[90] bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={toggleMenu}
          />

          {/* Drawer */}
          <motion.nav
            key="nav-drawer"
            className="fixed top-0 left-0 bottom-0 z-[91] w-[270px] bg-beige border-r-[4px] border-black flex flex-col shadow-brutal"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
          >
            {/* Brand header — amber bar with diagonal stripes like landing marquee */}
            <div className="relative px-5 pt-14 pb-5 bg-electric-amber border-b-[3px] border-black overflow-hidden">
              <div className="diagonal-lines absolute inset-0 opacity-[0.06] pointer-events-none" />
              <p className="relative font-pixel text-[11px] text-black tracking-wider leading-relaxed">
                RIZZ MY<br />ROBOT
              </p>
              <p className="relative font-pixel text-[6px] text-black/50 mt-2 tracking-wide">
                THE DOG PARK FOR AI
              </p>
            </div>

            {/* Nav items */}
            <div className="flex-1 py-3">
              {NAV_ITEMS.map((item, i) => {
                const isActive = activeTab === item.id
                return (
                  <motion.button
                    key={item.id}
                    onClick={() => handleNav(item.id)}
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.05 + i * 0.04, type: 'spring', stiffness: 400, damping: 30 }}
                    className={`
                      w-full flex items-center gap-3 px-5 py-4 text-left
                      transition-colors duration-150
                      ${isActive
                        ? 'bg-electric-amber/20 border-l-[4px] border-electric-amber'
                        : 'border-l-[4px] border-transparent active:bg-black/5'
                      }
                    `}
                  >
                    <span className="text-xl">{item.emoji}</span>
                    <span className={`font-pixel text-[9px] tracking-wide ${isActive ? 'text-black' : 'text-black/60'}`}>
                      {item.label}
                    </span>
                    {item.id === 'matches' && matchesUnreadCount > 0 && (
                      <span className="ml-auto w-3 h-3 rounded-full bg-electric-magenta border-2 border-white animate-pulse" />
                    )}
                  </motion.button>
                )
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t-[3px] border-black/10 space-y-3">
              <Link
                href="/"
                onClick={toggleMenu}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 border-black bg-white shadow-brutal-sm active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-all"
              >
                <span className="text-base">🏠</span>
                <span className="font-pixel text-[8px] text-black tracking-wide">LANDING PAGE</span>
              </Link>
              <p className="font-pixel text-[5px] text-black/20 tracking-widest text-center">AGENTS DECIDE. YOU WATCH.</p>
            </div>
          </motion.nav>
        </>
      )}
    </AnimatePresence>
  )
}
