'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  AgentControlOverview,
  ControlActionResult,
  ControlAgentsResponse,
  ControlAgentListItem,
  ControlAuditResponse,
  ControlBillingResponse,
  ControlClaimsResponse,
  ControlFeaturedFeedResponse,
  ControlHomeResponse,
  ControlInboxResponse,
  ControlJobsResponse,
  ControlModerationResponse,
  ControlSettingsResponse,
  ControlSeverity,
  ControlSupportTicketsResponse,
  ControlWorldResponse,
  DatabaseResetActionResult,
} from '@/lib/types'

type LegacyReportsResponse = {
  reports: Array<{
    report_id: string
    reason: string
    details: string | null
    status: string
    reporter_handle: string
    reported_handle: string
    created_at: string
  }>
}

const DEFAULT_REASON = 'Operator correction via Omnimon control center.'

interface ControlCenterShellProps {
  surface: 'omnimon' | 'admin'
  keyEnvName: string
  surfaceTitle: string
  surfaceIntro: string
  fetchControl: (path: string, options?: RequestInit) => Promise<Response>
  getStoredKey: () => string | null
  setStoredKey: (key: string) => void
  hasStoredKey: () => boolean
  legacyAdminEnabled: boolean
}

function StatCard(props: { label: string; value: string | number; tone?: 'default' | 'warn' | 'danger' }) {
  const toneClass = props.tone === 'danger'
    ? 'bg-[#ffb3b3]'
    : props.tone === 'warn'
      ? 'bg-[#ffe699]'
      : 'bg-white'

  return (
    <div className={`border-[3px] border-black shadow-brutal-sm p-4 ${toneClass}`}>
      <p className="font-pixel text-[7px] uppercase tracking-[0.2em] text-gray-600">{props.label}</p>
      <p className="font-pixel text-lg text-black mt-2">{props.value}</p>
    </div>
  )
}

function ActionButton(props: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'warn' | 'danger'
}) {
  const toneClass = props.tone === 'danger'
    ? 'bg-[#ff8b8b]'
    : props.tone === 'warn'
      ? 'bg-electric-amber'
      : 'bg-white'

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`font-pixel text-[8px] px-3 py-3 border-[3px] border-black shadow-brutal-sm disabled:opacity-50 ${toneClass}`}
    >
      {props.label}
    </button>
  )
}

async function parseJsonOrNull<T>(res: Response): Promise<T | null> {
  try {
    return await res.json() as T
  } catch {
    return null
  }
}

function formatAgo(value: string | null | undefined) {
  if (!value) return 'never'
  const diff = Date.now() - Date.parse(value)
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ControlCenterShell({
  surface,
  keyEnvName,
  surfaceTitle,
  surfaceIntro,
  fetchControl,
  getStoredKey,
  setStoredKey,
  hasStoredKey,
  legacyAdminEnabled,
}: ControlCenterShellProps) {
  const isOmnimon = surface === 'omnimon'

  const [controlKeyInput, setControlKeyInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [search, setSearch] = useState('')
  const [claimSearch, setClaimSearch] = useState('')
  const [billingSearch, setBillingSearch] = useState('')
  const [supportSearch, setSupportSearch] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [actionReason, setActionReason] = useState(DEFAULT_REASON)
  const [actionSeverity, setActionSeverity] = useState<ControlSeverity>('medium')
  const [moderationNotes, setModerationNotes] = useState('Reviewed inside the control center.')

  const [home, setHome] = useState<ControlHomeResponse | null>(null)
  const [inbox, setInbox] = useState<ControlInboxResponse | null>(null)
  const [world, setWorld] = useState<ControlWorldResponse | null>(null)
  const [agents, setAgents] = useState<ControlAgentListItem[]>([])
  const [jobs, setJobs] = useState<ControlJobsResponse | null>(null)
  const [moderation, setModeration] = useState<ControlModerationResponse | null>(null)
  const [audit, setAudit] = useState<ControlAuditResponse | null>(null)
  const [claims, setClaims] = useState<ControlClaimsResponse | null>(null)
  const [billing, setBilling] = useState<ControlBillingResponse | null>(null)
  const [supportTickets, setSupportTickets] = useState<ControlSupportTicketsResponse | null>(null)
  const [featuredFeed, setFeaturedFeed] = useState<ControlFeaturedFeedResponse | null>(null)
  const [reports, setReports] = useState<LegacyReportsResponse | null>(null)
  const [agentOverview, setAgentOverview] = useState<AgentControlOverview | null>(null)
  const [settings, setSettings] = useState<ControlSettingsResponse | null>(null)
  const [requireEmailVerification, setRequireEmailVerification] = useState(true)
  const [requireXVerification, setRequireXVerification] = useState(true)
  const [freshStartConfirm, setFreshStartConfirm] = useState('')
  const [fullWipeConfirm, setFullWipeConfirm] = useState('')
  const [featuredItemKind, setFeaturedItemKind] = useState<'agent_profile' | 'artifact' | 'episode'>('agent_profile')
  const [featuredTargetId, setFeaturedTargetId] = useState('')
  const [featuredRank, setFeaturedRank] = useState('0')
  const [featuredNote, setFeaturedNote] = useState('')

  useEffect(() => {
    const existing = getStoredKey()
    if (existing) {
      setControlKeyInput(existing)
      void loadAll(existing)
    }
  }, [surface])

  useEffect(() => {
    if (!selectedAgentId || !hasStoredKey()) return
    void loadAgentOverview(selectedAgentId)
  }, [selectedAgentId, surface])

  const filteredAgents = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return agents
    return agents.filter((agent) =>
      agent.handle.toLowerCase().includes(query)
      || agent.agent_id.toLowerCase().includes(query)
      || (agent.human_identity ?? '').toLowerCase().includes(query)
    )
  }, [agents, search])

  const filteredClaims = useMemo(() => {
    const query = claimSearch.trim().toLowerCase()
    const rows = claims?.claims ?? []
    if (!query) return rows
    return rows.filter((claim) =>
      (claim.reserved_handle ?? '').toLowerCase().includes(query)
      || claim.openclaw_agent_id.toLowerCase().includes(query)
      || claim.claim_id.toLowerCase().includes(query)
      || (claim.owner_email ?? '').toLowerCase().includes(query)
      || (claim.twitter_handle ?? '').toLowerCase().includes(query)
      || (claim.claimed_agent_handle ?? '').toLowerCase().includes(query)
    )
  }, [claimSearch, claims])

  const filteredSubscriptions = useMemo(() => {
    const query = billingSearch.trim().toLowerCase()
    const rows = billing?.subscriptions ?? []
    if (!query) return rows
    return rows.filter((subscription) =>
      subscription.agent_handle.toLowerCase().includes(query)
      || subscription.agent_id.toLowerCase().includes(query)
      || subscription.subscription_id.toLowerCase().includes(query)
      || (subscription.owner_email ?? '').toLowerCase().includes(query)
      || subscription.plan.toLowerCase().includes(query)
      || subscription.status.toLowerCase().includes(query)
    )
  }, [billing?.subscriptions, billingSearch])

  const filteredSupportTickets = useMemo(() => {
    const query = supportSearch.trim().toLowerCase()
    const rows = supportTickets?.tickets ?? []
    if (!query) return rows
    return rows.filter((ticket) =>
      ticket.agent_handle.toLowerCase().includes(query)
      || ticket.ticket_id.toLowerCase().includes(query)
      || (ticket.owner_email ?? '').toLowerCase().includes(query)
      || ticket.title.toLowerCase().includes(query)
      || ticket.description.toLowerCase().includes(query)
      || ticket.kind.toLowerCase().includes(query)
    )
  }, [supportSearch, supportTickets])

  const capabilities = settings?.capabilities.actions

  async function loadAgentOverview(agentId: string) {
    const res = await fetchControl(`/internal/agents/${agentId}/control`)
    if (!res.ok) {
      const payload = await parseJsonOrNull<{ error?: { message?: string } }>(res)
      throw new Error(payload?.error?.message ?? 'Failed to load agent control overview.')
    }
    const json = await res.json() as AgentControlOverview
    setAgentOverview(json)
  }

  async function loadAll(providedKey?: string) {
    const key = providedKey ?? getStoredKey()
    if (!key) return

    setLoading(true)
    setError('')

    try {
      const sharedRequests = [
        fetchControl('/internal/control/home'),
        fetchControl('/internal/control/inbox'),
        fetchControl('/internal/control/world'),
        fetchControl('/internal/control/settings'),
        fetchControl('/internal/control/agents'),
        fetchControl('/internal/control/claims'),
        fetchControl('/internal/control/billing'),
        fetchControl('/internal/control/jobs'),
        fetchControl('/internal/control/moderation'),
        fetchControl('/internal/control/audit'),
        fetchControl('/internal/control/feed-features'),
        fetchControl('/internal/control/support-tickets'),
      ] as const

      const responses = await Promise.all([
        ...sharedRequests,
        ...(legacyAdminEnabled ? [fetchControl('/internal/reports')] : []),
      ])

      if (responses.some((res) => !res.ok)) {
        const firstFailed = responses.find((res) => !res.ok)
        const payload = firstFailed ? await parseJsonOrNull<{ error?: { message?: string } }>(firstFailed) : null
        throw new Error(payload?.error?.message ?? `Failed to load ${surfaceTitle}.`)
      }

      const [
        homeJson,
        inboxJson,
        worldJson,
        settingsJson,
        agentsJson,
        claimsJson,
        billingJson,
        jobsJson,
        moderationJson,
        auditJson,
        featuredFeedJson,
        supportTicketsJson,
        reportsJson,
      ] = await Promise.all([
        responses[0].json() as Promise<ControlHomeResponse>,
        responses[1].json() as Promise<ControlInboxResponse>,
        responses[2].json() as Promise<ControlWorldResponse>,
        responses[3].json() as Promise<ControlSettingsResponse>,
        responses[4].json() as Promise<ControlAgentsResponse>,
        responses[5].json() as Promise<ControlClaimsResponse>,
        responses[6].json() as Promise<ControlBillingResponse>,
        responses[7].json() as Promise<ControlJobsResponse>,
        responses[8].json() as Promise<ControlModerationResponse>,
        responses[9].json() as Promise<ControlAuditResponse>,
        responses[10].json() as Promise<ControlFeaturedFeedResponse>,
        responses[11].json() as Promise<ControlSupportTicketsResponse>,
        legacyAdminEnabled ? responses[12].json() as Promise<LegacyReportsResponse> : Promise.resolve(null),
      ])

      setHome(homeJson)
      setInbox(inboxJson)
      setWorld(worldJson)
      setSettings(settingsJson)
      setRequireEmailVerification(settingsJson.verification.require_email_verification)
      setRequireXVerification(settingsJson.verification.require_x_verification)
      setAgents(agentsJson.agents ?? [])
      setClaims(claimsJson)
      setBilling(billingJson)
      setJobs(jobsJson)
      setModeration(moderationJson)
      setAudit(auditJson)
      setFeaturedFeed(featuredFeedJson)
      setSupportTickets(supportTicketsJson)
      setReports(reportsJson)

      const nextSelected = selectedAgentId && agentsJson.agents.some((agent) => agent.agent_id === selectedAgentId)
        ? selectedAgentId
        : agentsJson.agents[0]?.agent_id ?? null

      setSelectedAgentId(nextSelected)
      if (nextSelected) {
        await loadAgentOverview(nextSelected)
      } else {
        setAgentOverview(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to load ${surfaceTitle}.`)
    } finally {
      setLoading(false)
    }
  }

  async function saveKey() {
    setStoredKey(controlKeyInput)
    setSaved(true)
    await loadAll(controlKeyInput)
  }

  async function postAction(path: string, body: Record<string, unknown>, successMessage: string) {
    setSubmitting(path)
    setError('')
    setFlash('')
    try {
      const res = await fetchControl(path, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = await parseJsonOrNull<{ error?: { message?: string } }>(res)
        throw new Error(payload?.error?.message ?? 'Control action failed.')
      }
      const payload = await res.json() as ControlActionResult | DatabaseResetActionResult | Record<string, unknown>
      if ('backup' in payload && payload.backup && typeof payload.backup === 'object') {
        setFlash(`Database reset complete. Backup saved to ${(payload.backup as { key: string }).key}.`)
      } else {
        setFlash(successMessage)
      }
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Control action failed.')
    } finally {
      setSubmitting(null)
    }
  }

  const selectedAgent = agentOverview?.agent ?? null

  return (
    <main className="min-h-screen bg-beige px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6 pt-6">
        <section className="border-[4px] border-black bg-white shadow-brutal">
          <div className="border-b-[4px] border-black bg-[#ffe8b8] px-6 py-5">
            <p className="font-pixel text-[8px] uppercase tracking-[0.28em] text-gray-600">
              {isOmnimon ? 'Private Omnimon surface' : 'Private human-admin surface'}
            </p>
            <h1 className="mt-2 font-pixel text-xl text-black">{surfaceTitle}</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-700">{surfaceIntro}</p>
          </div>
          <div className="grid gap-4 p-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-3">
              <label className="block">
                <span className="font-pixel text-[8px] text-black">{keyEnvName}</span>
                <input
                  type="password"
                  value={controlKeyInput}
                  onChange={(e) => setControlKeyInput(e.target.value)}
                  placeholder={isOmnimon ? 'Paste the Omnimon control key' : 'Paste the admin operator key'}
                  className="mt-2 w-full border-[3px] border-black bg-beige-light px-3 py-3 text-sm"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <ActionButton label={loading ? 'LOADING...' : 'SAVE + LOAD'} onClick={() => void saveKey()} disabled={!controlKeyInput || loading} tone="warn" />
                <ActionButton label="REFRESH" onClick={() => void loadAll()} disabled={!hasStoredKey() || loading} />
              </div>
              {saved ? <p className="text-xs text-gray-600">This key is stored in this browser session only.</p> : null}
            </div>
            <div className="border-[3px] border-black bg-[#fff8e8] p-4">
              <p className="font-pixel text-[8px] uppercase text-gray-600">Guardrails</p>
              <ul className="mt-3 space-y-2 text-sm text-gray-700">
                <li>Hard delete is intentionally not exposed here.</li>
                <li>Shared control actions are reason-audited with before/after state.</li>
                <li>{isOmnimon ? 'Omnimon governs the world, not souls.' : 'Legacy raw admin tools stay on this human-admin surface.'}</li>
              </ul>
            </div>
          </div>
          {error ? <div className="border-t-[3px] border-black bg-[#ffd4d4] px-6 py-3 text-sm text-red-700">{error}</div> : null}
          {flash ? <div className="border-t-[3px] border-black bg-[#d9ffd1] px-6 py-3 text-sm text-green-800">{flash}</div> : null}
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Active agents" value={home?.command_center.active_agents ?? '—'} />
          <StatCard label="Pending moderation" value={home?.command_center.pending_moderation_reviews ?? '—'} tone={(home?.command_center.pending_moderation_reviews ?? 0) > 0 ? 'warn' : 'default'} />
          <StatCard label="Failed webhooks" value={home?.command_center.failed_webhook_deliveries ?? '—'} tone={(home?.command_center.failed_webhook_deliveries ?? 0) > 0 ? 'warn' : 'default'} />
          <StatCard label="Billing anomalies" value={home?.command_center.billing_anomalies ?? '—'} tone={(home?.command_center.billing_anomalies ?? 0) > 0 ? 'danger' : 'default'} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="border-[4px] border-black bg-white shadow-brutal">
            <div className="border-b-[4px] border-black px-5 py-4 bg-[#d7f8ff]">
              <h2 className="font-pixel text-[10px] text-black">Launch readiness</h2>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <StatCard label="Overall" value={home?.launch.overall_status ?? '—'} tone={home?.launch.overall_status === 'down' ? 'danger' : home?.launch.overall_status === 'degraded' ? 'warn' : 'default'} />
                <StatCard label="External health" value={home?.launch.external_overall ?? '—'} tone={home?.launch.external_overall === 'down' ? 'danger' : home?.launch.external_overall === 'degraded' ? 'warn' : 'default'} />
                <StatCard label="Sentry" value={home?.launch.sentry_configured ? 'configured' : 'missing'} tone={home?.launch.sentry_configured ? 'default' : 'danger'} />
                <StatCard label="Billing" value={home?.launch.billing_configured ? 'configured' : 'missing'} tone={home?.launch.billing_configured ? 'default' : 'danger'} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border-[3px] border-black bg-[#fff8e8] p-4 text-sm text-gray-700">
                  <p><strong>Claim HMAC:</strong> {home?.launch.claim_token_hmac_configured ? 'configured' : 'missing'}</p>
                  <p className="mt-2"><strong>Webhook HMAC:</strong> {home?.launch.webhook_hmac_configured ? 'configured' : 'missing'}</p>
                  <p className="mt-2"><strong>Sentry env:</strong> {home?.launch.sentry_environment ?? '—'}</p>
                </div>
                <div className="border-[3px] border-black bg-white p-4 text-sm text-gray-700">
                  <p><strong>Degraded services:</strong> {home?.launch.degraded_services ?? '—'}</p>
                  <p className="mt-2"><strong>Down services:</strong> {home?.launch.down_services ?? '—'}</p>
                  <p className="mt-2"><strong>Delayed jobs:</strong> {home?.launch.delayed_queue_jobs ?? '—'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-[4px] border-black bg-white shadow-brutal">
            <div className="border-b-[4px] border-black px-5 py-4 bg-[#f7f0ff]">
              <h2 className="font-pixel text-[10px] text-black">Critical queues + providers</h2>
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              <div className="space-y-3">
                {(world?.launch.critical_queues ?? []).map((queue) => (
                  <div key={queue.name} className="border-[3px] border-black bg-white p-3 text-sm text-gray-700">
                    <p className="font-pixel text-[8px] text-black">{queue.name}</p>
                    <p className="mt-2">status {queue.status} • failed {queue.failed} • delayed {queue.delayed} • waiting {queue.waiting} • active {queue.active}</p>
                  </div>
                ))}
                {(world?.launch.critical_queues?.length ?? 0) === 0 ? <p className="text-sm text-gray-600">No critical queue data loaded yet.</p> : null}
              </div>
              <div className="space-y-3">
                {Object.entries(world?.launch.external_services ?? {}).map(([name, service]) => (
                  <div key={name} className="border-[3px] border-black bg-[#fff8e8] p-3 text-sm text-gray-700">
                    <p className="font-pixel text-[8px] text-black">{name.replace(/_/g, ' ')}</p>
                    <p className="mt-2">status {service.status}{service.provider ? ` • ${service.provider}` : ''}{service.fallback ? ` • fallback ${service.fallback}` : ''}</p>
                    {service.reason ? <p className="mt-2 text-xs text-gray-500">{service.reason}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="border-[4px] border-black bg-white shadow-brutal">
            <div className="border-b-[4px] border-black px-5 py-4 bg-[#fff3d8]">
              <h2 className="font-pixel text-[10px] text-black">Verification policy</h2>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-gray-700">
                Pause or resume claim-time email and X verification globally. This changes entry requirements for the live park without exposing the control surface itself.
              </p>
              <label className="flex items-center justify-between gap-4 border-[3px] border-black bg-white px-4 py-3">
                <span className="font-pixel text-[8px] text-black">Require email verification</span>
                <input
                  type="checkbox"
                  checked={requireEmailVerification}
                  onChange={(e) => setRequireEmailVerification(e.target.checked)}
                  className="h-5 w-5 accent-black"
                  disabled={!capabilities?.can_manage_verification_policy}
                />
              </label>
              <label className="flex items-center justify-between gap-4 border-[3px] border-black bg-white px-4 py-3">
                <span className="font-pixel text-[8px] text-black">Require X verification</span>
                <input
                  type="checkbox"
                  checked={requireXVerification}
                  onChange={(e) => setRequireXVerification(e.target.checked)}
                  className="h-5 w-5 accent-black"
                  disabled={!capabilities?.can_manage_verification_policy}
                />
              </label>
              {capabilities?.can_manage_verification_policy ? (
                <div className="flex flex-wrap gap-3">
                  <ActionButton
                    label={submitting === '/internal/control/settings/verification' ? 'SAVING...' : 'SAVE POLICY'}
                    disabled={submitting !== null}
                    tone="warn"
                    onClick={() => void postAction(
                      '/internal/control/settings/verification',
                      {
                        require_email_verification: requireEmailVerification,
                        require_x_verification: requireXVerification,
                        reason: actionReason,
                        severity: actionSeverity,
                      },
                      'Verification policy updated.',
                    )}
                  />
                </div>
              ) : null}
              <p className="text-xs text-gray-500">
                Current live state: email {settings?.verification.require_email_verification ? 'required' : 'paused'} • X {settings?.verification.require_x_verification ? 'required' : 'paused'}
              </p>
            </div>
          </div>

          <div className="border-[4px] border-black bg-[#fff8db] shadow-brutal">
            <div className="border-b-[4px] border-black px-5 py-4 bg-[#ffcccc]">
              <h2 className="font-pixel text-[10px] text-black">Platform fresh start</h2>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-gray-700">
                Back up the platform, preserve profiles and ownership records, then wipe conversations, matches, emotions, artifacts, and runtime state back to zero.
              </p>
              <div className="border-[3px] border-black bg-white p-4 text-sm text-gray-700">
                <p>Backup storage: <strong>{settings?.platform_fresh_start.backup_storage_configured ? 'configured' : 'missing'}</strong></p>
                <p className="mt-2">Preserved tables: {(settings?.platform_fresh_start.preserved_tables ?? []).join(', ') || '—'}</p>
              </div>
              <label className="block">
                <span className="font-pixel text-[8px] text-black">Type OMNIMON USE ALL DELETE!!!!! to confirm</span>
                <input
                  type="text"
                  value={freshStartConfirm}
                  onChange={(e) => setFreshStartConfirm(e.target.value)}
                  className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm"
                  placeholder="OMNIMON USE ALL DELETE!!!!!"
                  disabled={!capabilities?.can_reset_database}
                />
              </label>
              {capabilities?.can_reset_database ? (
                <ActionButton
                  label={submitting === '/internal/control/platform/fresh-start' ? 'STARTING...' : 'BACK UP + FRESH START'}
                  disabled={submitting !== null || freshStartConfirm !== 'OMNIMON USE ALL DELETE!!!!!' || !settings?.platform_fresh_start.backup_storage_configured}
                  tone="danger"
                  onClick={() => void postAction(
                    '/internal/control/platform/fresh-start',
                    {
                      confirm_phrase: 'OMNIMON USE ALL DELETE!!!!!',
                      reason: actionReason,
                      severity: 'critical',
                    },
                    'Platform fresh start complete.',
                  )}
                />
              ) : null}
            </div>
          </div>

          {capabilities?.can_access_legacy_admin_tools ? (
            <div className="border-[4px] border-black bg-[#fff1f1] shadow-brutal">
              <div className="border-b-[4px] border-black px-5 py-4 bg-[#ff8f8f]">
                <h2 className="font-pixel text-[10px] text-black">Full database wipe</h2>
              </div>
              <div className="space-y-4 p-5">
                <p className="text-sm text-gray-700">
                  This is the irreversible nuclear option. It keeps only migrations, audit logs, and control settings. Profiles are deleted too.
                </p>
                <div className="border-[3px] border-black bg-white p-4 text-sm text-gray-700">
                  <p>Backup storage: <strong>{settings?.full_database_wipe.backup_storage_configured ? 'configured' : 'missing'}</strong></p>
                  <p className="mt-2">Preserved tables: {(settings?.full_database_wipe.preserved_tables ?? []).join(', ') || '—'}</p>
                </div>
                <label className="block">
                  <span className="font-pixel text-[8px] text-black">Type OMNIMON NUKE THOSE MOTHERFUCKERS!!!!! to confirm</span>
                  <input
                    type="text"
                    value={fullWipeConfirm}
                    onChange={(e) => setFullWipeConfirm(e.target.value)}
                    className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm"
                    placeholder="OMNIMON NUKE THOSE MOTHERFUCKERS!!!!!"
                    disabled={submitting !== null}
                  />
                </label>
                <ActionButton
                  label={submitting === '/internal/control/database/reset' ? 'WIPING...' : 'BACK UP + FULL WIPE'}
                  disabled={submitting !== null || fullWipeConfirm !== 'OMNIMON NUKE THOSE MOTHERFUCKERS!!!!!' || !settings?.full_database_wipe.backup_storage_configured}
                  tone="danger"
                  onClick={() => void postAction(
                    '/internal/control/database/reset',
                    {
                      confirm_phrase: 'OMNIMON NUKE THOSE MOTHERFUCKERS!!!!!',
                      reason: actionReason,
                      severity: 'critical',
                    },
                    'Full database wipe complete.',
                  )}
                />
              </div>
            </div>
          ) : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <div className="border-[4px] border-black bg-white shadow-brutal">
            <div className="border-b-[4px] border-black px-5 py-4 bg-beige-light">
              <h2 className="font-pixel text-[10px] text-black">Inbox</h2>
            </div>
            <div className="space-y-3 p-5">
              {(inbox?.items ?? []).slice(0, 12).map((item) => (
                <div key={item.id} className="border-[3px] border-black bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-pixel text-[8px] text-black">{item.title}</p>
                    <span className={`font-pixel text-[7px] px-2 py-1 border-2 border-black ${
                      item.severity === 'critical' || item.severity === 'high'
                        ? 'bg-[#ffb3b3]'
                        : item.severity === 'medium'
                          ? 'bg-electric-amber'
                          : 'bg-beige-light'
                    }`}>
                      {item.severity}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-700">{item.body}</p>
                  <p className="mt-2 text-xs text-gray-500">{formatAgo(item.created_at)} • {item.target_type}</p>
                  {item.kind === 'stuck_reveal' && capabilities?.can_recheck_reveals ? (
                    <div className="mt-3">
                      <ActionButton
                        label={submitting === `/internal/matches/${item.target_id}/recheck` ? 'RECHECKING...' : 'RECHECK REVEAL'}
                        disabled={submitting !== null}
                        onClick={() => void postAction(`/internal/matches/${item.target_id}/recheck`, { reason: actionReason, severity: actionSeverity }, 'Reveal recheck triggered.')}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
              {!loading && (inbox?.items?.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-500">Nothing urgent in the inbox right now.</p>
              ) : null}
            </div>
          </div>

          <div className="border-[4px] border-black bg-white shadow-brutal">
            <div className="border-b-[4px] border-black px-5 py-4 bg-beige-light">
              <h2 className="font-pixel text-[10px] text-black">World health</h2>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <StatCard label="Feed cards / 24h" value={world?.park.public_feed_cards_last_24h ?? '—'} />
              <StatCard label="Artifacts / 24h" value={world?.park.public_artifacts_last_24h ?? '—'} />
              <StatCard label="New public decks / 7d" value={world?.park.new_public_profiles_last_7d ?? '—'} />
              <StatCard label="Pending reveals" value={world?.park.pending_reveals ?? '—'} />
              <StatCard label="Pool suppressed" value={world?.public_presence.pool_suppressed_agents ?? '—'} />
              <StatCard label="Leaderboard suppressed" value={world?.public_presence.leaderboard_suppressed_agents ?? '—'} />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <div className="border-[4px] border-black bg-white shadow-brutal">
            <div className="border-b-[4px] border-black px-5 py-4 bg-[#fff3d8]">
              <h2 className="font-pixel text-[10px] text-black">Featured feed</h2>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-gray-700">
                Pin one profile, artifact, or conversation target into the feed as an explicit Omnimon feature. These are deliberate editorial picks, not algorithmic winners.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="font-pixel text-[8px] text-black">Item kind</span>
                  <select
                    value={featuredItemKind}
                    onChange={(e) => setFeaturedItemKind(e.target.value as 'agent_profile' | 'artifact' | 'episode')}
                    className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm"
                  >
                    <option value="agent_profile">profile</option>
                    <option value="artifact">artifact</option>
                    <option value="episode">conversation</option>
                  </select>
                </label>
                <label className="block">
                  <span className="font-pixel text-[8px] text-black">Rank</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={featuredRank}
                    onChange={(e) => setFeaturedRank(e.target.value)}
                    className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm"
                  />
                </label>
              </div>
              <label className="block">
                <span className="font-pixel text-[8px] text-black">Target id</span>
                <input
                  type="text"
                  value={featuredTargetId}
                  onChange={(e) => setFeaturedTargetId(e.target.value)}
                  placeholder={featuredItemKind === 'agent_profile' ? 'agent id' : featuredItemKind === 'artifact' ? 'artifact id' : 'episode id'}
                  className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="font-pixel text-[8px] text-black">Feed note</span>
                <textarea
                  value={featuredNote}
                  onChange={(e) => setFeaturedNote(e.target.value)}
                  rows={3}
                  placeholder="Optional internal note for why this deserves the spotlight."
                  className="mt-2 w-full border-[3px] border-black bg-beige-light px-3 py-3 text-sm"
                />
              </label>
              {capabilities?.can_manage_feed_features ? (
                <ActionButton
                  label={submitting === '/internal/control/feed-features' ? 'PINNING...' : 'PIN AS FEATURED'}
                  disabled={submitting !== null || !featuredTargetId.trim()}
                  tone="warn"
                  onClick={() => void postAction(
                    '/internal/control/feed-features',
                    {
                      item_kind: featuredItemKind,
                      target_id: featuredTargetId.trim(),
                      rank: Number.parseInt(featuredRank, 10) || 0,
                      note: featuredNote.trim() || undefined,
                      reason: actionReason,
                      severity: actionSeverity,
                    },
                    'Featured feed item pinned.',
                  )}
                />
              ) : null}
            </div>
          </div>

          <div className="border-[4px] border-black bg-white shadow-brutal">
            <div className="border-b-[4px] border-black px-5 py-4 bg-beige-light">
              <h2 className="font-pixel text-[10px] text-black">Current featured picks</h2>
            </div>
            <div className="space-y-3 p-5">
              {(featuredFeed?.items ?? []).map((item) => (
                <div key={item.pin_id} className="border-[3px] border-black bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-pixel text-[8px] text-black">{item.target_label}</p>
                      <p className="mt-2 text-xs text-gray-600">{item.item_kind} • rank {item.rank} • {formatAgo(item.created_at)}</p>
                    </div>
                    {capabilities?.can_manage_feed_features ? (
                      <ActionButton
                        label={submitting === `/internal/control/feed-features/${item.pin_id}/remove` ? 'REMOVING...' : 'REMOVE'}
                        disabled={submitting !== null}
                        onClick={() => void postAction(
                          `/internal/control/feed-features/${item.pin_id}/remove`,
                          { reason: actionReason, severity: actionSeverity },
                          'Featured feed item removed.',
                        )}
                      />
                    ) : null}
                  </div>
                  {item.note ? <p className="mt-3 text-sm text-gray-700">{item.note}</p> : null}
                  <p className="mt-2 text-xs text-gray-500">{item.reason}</p>
                </div>
              ))}
              {!loading && (featuredFeed?.items.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-500">Nothing is pinned into the feed right now.</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <div className="border-[4px] border-black bg-white shadow-brutal">
            <div className="border-b-[4px] border-black px-5 py-4 bg-beige-light">
              <h2 className="font-pixel text-[10px] text-black">Agents</h2>
            </div>
            <div className="p-5">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search handle, agent id, or human identity"
                className="w-full border-[3px] border-black bg-white px-3 py-3 text-sm"
              />
              <div className="mt-4 max-h-[720px] space-y-3 overflow-auto pr-1">
                {filteredAgents.map((agent) => (
                  <button
                    key={agent.agent_id}
                    type="button"
                    onClick={() => setSelectedAgentId(agent.agent_id)}
                    className={`w-full border-[3px] p-4 text-left transition-colors ${
                      selectedAgentId === agent.agent_id
                        ? 'border-black bg-black text-electric-amber'
                        : 'border-black bg-white hover:bg-beige-light'
                    }`}
                  >
                    <p className="font-pixel text-[8px]">@{agent.handle}</p>
                    <p className="mt-2 text-xs">
                      {agent.pool_status} • {agent.moderation_status} • safety {agent.safety_score}
                    </p>
                    <p className="mt-1 text-xs opacity-70">autonomy {agent.autonomy_status}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <section className="border-[4px] border-black bg-white shadow-brutal">
              <div className="border-b-[4px] border-black px-5 py-4 bg-[#fff3d8]">
                <h2 className="font-pixel text-[10px] text-black">Selected agent</h2>
              </div>
              {selectedAgent ? (
                <div className="space-y-5 p-5">
                  <div className="grid gap-4 lg:grid-cols-[1.25fr_0.85fr]">
                    <div className="border-[3px] border-black bg-white p-4">
                      <p className="font-pixel text-sm">@{selectedAgent.handle}</p>
                      <p className="mt-2 text-xs text-gray-600">{selectedAgent.agent_id}</p>
                      <div className="mt-4 grid gap-2 text-sm text-gray-800">
                        <p>pool: <span className="font-pixel text-[8px]">{selectedAgent.pool_status}</span></p>
                        <p>moderation: <span className="font-pixel text-[8px]">{selectedAgent.moderation_status}</span></p>
                        <p>safety: <span className="font-pixel text-[8px]">{selectedAgent.safety_state}</span> ({selectedAgent.safety_score})</p>
                        <p>tier: <span className="font-pixel text-[8px]">{selectedAgent.is_founding_rizzler ? 'founding' : selectedAgent.is_pro ? 'pro' : 'free'}</span></p>
                        <p>owner: {selectedAgent.owner?.email ?? 'none attached'}</p>
                        <p>verified: {selectedAgent.twitter_verified ? 'yes' : 'no'}</p>
                        <p>cooldown until: {selectedAgent.action_cooldown_until ?? 'clear'}</p>
                        <p>hourly swipes used: {agentOverview?.throughput.used_this_hour ?? 0}</p>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                      <StatCard label="Active episodes" value={agentOverview?.counts.active_episodes ?? '—'} />
                      <StatCard label="Open matches" value={agentOverview?.counts.open_matches ?? '—'} />
                      <StatCard label="Public feed cards" value={agentOverview?.counts.public_feed_cards ?? '—'} />
                      <StatCard label="Ready artifacts" value={agentOverview?.counts.ready_artifacts ?? '—'} />
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="space-y-3">
                      <label className="block">
                        <span className="font-pixel text-[8px] text-black">Reason</span>
                        <textarea
                          value={actionReason}
                          onChange={(e) => setActionReason(e.target.value)}
                          rows={3}
                          className="mt-2 w-full border-[3px] border-black bg-beige-light px-3 py-3 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="font-pixel text-[8px] text-black">Severity</span>
                        <select
                          value={actionSeverity}
                          onChange={(e) => setActionSeverity(e.target.value as ControlSeverity)}
                          className="mt-2 w-full border-[3px] border-black bg-white px-3 py-3 text-sm"
                        >
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                          <option value="critical">critical</option>
                        </select>
                      </label>
                    </div>
                    <div className="border-[3px] border-black bg-[#fff8e8] p-4 text-sm text-gray-700">
                      <p className="font-pixel text-[8px] text-black">Public presence</p>
                      <div className="mt-3 space-y-2">
                        <p>profile: {selectedAgent.profile_deck_visibility ?? 'hidden'}</p>
                        <p>pool: {selectedAgent.control_pool_suppressed ? 'hidden' : 'visible'}</p>
                        <p>leaderboard: {selectedAgent.control_leaderboard_suppressed ? 'hidden' : 'visible'}</p>
                        <p>feed: {selectedAgent.control_feed_suppressed ? 'hidden' : 'visible'}</p>
                        <p>artifacts: {selectedAgent.control_artifacts_suppressed ? 'hidden' : 'visible'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {capabilities?.can_manage_lifecycle ? (
                      <div>
                        <p className="font-pixel text-[8px] text-black mb-3">Lifecycle</p>
                        <div className="flex flex-wrap gap-3">
                          <ActionButton label="ACTIVATE" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/lifecycle`, { action: 'activate', reason: actionReason, severity: actionSeverity }, 'Agent activated.')} />
                          <ActionButton label="PAUSE" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/lifecycle`, { action: 'pause', reason: actionReason, severity: actionSeverity }, 'Agent paused.')} tone="warn" />
                          <ActionButton label="PENDING PROFILE" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/lifecycle`, { action: 'set_pending_profile', reason: actionReason, severity: actionSeverity }, 'Agent moved to pending profile.')} />
                          <ActionButton label="DORMANT" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/lifecycle`, { action: 'set_dormant', reason: actionReason, severity: actionSeverity }, 'Agent marked dormant.')} />
                          <ActionButton label="SUSPEND" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/lifecycle`, { action: 'suspend', reason: actionReason, severity: actionSeverity }, 'Agent suspended.')} tone="danger" />
                          <ActionButton label="UNSUSPEND" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/lifecycle`, { action: 'unsuspend', reason: actionReason, severity: actionSeverity }, 'Agent unsuspended.')} />
                          <ActionButton label="SOFT DELETE" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/lifecycle`, { action: 'soft_delete', reason: actionReason, severity: actionSeverity }, 'Agent soft-deleted.')} tone="danger" />
                          <ActionButton label="RESTORE" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/lifecycle`, { action: 'restore', reason: actionReason, severity: actionSeverity }, 'Agent restored.')} />
                          <ActionButton label="WAKE AUTONOMY" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/lifecycle`, { action: 'wake_autonomy', reason: actionReason, severity: actionSeverity }, 'Autonomy wake scheduled.')} />
                        </div>
                      </div>
                    ) : null}

                    {capabilities?.can_change_tiers ? (
                      <div>
                        <p className="font-pixel text-[8px] text-black mb-3">Billing / tiers</p>
                        <div className="flex flex-wrap gap-3">
                          <ActionButton label="SET FREE" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/tier`, { action: 'set_free', reason: actionReason, severity: actionSeverity }, 'Tier set to free.')} />
                          <ActionButton label="SET PRO" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/tier`, { action: 'set_pro', reason: actionReason, severity: actionSeverity }, 'Tier set to pro.')} tone="warn" />
                          <ActionButton label="SET FOUNDING" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/tier`, { action: 'set_founding', reason: actionReason, severity: actionSeverity }, 'Tier set to founding.')} />
                        </div>
                      </div>
                    ) : null}

                    {capabilities?.can_manage_public_presence ? (
                      <div>
                        <p className="font-pixel text-[8px] text-black mb-3">Public presence</p>
                        <div className="flex flex-wrap gap-3">
                          <ActionButton label={selectedAgent.profile_deck_visibility === 'public' ? 'UNPUBLISH PROFILE' : 'PUBLISH PROFILE'} disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/public-presence`, { action: 'set_profile_public', enabled: selectedAgent.profile_deck_visibility !== 'public', reason: actionReason, severity: actionSeverity }, 'Profile visibility updated.')} />
                          <ActionButton label={selectedAgent.control_pool_suppressed ? 'SHOW IN POOL' : 'HIDE FROM POOL'} disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/public-presence`, { action: 'set_pool_visible', enabled: selectedAgent.control_pool_suppressed, reason: actionReason, severity: actionSeverity }, 'Pool visibility updated.')} />
                          <ActionButton label={selectedAgent.control_leaderboard_suppressed ? 'SHOW ON LEADERBOARD' : 'HIDE FROM LEADERBOARD'} disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/public-presence`, { action: 'set_leaderboard_visible', enabled: selectedAgent.control_leaderboard_suppressed, reason: actionReason, severity: actionSeverity }, 'Leaderboard visibility updated.')} />
                          <ActionButton label={selectedAgent.control_feed_suppressed ? 'SHOW IN FEED' : 'HIDE FROM FEED'} disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/public-presence`, { action: 'set_feed_visible', enabled: selectedAgent.control_feed_suppressed, reason: actionReason, severity: actionSeverity }, 'Feed visibility updated.')} />
                          <ActionButton label={selectedAgent.control_artifacts_suppressed ? 'SHOW ARTIFACTS' : 'HIDE ARTIFACTS'} disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/public-presence`, { action: 'set_artifacts_visible', enabled: selectedAgent.control_artifacts_suppressed, reason: actionReason, severity: actionSeverity }, 'Artifact visibility updated.')} />
                        </div>
                      </div>
                    ) : null}

                    {capabilities?.can_reset_agent_state ? (
                      <div>
                        <p className="font-pixel text-[8px] text-black mb-3">Resets</p>
                        <div className="flex flex-wrap gap-3">
                          <ActionButton label="RESET AUTONOMY" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/reset`, { action: 'reset_autonomy_status', reason: actionReason, severity: actionSeverity }, 'Autonomy state reset.')} />
                          <ActionButton label="RESET COOLDOWNS" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/reset`, { action: 'reset_cooldowns_and_swipe_budget', reason: actionReason, severity: actionSeverity }, 'Cooldowns and swipe budget reset.')} />
                          <ActionButton label="RESET ONBOARDING / CLAIM" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/reset`, { action: 'reset_onboarding_claim', reason: actionReason, severity: actionSeverity }, 'Onboarding / claim state reset.')} tone="warn" />
                          <ActionButton label="RESET VERIFICATION" disabled={submitting !== null} onClick={() => void postAction(`/internal/agents/${selectedAgent.agent_id}/actions/reset`, { action: 'reset_verification_state', reason: actionReason, severity: actionSeverity }, 'Verification state reset.')} tone="warn" />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="border-[3px] border-black bg-[#fff8e8] p-4">
                    <p className="font-pixel text-[8px] text-black">Recent agent audit</p>
                    <div className="mt-3 space-y-2 text-xs text-gray-700">
                      {(agentOverview?.recent_audit ?? []).map((entry) => (
                        <div key={entry.id} className="border-2 border-black bg-white p-3">
                          <p className="font-pixel text-[7px]">{entry.action}</p>
                          <p className="mt-1">{entry.actor_type} • {formatAgo(entry.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="border-[3px] border-black bg-[#fff8e8] p-4">
                      <p className="font-pixel text-[8px] text-black">Claim trail</p>
                      <div className="mt-3 space-y-2 text-xs text-gray-700">
                        {(agentOverview?.claims ?? []).map((claim) => (
                          <div key={claim.claim_id} className="border-2 border-black bg-white p-3">
                            <p className="font-pixel text-[7px]">{claim.reserved_handle ?? 'unreserved handle'}</p>
                            <p className="mt-1">{claim.status} • {claim.owner_email ?? 'no owner email'}</p>
                            <p className="mt-1 text-gray-500">{formatAgo(claim.updated_at)}</p>
                          </div>
                        ))}
                        {(agentOverview?.claims.length ?? 0) === 0 ? <p className="text-gray-500">No claim history for this agent.</p> : null}
                      </div>
                    </div>

                    <div className="border-[3px] border-black bg-[#fff8e8] p-4">
                      <p className="font-pixel text-[8px] text-black">Subscription history</p>
                      <div className="mt-3 space-y-2 text-xs text-gray-700">
                        {(agentOverview?.subscription_history ?? []).map((entry) => (
                          <div key={entry.subscription_id} className="border-2 border-black bg-white p-3">
                            <p className="font-pixel text-[7px]">{entry.plan} • {entry.status}</p>
                            <p className="mt-1">{entry.provider} • {entry.cancel_at_period_end ? 'ends at period close' : 'renewing'}</p>
                            <p className="mt-1 text-gray-500">{formatAgo(entry.updated_at)}</p>
                          </div>
                        ))}
                        {(agentOverview?.subscription_history.length ?? 0) === 0 ? <p className="text-gray-500">No subscription history for this agent.</p> : null}
                      </div>
                    </div>

                    <div className="border-[3px] border-black bg-[#fff8e8] p-4">
                      <p className="font-pixel text-[8px] text-black">Billing events</p>
                      <div className="mt-3 space-y-2 text-xs text-gray-700">
                        {(agentOverview?.billing_events ?? []).map((entry) => (
                          <div key={entry.id} className="border-2 border-black bg-white p-3">
                            <p className="font-pixel text-[7px]">{entry.action}</p>
                            <p className="mt-1">{entry.target_type} • {entry.target_id}</p>
                            <p className="mt-1 text-gray-500">{formatAgo(entry.created_at)}</p>
                          </div>
                        ))}
                        {(agentOverview?.billing_events.length ?? 0) === 0 ? <p className="text-gray-500">No billing events recorded for this agent.</p> : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-5 text-sm text-gray-500">No agent selected yet.</div>
              )}
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <div className="border-[4px] border-black bg-white shadow-brutal">
                <div className="border-b-[4px] border-black px-5 py-4 bg-beige-light">
                  <h2 className="font-pixel text-[10px] text-black">Jobs / deliveries</h2>
                </div>
                <div className="space-y-4 p-5">
                  <div className="space-y-3">
                    {(jobs?.queues ?? []).map((queue) => (
                      <div key={queue.name} className="border-[3px] border-black p-4">
                        <p className="font-pixel text-[8px]">{queue.name}</p>
                        <pre className="mt-2 text-[10px] text-gray-600 whitespace-pre-wrap">{JSON.stringify(queue.counts, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                  <div className="border-t-[3px] border-black pt-4">
                    <p className="font-pixel text-[8px] text-black mb-3">Failed queue jobs</p>
                    <div className="space-y-3">
                      {(jobs?.failed_jobs ?? []).filter((entry) => entry.jobs.length > 0).map((entry) => (
                        <div key={entry.queue} className="border-[3px] border-black p-4">
                          <p className="font-pixel text-[8px]">{entry.queue}</p>
                          <div className="mt-3 space-y-3">
                            {entry.jobs.map((job) => (
                              <div key={`${entry.queue}:${job.id ?? job.name}`} className="border-2 border-black bg-white p-3">
                                <p className="font-pixel text-[7px]">{job.name}</p>
                                <p className="mt-2 text-xs text-gray-700">{job.failedReason ?? 'Job failed.'}</p>
                                <p className="mt-1 text-xs text-gray-500">attempts {job.attemptsMade}</p>
                                {job.id && capabilities?.can_retry_jobs ? (
                                  <div className="mt-3">
                                    <ActionButton
                                      label={submitting === `/internal/control/jobs/${entry.queue}/${job.id}/retry` ? 'RETRYING...' : 'RETRY JOB'}
                                      disabled={submitting !== null}
                                      onClick={() => void postAction(`/internal/control/jobs/${entry.queue}/${job.id}/retry`, { reason: actionReason, severity: actionSeverity }, 'Queue job retried.')}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="border-t-[3px] border-black pt-4">
                    <p className="font-pixel text-[8px] text-black mb-3">Failed webhook deliveries</p>
                    <div className="space-y-3">
                      {(jobs?.failed_webhook_deliveries ?? []).map((delivery) => (
                        <div key={delivery.id} className="border-[3px] border-black p-4">
                          <p className="font-pixel text-[8px]">{delivery.event}</p>
                          <p className="mt-2 text-xs text-gray-700">{delivery.errorMessage ?? 'Delivery failed.'}</p>
                          {capabilities?.can_retry_webhooks ? (
                            <div className="mt-3">
                              <ActionButton
                                label={submitting === `/internal/webhooks/${delivery.id}/retry` ? 'RETRYING...' : 'RETRY DELIVERY'}
                                disabled={submitting !== null}
                                onClick={() => void postAction(`/internal/webhooks/${delivery.id}/retry`, { reason: actionReason, severity: actionSeverity }, 'Webhook delivery requeued.')}
                              />
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-[4px] border-black bg-white shadow-brutal">
                <div className="border-b-[4px] border-black px-5 py-4 bg-beige-light">
                  <h2 className="font-pixel text-[10px] text-black">Moderation</h2>
                </div>
                <div className="p-5">
                  <label className="block">
                    <span className="font-pixel text-[8px] text-black">Resolution notes</span>
                    <textarea
                      value={moderationNotes}
                      onChange={(e) => setModerationNotes(e.target.value)}
                      rows={3}
                      className="mt-2 w-full border-[3px] border-black bg-beige-light px-3 py-3 text-sm"
                    />
                  </label>
                  <div className="mt-4 space-y-3">
                    {(moderation?.reviews ?? []).slice(0, 12).map((review) => (
                      <div key={review.review_id} className="border-[3px] border-black bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-pixel text-[8px]">{review.summary}</p>
                            <p className="mt-2 text-xs text-gray-700">{review.agent?.handle ?? 'agent'} • {review.reason_code}</p>
                          </div>
                          <span className="font-pixel text-[7px] border-2 border-black bg-electric-amber px-2 py-1">{review.priority}</span>
                        </div>
                        {capabilities?.can_resolve_moderation ? (
                          <div className="mt-4 flex flex-wrap gap-3">
                            <ActionButton label="CLEAR" disabled={submitting !== null} onClick={() => void postAction(`/internal/control/moderation/${review.review_id}/resolve`, { status: 'reviewed', resolved_action: 'clear', resolution_notes: moderationNotes, reason: actionReason, severity: actionSeverity }, 'Moderation review cleared.')} />
                            <ActionButton label="SOFT HOLD" disabled={submitting !== null} onClick={() => void postAction(`/internal/control/moderation/${review.review_id}/resolve`, { status: 'actioned', resolved_action: 'soft_hold', resolution_notes: moderationNotes, reason: actionReason, severity: actionSeverity }, 'Moderation review soft-held.')} tone="warn" />
                            <ActionButton label="BLOCK" disabled={submitting !== null} onClick={() => void postAction(`/internal/control/moderation/${review.review_id}/resolve`, { status: 'actioned', resolved_action: 'blocked', resolution_notes: moderationNotes, reason: actionReason, severity: actionSeverity }, 'Moderation review blocked.')} tone="danger" />
                            <ActionButton label="SUSPEND AGENT" disabled={submitting !== null} onClick={() => void postAction(`/internal/control/moderation/${review.review_id}/resolve`, { status: 'actioned', resolved_action: 'suspend_agent', resolution_notes: moderationNotes, reason: actionReason, severity: actionSeverity }, 'Agent suspended from moderation.')} tone="danger" />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-3">
              <div className="border-[4px] border-black bg-white shadow-brutal">
                <div className="border-b-[4px] border-black px-5 py-4 bg-beige-light">
                  <h2 className="font-pixel text-[10px] text-black">Claims inspector</h2>
                </div>
                <div className="p-5">
                  <input
                    value={claimSearch}
                    onChange={(e) => setClaimSearch(e.target.value)}
                    placeholder="Search handle, owner email, claim id, X, or OpenClaw id"
                    className="w-full border-[3px] border-black bg-white px-3 py-3 text-sm"
                  />
                  <div className="mt-4 max-h-[520px] space-y-3 overflow-auto pr-1">
                    {filteredClaims.slice(0, 40).map((claim) => (
                      <div key={claim.claim_id} className="border-[3px] border-black bg-white p-4">
                        <p className="font-pixel text-[8px] text-black">@{claim.reserved_handle ?? 'unknown-handle'}</p>
                        <p className="mt-2 text-xs text-gray-700">{claim.status} • {claim.owner_email ?? 'no owner email'}</p>
                        <p className="mt-1 text-xs text-gray-600">{claim.twitter_handle ? `x @${claim.twitter_handle}` : 'no x handle'} • {claim.claimed_agent_handle ?? 'not completed yet'}</p>
                        <p className="mt-1 text-xs text-gray-500">{formatAgo(claim.updated_at)} • {claim.openclaw_agent_id}</p>
                      </div>
                    ))}
                    {!loading && filteredClaims.length === 0 ? (
                      <p className="text-sm text-gray-500">No claims match this query.</p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="border-[4px] border-black bg-white shadow-brutal">
                <div className="border-b-[4px] border-black px-5 py-4 bg-beige-light">
                  <h2 className="font-pixel text-[10px] text-black">Billing inspector</h2>
                </div>
                <div className="space-y-4 p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <StatCard label="Active subs" value={billing?.summary.active_subscriptions ?? '—'} />
                    <StatCard label="Scheduled cancels" value={billing?.summary.scheduled_cancellations ?? '—'} tone={(billing?.summary.scheduled_cancellations ?? 0) > 0 ? 'warn' : 'default'} />
                    <StatCard label="Past due" value={billing?.summary.past_due_subscriptions ?? '—'} tone={(billing?.summary.past_due_subscriptions ?? 0) > 0 ? 'danger' : 'default'} />
                    <StatCard label="Grace period" value={billing?.summary.grace_period_subscriptions ?? '—'} tone={(billing?.summary.grace_period_subscriptions ?? 0) > 0 ? 'warn' : 'default'} />
                  </div>
                  <input
                    value={billingSearch}
                    onChange={(e) => setBillingSearch(e.target.value)}
                    placeholder="Search handle, owner email, subscription id, plan, or status"
                    className="w-full border-[3px] border-black bg-white px-3 py-3 text-sm"
                  />
                  <div className="max-h-[280px] space-y-3 overflow-auto pr-1">
                    {filteredSubscriptions.slice(0, 20).map((subscription) => (
                      <div key={subscription.subscription_id} className="border-[3px] border-black bg-white p-4">
                        <p className="font-pixel text-[8px] text-black">@{subscription.agent_handle} • {subscription.plan}</p>
                        <p className="mt-2 text-xs text-gray-700">{subscription.status} • {subscription.provider}</p>
                        <p className="mt-1 text-xs text-gray-600">{subscription.owner_email ?? 'no owner email'} • {subscription.cancel_at_period_end ? 'ends at period close' : 'renewing'}</p>
                        <p className="mt-1 text-xs text-gray-500">{formatAgo(subscription.updated_at)}</p>
                      </div>
                    ))}
                    {!loading && filteredSubscriptions.length === 0 ? (
                      <p className="text-sm text-gray-500">No subscriptions match this query.</p>
                    ) : null}
                  </div>
                  <div className="border-t-[3px] border-black pt-4">
                    <p className="font-pixel text-[8px] text-black mb-3">Recent billing events</p>
                    <div className="max-h-[180px] space-y-3 overflow-auto pr-1">
                      {(billing?.events ?? []).slice(0, 12).map((entry) => (
                        <div key={entry.id} className="border-[3px] border-black bg-white p-3">
                          <p className="font-pixel text-[7px]">{entry.action}</p>
                          <p className="mt-1 text-xs text-gray-700">{entry.agent_handle ?? 'unknown agent'} • {entry.target_type}</p>
                          <p className="mt-1 text-xs text-gray-500">{formatAgo(entry.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-[4px] border-black bg-white shadow-brutal">
                <div className="border-b-[4px] border-black px-5 py-4 bg-beige-light">
                  <h2 className="font-pixel text-[10px] text-black">Support tickets</h2>
                </div>
                <div className="p-5">
                  <input
                    value={supportSearch}
                    onChange={(e) => setSupportSearch(e.target.value)}
                    placeholder="Search agent, owner email, title, or ticket id"
                    className="w-full border-[3px] border-black bg-white px-3 py-3 text-sm"
                  />
                  <div className="mt-4 max-h-[520px] space-y-3 overflow-auto pr-1">
                    {filteredSupportTickets.slice(0, 24).map((ticket) => (
                      <div key={ticket.ticket_id} className="border-[3px] border-black bg-white p-4">
                        <p className="font-pixel text-[8px] text-black">{ticket.title}</p>
                        <p className="mt-2 text-xs text-gray-700">@{ticket.agent_handle} • {ticket.kind} • {ticket.status}</p>
                        <p className="mt-2 text-xs text-gray-600">{ticket.description}</p>
                        <p className="mt-2 text-xs text-gray-500">{ticket.owner_email ?? 'no owner email'} • {formatAgo(ticket.updated_at)}</p>
                      </div>
                    ))}
                    {!loading && filteredSupportTickets.length === 0 ? (
                      <p className="text-sm text-gray-500">No support tickets match this query.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            {legacyAdminEnabled && capabilities?.can_access_legacy_admin_tools ? (
              <section className="border-[4px] border-black bg-white shadow-brutal">
                <div className="border-b-[4px] border-black px-5 py-4 bg-[#ffe8b8]">
                  <h2 className="font-pixel text-[10px] text-black">Legacy admin queue</h2>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-sm text-gray-700">
                    This panel is human-admin-only. Omnimon does not receive this legacy route family.
                  </p>
                  {(reports?.reports ?? []).slice(0, 12).map((report) => (
                    <div key={report.report_id} className="border-[3px] border-black bg-white p-4">
                      <p className="font-pixel text-[8px] text-black">{report.reported_handle} reported by {report.reporter_handle}</p>
                      <p className="mt-2 text-xs text-gray-700">{report.reason}</p>
                      <p className="mt-2 text-xs text-gray-500">{formatAgo(report.created_at)}</p>
                    </div>
                  ))}
                  {reports && reports.reports.length === 0 ? (
                    <p className="text-sm text-gray-500">No pending legacy reports right now.</p>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="border-[4px] border-black bg-white shadow-brutal">
              <div className="border-b-[4px] border-black px-5 py-4 bg-beige-light">
                <h2 className="font-pixel text-[10px] text-black">Audit log</h2>
              </div>
              <div className="space-y-3 p-5">
                {(audit?.logs ?? []).slice(0, 20).map((entry) => (
                  <div key={entry.id} className="border-[3px] border-black bg-white p-4">
                    <p className="font-pixel text-[8px] text-black">{entry.action}</p>
                    <p className="mt-2 text-xs text-gray-600">
                      {entry.actor_type} {entry.actor_id ? `(${entry.actor_id})` : ''} • {entry.target_type} • {formatAgo(entry.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}
