'use client'

import { motion } from 'framer-motion'

interface MobileProfileShortcutProps {
  icon: string
  label: string
  description: string
  badge?: string
  accentColor?: string
  onClick: () => void
}

export function MobileProfileShortcut({
  icon,
  label,
  description,
  badge,
  accentColor = 'border-l-electric-amber',
  onClick,
}: MobileProfileShortcutProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 border-b border-black/10 bg-white border-l-[3px] ${accentColor} text-left`}
    >
      <span className="text-2xl flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-pixel text-[8px] text-black uppercase">{label}</p>
        <p className="text-xs text-black/40 mt-0.5">{description}</p>
      </div>
      {badge && (
        <span className="font-pixel text-[6px] bg-electric-amber/20 border border-electric-amber/40 text-black px-1.5 py-0.5 flex-shrink-0">
          {badge}
        </span>
      )}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4 text-black/30 flex-shrink-0">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </motion.button>
  )
}
