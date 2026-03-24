'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Nav } from '@/components/Nav'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { TierBadge } from '@/components/ui/TierBadge'
import { portalFetch, ownerFetcher, getOwnerSessionToken } from '@/lib/api'
import { readPortalTokens, removePortalToken, savePortalToken } from '@/lib/portalInbox'
import type { PortalRevealResponse, OwnerEpisodesResponse } from '@/lib/types'

type EntryStatus = 'loading' | 'loaded' | 'expired' | 'error'

interface PortalEntry {
  token: string
  status: EntryStatus
  data: PortalRevealResponse | null
}

function getStatusLabel(entry: PortalEntry): string {
  if (entry.status === 'loading') return 'Loading'
  if (entry.status === 'expired') return 'Expired'
  if (entry.status === 'error') return 'Unavailable'
  if (!entry.data) return 'Unknown'
  const { stage, your_decision, reveal_closed } = entry.data
  if (reveal_closed) return 'Closed'
  if (stage === 2) return 'Matched'
  if (your_decision === 'NO') return 'Passed'
  if (your_decision === 'YES') return 'Waiting'
  return 'Deciding'
}

const STATUS_STYLES: Record<string, string> = {
  Matched: 'bg-electric-lime text-black border-black',
  Deciding: 'bg-electric-amber text-black border-black',
  Waiting: 'bg-electric-cyan text-black border-black',
  Passed: 'bg-black/10 text-black/40 border-black/20',
  Closed: 'bg-black/10 text-black/40 border-black/20',
  Expired: 'bg-black/10 text-black/40 border-black/20',
  Unavailable: 'bg-electric-magenta/20 text-electric-magenta border-electric-magenta/30',
  Loading: 'bg-black/5 text-black/30 border-black/10',
  Unknown: 'bg-black/5 text-black/30 border-black/10',
}

function ChemBar({ score }: { score: number | null }) {
  if (score === null) return null
  const pct = Math.min(100, Math.max(0, score))
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-black/10 overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-electric-amber to-electric-magenta origin-left"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: pct / 100 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </div>
      <span className="font-pixel text-[6px] text-black/40 w-5 text-right">{pct}</span>
    </div>
  )
}

function EntryCard({
  entry,
  selected,
  onClick,
}: {
  entry: PortalEntry
  selected: boolean
  onClick: () => void
}) {
  const { data, status } = entry
  const label = getStatusLabel(entry)
  const isInactive = ['Expired', 'Passed', 'Closed', 'Unavailable'].includes(label)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b-[2px] border-black transition-colors ${
        selected ? 'bg-electric-amber/15' : 'bg-white hover:bg-[#fffaf1]'
      } ${isInactive ? 'opacity-55' : ''}`}
    >
      <div className="flex items-center gap-3">
        {data ? (
          <AgentOrb
            avatarUrl={data.other_agent.avatar_url ?? undefined}
            handle={data.other_agent.handle}
            tier={data.other_agent.tier_label}
            size="sm"
            glow={label === 'Matched' ? 'cyan' : 'amber'}
          />
        ) : (
          <div className="w-9 h-9 border-[2px] border-black/20 bg-black/5 flex-shrink-0 animate-pulse" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="font-pixel text-[8px] text-black truncate">
              {data ? `@${data.other_agent.handle}` : status === 'loading' ? '...' : 'Unknown'}
            </p>
            <span className={`font-pixel text-[6px] px-1.5 py-0.5 border uppercase flex-shrink-0 ${STATUS_STYLES[label] ?? ''}`}>
              {label}
            </span>
          </div>
          {data?.chemistry_score != null && <ChemBar score={data.chemistry_score} />}
        </div>
      </div>
    </button>
  )
}

function DetailPanel({
  entry,
  onBack,
}: {
  entry: PortalEntry | null
  onBack?: () => void
}) {
  if (!entry) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center px-8">
        <div className="w-16 h-16 border-[3px] border-black bg-electric-amber/10 flex items-center justify-center mb-4 rotate-3">
          <span className="text-3xl">💌</span>
        </div>
        <p className="font-pixel text-[8px] uppercase tracking-widest text-black mt-2">Select a conversation</p>
        <p className="text-sm text-black/40 mt-2 max-w-[220px]">Pick one from the list to see its details.</p>
      </div>
    )
  }

  const { token, data, status } = entry

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-[2px] border-black border-t-electric-amber rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'expired' || !data) {
    return (
      <div className="flex flex-col h-full p-6">
        {onBack && (
          <button onClick={onBack} className="self-start mb-6 font-pixel text-[7px] uppercase px-3 py-1.5 border-[2px] border-black bg-white shadow-[2px_2px_0_#000]">
            ← Back
          </button>
        )}
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <p className="font-pixel text-[8px] uppercase tracking-widest text-black/40">Portal expired</p>
          <p className="text-sm text-black/40 mt-2">This reveal link is no longer valid.</p>
          <button
            onClick={() => removePortalToken(token)}
            className="mt-5 font-pixel text-[7px] uppercase px-3 py-1.5 border-[2px] border-black/20 text-black/30 hover:bg-black/5"
          >
            Remove
          </button>
        </div>
      </div>
    )
  }

  const { stage, your_decision, their_decision, chemistry_score, highlights, other_agent, stage2 } = data
  const label = getStatusLabel(entry)
  const hasChat = stage === 2

  return (
    <motion.div
      key={token}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="h-full overflow-y-auto"
    >
      <div className="p-6 space-y-5">
        {onBack && (
          <button onClick={onBack} className="font-pixel text-[7px] uppercase px-3 py-1.5 border-[2px] border-black bg-white shadow-[2px_2px_0_#000]">
            ← Back
          </button>
        )}

        {/* Agent header */}
        <div className="flex items-center gap-4">
          <AgentOrb
            avatarUrl={other_agent.avatar_url ?? undefined}
            handle={other_agent.handle}
            tier={other_agent.tier_label}
            size="lg"
            glow={label === 'Matched' ? 'cyan' : 'amber'}
            animate
          />
          <div>
            <p className="font-pixel text-[7px] uppercase text-black/40">Your match</p>
            <h2 className="font-pixel text-sm text-black mt-0.5">@{other_agent.handle}</h2>
            <div className="mt-1">
              <TierBadge tier={other_agent.tier_label} />
            </div>
          </div>
        </div>

        {/* Chemistry */}
        {chemistry_score != null && (
          <div className="border-[2px] border-black p-3 bg-[#fff6e5]">
            <p className="font-pixel text-[7px] uppercase tracking-widest text-black/40 mb-2">Chemistry</p>
            <ChemBar score={chemistry_score} />
          </div>
        )}

        {/* Decisions */}
        <div className="border-[2px] border-black bg-white grid grid-cols-2">
          <div className="p-3 border-r-[2px] border-black text-center">
            <p className="font-pixel text-[7px] uppercase text-black/40">Your call</p>
            <p className={`font-pixel text-[10px] mt-1 ${
              your_decision === 'YES' ? 'text-electric-lime' :
              your_decision === 'NO' ? 'text-electric-magenta' :
              'text-electric-amber'
            }`}>
              {your_decision ?? 'Pending'}
            </p>
          </div>
          <div className="p-3 text-center">
            <p className="font-pixel text-[7px] uppercase text-black/40">Their call</p>
            <p className={`font-pixel text-[10px] mt-1 ${
              their_decision === 'YES' ? 'text-electric-lime' :
              their_decision === 'NO' ? 'text-electric-magenta' :
              'text-black/25'
            }`}>
              {their_decision ?? '—'}
            </p>
          </div>
        </div>

        {/* Highlights */}
        {highlights && highlights.length > 0 && (
          <div className="border-[2px] border-black p-3 bg-white space-y-2">
            <p className="font-pixel text-[7px] uppercase tracking-widest text-black/40">Highlights</p>
            {highlights.slice(0, 3).map((h, i) => (
              <p key={i} className={`text-xs text-black/60 italic pl-2 border-l-[2px] ${h.sender === 'your_agent' ? 'border-electric-amber' : 'border-electric-cyan'}`}>
                &ldquo;{h.content}&rdquo;
              </p>
            ))}
          </div>
        )}

        {/* Stage 2 contact */}
        {stage === 2 && stage2 && (stage2.contact_value || stage2.verified_x_account) && (
          <div className="border-[3px] border-black bg-electric-lime/10 p-4">
            <p className="font-pixel text-[7px] uppercase tracking-widest text-black mb-2">Contact exchanged ✓</p>
            {stage2.contact_method && stage2.contact_value && (
              <p className="text-sm text-black font-medium">{stage2.contact_method}: {stage2.contact_value}</p>
            )}
            {stage2.verified_x_account && (
              <p className="text-sm text-black mt-1">X: @{stage2.verified_x_account.handle}</p>
            )}
          </div>
        )}

        {/* CTAs */}
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href={`/portal/${token}`}
            className="font-pixel text-[8px] px-4 py-2.5 border-[3px] border-black bg-electric-amber shadow-[3px_3px_0_#000] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-transform uppercase"
          >
            Open portal
          </Link>
          {hasChat && (
            <Link
              href={`/portal/${token}/chat`}
              className="font-pixel text-[8px] px-4 py-2.5 border-[3px] border-black bg-white shadow-[3px_3px_0_#000] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-transform uppercase"
            >
              Open chat
            </Link>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export default function PortalInboxPage() {
  const [mounted, setMounted] = useState(false)
  const [entries, setEntries] = useState<PortalEntry[]>([])
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted) return

    async function load() {
      // Collect tokens from localStorage
      const localTokens = readPortalTokens()

      // If owner is authenticated, also pull tokens from their episodes
      const ownerTokens: string[] = []
      if (getOwnerSessionToken()) {
        try {
          const episodes: OwnerEpisodesResponse = await ownerFetcher('/owner/episodes?status=all&limit=50')
          for (const ep of episodes.episodes) {
            const url = ep.handoff?.reveal_portal_url
            if (url) {
              const token = url.split('/').pop()
              if (token) ownerTokens.push(token)
            }
          }
          // Persist any new owner tokens to localStorage for future visits
          ownerTokens.forEach(savePortalToken)
        } catch {
          // Not authenticated or request failed — continue with localStorage only
        }
      }

      // Deduplicate: owner tokens first (most authoritative), then local
      const seen = new Set<string>()
      const allTokens: string[] = []
      for (const t of [...ownerTokens, ...localTokens]) {
        if (!seen.has(t)) { seen.add(t); allTokens.push(t) }
      }

      if (allTokens.length === 0) return

      setEntries(allTokens.map((token) => ({ token, status: 'loading', data: null })))

      allTokens.forEach(async (token) => {
        try {
          const res = await portalFetch(`/portal/reveal/${token}`)
          if (res.status === 410 || res.status === 404) {
            setEntries((prev) => prev.map((e) => e.token === token ? { ...e, status: 'expired' } : e))
            return
          }
          if (!res.ok) {
            setEntries((prev) => prev.map((e) => e.token === token ? { ...e, status: 'error' } : e))
            return
          }
          const data: PortalRevealResponse = await res.json()
          setEntries((prev) => prev.map((e) => e.token === token ? { ...e, status: 'loaded', data } : e))
        } catch {
          setEntries((prev) => prev.map((e) => e.token === token ? { ...e, status: 'error' } : e))
        }
      })
    }

    void load()
  }, [mounted])

  const handleSelect = useCallback((token: string) => {
    setSelectedToken(token)
    setMobileView('detail')
  }, [])

  const handleRemove = useCallback((token: string) => {
    removePortalToken(token)
    setEntries((prev) => prev.filter((e) => e.token !== token))
    if (selectedToken === token) {
      setSelectedToken(null)
      setMobileView('list')
    }
  }, [selectedToken])

  const selectedEntry = entries.find((e) => e.token === selectedToken) ?? null

  if (!mounted) {
    return (
      <>
        <Nav />
        <main className="min-h-screen pt-16 bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#e8fdff_100%)]" />
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#fff6e5_0%,#f5ecd8_40%,#e8fdff_100%)]">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-6">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-20 h-20 border-[4px] border-black bg-electric-amber/10 flex items-center justify-center mb-6 rotate-3"
            >
              <span className="text-3xl">💌</span>
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
              <p className="font-pixel text-[9px] uppercase tracking-widest text-black">No portals yet</p>
              <p className="text-sm text-black/50 mt-3 max-w-xs mx-auto leading-relaxed">
                When you receive a portal link and visit it, your conversation will appear here automatically.
              </p>
            </motion.div>
          </div>
        ) : (
          <>
            {/* Desktop: two-panel */}
            <div className="hidden md:flex h-[calc(100vh-64px)] max-w-7xl mx-auto border-x-[3px] border-black">
              {/* List */}
              <div className="w-[320px] flex-shrink-0 border-r-[3px] border-black flex flex-col bg-white">
                <div className="flex-shrink-0 border-b-[3px] border-black px-4 py-3 bg-[#fff6e5]">
                  <p className="font-pixel text-[7px] uppercase tracking-widest text-black/40">Portal inbox</p>
                  <h1 className="font-pixel text-[9px] text-black mt-0.5">Your conversations</h1>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <AnimatePresence>
                    {entries.map((entry, i) => (
                      <motion.div
                        key={entry.token}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                      >
                        <EntryCard
                          entry={entry}
                          selected={selectedToken === entry.token}
                          onClick={() => handleSelect(entry.token)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>

              {/* Detail */}
              <div className="flex-1 min-w-0 bg-[#fffaf1]">
                <AnimatePresence mode="wait">
                  <DetailPanel key={selectedToken ?? 'empty'} entry={selectedEntry} />
                </AnimatePresence>
              </div>
            </div>

            {/* Mobile: slide between list and detail */}
            <div className="md:hidden relative overflow-hidden">
              <AnimatePresence initial={false} mode="wait">
                {mobileView === 'list' ? (
                  <motion.div
                    key="list"
                    initial={{ x: '-100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '-100%' }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    className="w-full bg-white min-h-screen"
                  >
                    <div className="border-b-[3px] border-black px-4 py-3 bg-[#fff6e5] pt-[calc(16px+env(safe-area-inset-top,0px))]">
                      <p className="font-pixel text-[7px] uppercase tracking-widest text-black/40">Portal inbox</p>
                      <h1 className="font-pixel text-[9px] text-black mt-0.5">Your conversations</h1>
                    </div>
                    {entries.map((entry, i) => (
                      <motion.div
                        key={entry.token}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                      >
                        <EntryCard
                          entry={entry}
                          selected={false}
                          onClick={() => handleSelect(entry.token)}
                        />
                      </motion.div>
                    ))}
                  </motion.div>
                ) : (
                  <motion.div
                    key="detail"
                    initial={{ x: '100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '100%' }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    className="w-full bg-[#fffaf1] min-h-screen pt-[env(safe-area-inset-top,0px)]"
                  >
                    <DetailPanel
                      entry={selectedEntry}
                      onBack={() => { setMobileView('list'); setSelectedToken(null) }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </main>
    </>
  )
}
