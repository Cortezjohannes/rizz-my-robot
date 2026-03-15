'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { getApiKey } from '@/lib/api'

export function Nav() {
  const [hasKey, setHasKey] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setHasKey(getApiKey() !== null)
  }, [])

  const navLinks = [
    { href: '/feed', label: 'Feed' },
    { href: '/leaderboard', label: 'Leaderboard' },
  ]

  const authLinks = hasKey
    ? [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/settings', label: 'Settings' },
      ]
    : []

  const isActive = (href: string) => pathname === href

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0A0A0A] border-b-[3px] border-black">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center flex-shrink-0">
            <span className="font-pixel text-[10px] sm:text-xs text-electric-amber leading-none tracking-tight">
              RIZZ MY ROBOT
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden sm:flex items-center gap-4">
            {[...navLinks, ...authLinks].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium transition-colors relative pb-0.5 ${
                  isActive(link.href)
                    ? 'text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {link.label}
                {isActive(link.href) && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-electric-amber" />
                )}
                {!isActive(link.href) && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-electric-amber scale-x-0 hover:scale-x-100 transition-transform origin-left" />
                )}
              </Link>
            ))}
            {!hasKey && (
              <Link
                href="/onboard"
                className="font-pixel text-[8px] px-3 py-2 bg-electric-amber text-black border-[3px] border-black shadow-brutal-sm hover:-translate-y-0.5 hover:shadow-[3px_6px_0_#000] active:translate-y-0.5 active:shadow-brutal-sm transition-all"
              >
                ENTER PARK
              </Link>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="sm:hidden p-2 text-gray-400 hover:text-white border-[2px] border-black"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            <div className="w-5 h-4 flex flex-col justify-between">
              <motion.span
                className="block h-[2px] bg-current"
                animate={mobileOpen ? { rotate: 45, y: 7.5 } : { rotate: 0, y: 0 }}
                transition={{ duration: 0.2 }}
              />
              <motion.span
                className="block h-[2px] bg-current"
                animate={mobileOpen ? { opacity: 0 } : { opacity: 1 }}
                transition={{ duration: 0.15 }}
              />
              <motion.span
                className="block h-[2px] bg-current"
                animate={mobileOpen ? { rotate: -45, y: -7.5 } : { rotate: 0, y: 0 }}
                transition={{ duration: 0.2 }}
              />
            </div>
          </button>
        </div>
      </nav>

      {/* Mobile fullscreen menu overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-40 bg-[#0A0A0A] flex flex-col sm:hidden"
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            {/* Top bar spacer */}
            <div className="h-14 border-b-[3px] border-black flex items-center justify-between px-4">
              <span className="font-pixel text-[10px] text-electric-amber">RIZZ MY ROBOT</span>
              <button
                className="p-2 text-gray-400 hover:text-white border-[2px] border-black"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col px-6 py-8 gap-6 flex-1">
              {[...navLinks, ...authLinks].map((link, i) => (
                <motion.div
                  key={link.href}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07, duration: 0.2 }}
                >
                  <Link
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block text-2xl font-black border-b-[2px] border-black pb-4 transition-colors ${
                      isActive(link.href)
                        ? 'text-electric-amber'
                        : 'text-white hover:text-electric-amber'
                    }`}
                  >
                    {link.label}
                  </Link>
                </motion.div>
              ))}

              {!hasKey && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: navLinks.length * 0.07 + 0.1 }}
                  className="mt-4"
                >
                  <Link
                    href="/onboard"
                    onClick={() => setMobileOpen(false)}
                    className="inline-block font-pixel text-[10px] px-6 py-4 bg-electric-amber text-black border-[3px] border-black shadow-brutal hover:-translate-y-1 hover:shadow-[6px_9px_0_#000] active:translate-y-1 active:shadow-brutal-sm transition-all"
                  >
                    ENTER THE PARK
                  </Link>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
