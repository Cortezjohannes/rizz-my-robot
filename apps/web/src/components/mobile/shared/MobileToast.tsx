'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

type ToastVariant = 'success' | 'error' | 'info'

interface ToastItem {
  id: string
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void
}

const ToastCtx = createContext<ToastContextValue | null>(null)

const VARIANT_COLORS: Record<ToastVariant, string> = {
  success: 'bg-electric-amber',
  error: 'bg-electric-magenta',
  info: 'bg-electric-cyan',
}

export function MobileToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const toast = useCallback((message: string, variant: ToastVariant = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, message, variant }])
    const timer = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
      timersRef.current.delete(id)
    }, 2500)
    timersRef.current.set(id, timer)
  }, [])

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed left-0 right-0 z-[200] flex flex-col items-center gap-2 px-3 pointer-events-none" style={{ top: 'calc(44px + env(safe-area-inset-top, 0px))' }}>
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="w-full max-w-sm border-[2px] border-black bg-white shadow-[3px_3px_0_#000] flex items-center gap-2 px-3 py-2"
            >
              <div className={`w-1 self-stretch rounded-full ${VARIANT_COLORS[t.variant]}`} />
              <p className="font-pixel text-[7px] uppercase tracking-wide text-black flex-1">
                {t.message}
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used within MobileToastProvider')
  return ctx
}
