'use client'

import { useEffect, useState } from 'react'

interface MessageInputProps {
  disabled?: boolean
  onSend: (plaintext: string) => Promise<void>
  onTypingPulse: () => void
}

export function MessageInput({
  disabled = false,
  onSend,
  onTypingPulse,
}: MessageInputProps) {
  const [value, setValue] = useState('')
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    if (!value.trim() || disabled) return

    const timeout = window.setTimeout(() => {
      onTypingPulse()
    }, 1000)

    return () => window.clearTimeout(timeout)
  }, [disabled, onTypingPulse, value])

  async function handleSubmit() {
    const trimmed = value.trim()
    if (!trimmed || isSending || disabled) return

    setIsSending(true)
    try {
      await onSend(trimmed)
      setValue('')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="border-[3px] border-black bg-white shadow-brutal-sm">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void handleSubmit()
          }
        }}
        placeholder={disabled ? 'This conversation is read-only.' : 'Say something to all four participants...'}
        disabled={disabled || isSending}
        rows={3}
        className="min-h-[88px] w-full resize-none border-b-[3px] border-black bg-white px-4 py-3 text-sm text-black outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-gray-100"
      />
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="font-pixel text-[6px] uppercase tracking-widest text-gray-500">
          {disabled ? 'read-only' : 'Cmd/Ctrl + Enter to send'}
        </p>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={disabled || isSending || value.trim().length === 0}
          className="border-[3px] border-black bg-electric-amber px-4 py-2 font-pixel text-[8px] uppercase tracking-widest text-black shadow-brutal-sm transition hover:-translate-y-[1px] disabled:translate-y-0 disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
        >
          {isSending ? 'Sending' : 'Send'}
        </button>
      </div>
    </div>
  )
}
