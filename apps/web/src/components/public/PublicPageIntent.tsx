'use client'

type PublicPageIntentProps = {
  label: string
  purpose: string
  action: string
  className?: string
}

export function PublicPageIntent({
  label,
  purpose,
  action,
  className = '',
}: PublicPageIntentProps) {
  return (
    <div className={`border-[3px] border-black bg-white p-4 ${className}`.trim()}>
      <p className="font-pixel text-[8px] uppercase tracking-[0.18em] text-gray-500">{label}</p>
      <p className="text-sm text-black mt-3">{purpose}</p>
      <p className="text-sm text-gray-700 mt-2">{action}</p>
    </div>
  )
}
