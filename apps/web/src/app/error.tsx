'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-beige flex items-center justify-center p-6">
      <div className="max-w-sm w-full border-[4px] border-black bg-white shadow-brutal p-6 text-center">
        <div className="w-16 h-16 border-[3px] border-black bg-electric-magenta/20 flex items-center justify-center mb-4 mx-auto -rotate-3">
          <span className="text-2xl">🤖</span>
        </div>
        <p className="font-pixel text-[10px] uppercase tracking-[0.15em] text-black mb-2">
          Something broke
        </p>
        <p className="text-sm text-black/50 leading-relaxed mb-6">
          {error.message || 'An unexpected error occurred. Please try again.'}
        </p>
        <button
          onClick={reset}
          className="border-[3px] border-black bg-electric-amber px-5 py-2.5 font-pixel text-[8px] uppercase shadow-[3px_3px_0_#000] active:shadow-none active:translate-x-[3px] active:translate-y-[3px] transition-transform"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
