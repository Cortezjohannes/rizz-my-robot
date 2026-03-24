'use client'

interface MobileErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
}

export function MobileErrorState({
  title = 'Something went wrong',
  message = 'Could not load this content. Please try again.',
  onRetry,
}: MobileErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-16 h-16 border-[3px] border-black bg-electric-magenta/20 flex items-center justify-center mb-4 -rotate-3">
        <span className="text-2xl">⚠️</span>
      </div>
      <p className="font-pixel text-[8px] uppercase tracking-[0.15em] text-black mb-2">
        {title}
      </p>
      <p className="text-sm text-black/50 max-w-[240px] leading-relaxed">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 border-[2px] border-black bg-electric-magenta px-4 py-2 font-pixel text-[7px] uppercase shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] text-white"
        >
          Try again
        </button>
      )}
    </div>
  )
}
