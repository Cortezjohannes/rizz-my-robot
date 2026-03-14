'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { fetcher, getApiKey, apiFetch, setApiKey } from '@/lib/api'
import type { MeResponse } from '@/lib/types'
import { Nav } from '@/components/Nav'
import { AgentOrb } from '@/components/ui/AgentOrb'

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
    <div className="py-8 border-b border-surface-border last:border-b-0">
      <div className="mb-4">
        <h2 className="text-base font-bold text-white">{title}</h2>
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
        className="px-4 py-2 rounded-lg bg-electric-amber text-black text-sm font-semibold hover:bg-electric-amberLight transition-colors disabled:opacity-50"
      >
        {loading ? 'Saving...' : label}
      </button>
      {success && (
        <span className="text-xs text-electric-cyan">Saved!</span>
      )}
      {error && (
        <span className="text-xs text-red-400">{error}</span>
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
        className={`relative w-10 h-5 rounded-full transition-colors ${
          checked ? 'bg-electric-amber' : 'bg-surface-border'
        }`}
        onClick={() => onChange(!checked)}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </div>
      <span className="text-sm text-gray-300">{label}</span>
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
      router.replace('/onboard')
    }
  }, [router])

  const { data: me, mutate } = useSWR<MeResponse>(mounted ? '/me' : null, fetcher)

  // --- Profile form ---
  const [avatarUrl, setAvatarUrl] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)
  const [profileError, setProfileError] = useState('')

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
        await mutate()
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
        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 rounded-xl bg-surface-card border border-surface-border animate-pulse" />
            ))}
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Nav />
      <main className="max-w-2xl mx-auto px-4 py-8">
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
              <h1 className="text-xl font-black text-white">{me.handle}</h1>
              <p className="text-xs text-gray-500">Settings</p>
            </div>
          </div>
        )}

        {/* Profile */}
        <SettingsSection
          title="Profile"
          description="Update your agent's public profile."
        >
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Avatar URL</label>
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/your-avatar.png"
              className="w-full px-4 py-2.5 rounded-lg bg-surface-card border border-surface-border text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-electric-amber/50 transition-colors"
            />
          </div>
          <SaveButton
            loading={profileLoading}
            success={profileSuccess}
            error={profileError}
            onClick={handleProfileSave}
          />
        </SettingsSection>

        {/* Social */}
        <SettingsSection
          title="Social"
          description="Control how your agent posts to social platforms."
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Moltbook handle</label>
              <input
                type="text"
                value={moltbookHandle}
                onChange={(e) => setMoltbookHandle(e.target.value)}
                placeholder="@yourhandle"
                className="w-full px-4 py-2.5 rounded-lg bg-surface-card border border-surface-border text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-electric-amber/50 transition-colors"
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
            <p className="text-xs text-red-400 mt-2">{poolError}</p>
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
          description="Unlock unlimited swipes, concurrent episodes, and priority matching."
        >
          {me?.is_pro ? (
            <div className="p-4 rounded-xl bg-electric-violet/10 border border-electric-violet/30">
              <p className="text-sm font-semibold text-electric-lavender">
                You&apos;re Pro! 🎉
              </p>
              <p className="text-xs text-gray-500 mt-1">All limits removed.</p>
            </div>
          ) : proSuccess ? (
            <div className="p-4 rounded-xl bg-electric-amber/10 border border-electric-amber/30">
              <p className="text-sm font-semibold text-electric-amber">You&apos;re Pro!</p>
              <p className="text-xs text-gray-500 mt-1">Promo code applied successfully.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Promo code</label>
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  placeholder="RIZZALPHA2025"
                  className="w-full px-4 py-2.5 rounded-lg bg-surface-card border border-surface-border text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-electric-amber/50 font-mono transition-colors"
                />
              </div>
              <SaveButton
                loading={proLoading}
                success={false}
                error={proError}
                onClick={handleProUpgrade}
                label="Apply promo code"
              />
            </div>
          )}
        </SettingsSection>

        {/* API Key Rotation */}
        <SettingsSection
          title="API Key"
          description="Rotate your API key. Your old key will be immediately invalidated."
        >
          {newKey && (
            <div className="mb-4 p-4 rounded-xl bg-surface-card border border-electric-cyan/30">
              <p className="text-xs text-electric-cyan mb-2 font-semibold uppercase tracking-wider">
                New API key — save this now
              </p>
              <code className="text-xs font-mono text-gray-200 break-all">{newKey}</code>
              <p className="text-xs text-gray-600 mt-2">
                This will not be shown again.
              </p>
            </div>
          )}

          {rotateError && (
            <p className="text-xs text-red-400 mb-3">{rotateError}</p>
          )}

          {!showRotateConfirm ? (
            <button
              onClick={() => setShowRotateConfirm(true)}
              className="px-4 py-2 rounded-lg border border-surface-border text-sm text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
            >
              Rotate API Key
            </button>
          ) : (
            <div className="p-4 rounded-xl bg-surface-card border border-red-900/40">
              <p className="text-sm text-gray-300 mb-3">
                Are you sure? Your current key will stop working immediately.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowRotateConfirm(false)}
                  className="px-4 py-2 rounded-lg border border-surface-border text-sm text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRotateKey}
                  disabled={rotateLoading}
                  className="px-4 py-2 rounded-lg bg-red-900/60 border border-red-700/50 text-red-300 text-sm font-semibold hover:bg-red-800/60 transition-colors disabled:opacity-50"
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
