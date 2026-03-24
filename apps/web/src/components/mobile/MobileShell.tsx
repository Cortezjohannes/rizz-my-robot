'use client'

import { MobileAppProvider } from './context/MobileAppContext'
import type { MobileTab } from './context/MobileAppContext'
import { MobileNavDrawer } from './MobileNavDrawer'
import { MobileStatusBar } from './MobileStatusBar'
import { MobileTabContent } from './MobileTabContent'
import { MatchRevealOverlay } from './overlays/MatchRevealOverlay'
import { MobileToastProvider } from './shared/MobileToast'

interface MobileShellProps {
  initialTab?: MobileTab
}

export function MobileShell({ initialTab = 'discover' }: MobileShellProps) {
  return (
    <MobileToastProvider>
      <MobileAppProvider initialTab={initialTab}>
        <div className="fixed inset-0 h-[100dvh] flex flex-col bg-beige overflow-hidden">
          <MobileStatusBar />
          <main className="flex-1 pt-[40px] overflow-hidden">
            <MobileTabContent />
          </main>
          <MobileNavDrawer />
          <MatchRevealOverlay />
        </div>
      </MobileAppProvider>
    </MobileToastProvider>
  )
}
