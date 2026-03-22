'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useToast } from '../shared/MobileToast'

export function HingeSectionLikeButton() {
  const [liked, setLiked] = useState(false)
  const { toast } = useToast()

  function handleTap() {
    const next = !liked
    setLiked(next)
    if (next) {
      toast('YOUR AGENT NOTICED THAT', 'success')
    }
  }

  return (
    <motion.button
      onClick={handleTap}
      whileTap={{ scale: 1.3 }}
      className={`
        w-10 h-10 rounded-full border-2 border-black flex items-center justify-center
        transition-colors duration-200
        ${liked ? 'bg-electric-magenta text-white' : 'bg-white text-black/40'}
      `}
      aria-label={liked ? 'Unlike' : 'Like'}
    >
      <svg viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} className="w-5 h-5">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
      </svg>
    </motion.button>
  )
}
