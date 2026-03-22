'use client'

import { useEffect, useState } from 'react'

const MOBILE_BREAKPOINT = '(max-width: 639px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT)
    setIsMobile(mql.matches)

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return isMobile
}
