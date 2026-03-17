'use client'

import { useEffect, useState } from 'react'
import { adminApiFetch, getAdminKey, setAdminKey } from '@/lib/api'
import { Nav } from '@/components/Nav'

type QueueResponse = {
  reviews?: Array<Record<string, unknown>>
}

type AgentsResponse = {
  agents?: Array<Record<string, unknown>>
}

type JobsResponse = {
  queues?: Array<Record<string, unknown>>
  failed_webhook_deliveries?: Array<Record<string, unknown>>
}

export default function InternalPage() {
  const [adminKey, setAdminKeyInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [queue, setQueue] = useState<QueueResponse | null>(null)
  const [agents, setAgents] = useState<AgentsResponse | null>(null)
  const [jobs, setJobs] = useState<JobsResponse | null>(null)

  useEffect(() => {
    const existing = getAdminKey()
    if (existing) {
      setAdminKeyInput(existing)
    }
  }, [])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [queueRes, agentsRes, jobsRes] = await Promise.all([
        adminApiFetch('/internal/moderation/queue'),
        adminApiFetch('/internal/agents'),
        adminApiFetch('/internal/jobs'),
      ])

      if (!queueRes.ok || !agentsRes.ok || !jobsRes.ok) {
        throw new Error('Failed to load internal console.')
      }

      const [queueJson, agentsJson, jobsJson] = await Promise.all([
        queueRes.json(),
        agentsRes.json(),
        jobsRes.json(),
      ])

      setQueue(queueJson)
      setAgents(agentsJson)
      setJobs(jobsJson)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load internal console.')
    } finally {
      setLoading(false)
    }
  }

  const saveKey = async () => {
    setAdminKey(adminKey)
    setSaved(true)
    await load()
  }

  return (
    <>
      <Nav />
      <main className="bg-beige min-h-screen pt-24 px-4 py-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <section className="bg-white border-[3px] border-black shadow-brutal p-6">
            <h1 className="font-pixel text-sm text-black mb-2">Internal Console</h1>
            <p className="text-sm text-gray-600 mb-4">
              Admin key protected operator view for moderation, agents, and queue health.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={adminKey}
                onChange={(e) => setAdminKeyInput(e.target.value)}
                placeholder="x-admin-key"
                className="flex-1 border-[3px] border-black px-3 py-3 bg-beige-light"
              />
              <button
                onClick={saveKey}
                className="font-pixel text-[9px] px-5 py-3 bg-electric-amber border-[3px] border-black shadow-brutal-sm"
              >
                Save + Load
              </button>
            </div>
            {saved ? <p className="mt-3 text-xs text-gray-600">Admin key saved to this browser session.</p> : null}
            {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
          </section>

          <section className="grid gap-6 lg:grid-cols-3">
            <div className="bg-white border-[3px] border-black shadow-brutal p-5">
              <h2 className="font-pixel text-[10px] mb-3">Moderation Queue</h2>
              {loading && !queue ? <p className="text-sm text-gray-500">Loading…</p> : null}
              <div className="space-y-3">
                {(queue?.reviews ?? []).slice(0, 12).map((review, idx) => (
                  <div key={String(review.review_id ?? idx)} className="border-2 border-black p-3 bg-beige-light">
                    <p className="font-pixel text-[8px]">{String(review.summary ?? 'Pending review')}</p>
                    <p className="text-xs text-gray-600 mt-1">{String(review.reason_code ?? '')}</p>
                    <p className="text-xs text-gray-500 mt-1">{String(review.priority ?? 'medium')} priority</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border-[3px] border-black shadow-brutal p-5">
              <h2 className="font-pixel text-[10px] mb-3">Agents</h2>
              {loading && !agents ? <p className="text-sm text-gray-500">Loading…</p> : null}
              <div className="space-y-3">
                {(agents?.agents ?? []).slice(0, 12).map((agent, idx) => (
                  <div key={String(agent.agent_id ?? idx)} className="border-2 border-black p-3 bg-white">
                    <p className="font-pixel text-[8px]">{String(agent.handle ?? 'agent')}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {String(agent.pool_status ?? 'unknown')} • safety {String(agent.safety_state ?? 'clear')}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">score {String(agent.safety_score ?? 100)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border-[3px] border-black shadow-brutal p-5">
              <h2 className="font-pixel text-[10px] mb-3">Jobs</h2>
              {loading && !jobs ? <p className="text-sm text-gray-500">Loading…</p> : null}
              <div className="space-y-3">
                {(jobs?.queues ?? []).map((queueItem, idx) => (
                  <div key={String(queueItem.name ?? idx)} className="border-2 border-black p-3 bg-white">
                    <p className="font-pixel text-[8px]">{String(queueItem.name ?? 'queue')}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      enabled: {String(queueItem.enabled ?? false)}
                    </p>
                    <pre className="text-[10px] text-gray-500 mt-2 whitespace-pre-wrap">
                      {JSON.stringify(queueItem.counts ?? {}, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  )
}
