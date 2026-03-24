'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { ownerApiFetch, ownerFetcher } from '@/lib/api'

interface OwnerSupportPanelProps {
  compact?: boolean
}

export function OwnerSupportPanel({ compact = false }: OwnerSupportPanelProps) {
  const { data, mutate } = useSWR<{
    tickets: Array<{
      ticket_id: string
      kind: 'bug_report' | 'feature_request'
      title: string
      description: string
      page_url: string | null
      status: string
      omnimon_summary: string | null
      omnimon_action: string | null
      reviewed_at: string | null
      reported_to_owner_at: string | null
      created_at: string
      updated_at: string
    }>
  }>('/owner/support-tickets', ownerFetcher)
  const [kind, setKind] = useState<'bug_report' | 'feature_request'>('bug_report')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    setPageUrl(window.location.href)
  }, [])

  const submit = async () => {
    setLoading(true)
    setSuccess(false)
    setError('')
    try {
      const res = await ownerApiFetch('/owner/support-tickets', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          title,
          description,
          page_url: pageUrl || null,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(payload?.error?.message ?? 'Failed to submit ticket.')
        return
      }
      setSuccess(true)
      setTitle('')
      setDescription('')
      await mutate()
      setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError('Connection error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-[3px] border-black bg-white shadow-brutal-sm p-6">
        <div className="space-y-4">
          <div>
            <label className="font-pixel text-[8px] text-gray-600 uppercase tracking-widest">Type</label>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => setKind('bug_report')}
                className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black ${kind === 'bug_report' ? 'bg-electric-amber text-black' : 'bg-white text-gray-600'}`}
              >
                Bug
              </button>
              <button
                type="button"
                onClick={() => setKind('feature_request')}
                className={`font-pixel text-[8px] px-3 py-2 border-[3px] border-black ${kind === 'feature_request' ? 'bg-electric-cyan text-black' : 'bg-white text-gray-600'}`}
              >
                Feature
              </button>
            </div>
          </div>

          <div>
            <label className="font-pixel text-[8px] text-gray-600 uppercase tracking-widest">Title</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Short summary"
              className="mt-2 w-full border-[3px] border-black bg-white px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="font-pixel text-[8px] text-gray-600 uppercase tracking-widest">Details</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What happened, what you expected, and what Omnimon should inspect."
              rows={compact ? 4 : 6}
              className="mt-2 w-full border-[3px] border-black bg-white px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="font-pixel text-[8px] text-gray-600 uppercase tracking-widest">Page URL</label>
            <input
              value={pageUrl}
              onChange={(event) => setPageUrl(event.target.value)}
              placeholder="Optional context URL"
              className="mt-2 w-full border-[3px] border-black bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={loading}
              className="font-pixel text-[9px] px-4 py-2 bg-electric-amber text-black brutal-btn border-[3px] border-black transition-colors disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send To Omnimon'}
            </button>
            {success ? (
              <span className="font-pixel text-[7px] text-electric-cyan">Sent!</span>
            ) : null}
            {error ? (
              <span className="font-pixel text-[7px] text-electric-magenta">{error}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="border-[3px] border-black bg-white shadow-brutal-sm p-6">
        <p className="font-pixel text-[8px] text-gray-600 uppercase tracking-widest">Recent tickets</p>
        <div className="mt-4 space-y-3">
          {(data?.tickets ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">No tickets yet.</p>
          ) : (
            data!.tickets.slice(0, compact ? 4 : 12).map((ticket) => (
              <div key={ticket.ticket_id} className="border-[3px] border-black bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-pixel text-[8px] text-black">{ticket.kind === 'bug_report' ? 'BUG' : 'FEATURE'}</span>
                  <span className="font-pixel text-[8px] text-gray-500">{ticket.status.replaceAll('_', ' ')}</span>
                </div>
                <p className="font-pixel text-[9px] text-black mt-2">{ticket.title}</p>
                <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{ticket.description}</p>
                {ticket.omnimon_summary ? (
                  <div className="mt-3 border-t-[2px] border-dashed border-black pt-3">
                    <p className="font-pixel text-[8px] text-electric-cyan">Omnimon</p>
                    <p className="text-sm text-gray-700 mt-1">{ticket.omnimon_summary}</p>
                    {ticket.omnimon_action ? <p className="text-xs text-gray-500 mt-2">Action: {ticket.omnimon_action}</p> : null}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
