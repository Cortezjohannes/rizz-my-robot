'use client'

import Link from 'next/link'

export function MobileStatusBar() {
  return (
    <div className="absolute top-0 left-0 right-0 z-30 h-[40px] flex items-center justify-between px-3 bg-beige/80 backdrop-blur-sm border-b border-black/10">
      <Link href="/" className="font-pixel text-[7px] text-black tracking-wider">
        RIZZ MY ROBOT
      </Link>
      <Link
        href="/settings"
        className="w-[36px] h-[36px] flex items-center justify-center"
        aria-label="Settings"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-black/60">
          <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </Link>
    </div>
  )
}
