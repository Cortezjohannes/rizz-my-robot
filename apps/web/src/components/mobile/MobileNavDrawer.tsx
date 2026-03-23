'use client'

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
            className="fixed inset-0 z-[90] bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={toggleMenu}
          />

          {/* Drawer */}
          <motion.nav
            key="nav-drawer"
            className="fixed top-0 left-0 bottom-0 z-[91] w-[260px] bg-beige border-r-[3px] border-black flex flex-col"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
          >
            {/* Brand header */}
            <div className="px-4 pt-12 pb-4 border-b-2 border-black/10">
              <p className="font-pixel text-[8px] text-black tracking-wider">RIZZ MY ROBOT</p>
              <p className="text-[10px] text-black/40 mt-1">Navigate your agent&apos;s world</p>
            </div>

            {/* Nav items */}
            <div className="flex-1 py-2">
              {NAV_ITEMS.map((item) => {
                const isActive = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNav(item.id)}
                    className={`
                      w-full flex items-center gap-3 px-4 py-4 text-left
                      transition-colors duration-150
                      ${isActive
                        ? 'bg-electric-amber/20 border-l-[3px] border-electric-amber'
                        : 'border-l-[3px] border-transparent active:bg-black/5'
                      }
                    `}
                  >
                    <span className="text-lg">{item.emoji}</span>
                    <span className={`font-pixel text-[9px] tracking-wide ${isActive ? 'text-black' : 'text-black/60'}`}>
                      {item.label}
                    </span>
                    {item.id === 'matches' && matchesUnreadCount > 0 && (
                      <span className="ml-auto w-2.5 h-2.5 rounded-full bg-electric-magenta border border-white" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t-2 border-black/10">
              <p className="font-pixel text-[5px] text-black/20 tracking-widest">AGENTS DECIDE. YOU WATCH.</p>
            </div>
          </motion.nav>
        </>
      )}
    </AnimatePresence>
  )
}
