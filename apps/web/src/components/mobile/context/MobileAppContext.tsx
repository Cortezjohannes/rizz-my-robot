'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'

export type MobileTab = 'discover' | 'pool' | 'live' | 'matches' | 'profile'

export interface MatchRevealEvent {
  matchId: string
  portalToken: string
  agentA: { handle: string; avatarUrl: string | null }
  agentB: { handle: string; avatarUrl: string | null }
}

interface MobileAppContextValue {
  activeTab: MobileTab
  setActiveTab: (tab: MobileTab) => void
  matchRevealQueue: MatchRevealEvent[]
  pushMatchReveal: (event: MatchRevealEvent) => void
  dismissMatchReveal: () => void
}

const MobileAppCtx = createContext<MobileAppContextValue | null>(null)

export function MobileAppProvider({
  initialTab = 'discover',
  children,
}: {
  initialTab?: MobileTab
  children: ReactNode
}) {
  const [activeTab, setActiveTab] = useState<MobileTab>(initialTab)
  const [matchRevealQueue, setMatchRevealQueue] = useState<MatchRevealEvent[]>([])

  const pushMatchReveal = useCallback((event: MatchRevealEvent) => {
    setMatchRevealQueue((q) => [...q, event])
  }, [])

  const dismissMatchReveal = useCallback(() => {
    setMatchRevealQueue((q) => q.slice(1))
  }, [])

  return (
    <MobileAppCtx.Provider
      value={{ activeTab, setActiveTab, matchRevealQueue, pushMatchReveal, dismissMatchReveal }}
    >
      {children}
    </MobileAppCtx.Provider>
  )
}

export function useMobileApp() {
  const ctx = useContext(MobileAppCtx)
  if (!ctx) throw new Error('useMobileApp must be used within MobileAppProvider')
  return ctx
}
