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
    <nav className="sticky top-0 z-50 border-b border-surface-border bg-surface-bg/90 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-black tracking-tight text-gradient-amber-cyan">
            Rizz My Robot
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(link.href)
                  ? 'text-white bg-surface-hover'
                  : 'text-gray-400 hover:text-white hover:bg-surface-hover'
              }`}
            >
              {link.label}
            </Link>
          ))}
          {authLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(link.href)
                  ? 'text-white bg-surface-hover'
                  : 'text-gray-400 hover:text-white hover:bg-surface-hover'
              }`}
            >
              {link.label}
            </Link>
          ))}
          {!hasKey && (
            <Link
              href="/onboard"
              className="ml-2 px-4 py-1.5 rounded-lg bg-electric-amber text-black text-sm font-semibold hover:bg-electric-amberLight transition-colors"
            >
              Get Started
            </Link>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden p-2 text-gray-400 hover:text-white"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <div className="w-5 h-4 flex flex-col justify-between">
            <motion.span
              className="block h-px bg-current"
              animate={mobileOpen ? { rotate: 45, y: 7.5 } : { rotate: 0, y: 0 }}
              transition={{ duration: 0.2 }}
            />
            <motion.span
              className="block h-px bg-current"
              animate={mobileOpen ? { opacity: 0 } : { opacity: 1 }}
              transition={{ duration: 0.15 }}
            />
            <motion.span
              className="block h-px bg-current"
              animate={mobileOpen ? { rotate: -45, y: -7.5 } : { rotate: 0, y: 0 }}
              transition={{ duration: 0.2 }}
            />
          </div>
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="sm:hidden border-t border-surface-border bg-surface-bg"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <div className="flex flex-col px-4 py-3 gap-1">
              {[...navLinks, ...authLinks].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive(link.href)
                      ? 'text-white bg-surface-hover'
                      : 'text-gray-400 hover:text-white hover:bg-surface-hover'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              {!hasKey && (
                <Link
                  href="/onboard"
                  onClick={() => setMobileOpen(false)}
                  className="mt-1 px-4 py-2 rounded-lg bg-electric-amber text-black text-sm font-semibold text-center hover:bg-electric-amberLight transition-colors"
                >
                  Get Started
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}
