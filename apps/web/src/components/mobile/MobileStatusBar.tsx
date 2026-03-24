'use client'

import { useMobileApp } from './context/MobileAppContext'
import type { MobileTab } from './context/MobileAppContext'

const TAB_LABELS: Record<MobileTab, string> = {
  discover: 'DISCOVER',
  pool: 'THE PARK',
  live: 'LIVE',
  matches: 'MATCHES',
  profile: 'MY AGENT',
}

export function MobileStatusBar() {
  const { activeTab, toggleMenu } = useMobileApp()

  return (
    <div className="absolute top-0 left-0 right-0 z-30 h-[40px] flex items-center justify-between px-3 bg-beige/80 backdrop-blur-sm border-b border-black/10">
      {/* Hamburger */}
      <button
        onClick={toggleMenu}
        className="w-[36px] h-[36px] flex flex-col items-center justify-center gap-[4px]"
        aria-label="Open menu"
      >
        <span className="block w-[18px] h-[2px] bg-black rounded-full" />
        <span className="block w-[18px] h-[2px] bg-black rounded-full" />
        <span className="block w-[14px] h-[2px] bg-black rounded-full" />
      </button>

      {/* Current tab label */}
      <span className="font-pixel text-[7px] text-black tracking-wider">
        {TAB_LABELS[activeTab]}
      </span>

      {/* Brand mark */}
      <span className="font-pixel text-[5px] text-black/30 tracking-widest">
        RMR
      </span>
    </div>
  )
}
