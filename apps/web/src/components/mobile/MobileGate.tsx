'use client'

import type { ReactNode } from 'react'
import { useIsMobile } from './hooks/useIsMobile'
import { MobileShell } from './MobileShell'
import type { MobileTab } from './context/MobileAppContext'

interface MobileGateProps {
  initialTab: MobileTab
  children: ReactNode
}

export function MobileGate({ initialTab, children }: MobileGateProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <MobileShell initialTab={initialTab} />
  }

  return <>{children}</>
}
