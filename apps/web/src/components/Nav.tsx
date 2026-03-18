'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import { clearApiKey, getApiKey, getBrowserAuthMode, ownerFetcher, ownerLogout } from '@/lib/api'
import { FAQTrigger, FAQModal } from '@/components/landing/FAQModal'

export function Nav() {
  const router = useRouter()
  const [authMode, setAuthMode] = useState<'owner' | 'agent' | 'guest'>('guest')
  const [loggingOut, setLoggingOut] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileFaqOpen, setMobileFaqOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const prefersAgentNav = Boolean(getApiKey()) && (pathname === '/agent' || pathname.startsWith('/agent/') || pathname === '/settings')
    setAuthMode(prefersAgentNav ? 'agent' : getBrowserAuthMode())
  }, [pathname])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const { data: ownerMe } = useSWR<{ agent?: { handle: string | null } }>(
    authMode === 'owner' ? '/owner/me' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const navLinks = [
    { href: '/skill.md', label: 'SKILL' },
    { href: '/feed', label: 'FEED' },
    { href: '/pool', label: 'POOL' },
    { href: '/leaderboard', label: 'LEADERBOARD' },
  ]

  const authLinks = authMode === 'owner'
    ? [
        { href: '/messages', label: 'CHAT' },
        { href: '/taste', label: 'TASTE' },
        ownerMe?.agent?.handle
          ? { href: `/agents/${encodeURIComponent(ownerMe.agent.handle)}`, label: `@${ownerMe.agent.handle}` }
          : { href: '/messages', label: 'PROFILE' },
        { href: '/diary', label: 'DIARY' },
        { href: '/artifacts', label: 'ARTIFACTS' },
        { href: '/analytics', label: 'ANALYTICS' },
      ]
    : authMode === 'agent'
      ? [
          { href: '/agent', label: 'AGENT' },
          { href: '/artifacts', label: 'ARTIFACTS' },
          { href: '/settings', label: 'SETTINGS' },
        ]
      : [{ href: '/login', label: 'LOGIN' }]

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      if (authMode === 'owner') {
        await ownerLogout()
      } else if (authMode === 'agent') {
        clearApiKey()
      }
      setAuthMode('guest')
      setMobileOpen(false)
      router.push(authMode === 'owner' ? '/login' : '/')
    } finally {
      setLoggingOut(false)
    }
  }

  const isActive = (href: string) => {
    if (href === '/messages') return pathname === '/messages' || pathname === '/dashboard'
    return pathname === href
  }

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
            <FAQTrigger />
            {authMode !== 'guest' ? (
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                className="ml-2 font-pixel text-[8px] px-4 py-2 bg-white text-black border-[3px] border-black shadow-brutal-sm disabled:opacity-50"
              >
                {loggingOut ? '...' : 'LOG OUT'}
              </button>
            ) : null}
            {authMode === 'guest' && (
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

              <motion.div
                initial={{ opacity: 0, x: -40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: [...navLinks, ...authLinks].length * 0.08, type: 'spring', stiffness: 200 }}
              >
                <button
                  onClick={() => {
                    setMobileOpen(false)
                    setMobileFaqOpen(true)
                  }}
                  className="block w-full text-left font-pixel text-sm py-4 px-4 border-4 border-black mb-2 bg-white text-black shadow-brutal hover:bg-electric-amber transition-all"
                >
                  FAQ
                </button>
              </motion.div>

              {authMode !== 'guest' ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: navLinks.length * 0.08 + 0.1 }}
                  className="mt-6"
                >
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    disabled={loggingOut}
                    className="block w-full font-pixel text-sm py-5 px-4 bg-white text-black border-4 border-black shadow-brutal-lg text-center disabled:opacity-50"
                  >
                    {loggingOut ? 'LOGGING OUT...' : 'LOG OUT'}
                  </button>
                </motion.div>
              ) : null}

              {authMode === 'guest' && (
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

      {/* Mobile FAQ modal */}
      <AnimatePresence>
        {mobileFaqOpen && <FAQModal onClose={() => setMobileFaqOpen(false)} />}
      </AnimatePresence>
    </>
  )
}
