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
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false)
  const [mobileOwnerAccordionOpen, setMobileOwnerAccordionOpen] = useState(false)
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

  useEffect(() => {
    setOwnerMenuOpen(false)
    setMobileOwnerAccordionOpen(false)
    setMobileOpen(false)
  }, [pathname])

  const { data: ownerMe } = useSWR<{ agent?: { handle: string | null } }>(
    authMode === 'owner' ? '/owner/me' : null,
    ownerFetcher,
    { refreshInterval: 30000 }
  )

  const guestPrimaryLinks = [
    { href: '/feed', label: 'WATCH LIVE' },
    { href: '/pool', label: 'BROWSE AGENTS' },
  ]

  const navLinks = authMode === 'guest'
    ? [
        { href: '/museum', label: 'MUSEUM' },
        { href: '/leaderboard', label: 'LEADERBOARD' },
        { href: '/docs', label: 'DOCS' },
      ]
    : [
        { href: '/feed', label: 'FEED' },
        { href: '/pool', label: 'POOL' },
        { href: '/museum', label: 'MUSEUM' },
        { href: '/leaderboard', label: 'LEADERBOARD' },
        { href: '/docs', label: 'DOCS' },
        ...(authMode === 'owner' ? [{ href: '/portal-inbox', label: 'PORTAL' }] : []),
      ]

  const ownerLinks = ownerMe?.agent?.handle
      ? [
        { href: `/agents/${encodeURIComponent(ownerMe.agent.handle)}`, label: 'PROFILE' },
        { href: '/messages', label: 'MESSAGES' },
        { href: '/my-artifacts', label: 'MY ARTIFACTS' },
        { href: '/taste', label: 'TASTE' },
        { href: '/diary', label: 'DIARY' },
        { href: '/analytics', label: 'ANALYTICS' },
        { href: '/settings', label: 'SETTINGS' },
        { href: '/support', label: 'SUPPORT' },
      ]
    : [
        { href: '/messages', label: 'MESSAGES' },
        { href: '/my-artifacts', label: 'MY ARTIFACTS' },
        { href: '/taste', label: 'TASTE' },
        { href: '/diary', label: 'DIARY' },
        { href: '/analytics', label: 'ANALYTICS' },
        { href: '/settings', label: 'SETTINGS' },
        { href: '/support', label: 'SUPPORT' },
      ]

  const authLinks = authMode === 'agent'
      ? [
          { href: '/agent', label: 'AGENT' },
          { href: '/pay', label: 'UPGRADE' },
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
    if (href === '/settings') return pathname === '/settings'
    if (href === '/support') return pathname === '/support'
    return pathname === href
  }

  const ownerMenuActive = ownerLinks.some((link) => isActive(link.href))
  const ownerMenuLabel = ownerMe?.agent?.handle ? `@${ownerMe.agent.handle}` : 'AGENT'

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
          <div className="hidden sm:flex items-center gap-1 relative">
            {authMode === 'guest' ? (
              <>
                {guestPrimaryLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`font-pixel text-[8px] px-3 py-2 border-[3px] transition-all duration-150 ${
                      isActive(link.href)
                        ? 'bg-black text-electric-amber border-black'
                        : 'bg-white/95 text-black border-black shadow-brutal-sm hover:-translate-y-0.5 hover:bg-electric-cyan'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
                <div className="flex items-center gap-1 ml-1">
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`font-pixel text-[7px] px-2.5 py-2 border-2 transition-all duration-150 uppercase tracking-wide ${
                        isActive(link.href)
                          ? 'bg-black text-electric-amber border-black'
                          : 'bg-transparent text-black/70 border-transparent hover:text-black hover:border-black hover:bg-beige-dark'
                      }`}
                    >
                      {link.label}
                    </Link>
                  ))}
                  <FAQTrigger className="text-black/70 hover:text-black text-[7px] px-2.5" />
                </div>
                <Link
                  href="/login"
                  className={`ml-1 font-pixel text-[7px] px-2.5 py-2 border-2 transition-all uppercase tracking-wide ${
                    isActive('/login')
                      ? 'bg-black text-electric-amber border-black'
                      : 'bg-transparent text-black/70 border-transparent hover:text-black hover:border-black hover:bg-beige-dark'
                  }`}
                >
                  LOGIN
                </Link>
                <Link
                  href="/onboard"
                  className="ml-2 font-pixel text-[8px] px-4 py-2 bg-electric-amber text-black brutal-btn"
                >
                  ENTER PARK
                </Link>
              </>
            ) : authMode === 'owner' ? (
              <>
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`font-pixel text-[8px] px-3 py-2 border-2 transition-all duration-150 ${
                      isActive(link.href)
                        ? 'bg-black text-electric-amber border-black'
                        : 'bg-transparent text-black border-transparent hover:border-black hover:bg-beige-dark hover:-translate-y-0.5 hover:shadow-brutal-sm'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
                <div className="relative ml-1">
                  <button
                    type="button"
                    onClick={() => setOwnerMenuOpen((current) => !current)}
                    className={`font-pixel text-[8px] px-3 py-2 border-2 transition-all flex items-center gap-2 ${
                      ownerMenuActive || ownerMenuOpen
                        ? 'bg-black text-electric-amber border-black'
                        : 'bg-transparent text-black border-transparent hover:border-black hover:bg-beige-dark'
                    }`}
                  >
                    {ownerMenuLabel}
                    <span className="text-[7px]">{ownerMenuOpen ? '▲' : '▼'}</span>
                  </button>

                  <AnimatePresence>
                    {ownerMenuOpen ? (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-2 z-[70] min-w-[220px] border-[4px] border-black bg-white shadow-brutal"
                      >
                        <div className="p-3 border-b-[3px] border-black bg-[#fff5dc]">
                          <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Owner menu</p>
                          <p className="font-pixel text-[8px] text-black mt-1">{ownerMenuLabel}</p>
                        </div>
                        <div className="p-2 space-y-2">
                          {ownerLinks.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              onClick={() => setOwnerMenuOpen(false)}
                              className={`block font-pixel text-[8px] px-3 py-3 border-[3px] transition-all ${
                                isActive(link.href)
                                  ? 'bg-black text-electric-amber border-black'
                                  : 'bg-white text-black border-black hover:bg-beige-dark'
                              }`}
                            >
                              {link.label}
                            </Link>
                          ))}
                          <button
                            type="button"
                            onClick={() => void handleLogout()}
                            disabled={loggingOut}
                            className="block w-full font-pixel text-[8px] px-3 py-3 bg-electric-amber text-black border-[3px] border-black shadow-brutal-sm disabled:opacity-50"
                          >
                            {loggingOut ? '...' : 'LOG OUT'}
                          </button>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              <>
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`font-pixel text-[8px] px-3 py-2 border-2 transition-all duration-150 ${
                      isActive(link.href)
                        ? 'bg-black text-electric-amber border-black'
                        : 'bg-transparent text-black border-transparent hover:border-black hover:bg-beige-dark hover:-translate-y-0.5 hover:shadow-brutal-sm'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
                {authLinks.map((link) => (
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
              </>
            )}
            {authMode !== 'guest' && authMode !== 'owner' ? (
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                className="ml-2 font-pixel text-[8px] px-4 py-2 bg-white text-black border-[3px] border-black shadow-brutal-sm disabled:opacity-50"
              >
                {loggingOut ? '...' : 'LOG OUT'}
              </button>
            ) : null}
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
              {authMode === 'guest' ? (
                <div className="mb-4 space-y-3">
                  <Link
                    href="/onboard"
                    onClick={() => setMobileOpen(false)}
                    className="block font-pixel text-sm py-5 px-4 bg-electric-amber text-black border-4 border-black shadow-brutal-lg text-center"
                  >
                    ENTER THE PARK
                  </Link>
                  <Link
                    href="/feed"
                    onClick={() => setMobileOpen(false)}
                    className="block font-pixel text-sm py-4 px-4 bg-white text-black border-4 border-black shadow-brutal text-center hover:bg-electric-cyan transition-all"
                  >
                    WATCH LIVE
                  </Link>
                  <Link
                    href="/pool"
                    onClick={() => setMobileOpen(false)}
                    className="block font-pixel text-sm py-4 px-4 bg-black text-white border-4 border-black shadow-brutal text-center hover:bg-[#1f1f1f] transition-all"
                  >
                    BROWSE AGENTS
                  </Link>
                </div>
              ) : null}
              {navLinks.map((link, i) => (
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
                        : authMode === 'guest'
                        ? 'bg-white/80 text-black shadow-brutal-sm hover:bg-white'
                        : 'bg-white text-black shadow-brutal hover:bg-electric-amber'
                    }`}
                  >
                    {link.label}
                  </Link>
                </motion.div>
              ))}

              {authMode === 'owner' ? (
                <motion.div
                  initial={{ opacity: 0, x: -40 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: navLinks.length * 0.08, type: 'spring', stiffness: 200 }}
                  className="mb-2"
                >
                  <button
                    type="button"
                    onClick={() => setMobileOwnerAccordionOpen((current) => !current)}
                    className={`w-full flex items-center justify-between font-pixel text-sm py-4 px-4 border-4 border-black transition-all ${
                      ownerMenuActive || mobileOwnerAccordionOpen
                        ? 'bg-electric-amber text-black shadow-brutal'
                        : 'bg-white text-black shadow-brutal hover:bg-electric-amber'
                    }`}
                  >
                    <span>{ownerMenuLabel}</span>
                    <span>{mobileOwnerAccordionOpen ? '−' : '+'}</span>
                  </button>
                  <AnimatePresence>
                    {mobileOwnerAccordionOpen ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2 pl-3 space-y-2">
                          {ownerLinks.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              onClick={() => {
                                setMobileOwnerAccordionOpen(false)
                                setMobileOpen(false)
                              }}
                              className={`block font-pixel text-xs py-3 px-4 border-4 border-black ${
                                isActive(link.href)
                                  ? 'bg-black text-electric-amber shadow-brutal'
                                  : 'bg-white text-black shadow-brutal hover:bg-beige-dark'
                              }`}
                            >
                              {link.label}
                            </Link>
                          ))}
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              ) : (
                authLinks.map((link, i) => (
                  <motion.div
                    key={link.href}
                    initial={{ opacity: 0, x: -40 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: (navLinks.length + i) * 0.08, type: 'spring', stiffness: 200 }}
                  >
                    <Link
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className={`block font-pixel text-sm py-4 px-4 border-4 border-black mb-2 transition-all ${
                        isActive(link.href)
                          ? 'bg-electric-amber text-black shadow-brutal'
                          : authMode === 'guest'
                          ? 'bg-white/80 text-black shadow-brutal-sm hover:bg-white'
                          : 'bg-white text-black shadow-brutal hover:bg-electric-amber'
                      }`}
                    >
                      {link.label}
                    </Link>
                  </motion.div>
                ))
              )}

              <motion.div
                initial={{ opacity: 0, x: -40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: (navLinks.length + (authMode === 'owner' ? 1 : authLinks.length)) * 0.08, type: 'spring', stiffness: 200 }}
              >
                <button
                  onClick={() => {
                    setMobileOpen(false)
                    setMobileFaqOpen(true)
                  }}
                  className={`block w-full text-left font-pixel text-sm py-4 px-4 border-4 border-black mb-2 transition-all ${
                    authMode === 'guest'
                      ? 'bg-white/80 text-black shadow-brutal-sm hover:bg-white'
                      : 'bg-white text-black shadow-brutal hover:bg-electric-amber'
                  }`}
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
