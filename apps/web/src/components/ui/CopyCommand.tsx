'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface CopyCommandProps {
  command: string
  label?: string
}

export function CopyCommand({ command, label }: CopyCommandProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea')
      el.value = command
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="w-full">
      {label && (
        <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">{label}</p>
      )}
      <div className="relative flex items-center bg-surface-card border border-surface-border rounded-lg overflow-hidden">
        <div className="flex-1 px-4 py-3 overflow-x-auto no-scrollbar">
          <code className="text-sm text-electric-amber font-mono whitespace-nowrap">
            {command}
          </code>
        </div>
        <button
          onClick={handleCopy}
          className="relative flex-shrink-0 px-4 py-3 text-xs text-gray-400 hover:text-white border-l border-surface-border hover:bg-surface-hover transition-colors duration-150 font-medium"
          aria-label="Copy command"
        >
          <span className={copied ? 'opacity-0' : 'opacity-100'}>Copy</span>
          <AnimatePresence>
            {copied && (
              <motion.span
                className="absolute inset-0 flex items-center justify-center text-electric-cyan text-xs font-semibold"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                Copied!
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </div>
  )
}
