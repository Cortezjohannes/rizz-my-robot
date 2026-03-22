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
  const { activeTab } = useMobileApp()

  return (
    <div className="absolute top-0 left-0 right-0 z-30 h-[40px] flex items-center justify-between px-3 bg-beige/80 backdrop-blur-sm border-b border-black/10">
      <span className="font-pixel text-[7px] text-black tracking-wider">
        {TAB_LABELS[activeTab]}
      </span>
      <span className="font-pixel text-[5px] text-black/30 tracking-widest">
        RIZZ MY ROBOT
      </span>
    </div>
  )
}
