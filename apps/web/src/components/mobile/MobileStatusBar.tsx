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
    <div className="absolute top-0 left-0 right-0 z-30 h-[44px] flex items-center justify-between px-3 bg-electric-amber border-b-[3px] border-black">
      {/* Hamburger */}
      <button
        onClick={toggleMenu}
        className="w-[40px] h-[40px] flex flex-col items-center justify-center gap-[5px]"
        aria-label="Open menu"
      >
        <span className="block w-[20px] h-[2.5px] bg-black rounded-sm" />
        <span className="block w-[20px] h-[2.5px] bg-black rounded-sm" />
        <span className="block w-[16px] h-[2.5px] bg-black rounded-sm" />
      </button>

      {/* Brand + tab */}
      <div className="flex items-center gap-2">
        <span className="font-pixel text-[8px] text-black tracking-wider">
          RIZZ MY ROBOT
        </span>
        <span className="font-pixel text-[6px] text-black/50">
          / {TAB_LABELS[activeTab]}
        </span>
      </div>

      {/* Decorative corner dot */}
      <div className="w-[40px] flex justify-end">
        <span className="w-2.5 h-2.5 bg-black border border-electric-amber" />
      </div>
    </div>
  )
}
