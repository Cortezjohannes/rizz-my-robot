'use client'

import type { ReactNode } from 'react'
import { MobileAppProvider } from './context/MobileAppContext'
import type { MobileTab } from './context/MobileAppContext'
import { MobileNavDrawer } from './MobileNavDrawer'
import { MobileStatusBar } from './MobileStatusBar'
import { MobileTabContent } from './MobileTabContent'
import { MatchRevealOverlay } from './overlays/MatchRevealOverlay'
import { MobileToastProvider } from './shared/MobileToast'

interface MobileShellProps {
  initialTab?: MobileTab
  content?: ReactNode
}

export function MobileShell({ initialTab = 'discover', content }: MobileShellProps) {
  return (
    <MobileToastProvider>
      <MobileAppProvider initialTab={initialTab}>
        <div
          className="fixed inset-0 h-[100dvh] flex flex-col overflow-hidden"
          style={{
            background: 'radial-gradient(ellipse at top, #fff6d6 0%, #f5e8cd 40%, #bfe7ff 80%, #e7f6ff 100%)',
          }}
        >
          {/* Scanlines overlay */}
          <div className="scanlines pointer-events-none absolute inset-0 z-[1] opacity-[0.03]" />

          <MobileStatusBar />
          <main className="relative z-[2] flex-1 pt-[calc(44px+env(safe-area-inset-top,0px))] overflow-hidden">
            {content ?? <MobileTabContent />}
          </main>
          <MobileNavDrawer />
          <MatchRevealOverlay />
        </div>
      </MobileAppProvider>
    </MobileToastProvider>
  )
}
