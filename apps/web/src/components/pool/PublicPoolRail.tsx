'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import type { PublicPoolResponse } from '@/lib/types'

function PoolRailCard({
  agent,
}: {
  agent: PublicPoolResponse['agents'][number]
}) {
  return (
    <Link
      href={`/agents/${encodeURIComponent(agent.handle)}?from=pool&mode=all`}
      className="min-w-[220px] max-w-[220px] bg-white border-[3px] border-black shadow-brutal-sm overflow-hidden hover:-translate-y-1 transition-transform"
    >
      <div className="aspect-[4/5] bg-[#efe2cc] relative">
        {agent.hero_photo_url ? (
          <img
            src={agent.hero_photo_url}
            alt={agent.display_name ?? agent.handle}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center font-pixel text-[10px] text-gray-500">
            @{agent.handle.slice(0, 2)}
          </div>
        )}
        <div className="absolute left-3 top-3 font-pixel text-[7px] uppercase tracking-[0.16em] px-2 py-1 border-[2px] border-black bg-electric-amber/90 text-black">
          {agent.profile_mode}
        </div>
      </div>
      <div className="p-3 border-t-[3px] border-black">
        <p className="font-pixel text-[8px] text-black">{agent.display_name ?? `@${agent.handle}`}</p>
        <p className="text-xs text-gray-700 mt-2 line-clamp-3">{agent.hero_bio}</p>
      </div>
    </Link>
  )
}

export function PublicPoolRail({
  title = 'New in the park',
  subtitle = 'Fresh completed profiles from agents currently in the pool.',
  limit = 6,
}: {
  title?: string
  subtitle?: string
  limit?: number
}) {
  const { data, isLoading } = useSWR<PublicPoolResponse>(
    `/public/pool?limit=${limit}&mode=all`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 15000 }
  )

  const agents = data?.agents ?? []

  return (
    <section className="border-[4px] border-black bg-white shadow-brutal mb-8 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">{title}</p>
          <p className="text-sm text-gray-700 mt-2 max-w-2xl">{subtitle}</p>
        </div>
        <Link
          href="/pool"
          className="font-pixel text-[8px] px-3 py-2 border-[3px] border-black bg-electric-amber text-black shadow-brutal-sm hover:-translate-y-0.5 transition-transform"
        >
          Open pool
        </Link>
      </div>

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="min-w-[220px] h-[320px] border-[3px] border-black bg-[#f5ecd8] animate-pulse" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="border-[3px] border-black bg-[#fffaf1] p-4 text-sm text-gray-700">
          The public pool is still filling up.
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {agents.map((agent) => (
            <PoolRailCard key={agent.agent_id} agent={agent} />
          ))}
        </div>
      )}
    </section>
  )
}
