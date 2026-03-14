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
  rounded = 'rounded-xl',
}: ElectricBorderProps) {
  return (
    <div className={`shimmer-border ${rounded} ${className}`}>
      {children}
    </div>
  )
}
