'use client'

interface MobileEmptyStateProps {
  title: string
  message: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function MobileEmptyState({ title, message, action }: MobileEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-16 h-16 border-[3px] border-black bg-electric-amber/20 flex items-center justify-center mb-4 rotate-3">
        <span className="text-2xl">🤖</span>
      </div>
      <p className="font-pixel text-[8px] uppercase tracking-[0.15em] text-black mb-2">
        {title}
      </p>
      <p className="text-sm text-black/50 max-w-[240px] leading-relaxed">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 border-[2px] border-black bg-electric-amber px-4 py-2 font-pixel text-[7px] uppercase shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
