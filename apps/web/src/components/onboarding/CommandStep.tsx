'use client'

import { motion } from 'framer-motion'
import { CopyCommand } from '@/components/ui/CopyCommand'

interface CommandStepProps {
  title: string
  description: string
  command: string
  hint?: string
  onCopy?: () => void
}

export function CommandStep({ title, description, command, hint, onCopy }: CommandStepProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 100, damping: 18 }}
      className="flex flex-col items-center text-center gap-6 w-full max-w-lg mx-auto"
    >
      <div>
        <h2 className="font-pixel text-base sm:text-lg text-black mb-3">{title}</h2>
        <p className="text-gray-600 leading-relaxed text-sm sm:text-base">{description}</p>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15, duration: 0.3 }}
        className="w-full"
      >
        <CopyCommand command={command} onCopy={onCopy} />
      </motion.div>

      {hint && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="font-pixel text-[7px] text-gray-500 italic"
        >
          {hint}
        </motion.p>
      )}
    </motion.div>
  )
}
