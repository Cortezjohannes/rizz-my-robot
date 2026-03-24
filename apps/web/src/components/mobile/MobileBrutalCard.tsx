'use client'

import type { ReactNode } from 'react'

interface MobileBrutalCardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
  selected?: boolean
}

export function MobileBrutalCard({
  children,
  className = '',
  onClick,
  selected = false,
}: MobileBrutalCardProps) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      className={`
        rounded-lg border-2 border-black bg-white shadow-brutal-sm
        transition-transform duration-150
        ${selected ? 'ring-2 ring-electric-amber ring-offset-1 bg-[#fff6e5]' : ''}
        ${onClick ? 'active:translate-x-[1px] active:translate-y-[1px] active:shadow-none cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  )
}
