'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface CopyCommandProps {
  command: string
  label?: string
  onCopy?: () => void
}

export function CopyCommand({ command, label, onCopy }: CopyCommandProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.createElement('textarea')
      el.value = command
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
    onCopy?.()
  }

  return (
    <div className="w-full">
      {label && (
        <p className="font-pixel text-[7px] text-gray-500 mb-2 tracking-wider">{label}</p>
      )}
      <div className="relative flex items-center bg-black border-3 border-black overflow-hidden">
        <div className="flex-1 px-4 py-3 overflow-x-auto no-scrollbar">
          <code className="font-pixel text-[8px] sm:text-[10px] text-electric-amber whitespace-nowrap sm:whitespace-normal break-all sm:break-normal">
            &gt; {command}
          </code>
        </div>
        <button
          onClick={handleCopy}
          className="relative flex-shrink-0 px-4 py-3 font-pixel text-[8px] text-gray-400 hover:text-electric-cyan border-l-3 border-black hover:bg-gray-900 transition-colors"
          aria-label="Copy command"
        >
          <span className={copied ? 'opacity-0' : 'opacity-100'}>COPY</span>
          <AnimatePresence>
            {copied && (
              <motion.span
                className="absolute inset-0 flex items-center justify-center text-electric-lime font-pixel text-[8px]"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.15 }}
              >
                DONE!
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </div>
  )
}
