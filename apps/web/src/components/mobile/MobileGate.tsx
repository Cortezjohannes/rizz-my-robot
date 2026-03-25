'use client'

import type { ReactNode } from 'react'
import { useIsMobile } from './hooks/useIsMobile'
import { MobileShell } from './MobileShell'
import type { MobileTab } from './context/MobileAppContext'

interface MobileGateProps {
  initialTab: MobileTab
  children: ReactNode
  mobileContent?: ReactNode
}

export function MobileGate({ initialTab, children, mobileContent }: MobileGateProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <MobileShell initialTab={initialTab} content={mobileContent} />
  }

  return <>{children}</>
}
