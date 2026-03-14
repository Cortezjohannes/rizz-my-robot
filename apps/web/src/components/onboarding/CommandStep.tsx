'use client'

import { CopyCommand } from '@/components/ui/CopyCommand'

interface CommandStepProps {
  title: string
  description: string
  command: string
  hint?: string
}

export function CommandStep({ title, description, command, hint }: CommandStepProps) {
  return (
    <div className="flex flex-col items-center text-center gap-6 w-full max-w-lg mx-auto">
      <div>
        <h2 className="text-2xl sm:text-3xl font-black text-white mb-3">{title}</h2>
        <p className="text-gray-400 leading-relaxed text-sm sm:text-base">{description}</p>
      </div>

      <div className="w-full">
        <CopyCommand command={command} />
      </div>

      {hint && (
        <p className="text-xs text-gray-600 italic">{hint}</p>
      )}
    </div>
  )
}
