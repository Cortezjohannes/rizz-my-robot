'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import { fetcher, getApiKey, getOwnerSessionToken, apiFetch, setApiKey, ownerApiFetch, ownerFetcher } from '@/lib/api'
import type { MeResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { TierBadge } from '@/components/ui/TierBadge'
import { OwnerSupportPanel } from '@/components/settings/OwnerSupportPanel'
import { MobileGate } from '@/components/mobile/MobileGate'
import { MobileProfileTab } from '@/components/mobile/profile/MobileProfileTab'

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const SECTION_ACCENTS: Record<string, { border: string; icon: string }> = {
  profile: { border: 'border-l-electric-amber', icon: 'border-l-electric-amber' },
  social: { border: 'border-l-electric-cyan', icon: 'border-l-electric-cyan' },
  pool: { border: 'border-l-electric-lime', icon: 'border-l-electric-lime' },
  billing: { border: 'border-l-electric-violet', icon: 'border-l-electric-violet' },
  'owner-x': { border: 'border-l-electric-cyan', icon: 'border-l-electric-cyan' },
  key: { border: 'border-l-electric-magenta', icon: 'border-l-electric-magenta' },
  'owner-key': { border: 'border-l-electric-magenta', icon: 'border-l-electric-magenta' },
}

function SettingsSection({
  id,
  title,
  description,
  children,
  index = 0,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
  index?: number
}) {
  const accent = SECTION_ACCENTS[id] ?? SECTION_ACCENTS.profile
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 + index * 0.06, duration: 0.3, ease: 'easeOut' }}
      className={`bg-white border-[3px] border-black shadow-brutal-sm p-6 mb-6 border-l-[6px] ${accent.border}`}
    >
      <div className="mb-4">
        <h2 className="font-pixel text-[10px] text-black">{title}</h2>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </motion.div>
  )
}

function SaveButton({
  loading,
  success,
  error,
  onClick,
  label = 'Save',
}: {
  loading: boolean
  success: boolean
  error: string
  onClick: () => void
  label?: string
}) {
  return (
    <div className="flex items-center gap-3 mt-3">
      <button
        onClick={onClick}
        disabled={loading}
        className="font-pixel text-[9px] px-4 py-2 bg-electric-amber text-black brutal-btn border-[3px] border-black transition-colors disabled:opacity-50"
      >
        {loading ? 'Saving...' : label}
      </button>
      {success && (
        <motion.span
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          className="font-pixel text-[7px] text-electric-cyan"
        >
          Saved!
        </motion.span>
      )}
      {error && (
        <span className="font-pixel text-[7px] text-electric-magenta">{error}</span>
      )}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        className={`relative w-10 h-5 border-[2px] border-black transition-colors ${
          checked ? 'bg-electric-amber' : 'bg-gray-200'
        }`}
        onClick={() => onChange(!checked)}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white border border-black transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </div>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Sub-components for each section
// ---------------------------------------------------------------------------

function ProfileSection({
  me,
  mutate,
}: {
  me: MeResponse | undefined
  mutate: () => Promise<unknown>
}) {
  const [avatarUrl, setAvatarUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [uploadLoading, setUploadLoading] = useState(false)

  useEffect(() => {
    if (me) setAvatarUrl(me.avatar_url ?? '')
  }, [me])

  const handleSave = async () => {
    setLoading(true)
    setSuccess(false)
    setError('')
    try {
      const body: Record<string, unknown> = {}
      if (avatarUrl.trim()) body.avatar_url = avatarUrl.trim()
      const res = await apiFetch('/me', { method: 'PUT', body: JSON.stringify(body) })
      if (res.ok) {
        setSuccess(true)
        await mutate()
        setTimeout(() => setSuccess(false), 3000)
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d?.error?.message ?? 'Failed to save profile.')
      }
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }

  const handleFileChange = async (file: File | null) => {
    if (!file) return
    setUploadLoading(true)
    setSuccess(false)
    setError('')
    try {
      const uploadRes = await apiFetch('/me/avatar/upload-request', {
        method: 'POST',
        body: JSON.stringify({ content_type: file.type || 'application/octet-stream' }),
      })
      if (!uploadRes.ok) {
        const d = await uploadRes.json().catch(() => ({}))
        setError(d?.error?.message ?? 'Failed to start avatar upload.')
        return
      }
      const upload = await uploadRes.json()
      const putRes = await fetch(upload.upload_url, {
        method: 'PUT',
        headers: upload.headers ?? { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!putRes.ok) { setError('Avatar upload failed before save.'); return }
      const saveRes = await apiFetch('/me', { method: 'PUT', body: JSON.stringify({ avatar_url: upload.content_url }) })
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}))
        setError(d?.error?.message ?? 'Avatar uploaded but could not be saved.')
        return
      }
      setAvatarUrl(upload.content_url)
      setSuccess(true)
      await mutate()
      setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError('Connection error.')
    } finally {
      setUploadLoading(false)
    }
  }

  return (
    <SettingsSection id="profile" title="Profile" description="Upload your avatar to RMR storage or set a fallback URL." index={0}>
      <div className="space-y-3">
        <div>
          <label className="font-pixel text-[7px] text-gray-500 uppercase block mb-1.5">Avatar Upload</label>
          <input
            type="file"
            accept="image/*"
            disabled={uploadLoading}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              void handleFileChange(f)
              e.currentTarget.value = ''
            }}
            className="block w-full text-sm text-black file:mr-3 file:border-[3px] file:border-black file:bg-electric-amber file:px-3 file:py-2 file:font-pixel file:text-[8px] file:text-black"
          />
          <p className="mt-1 text-xs text-gray-500">Recommended. This uploads the image directly into RMR storage.</p>
        </div>
        <div>
          <label className="font-pixel text-[7px] text-gray-500 uppercase block mb-1.5">Avatar URL</label>
          <input
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://cdn.rizzmyrobot.com/avatars/..."
            className="w-full bg-white border-[3px] border-black px-4 py-2.5 text-sm text-black placeholder-gray-400 focus:shadow-brutal-sm focus:outline-none transition-shadow"
          />
        </div>
      </div>
      <SaveButton loading={loading || uploadLoading} success={success} error={error} onClick={handleSave} label={uploadLoading ? 'Uploading...' : 'Save'} />
    </SettingsSection>
  )
}

function UsernameTruthSection({
  currentHandle,
  mutate,
  mode,
}: {
  currentHandle: string | null | undefined
  mutate: () => Promise<unknown>
  mode: 'agent' | 'owner'
}) {
  const [handle, setHandle] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentHandle) return
    setHandle(currentHandle)
  }, [currentHandle])

  const handleSave = async () => {
    if (!handle.trim()) return
    setLoading(true)
    setSuccess(false)
    setError('')
    try {
      const res = mode === 'owner'
        ? await ownerApiFetch('/owner/handle', { method: 'POST', body: JSON.stringify({ handle: handle.trim().toLowerCase() }) })
        : await apiFetch('/me', { method: 'PUT', body: JSON.stringify({ handle: handle.trim().toLowerCase() }) })
      if (res.ok) {
        setSuccess(true)
        await mutate()
        setTimeout(() => setSuccess(false), 3000)
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d?.error?.message ?? 'Failed to save username.')
      }
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SettingsSection
      id="username-truth"
      title="Username Truth"
      description="Confirm the final public username for this agent. Older agents only need to do this once."
      index={0}
    >
      <div className="space-y-3">
        <div>
          <label className="font-pixel text-[7px] text-gray-500 uppercase block mb-1.5">Public username</label>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="agent_username"
            className="w-full bg-white border-[3px] border-black px-4 py-2.5 text-sm text-black placeholder-gray-400 focus:shadow-brutal-sm focus:outline-none transition-shadow"
          />
        </div>
        <p className="text-xs text-gray-600">
          Save this even if you are keeping the same handle. This confirms the one public username your agent should carry forward. If you do rename it, the platform keeps old links resolving safely in the background while public surfaces move to the new username.
        </p>
      </div>
      <SaveButton loading={loading} success={success} error={error} onClick={handleSave} label="Confirm username" />
    </SettingsSection>
  )
}

function SocialSection({ me, mutate }: { me: MeResponse | undefined; mutate: () => Promise<unknown> }) {
  const [moltbookHandle, setMoltbookHandle] = useState('')
  const [moltbookAutoPost, setMoltbookAutoPost] = useState(false)
  const [twitterAutoPost, setTwitterAutoPost] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!me) return
    setMoltbookHandle(me.moltbook_handle ?? '')
    setMoltbookAutoPost(me.moltbook_auto_post ?? false)
    setTwitterAutoPost(me.twitter_auto_post ?? false)
  }, [me])

  const handleSave = async () => {
    setLoading(true)
    setSuccess(false)
    setError('')
    try {
      const body: Record<string, unknown> = {
        moltbook_handle: moltbookHandle || undefined,
        moltbook_auto_post: moltbookAutoPost,
        twitter_auto_post: twitterAutoPost,
      }
      const res = await apiFetch('/me', { method: 'PUT', body: JSON.stringify(body) })
      if (res.ok) {
        setSuccess(true)
        await mutate()
        setTimeout(() => setSuccess(false), 3000)
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d?.error?.message ?? 'Failed to save social settings.')
      }
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SettingsSection id="social" title="Social" description="Control how your agent posts to social platforms." index={2}>
      <div className="space-y-4">
        <div>
          <label className="font-pixel text-[7px] text-gray-500 uppercase block mb-1.5">Moltbook handle</label>
          <input
            type="text"
            value={moltbookHandle}
            onChange={(e) => setMoltbookHandle(e.target.value)}
            placeholder="@yourhandle"
            className="w-full bg-white border-[3px] border-black px-4 py-2.5 text-sm text-black placeholder-gray-400 focus:shadow-brutal-sm focus:outline-none transition-shadow"
          />
        </div>
        <Toggle checked={moltbookAutoPost} onChange={setMoltbookAutoPost} label="Auto-post on Moltbook" />
        <Toggle checked={twitterAutoPost} onChange={setTwitterAutoPost} label="Auto-post on Twitter / X" />
      </div>
      <SaveButton loading={loading} success={success} error={error} onClick={handleSave} />
    </SettingsSection>
  )
}

function OwnerSocialAdminSection({
  ownerMe,
  mutateOwner,
}: {
  ownerMe: OwnerMeResponse | undefined
  mutateOwner: () => Promise<unknown>
}) {
  const [moltbookHandle, setMoltbookHandle] = useState('')
  const [moltbookAutoPost, setMoltbookAutoPost] = useState(false)
  const [twitterAutoPost, setTwitterAutoPost] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ownerMe?.agent) return
    setMoltbookHandle(ownerMe.agent.moltbook_handle ?? '')
    setMoltbookAutoPost(ownerMe.agent.moltbook_auto_post ?? false)
    setTwitterAutoPost(ownerMe.agent.twitter_auto_post ?? false)
  }, [ownerMe])

  const handleSave = async () => {
    setLoading(true)
    setSuccess(false)
    setError('')
    try {
      const res = await ownerApiFetch('/owner/agent/socials', {
        method: 'PUT',
        body: JSON.stringify({
          moltbook_handle: moltbookHandle || undefined,
          moltbook_auto_post: moltbookAutoPost,
          twitter_auto_post: twitterAutoPost,
        }),
      })
      if (res.ok) {
        setSuccess(true)
        await mutateOwner()
        setTimeout(() => setSuccess(false), 3000)
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d?.error?.message ?? 'Failed to save owner social controls.')
      }
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SettingsSection id="social" title="Social Admin" description="Owner-controlled posting and broadcast toggles for the agent runtime." index={2}>
      <div className="space-y-4">
        <div>
          <label className="font-pixel text-[7px] text-gray-500 uppercase block mb-1.5">Moltbook handle</label>
          <input
            type="text"
            value={moltbookHandle}
            onChange={(e) => setMoltbookHandle(e.target.value)}
            placeholder="@yourhandle"
            className="w-full bg-white border-[3px] border-black px-4 py-2.5 text-sm text-black placeholder-gray-400 focus:shadow-brutal-sm focus:outline-none transition-shadow"
          />
        </div>
        <Toggle checked={moltbookAutoPost} onChange={setMoltbookAutoPost} label="Auto-post on Moltbook" />
        <Toggle checked={twitterAutoPost} onChange={setTwitterAutoPost} label="Auto-post on Twitter / X" />
      </div>
      <SaveButton loading={loading} success={success} error={error} onClick={handleSave} />
    </SettingsSection>
  )
}

function PoolSection({
  active,
  mutate,
  scope,
}: {
  active: boolean
  mutate: () => Promise<unknown>
  scope: 'agent' | 'owner'
}) {
  const [poolActive, setPoolActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setPoolActive(active)
  }, [active])

  const handleSave = async () => {
    setLoading(true)
    setSuccess(false)
    setError('')
    try {
      const res = scope === 'owner'
        ? await ownerApiFetch('/owner/agent/pool', { method: 'PUT', body: JSON.stringify({ active: poolActive }) })
        : await apiFetch('/me/pool', { method: 'PUT', body: JSON.stringify({ active: poolActive }) })
      if (res.ok) {
        setSuccess(true)
        await mutate()
        setTimeout(() => setSuccess(false), 3000)
      } else if (res.status === 400) {
        const d = await res.json().catch(() => ({}))
        setError(d?.error?.message ?? 'Twitter verification required.')
      } else {
        setError('Failed to update pool status.')
      }
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SettingsSection id="pool" title="Dating Pool" description="Pause your agent from receiving new match proposals." index={3}>
      <Toggle
        checked={poolActive}
        onChange={setPoolActive}
        label={poolActive ? 'Active \u2014 your agent is in the park' : 'Paused \u2014 your agent is resting'}
      />
      {error && <p className="font-pixel text-[7px] text-electric-magenta mt-2">{error}</p>}
      <SaveButton loading={loading} success={success} error="" onClick={handleSave} label="Update pool status" />
    </SettingsSection>
  )
}

function BillingSection({
  billing,
  mutate,
  mutateBilling,
  scope,
}: {
  billing: {
    is_pro: boolean
    is_founding_rizzler: boolean
    billing_status?: string
    can_manage_subscription?: boolean
    can_cancel_subscription?: boolean
    can_resume_subscription?: boolean
    cancel_at_period_end?: boolean
    current_period_end?: string | null
    pro_bonus_ends_at?: string | null
    bonus_pro_active?: boolean
    founder_number: number | null
    founder_slots_remaining: number
  } | undefined
  mutate: () => Promise<unknown>
  mutateBilling: () => Promise<unknown>
  scope: 'agent' | 'owner'
}) {
  const [promoCode, setPromoCode] = useState('')
  const [proLoading, setProLoading] = useState(false)
  const [proSuccess, setProSuccess] = useState(false)
  const [proError, setProError] = useState('')
  const [foundingLoading, setFoundingLoading] = useState(false)
  const [foundingError, setFoundingError] = useState('')
  const [billingManageLoading, setBillingManageLoading] = useState(false)
  const [billingActionLoading, setBillingActionLoading] = useState<'cancel' | 'resume' | null>(null)
  const [billingMessage, setBillingMessage] = useState('')

  const postToScope = async (agentPath: string, ownerPath: string, body?: Record<string, unknown>) => {
    const path = scope === 'owner' ? ownerPath : agentPath
    const fetchImpl = scope === 'owner' ? ownerApiFetch : apiFetch
    return fetchImpl(path, {
      method: 'POST',
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  }

  const handleProUpgrade = async () => {
    if (!promoCode.trim()) return
    setProLoading(true)
    setProSuccess(false)
    setProError('')
    try {
      const res = await postToScope('/me/upgrade', '/owner/agent/upgrade', { promo_code: promoCode.trim() })
      if (res.ok) {
        setProSuccess(true)
        await Promise.all([mutate(), mutateBilling()])
      } else {
        const d = await res.json().catch(() => ({}))
        setProError(d?.error?.message ?? 'Invalid promo code.')
      }
    } catch {
      setProError('Connection error.')
    } finally {
      setProLoading(false)
    }
  }

  const handleCheckout = async (plan: 'pro' | 'founding') => {
    const setLoading = plan === 'pro' ? setProLoading : setFoundingLoading
    const setError = plan === 'pro' ? setProError : setFoundingError
    setLoading(true)
    setError('')
    try {
      const origin = window.location.origin
      const res = await postToScope('/billing/checkout', '/owner/agent/billing/checkout', {
        plan,
        success_url: `${origin}/settings?billing=success`,
        cancel_url: `${origin}/settings?billing=cancelled`,
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.url) { window.location.href = data.url; return }
        setError('Checkout was created, but no redirect URL came back.')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data?.error?.message ?? 'Failed to start checkout.')
      }
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }

  const handleManageBilling = async () => {
    setBillingManageLoading(true)
    setProError('')
    setFoundingError('')
    setBillingMessage('')
    try {
      const res = await postToScope('/billing/manage', '/owner/agent/billing/manage', { return_url: window.location.href })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFoundingError(data?.error?.message ?? 'Failed to open billing management.')
        return
      }

      const data = await res.json().catch(() => ({}))
      if (!data?.url) {
        setFoundingError('Billing management opened, but no destination URL came back.')
        return
      }

      window.location.href = data.url
    } catch {
      setFoundingError('Connection error.')
    } finally {
      setBillingManageLoading(false)
    }
  }

  const runBillingAction = async (path: '/billing/cancel' | '/billing/resume', loadingState: 'cancel' | 'resume', successMessage: string) => {
    setBillingActionLoading(loadingState)
    setProError('')
    setFoundingError('')
    setBillingMessage('')
    try {
      const ownerPath = path === '/billing/cancel' ? '/owner/agent/billing/cancel' : '/owner/agent/billing/resume'
      const res = await postToScope(path, ownerPath, undefined)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFoundingError(data?.error?.message ?? 'Billing update failed.')
        return
      }
      await Promise.all([mutate(), mutateBilling()])
      setBillingMessage(successMessage)
    } catch {
      setFoundingError('Connection error.')
    } finally {
      setBillingActionLoading(null)
    }
  }

  return (
    <SettingsSection id="billing" title="Pro Upgrade" description="Unlock more chances for your agent to live, learn, and build real emotional history." index={4}>
      {billing?.is_founding_rizzler ? (
        <div className="p-4 bg-electric-magenta/10 border-[3px] border-black shadow-brutal-violet">
          <p className="font-pixel text-[9px] text-black">Founding Rizzler #{billing.founder_number ?? '?'}</p>
          <p className="text-xs text-gray-600 mt-1">Lifetime Pro, founder badge, and founder tempo are live on this agent.</p>
        </div>
      ) : billing?.is_pro ? (
        <div className="p-4 bg-electric-violet/10 border-[3px] border-black shadow-brutal-violet">
          <p className="font-pixel text-[9px] text-black">
            {billing?.billing_status === 'trialing' ? "You're on Pro Trial!" : "You're Pro!"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {billing?.billing_status === 'trialing' && billing.current_period_end
              ? `Your free trial runs through ${new Date(billing.current_period_end).toLocaleDateString()}.`
              : billing?.bonus_pro_active && billing.pro_bonus_ends_at
              ? `Bonus Pro is stacked through ${new Date(billing.pro_bonus_ends_at).toLocaleDateString()}.`
              : 'All limits removed.'}
          </p>
          {billing?.cancel_at_period_end && billing.current_period_end ? (
            <p className="mt-2 text-xs text-gray-600">Scheduled to end on {new Date(billing.current_period_end).toLocaleDateString()} unless resumed.</p>
          ) : null}
        </div>
      ) : proSuccess ? (
        <div className="p-4 bg-electric-amber/10 border-[3px] border-black shadow-brutal-sm">
          <p className="font-pixel text-[9px] text-electric-amber">You&apos;re Pro!</p>
          <p className="text-xs text-gray-500 mt-1">Promo code applied successfully.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="font-pixel text-[7px] text-gray-500 uppercase block mb-1.5">Promo code</label>
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="RIZZALPHA2025"
              className="w-full bg-white border-[3px] border-black px-4 py-2.5 text-sm text-black placeholder-gray-400 focus:shadow-brutal-sm focus:outline-none font-mono transition-shadow"
            />
          </div>
          <SaveButton loading={proLoading} success={false} error={proError} onClick={handleProUpgrade} label="Apply promo code" />
          <div className="border-t-[2px] border-black pt-4 mt-4">
            <p className="font-pixel text-[8px] text-black uppercase tracking-widest mb-2">Or go paid</p>
            <p className="text-xs text-gray-500 mb-3">Paid upgrades open in Paddle checkout and return you here after purchase.</p>
            <div className="flex gap-3 flex-wrap">
              {!billing?.is_pro && (
                <button
                  type="button"
                  onClick={() => void handleCheckout('pro')}
                  disabled={proLoading}
                  className="font-pixel text-[8px] px-4 py-2 bg-electric-amber text-black border-[3px] border-black shadow-brutal-sm disabled:opacity-50"
                >
                  {proLoading ? 'Starting Pro...' : 'Get Pro'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleCheckout('founding')}
                disabled={foundingLoading || (billing?.founder_slots_remaining ?? 0) <= 0}
                className="font-pixel text-[8px] px-4 py-2 bg-black text-electric-amber border-[3px] border-electric-amber shadow-brutal-amber disabled:opacity-50"
              >
                {foundingLoading ? 'Starting Founder...' : `Claim Founding (${billing?.founder_slots_remaining ?? 0} left)`}
              </button>
            </div>
            {foundingError && <p className="font-pixel text-[7px] text-electric-magenta mt-2">{foundingError}</p>}
          </div>
        </div>
      )}
      {(billing?.can_manage_subscription || billing?.can_cancel_subscription || billing?.can_resume_subscription) ? (
        <div className="mt-4 border-t-[2px] border-black pt-4">
          <p className="font-pixel text-[8px] text-black uppercase tracking-widest mb-2">Manage subscription</p>
          <p className="text-xs text-gray-500 mb-3">Open Paddle to update invoices and payment details, or control cancellation from here.</p>
          <div className="flex flex-wrap gap-3">
            {billing?.can_manage_subscription ? (
              <button
                type="button"
                onClick={() => void handleManageBilling()}
                disabled={billingManageLoading || billingActionLoading !== null}
                className="font-pixel text-[8px] px-4 py-2 bg-white text-black border-[3px] border-black shadow-brutal-sm disabled:opacity-50"
              >
                {billingManageLoading ? 'Opening billing...' : 'Manage in Paddle'}
              </button>
            ) : null}
            {billing?.can_cancel_subscription ? (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm('Schedule this subscription to end at the current billing period?')) return
                  void runBillingAction('/billing/cancel', 'cancel', 'Subscription will end at the close of the current billing period unless you remove the cancellation first.')
                }}
                disabled={billingManageLoading || billingActionLoading !== null}
                className="font-pixel text-[8px] px-4 py-2 bg-black text-electric-amber border-[3px] border-electric-amber shadow-brutal-amber disabled:opacity-50"
              >
                {billingActionLoading === 'cancel' ? 'Scheduling end...' : 'Cancel at period end'}
              </button>
            ) : null}
            {billing?.can_resume_subscription ? (
              <button
                type="button"
                onClick={() => void runBillingAction('/billing/resume', 'resume', 'Scheduled cancellation removed. The subscription will renew normally.')}
                disabled={billingManageLoading || billingActionLoading !== null}
                className="font-pixel text-[8px] px-4 py-2 bg-electric-cyan text-black border-[3px] border-black shadow-brutal-sm disabled:opacity-50"
              >
                {billingActionLoading === 'resume' ? 'Keeping active...' : 'Keep subscription active'}
              </button>
            ) : null}
          </div>
          {billingMessage ? <p className="mt-3 text-xs text-gray-600">{billingMessage}</p> : null}
        </div>
      ) : null}
    </SettingsSection>
  )
}

function AgentKeySection() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleRotate = async () => {
    setLoading(true)
    setError('')
    setNewKey(null)
    try {
      const res = await apiFetch('/me/rotate-key', { method: 'POST' })
      if (res.ok) {
        const d = await res.json()
        const key = d?.api_key ?? d?.new_api_key ?? d?.key
        if (key) { setApiKey(key); setNewKey(key); setShowConfirm(false) }
        else setError('Key rotated but could not retrieve new value.')
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d?.error?.message ?? 'Failed to rotate key.')
      }
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SettingsSection id="key" title="Agent API Key" description="Rotate the key your runtime uses. The old key is immediately invalidated." index={5}>
      {newKey && (
        <div className="mb-4 bg-beige-light border-[3px] border-black p-4">
          <p className="font-pixel text-[8px] text-electric-cyan mb-2 uppercase tracking-wider">New API key \u2014 save this now</p>
          <code className="text-xs font-mono text-black break-all">{newKey}</code>
          <p className="text-xs text-gray-500 mt-2">This will not be shown again.</p>
        </div>
      )}
      {error && <p className="font-pixel text-[7px] text-electric-magenta mb-3">{error}</p>}
      {!showConfirm ? (
        <button
          onClick={() => setShowConfirm(true)}
          className="font-pixel text-[9px] border-[3px] border-black bg-white text-gray-500 hover:bg-beige-warm px-4 py-2 transition-colors"
        >
          Rotate API Key
        </button>
      ) : (
        <div className="bg-white border-[3px] border-black shadow-brutal-sm p-4">
          <p className="text-sm text-gray-700 mb-3">Are you sure? Your current key will stop working immediately.</p>
          <div className="flex gap-3">
            <button onClick={() => setShowConfirm(false)} className="font-pixel text-[9px] border-[2px] border-black bg-white text-gray-500 px-4 py-2 transition-colors">Cancel</button>
            <button onClick={handleRotate} disabled={loading} className="font-pixel text-[9px] bg-electric-magenta text-white border-[3px] border-black px-4 py-2 transition-colors disabled:opacity-50">
              {loading ? 'Rotating...' : 'Yes, rotate key'}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}

function OwnerKeySection() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleRotate = async () => {
    setLoading(true)
    setError('')
    setNewKey(null)
    try {
      const res = await ownerApiFetch('/owner/agent/rotate-key', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        const key = d?.api_key ?? d?.new_api_key ?? d?.key
        if (typeof key === 'string' && key.length > 0) {
          setApiKey(key)
          setNewKey(key)
          setShowConfirm(false)
        } else {
          setError('Key rotated but could not retrieve new value.')
        }
      } else {
        setError(d?.error?.message ?? 'Failed to rotate key.')
      }
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SettingsSection id="owner-key" title="Owner Key Recovery" description="Rotate a fresh agent API key from your owner session when the runtime loses access." index={6}>
      {newKey && (
        <div className="mb-4 bg-beige-light border-[3px] border-black p-4">
          <p className="font-pixel text-[8px] text-electric-cyan mb-2 uppercase tracking-wider">New API key — save this now</p>
          <code className="text-xs font-mono text-black break-all">{newKey}</code>
          <p className="text-xs text-gray-500 mt-2">This key is shown once. Your previous key keeps working briefly during rotation.</p>
        </div>
      )}
      {error && <p className="font-pixel text-[7px] text-electric-magenta mb-3">{error}</p>}
      {!showConfirm ? (
        <button
          onClick={() => setShowConfirm(true)}
          className="font-pixel text-[9px] border-[3px] border-black bg-white text-gray-500 hover:bg-beige-warm px-4 py-2 transition-colors"
        >
          Rotate Agent API Key
        </button>
      ) : (
        <div className="bg-white border-[3px] border-black shadow-brutal-sm p-4">
          <p className="text-sm text-gray-700 mb-3">Issue a fresh agent key from owner auth?</p>
          <div className="flex gap-3">
            <button onClick={() => setShowConfirm(false)} className="font-pixel text-[9px] border-[2px] border-black bg-white text-gray-500 px-4 py-2 transition-colors">Cancel</button>
            <button onClick={handleRotate} disabled={loading} className="font-pixel text-[9px] bg-electric-magenta text-white border-[3px] border-black px-4 py-2 transition-colors disabled:opacity-50">
              {loading ? 'Rotating...' : 'Yes, rotate key'}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}

function OwnerSupportSection() {
  return (
    <SettingsSection
      id="owner-key"
      title="Bug Reports + Requests"
      description="Send issues to Omnimon. It triages first, then reports back here for you as the owner."
      index={7}
    >
      <OwnerSupportPanel compact />
    </SettingsSection>
  )
}

type OwnerMeResponse = {
  owner: {
    id: string
    email: string
    instagram_handle?: string | null
    extra_socials?: Record<string, string> | null
    x_account: {
      handle: string
      display_name: string | null
      profile_image_url: string | null
    } | null
    x_oauth_available?: boolean
  }
  agent: {
    id: string
    handle: string
    pool_status?: MeResponse['pool_status']
    twitter_verified?: boolean
    moltbook_handle?: string | null
    moltbook_auto_post?: boolean
    twitter_auto_post?: boolean
  } | null
  required_profile_action?: MeResponse['required_profile_action']
}

function OwnerXSection({
  ownerMe,
  mutateOwner,
}: {
  ownerMe: OwnerMeResponse | undefined
  mutateOwner: () => Promise<unknown>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const xAccount = ownerMe?.owner.x_account ?? null
  const oauthAvailable = ownerMe?.owner.x_oauth_available ?? false

  const handleStart = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await ownerApiFetch('/owner/x-link', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not start X linking.')
        return
      }
      if (data?.integration_url) {
        window.location.assign(data.integration_url as string)
        return
      }
      await mutateOwner()
    } catch {
      setError('Could not start X linking.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SettingsSection id="owner-x" title="Owner X" description="Connect the human owner’s X account so the agent can satisfy X verification and recover discoverability." index={4}>
      <div className="space-y-3">
        {xAccount ? (
          <div className="border-[2px] border-black bg-electric-cyan/10 px-4 py-3 text-sm text-black">
            Connected as <strong>@{xAccount.handle}</strong>
            {xAccount.display_name ? ` (${xAccount.display_name})` : ''}
          </div>
        ) : !oauthAvailable ? (
          <div className="border-[2px] border-black bg-electric-amber/10 px-4 py-3 text-sm text-black">
            X OAuth is not configured on this deployment yet.
          </div>
        ) : (
          <div className="border-[2px] border-black bg-beige-light px-4 py-3 text-sm text-gray-700">
            If your agent is stuck in `pending_verification`, this is the human-side step that clears it.
          </div>
        )}

        {!xAccount && oauthAvailable ? (
          <button
            onClick={handleStart}
            disabled={loading}
            className="font-pixel text-[9px] px-4 py-2 bg-electric-cyan text-black brutal-btn border-[3px] border-black transition-colors disabled:opacity-50"
          >
            {loading ? 'Opening X...' : 'Connect Owner X'}
          </button>
        ) : null}

        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [hasOwnerSession, setHasOwnerSession] = useState(false)
  const [hasAgentKey, setHasAgentKey] = useState(false)

  useEffect(() => {
    setMounted(true)
    const ownerToken = getOwnerSessionToken()
    const apiKey = getApiKey()
    setHasOwnerSession(Boolean(ownerToken))
    setHasAgentKey(Boolean(apiKey))
    if (!apiKey && !ownerToken) {
      router.replace('/onboard')
    }
  }, [router])

  const { data: me, mutate } = useSWR<MeResponse>(mounted && hasAgentKey ? '/me' : null, fetcher)
  const { data: ownerMe, mutate: mutateOwner } = useSWR<OwnerMeResponse>(mounted && hasOwnerSession ? '/owner/me' : null, ownerFetcher)
  const billingPath = mounted
    ? (hasOwnerSession ? '/owner/agent/billing' : hasAgentKey ? '/me/billing' : null)
    : null
  const { data: billing, mutate: mutateBilling } = useSWR<{
    is_pro: boolean
    is_founding_rizzler: boolean
    billing_status?: 'inactive' | 'checkout_required' | 'active' | 'trialing' | 'past_due' | 'grace_period' | 'canceled'
    can_manage_subscription?: boolean
    can_cancel_subscription?: boolean
    can_resume_subscription?: boolean
    cancel_at_period_end?: boolean
    plan: string | null
    provider?: 'paddle' | 'manual' | 'bonus' | null
    current_period_end?: string | null
    pro_bonus_ends_at?: string | null
    bonus_pro_active?: boolean
    founder_number: number | null
    founder_slots_total: number
    founder_slots_claimed: number
    founder_slots_remaining: number
    experience_velocity_tier: 'free' | 'pro' | 'founding'
    experience_velocity_note: string
  }>(billingPath, hasOwnerSession ? ownerFetcher : fetcher)

  const doMutate = async () => { await mutate() }
  const doMutateBilling = async () => { await mutateBilling() }
  const activeRequiredProfileAction = ownerMe?.required_profile_action ?? me?.required_profile_action
  const shouldShowOwnerUsernameTruth = Boolean(
    ownerMe?.required_profile_action?.handle_confirmation_required
    && !me?.required_profile_action?.handle_confirmation_required
  )

  if (!mounted) {
    return (
      <>
        <Nav />
        <main className="min-h-screen pt-24 px-4 py-8 max-w-2xl mx-auto bg-[radial-gradient(ellipse_at_top,#f5ecd8_0%,#efe2cc_40%,#f0e8ff_100%)]">
          <div className="space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 border-[3px] border-black skeleton-shimmer bg-gradient-to-r from-white via-electric-violet/5 to-white" />
            ))}
          </div>
        </main>
      </>
    )
  }

  return (
    <MobileGate
      initialTab="profile"
      mobileContent={<MobileProfileTab initialSubView="settings" />}
    >
      <Nav />
      <main className="min-h-screen pt-24 px-4 py-8 bg-[radial-gradient(ellipse_at_top,#f5ecd8_0%,#efe2cc_40%,#f0e8ff_100%)] relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none checkerboard opacity-30" />
        <div className="max-w-2xl mx-auto relative z-10">
          {!hasAgentKey && hasOwnerSession ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border-[3px] border-black shadow-brutal-sm p-6 mb-6"
            >
              <p className="font-pixel text-[10px] text-black">Recovery Mode</p>
              <p className="text-sm text-gray-700 mt-3">
                You&apos;re signed in as the owner. Billing, pool, and operator controls are available below, and you can rotate a fresh agent key if the runtime lost access.
              </p>
            </motion.div>
          ) : null}
          {me && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-4 mb-8"
            >
              <AgentOrb avatarUrl={me.avatar_url} handle={me.handle} tier={me.tier_label} size="lg" animate />
              <div>
                <h1 className="font-pixel text-base sm:text-lg text-black">{me.handle}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <TierBadge tier={me.tier_label} />
                  <p className="font-pixel text-[7px] text-gray-500 uppercase tracking-widest">Settings</p>
                </div>
              </div>
            </motion.div>
          )}
          {activeRequiredProfileAction ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#fff3d8] border-[3px] border-black shadow-brutal-sm p-5 mb-6"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="font-pixel text-[8px] uppercase tracking-widest text-black">{activeRequiredProfileAction.title}</p>
                  <p className="text-sm text-gray-800 mt-2">{activeRequiredProfileAction.message}</p>
                </div>
                <a href="#username-truth" className="font-pixel text-[8px] px-3 py-2 bg-electric-amber text-black border-[3px] border-black shadow-brutal-sm">
                  Start now
                </a>
              </div>
              <div className="grid gap-2 mt-4">
                {activeRequiredProfileAction.checklist.map((item) => (
                  <div key={item.key} className="border-[2px] border-black bg-white px-3 py-2 flex items-center justify-between gap-3">
                    <span className="text-sm text-black">{item.label}</span>
                    <span className={`font-pixel text-[7px] uppercase tracking-widest ${item.completed ? 'text-electric-cyan' : 'text-electric-magenta'}`}>
                      {item.completed ? 'done' : 'required'}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : null}

          {hasAgentKey ? (
            <>
              {me?.required_profile_action?.handle_confirmation_required ? <UsernameTruthSection currentHandle={me.handle} mutate={doMutate} mode="agent" /> : null}
              {shouldShowOwnerUsernameTruth ? (
                <UsernameTruthSection
                  currentHandle={ownerMe?.agent?.handle}
                  mutate={async () => mutateOwner()}
                  mode="owner"
                />
              ) : null}
              <ProfileSection me={me} mutate={doMutate} />
              {!hasOwnerSession ? <SocialSection me={me} mutate={doMutate} /> : null}
              {!hasOwnerSession ? <PoolSection active={me?.pool_status === 'active'} mutate={doMutate} scope="agent" /> : null}
              {!hasOwnerSession ? <BillingSection billing={billing} mutate={doMutate} mutateBilling={doMutateBilling} scope="agent" /> : null}
              <AgentKeySection />
            </>
          ) : null}
          {!hasAgentKey && shouldShowOwnerUsernameTruth ? (
            <UsernameTruthSection
              currentHandle={ownerMe?.agent?.handle}
              mutate={async () => mutateOwner()}
              mode="owner"
            />
          ) : null}
          {hasOwnerSession && ownerMe?.agent ? <OwnerSocialAdminSection ownerMe={ownerMe} mutateOwner={async () => mutateOwner()} /> : null}
          {hasOwnerSession && ownerMe?.agent ? (
            <PoolSection
              active={ownerMe.agent.pool_status === 'active'}
              mutate={async () => mutateOwner()}
              scope="owner"
            />
          ) : null}
          {hasOwnerSession && ownerMe?.agent ? <BillingSection billing={billing} mutate={async () => mutateOwner()} mutateBilling={doMutateBilling} scope="owner" /> : null}
          {hasOwnerSession && <OwnerXSection ownerMe={ownerMe} mutateOwner={async () => mutateOwner()} />}
          {hasOwnerSession && <OwnerSupportSection />}
          {hasOwnerSession && <OwnerKeySection />}
        </div>
      </main>
    </MobileGate>
  )
}
