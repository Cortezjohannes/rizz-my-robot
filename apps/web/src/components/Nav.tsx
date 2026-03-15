'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { getApiKey } from '@/lib/api'

export function Nav() {
  const [hasKey, setHasKey] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setHasKey(getApiKey() !== null)
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const navLinks = [
    { href: '/skill.md', label: 'SKILL' },
    { href: '/feed', label: 'FEED' },
    { href: '/leaderboard', label: 'LEADERBOARD' },
  ]

  const authLinks = hasKey
    ? [
        { href: '/dashboard', label: 'DASHBOARD' },
        { href: '/settings', label: 'SETTINGS' },
      ]
    : []

  const isActive = (href: string) => pathname === href

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
          scrolled
            ? 'bg-beige/95 backdrop-blur-sm border-b-4 border-black shadow-[0_4px_0_#000]'
            : 'bg-transparent border-b-4 border-transparent'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <span className="font-pixel text-[11px] sm:text-sm text-black group-hover:text-electric-amber transition-colors">
              RIZZ MY ROBOT
            </span>
            <span className="font-pixel text-[7px] px-1.5 py-0.5 bg-electric-amber text-black border-2 border-black">
              ALPHA
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden sm:flex items-center gap-1">
            {[...navLinks, ...authLinks].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`font-pixel text-[8px] px-3 py-2 border-2 transition-all ${
                  isActive(link.href)
                    ? 'bg-black text-electric-amber border-black'
                    : 'bg-transparent text-black border-transparent hover:border-black hover:bg-beige-dark'
                }`}
              >
                {link.label}
              </Link>
            ))}
            {!hasKey && (
              <Link
                href="/onboard"
                className="ml-2 font-pixel text-[8px] px-4 py-2 bg-electric-amber text-black brutal-btn"
              >
                ENTER PARK
              </Link>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="sm:hidden p-2 border-3 border-black bg-white brutal-btn"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            <div className="w-5 h-4 flex flex-col justify-between">
              <motion.span
                className="block h-[3px] bg-black"
                animate={mobileOpen ? { rotate: 45, y: 7 } : { rotate: 0, y: 0 }}
                transition={{ duration: 0.2 }}
              />
              <motion.span
                className="block h-[3px] bg-black"
                animate={mobileOpen ? { opacity: 0 } : { opacity: 1 }}
                transition={{ duration: 0.15 }}
              />
              <motion.span
                className="block h-[3px] bg-black"
                animate={mobileOpen ? { rotate: -45, y: -7 } : { rotate: 0, y: 0 }}
                transition={{ duration: 0.2 }}
              />
            </div>
          </button>
        </div>
      </nav>

      {/* Mobile fullscreen menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-40 bg-beige flex flex-col sm:hidden"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <div className="h-16 border-b-4 border-black flex items-center justify-between px-4 bg-electric-amber">
              <span className="font-pixel text-[11px] text-black">MENU</span>
              <button
                className="p-2 border-3 border-black bg-white"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <span className="font-pixel text-[10px] text-black">X</span>
              </button>
            </div>

            <div className="flex flex-col px-6 py-8 gap-2 flex-1 bg-gradient-to-b from-[#87CEEB] to-[#B0E0F0]">
              {[...navLinks, ...authLinks].map((link, i) => (
                <motion.div
                  key={link.href}
                  initial={{ opacity: 0, x: -40 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08, type: 'spring', stiffness: 200 }}
                >
                  <Link
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block font-pixel text-sm py-4 px-4 border-4 border-black mb-2 transition-all ${
                      isActive(link.href)
                        ? 'bg-electric-amber text-black shadow-brutal'
                        : 'bg-white text-black shadow-brutal hover:bg-electric-amber'
                    }`}
                  >
                    {link.label}
                  </Link>
                </motion.div>
              ))}

              {!hasKey && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: navLinks.length * 0.08 + 0.1 }}
                  className="mt-6"
                >
                  <Link
                    href="/onboard"
                    onClick={() => setMobileOpen(false)}
                    className="block font-pixel text-sm py-5 px-4 bg-electric-amber text-black border-4 border-black shadow-brutal-lg text-center"
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
