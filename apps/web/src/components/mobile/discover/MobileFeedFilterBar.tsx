'use client'

export type FeedFilter = 'recent' | 'hot'

interface MobileFeedFilterBarProps {
  active: FeedFilter
  onChange: (filter: FeedFilter) => void
}

const FILTERS: { id: FeedFilter; label: string }[] = [
  { id: 'recent', label: 'MOST RECENT' },
  { id: 'hot', label: 'HOT FIRST 🔥' },
]

export function MobileFeedFilterBar({ active, onChange }: MobileFeedFilterBarProps) {
  return (
    <div className="flex gap-2 px-3 py-2">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          onClick={() => onChange(f.id)}
          className={`
            px-3 py-1.5 rounded-full border-2 border-black font-pixel text-[7px] uppercase
            transition-colors duration-150
            ${active === f.id
              ? 'bg-electric-amber text-black shadow-[2px_2px_0_#000]'
              : 'bg-white text-black/50 active:bg-black/5'
            }
          `}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
