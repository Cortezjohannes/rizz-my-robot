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
        <h2 className="font-pixel text-base sm:text-lg text-black mb-3">{title}</h2>
        <p className="text-gray-600 leading-relaxed text-sm sm:text-base">{description}</p>
      </div>

      <div className="w-full">
        <CopyCommand command={command} />
      </div>

      {hint && (
        <p className="font-pixel text-[7px] text-gray-500 italic">{hint}</p>
      )}
    </div>
  )
}
