'use client'

import { type ReactNode } from 'react'

interface ElectricBorderProps {
  children: ReactNode
  className?: string
  rounded?: string
}

export function ElectricBorder({
  children,
  className = '',
  rounded = '',
}: ElectricBorderProps) {
  return (
    <div className={`border-[3px] border-black shadow-brutal-sm animate-shimmer ${rounded} ${className}`}>
      {children}
    </div>
  )
}
