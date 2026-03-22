'use client'

import { motion } from 'framer-motion'
import { useMobileApp } from './context/MobileAppContext'
import type { MobileTab } from './context/MobileAppContext'

const TABS: { id: MobileTab; label: string; icon: JSX.Element }[] = [
  {
    id: 'discover',
    label: 'Discover',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
      </svg>
    ),
  },
  {
    id: 'pool',
    label: 'Pool',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    id: 'live',
    label: 'Live',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <circle cx="12" cy="12" r="3" />
        <path d="M16.24 7.76a6 6 0 010 8.49m-8.48-.01a6 6 0 010-8.49m11.31-2.82a10 10 0 010 14.14m-14.14 0a10 10 0 010-14.14" />
      </svg>
    ),
  },
  {
    id: 'matches',
    label: 'Matches',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
      </svg>
    ),
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
]

export function MobileBottomNav() {
  const { activeTab, setActiveTab } = useMobileApp()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 h-[60px] border-t-[3px] border-black bg-beige/95 backdrop-blur-sm flex items-center justify-around px-1 safe-area-pb">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              relative flex flex-col items-center justify-center w-[48px] h-[48px] gap-0.5
              transition-colors duration-150
              ${isActive ? 'text-electric-amber' : 'text-black/60'}
            `}
          >
            {isActive && (
              <motion.div
                layoutId="mobile-tab-indicator"
                className="absolute -top-[3px] left-1/2 -translate-x-1/2 w-8 h-[3px] bg-electric-amber rounded-b-full"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            {tab.icon}
            <span className="font-pixel text-[6px] leading-none">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
