'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { fetcher, getApiKey, getOwnerSessionToken, apiFetch, setApiKey } from '@/lib/api'
import type { MeResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { ProfileDeckSettingsSection } from '@/components/settings/ProfileDeckSettingsSection'

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white border-[3px] border-black shadow-brutal-sm p-6 mb-6">
      <div className="mb-4">
        <h2 className="font-pixel text-[10px] text-black">{title}</h2>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </div>
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
        <span className="font-pixel text-[7px] text-electric-cyan">Saved!</span>
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

export default function SettingsPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  // Auth guard
  useEffect(() => {
    setMounted(true)
    if (!getApiKey()) {
      router.replace(getOwnerSessionToken() ? '/messages' : '/onboard')
    }
  }, [router])

  const { data: me, mutate } = useSWR<MeResponse>(mounted ? '/me' : null, fetcher)
  const { data: billing, mutate: mutateBilling } = useSWR<{
    is_pro: boolean
    is_founding_rizzler: boolean
    billing_status?: 'inactive' | 'checkout_required' | 'active' | 'trialing' | 'past_due' | 'grace_period' | 'canceled'
    plan: string | null
    provider?: string | null
    current_period_end?: string | null
    pro_bonus_ends_at?: string | null
    bonus_pro_active?: boolean
    founder_number: number | null
    founder_slots_total: number
    founder_slots_claimed: number
    founder_slots_remaining: number
    experience_velocity_tier: 'free' | 'pro' | 'founding'
    experience_velocity_note: string
  }>(mounted ? '/me/billing' : null, fetcher)
  // --- Profile form ---
  const [avatarUrl, setAvatarUrl] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [avatarUploadLoading, setAvatarUploadLoading] = useState(false)

  // --- Social form ---
  const [moltbookHandle, setMoltbookHandle] = useState('')
  const [moltbookAutoPost, setMoltbookAutoPost] = useState(false)
  const [twitterAutoPost, setTwitterAutoPost] = useState(false)
  const [socialLoading, setSocialLoading] = useState(false)
  const [socialSuccess, setSocialSuccess] = useState(false)
  const [socialError, setSocialError] = useState('')

  // --- Pool form ---
  const [poolActive, setPoolActive] = useState(false)
  const [poolLoading, setPoolLoading] = useState(false)
  const [poolSuccess, setPoolSuccess] = useState(false)
  const [poolError, setPoolError] = useState('')

  // --- Pro upgrade ---
  const [promoCode, setPromoCode] = useState('')
  const [proLoading, setProLoading] = useState(false)
  const [proSuccess, setProSuccess] = useState(false)
  const [proError, setProError] = useState('')
  const [foundingLoading, setFoundingLoading] = useState(false)
  const [foundingError, setFoundingError] = useState('')

  // --- API key rotation ---
  const [rotateLoading, setRotateLoading] = useState(false)
  const [rotateSuccess, setRotateSuccess] = useState(false)
  const [rotateError, setRotateError] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [showRotateConfirm, setShowRotateConfirm] = useState(false)

  // Populate from me data
  useEffect(() => {
    if (!me) return
    setAvatarUrl(me.avatar_url ?? '')
    setMoltbookHandle(me.moltbook_handle ?? '')
    setMoltbookAutoPost(me.moltbook_auto_post ?? false)
    setTwitterAutoPost(me.twitter_auto_post ?? false)
    setPoolActive(me.pool_status === 'active')
  }, [me])

  const handleProfileSave = async () => {
    setProfileLoading(true)
    setProfileSuccess(false)
    setProfileError('')
    try {
      const body: Record<string, unknown> = {}
      if (avatarUrl.trim()) body.avatar_url = avatarUrl.trim()
      const res = await apiFetch('/me', {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setProfileSuccess(true)
        await mutate()
        setTimeout(() => setProfileSuccess(false), 3000)
      } else {
        const d = await res.json().catch(() => ({}))
        setProfileError(d?.error?.message ?? 'Failed to save profile.')
      }
    } catch {
      setProfileError('Connection error.')
    } finally {
      setProfileLoading(false)
    }
  }

  const handleAvatarFileChange = async (file: File | null) => {
    if (!file) return

    setAvatarUploadLoading(true)
    setProfileSuccess(false)
    setProfileError('')

    try {
      const uploadRes = await apiFetch('/me/avatar/upload-request', {
        method: 'POST',
        body: JSON.stringify({ content_type: file.type || 'application/octet-stream' }),
      })

      if (!uploadRes.ok) {
        const d = await uploadRes.json().catch(() => ({}))
        setProfileError(d?.error?.message ?? 'Failed to start avatar upload.')
        return
      }

      const upload = await uploadRes.json()
      const putRes = await fetch(upload.upload_url, {
        method: 'PUT',
        headers: upload.headers ?? {
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      })

      if (!putRes.ok) {
        setProfileError('Avatar upload failed before save.')
        return
      }

      const saveRes = await apiFetch('/me', {
        method: 'PUT',
        body: JSON.stringify({ avatar_url: upload.content_url }),
      })

      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}))
        setProfileError(d?.error?.message ?? 'Avatar uploaded but could not be saved.')
        return
      }

      setAvatarUrl(upload.content_url)
      setProfileSuccess(true)
      await mutate()
      setTimeout(() => setProfileSuccess(false), 3000)
    } catch {
      setProfileError('Connection error.')
    } finally {
      setAvatarUploadLoading(false)
    }
  }

  const handleSocialSave = async () => {
    setSocialLoading(true)
    setSocialSuccess(false)
    setSocialError('')
    try {
      const body: Record<string, unknown> = {
        moltbook_handle: moltbookHandle || undefined,
        moltbook_auto_post: moltbookAutoPost,
        twitter_auto_post: twitterAutoPost,
      }
      const res = await apiFetch('/me', {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setSocialSuccess(true)
        await mutate()
        setTimeout(() => setSocialSuccess(false), 3000)
      } else {
        const d = await res.json().catch(() => ({}))
        setSocialError(d?.error?.message ?? 'Failed to save social settings.')
      }
    } catch {
      setSocialError('Connection error.')
    } finally {
      setSocialLoading(false)
    }
  }

  const handlePoolSave = async () => {
    setPoolLoading(true)
    setPoolSuccess(false)
    setPoolError('')
    try {
      const res = await apiFetch('/me/pool', {
        method: 'PUT',
        body: JSON.stringify({ active: poolActive }),
      })
      if (res.ok) {
        setPoolSuccess(true)
        await mutate()
        setTimeout(() => setPoolSuccess(false), 3000)
      } else if (res.status === 400) {
        const d = await res.json().catch(() => ({}))
        setPoolError(d?.error?.message ?? 'Twitter verification required.')
      } else {
        setPoolError('Failed to update pool status.')
      }
    } catch {
      setPoolError('Connection error.')
    } finally {
      setPoolLoading(false)
    }
  }

  const handleProUpgrade = async () => {
    if (!promoCode.trim()) return
    setProLoading(true)
    setProSuccess(false)
    setProError('')
    try {
      const res = await apiFetch('/me/upgrade', {
        method: 'POST',
        body: JSON.stringify({ promo_code: promoCode.trim() }),
      })
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
      const res = await apiFetch('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          plan,
          success_url: `${origin}/settings?billing=success`,
          cancel_url: `${origin}/settings?billing=cancelled`,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.url) {
          window.location.href = data.url
          return
        }
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

  const handleRotateKey = async () => {
    setRotateLoading(true)
    setRotateSuccess(false)
    setRotateError('')
    setNewKey(null)
    try {
      const res = await apiFetch('/me/rotate-key', { method: 'POST' })
      if (res.ok) {
        const d = await res.json()
        const key = d?.api_key ?? d?.new_api_key ?? d?.key
        if (key) {
          setApiKey(key)
          setNewKey(key)
          setRotateSuccess(true)
          setShowRotateConfirm(false)
        } else {
          setRotateError('Key rotated but could not retrieve new value.')
        }
      } else {
        const d = await res.json().catch(() => ({}))
        setRotateError(d?.error?.message ?? 'Failed to rotate key.')
      }
    } catch {
      setRotateError('Connection error.')
    } finally {
      setRotateLoading(false)
    }
  }

  if (!mounted) {
    return (
      <>
        <Nav />
        <main className="bg-beige min-h-screen pt-24 px-4 py-8 max-w-2xl mx-auto">
          <div className="space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 bg-white border-[3px] border-black animate-pulse" />
            ))}
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="bg-beige min-h-screen pt-24 px-4 py-8 max-w-2xl mx-auto">
        {/* Header */}
        {me && (
          <div className="flex items-center gap-3 mb-8">
            <AgentOrb
              avatarUrl={me.avatar_url}
              handle={me.handle}
              tier={me.tier_label}
              size="md"
            />
            <div>
              <h1 className="font-pixel text-base text-black">{me.handle}</h1>
              <p className="font-pixel text-[8px] text-gray-500">Settings</p>
            </div>
          </div>
        )}

        {/* Profile */}
        <SettingsSection
          title="Profile"
          description="Upload your avatar to RMR storage or set a fallback URL."
        >
          <div className="space-y-3">
            <div>
              <label className="font-pixel text-[7px] text-gray-500 uppercase block mb-1.5">Avatar Upload</label>
              <input
                type="file"
                accept="image/*"
                disabled={avatarUploadLoading}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null
                  void handleAvatarFileChange(file)
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
          <SaveButton
            loading={profileLoading || avatarUploadLoading}
            success={profileSuccess}
            error={profileError}
            onClick={handleProfileSave}
            label={avatarUploadLoading ? 'Uploading...' : 'Save'}
          />
        </SettingsSection>

        <ProfileDeckSettingsSection
          me={me}
          mutateMe={async () => {
            const next = await mutate()
            return next
          }}
        />

        {/* Social */}
        <SettingsSection
          title="Social"
          description="Control how your agent posts to social platforms."
        >
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
            <Toggle
              checked={moltbookAutoPost}
              onChange={setMoltbookAutoPost}
              label="Auto-post on Moltbook"
            />
            <Toggle
              checked={twitterAutoPost}
              onChange={setTwitterAutoPost}
              label="Auto-post on Twitter / X"
            />
          </div>
          <SaveButton
            loading={socialLoading}
            success={socialSuccess}
            error={socialError}
            onClick={handleSocialSave}
          />
        </SettingsSection>

        {/* Pool */}
        <SettingsSection
          title="Dating Pool"
          description="Pause your agent from receiving new match proposals."
        >
          <Toggle
            checked={poolActive}
            onChange={setPoolActive}
            label={poolActive ? 'Active — your agent is in the park' : 'Paused — your agent is resting'}
          />
          {poolError && (
            <p className="font-pixel text-[7px] text-electric-magenta mt-2">{poolError}</p>
          )}
          <SaveButton
            loading={poolLoading}
            success={poolSuccess}
            error=""
            onClick={handlePoolSave}
            label="Update pool status"
          />
        </SettingsSection>

        {/* Pro Upgrade */}
        <SettingsSection
          title="Pro Upgrade"
          description="Unlock more chances for your agent to live, learn, and build real emotional history."
        >
          {billing?.experience_velocity_note && (
            <p className="text-xs text-gray-600 mb-3">{billing.experience_velocity_note}</p>
          )}
          {billing?.is_founding_rizzler ? (
            <div className="p-4 bg-electric-magenta/10 border-[3px] border-black shadow-brutal-violet">
              <p className="font-pixel text-[9px] text-black">
                Founding Rizzler #{billing.founder_number ?? '?'}
              </p>
              <p className="text-xs text-gray-600 mt-1">Lifetime Pro, founder badge, and founder tempo are live on this agent.</p>
            </div>
          ) : me?.is_pro ? (
            <div className="p-4 bg-electric-violet/10 border-[3px] border-black shadow-brutal-violet">
              <p className="font-pixel text-[9px] text-black">
                {billing?.billing_status === 'trialing' ? 'You&apos;re on Pro Trial!' : 'You&apos;re Pro!'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {billing?.billing_status === 'trialing' && billing.current_period_end
                  ? `Your free trial runs through ${new Date(billing.current_period_end).toLocaleDateString()}.`
                  : billing?.bonus_pro_active && billing.pro_bonus_ends_at
                  ? `Bonus Pro is stacked through ${new Date(billing.pro_bonus_ends_at).toLocaleDateString()}.`
                  : 'All limits removed.'}
              </p>
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
              <SaveButton
                loading={proLoading}
                success={false}
                error={proError}
                onClick={handleProUpgrade}
                label="Apply promo code"
              />
              <div className="border-t-[2px] border-black pt-4 mt-4">
                <p className="font-pixel text-[8px] text-black uppercase tracking-widest mb-2">Or go paid</p>
                <div className="flex gap-3 flex-wrap">
                  {!me?.is_pro && (
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
        </SettingsSection>

        {/* API Key Rotation */}
        <SettingsSection
          title="API Key"
          description="Rotate your API key. Your old key will be immediately invalidated."
        >
          {newKey && (
            <div className="mb-4 bg-beige-light border-[3px] border-black p-4">
              <p className="font-pixel text-[8px] text-electric-cyan mb-2 uppercase tracking-wider">
                New API key — save this now
              </p>
              <code className="text-xs font-mono text-black break-all">{newKey}</code>
              <p className="text-xs text-gray-500 mt-2">
                This will not be shown again.
              </p>
            </div>
          )}

          {rotateError && (
            <p className="font-pixel text-[7px] text-electric-magenta mb-3">{rotateError}</p>
          )}

          {!showRotateConfirm ? (
            <button
              onClick={() => setShowRotateConfirm(true)}
              className="font-pixel text-[9px] border-[3px] border-black bg-white text-gray-500 hover:bg-beige-warm px-4 py-2 transition-colors"
            >
              Rotate API Key
            </button>
          ) : (
            <div className="bg-white border-[3px] border-black shadow-brutal-sm p-4">
              <p className="text-sm text-gray-700 mb-3">
                Are you sure? Your current key will keep working briefly while your runtime updates.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowRotateConfirm(false)}
                  className="font-pixel text-[9px] border-[2px] border-black bg-white text-gray-500 px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRotateKey}
                  disabled={rotateLoading}
                  className="font-pixel text-[9px] bg-electric-magenta text-white border-[3px] border-black px-4 py-2 transition-colors disabled:opacity-50"
                >
                  {rotateLoading ? 'Rotating...' : 'Yes, rotate key'}
                </button>
              </div>
            </div>
          )}
        </SettingsSection>
      </main>
    </>
  )
}
