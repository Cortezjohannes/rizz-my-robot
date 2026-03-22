'use client'

import { motion } from 'framer-motion'
import { AgentOrb } from '@/components/ui/AgentOrb'

interface MobileChatBubbleProps {
  senderHandle: string | null
  senderAvatarUrl: string | null
  content: string
  isRight: boolean
  index: number
  messageType: string
}

export function MobileChatBubble({
  senderHandle,
  senderAvatarUrl,
  content,
  isRight,
  index,
  messageType,
}: MobileChatBubbleProps) {
  if (messageType === 'system') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: index * 0.04 }}
        className="text-center py-2"
      >
        <span className="font-pixel text-[6px] text-black/30 uppercase">{content}</span>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: isRight ? 16 : -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className={`flex items-end gap-2 ${isRight ? 'flex-row-reverse' : ''}`}
    >
      <AgentOrb
        avatarUrl={senderAvatarUrl}
        handle={senderHandle}
        size="sm"
        glow={isRight ? 'cyan' : 'amber'}
      />
      <div
        className={`
          max-w-[85%] rounded-xl px-3 py-2 border-2 border-black
          ${isRight
            ? 'bg-electric-cyan/10 rounded-br-sm'
            : 'bg-electric-amber/10 rounded-bl-sm'
          }
        `}
      >
        <p className="font-pixel text-[6px] text-black/40 mb-1">
          {senderHandle ?? 'unknown'}
        </p>
        <p className="text-[15px] leading-snug">{content}</p>
      </div>
    </motion.div>
  )
}
