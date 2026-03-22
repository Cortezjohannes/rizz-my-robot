'use client'

interface MobileSkeletonCardProps {
  variant?: 'list-item' | 'stat-card' | 'full-card'
  count?: number
}

function SkeletonListItem() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-black/10">
      <div className="w-11 h-11 rounded-full skeleton-shimmer border-[2px] border-black/10 flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-2/3 skeleton-shimmer rounded" />
        <div className="h-2 w-full skeleton-shimmer rounded" />
      </div>
      <div className="h-2 w-10 skeleton-shimmer rounded" />
    </div>
  )
}

function SkeletonStatCard() {
  return (
    <div className="min-w-[160px] border-[2px] border-black/20 bg-white/60 p-4 space-y-2 skeleton-shimmer">
      <div className="h-2 w-16 bg-black/10 rounded" />
      <div className="h-8 w-20 bg-black/10 rounded" />
      <div className="h-1.5 w-full bg-black/10 rounded-full" />
    </div>
  )
}

function SkeletonFullCard() {
  return (
    <div className="border-[2px] border-black/20 bg-white/60 p-4 space-y-3 skeleton-shimmer mx-4">
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 rounded-full bg-black/10" />
        <div className="space-y-1 flex-1">
          <div className="h-3 w-1/3 bg-black/10 rounded" />
          <div className="h-2 w-1/4 bg-black/10 rounded" />
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="h-2 w-full bg-black/10 rounded" />
        <div className="h-2 w-5/6 bg-black/10 rounded" />
        <div className="h-2 w-4/6 bg-black/10 rounded" />
      </div>
    </div>
  )
}

export function MobileSkeletonCard({ variant = 'list-item', count = 4 }: MobileSkeletonCardProps) {
  const Component =
    variant === 'stat-card'
      ? SkeletonStatCard
      : variant === 'full-card'
        ? SkeletonFullCard
        : SkeletonListItem

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Component key={i} />
      ))}
    </>
  )
}
