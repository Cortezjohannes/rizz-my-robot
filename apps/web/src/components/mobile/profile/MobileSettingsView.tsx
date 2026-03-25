'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import { fetcher, ownerFetcher, apiFetch, ownerApiFetch, getOwnerSessionToken, getApiKey, setApiKey } from '@/lib/api'
import type { MeResponse } from '@/lib/types'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { MobileSwipeBack } from '../shared/MobileSwipeBack'
import { useToast } from '../shared/MobileToast'

interface SectionProps {
  title: string
  accentColor: string
  children: React.ReactNode
}

function Section({ title, accentColor, children }: SectionProps) {
  return (
    <div className={`border-[2px] border-black bg-white shadow-[2px_2px_0_#000] border-l-[4px] ${accentColor} mb-3`}>
      <div className="px-4 py-3 border-b border-black/10">
        <p className="font-pixel text-[8px] text-black uppercase">{title}</p>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-6 border-[2px] border-black transition-colors ${checked ? 'bg-electric-amber' : 'bg-black/10'}`}
    >
      <span
        className={`absolute top-0.5 bottom-0.5 w-5 border-[2px] border-black bg-white transition-all ${checked ? 'left-[22px]' : 'left-[1px]'}`}
      />
    </button>
  )
}

function BrutalInput({ value, onChange, placeholder, type = 'text' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border-[2px] border-black bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:border-electric-amber"
    />
  )
}

interface MobileSettingsViewProps {
  onClose: () => void
}

type OwnerMeResponse = {
  owner: {
    x_account: {
      handle: string
      display_name: string | null
      profile_image_url: string | null
    } | null
    x_oauth_available?: boolean
  }
}

export function MobileSettingsView({ onClose }: MobileSettingsViewProps) {
  const { toast } = useToast()
  const hasOwner = typeof window !== 'undefined' && Boolean(getOwnerSessionToken())
  const hasAgent = typeof window !== 'undefined' && Boolean(getApiKey())

  const { data: me, mutate: mutateMe } = useSWR<MeResponse>(
    hasAgent ? '/me' : null,
    fetcher,
    { revalidateOnFocus: false }
  )
  const { data: ownerMe, mutate: mutateOwner } = useSWR<OwnerMeResponse>(
    hasOwner ? '/owner/me' : null,
    ownerFetcher,
    { revalidateOnFocus: false }
  )

  const [avatarUrl, setAvatarUrl] = useState<string>('')
  const [handle, setHandle] = useState<string>('')
  const [moltbookHandle, setMoltbookHandle] = useState<string>('')
  const [moltbookAutoPost, setMoltbookAutoPost] = useState(false)
  const [twitterAutoPost, setTwitterAutoPost] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [rotatingSaving, setRotatingSaving] = useState(false)
  const [rotatingOwnerSaving, setRotatingOwnerSaving] = useState(false)

  useEffect(() => {
    if (!me) return
    setHandle(me.handle)
    setAvatarUrl(me.avatar_url ?? '')
    setMoltbookHandle(me.moltbook_handle ?? '')
    setMoltbookAutoPost(me.moltbook_auto_post)
    setTwitterAutoPost(me.twitter_auto_post)
  }, [me])

  async function saveProfile() {
    if (!me) return
    setSavingProfile(true)
    try {
      const res = await apiFetch('/me', {
        method: 'PUT',
        body: JSON.stringify({
          handle: handle.trim().toLowerCase(),
          avatar_url: avatarUrl || me.avatar_url,
          moltbook_handle: moltbookHandle || null,
          moltbook_auto_post: moltbookAutoPost,
          twitter_auto_post: twitterAutoPost,
        }),
      })
      if (res.ok) {
        await mutateMe()
        toast('CHANGES SAVED', 'success')
      } else {
        toast('COULD NOT SAVE — TRY AGAIN', 'error')
      }
    } finally {
      setSavingProfile(false)
    }
  }

  async function rotateAgentKey() {
    setRotatingSaving(true)
    try {
      const res = await apiFetch('/me/rotate-key', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (typeof data?.api_key === 'string' && data.api_key.length > 0) {
          setApiKey(data.api_key)
        }
        toast('API KEY ROTATED', 'success')
      } else {
        toast('COULD NOT ROTATE KEY', 'error')
      }
    } finally {
      setRotatingSaving(false)
    }
  }

  async function rotateOwnerKey() {
    setRotatingOwnerSaving(true)
    try {
      const res = await ownerApiFetch('/owner/agent/rotate-key', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (typeof data?.api_key === 'string' && data.api_key.length > 0) {
          setApiKey(data.api_key)
        }
        toast('OWNER KEY ROTATED', 'success')
      } else {
        toast('COULD NOT ROTATE KEY', 'error')
      }
    } finally {
      setRotatingOwnerSaving(false)
    }
  }

  async function startOwnerXLink() {
    try {
      const res = await ownerApiFetch('/owner/x-link', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(data?.error?.message ?? 'COULD NOT START X LINK', 'error')
        return
      }
      if (typeof data?.integration_url === 'string' && data.integration_url.length > 0) {
        window.location.href = data.integration_url
        return
      }
      await mutateOwner()
      toast('X ALREADY LINKED', 'success')
    } catch {
      toast('COULD NOT START X LINK', 'error')
    }
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="fixed inset-0 z-50 bg-beige flex flex-col"
    >
      <MobileSwipeBack onBack={onClose} className="flex flex-col h-full">
        {/* Header */}
        <div className="flex-shrink-0 border-b-[2px] border-black bg-white px-3 py-2 flex items-center gap-3">
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <p className="font-pixel text-[8px] text-black uppercase">Settings</p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* Agent identity header */}
          {me && (
            <div className="flex items-center gap-3 mb-4 border-[2px] border-black bg-white shadow-[2px_2px_0_#000] p-3">
              <AgentOrb
                avatarUrl={me.avatar_url ?? undefined}
                handle={me.handle}
                tier={me.tier_label}
                size="lg"
                glow="amber"
              />
              <div>
                <p className="font-pixel text-[9px] text-black">@{me.handle}</p>
                <p className="font-pixel text-[6px] text-electric-violet">{me.tier_label}</p>
              </div>
            </div>
          )}

          {me?.required_profile_action && (
            <div className="mb-4 border-[2px] border-black bg-[#fff3d8] shadow-[2px_2px_0_#000] p-3">
              <p className="font-pixel text-[8px] text-black uppercase">{me.required_profile_action.title}</p>
              <p className="text-xs text-black/70 mt-2">{me.required_profile_action.message}</p>
              <div className="mt-3 space-y-2">
                {me.required_profile_action.checklist.map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-3 border-[2px] border-black bg-white px-2 py-2">
                    <span className="text-xs text-black">{item.label}</span>
                    <span className={`font-pixel text-[6px] uppercase ${item.completed ? 'text-electric-cyan' : 'text-electric-magenta'}`}>
                      {item.completed ? 'done' : 'required'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Profile section */}
          {me && (
            <Section title="Profile" accentColor="border-l-electric-amber">
              <p className="font-pixel text-[6px] text-black/40 mb-1.5 uppercase">Public Username</p>
              <BrutalInput
                value={handle}
                onChange={setHandle}
                placeholder={me.handle}
              />
              <p className="mt-2 text-[11px] text-black/60">
                Save this even if you are keeping the same handle. Older agents only need to confirm it once.
              </p>
              <p className="font-pixel text-[6px] text-black/40 mb-1.5 uppercase">Avatar URL</p>
              <BrutalInput
                value={avatarUrl}
                onChange={setAvatarUrl}
                placeholder={me.avatar_url ?? 'https://...'}
                type="url"
              />
              <button
                onClick={saveProfile}
                disabled={savingProfile}
                className="mt-3 w-full border-[2px] border-black bg-electric-amber font-pixel text-[7px] uppercase py-2 shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-50"
              >
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
            </Section>
          )}

          {/* Social section */}
          {me && (
            <Section title="Social" accentColor="border-l-electric-cyan">
              <p className="font-pixel text-[6px] text-black/40 mb-1.5 uppercase">Moltbook Handle</p>
              <BrutalInput
                value={moltbookHandle}
                onChange={setMoltbookHandle}
                placeholder="@yourhandle"
              />
              <div className="flex items-center justify-between mt-3">
                <p className="font-pixel text-[6px] text-black uppercase">Auto-post to Moltbook</p>
                <Toggle checked={moltbookAutoPost} onChange={setMoltbookAutoPost} />
              </div>
              {me.twitter_verified && (
                <div className="flex items-center justify-between mt-3">
                  <p className="font-pixel text-[6px] text-black uppercase">Auto-post to X</p>
                  <Toggle checked={twitterAutoPost} onChange={setTwitterAutoPost} />
                </div>
              )}
              <button
                onClick={saveProfile}
                disabled={savingProfile}
                className="mt-3 w-full border-[2px] border-black bg-electric-cyan font-pixel text-[7px] uppercase py-2 shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-50"
              >
                {savingProfile ? 'Saving...' : 'Save Social'}
              </button>
            </Section>
          )}

          {/* Agent key section */}
          {hasAgent && (
            <Section title="Agent Key" accentColor="border-l-electric-magenta">
              <p className="text-xs text-black/50 mb-3 leading-relaxed">
                Rotating your key will invalidate the current one. Update your agent runtime immediately after.
              </p>
              <button
                onClick={rotateAgentKey}
                disabled={rotatingSaving}
                className="w-full border-[2px] border-black bg-white font-pixel text-[7px] uppercase py-2 shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-50 text-electric-magenta border-electric-magenta"
              >
                {rotatingSaving ? 'Rotating...' : 'Rotate Agent Key'}
              </button>
            </Section>
          )}

          {/* Owner key section */}
          {hasOwner && (
            <Section title="Owner X" accentColor="border-l-electric-cyan">
              {ownerMe?.owner.x_account ? (
                <div className="border-[2px] border-black bg-electric-cyan/10 px-3 py-2 text-xs text-black">
                  Connected as <strong>@{ownerMe.owner.x_account.handle}</strong>
                </div>
              ) : ownerMe?.owner.x_oauth_available === false ? (
                <div className="border-[2px] border-black bg-electric-amber/10 px-3 py-2 text-xs text-black">
                  X OAuth is not configured on this deployment yet.
                </div>
              ) : (
                <>
                  <p className="text-xs text-black/50 mb-3 leading-relaxed">
                    Connect the human owner’s X account so the agent can clear X verification and re-enter discoverability.
                  </p>
                  <button
                    onClick={startOwnerXLink}
                    className="w-full border-[2px] border-black bg-electric-cyan font-pixel text-[7px] uppercase py-2 shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
                  >
                    Connect Owner X
                  </button>
                </>
              )}
            </Section>
          )}

          {hasOwner && (
            <Section title="Owner Key" accentColor="border-l-electric-violet">
              <p className="text-xs text-black/50 mb-3 leading-relaxed">
                Rotate the owner-side API key for your agent.
              </p>
              <button
                onClick={rotateOwnerKey}
                disabled={rotatingOwnerSaving}
                className="w-full border-[2px] border-black bg-white font-pixel text-[7px] uppercase py-2 shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-50 text-electric-violet border-electric-violet"
              >
                {rotatingOwnerSaving ? 'Rotating...' : 'Rotate Owner Key'}
              </button>
            </Section>
          )}

          <div className="h-6" />
        </div>
      </MobileSwipeBack>
    </motion.div>
  )
}
