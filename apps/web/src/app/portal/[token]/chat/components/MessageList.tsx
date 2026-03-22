'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { API_BASE } from '@/lib/api'
import { artifactTypeLabel, isAudioArtifact, isImageArtifact } from '@/lib/artifacts'
import { decryptMessage } from '@/lib/revealChatCrypto'
import type {
  PublicArtifactDetailResponse,
  RevealChatSenderKind,
} from '@/lib/types'
import type { ChatParticipantDescriptor, RevealChatUiMessage } from './revealChatModels'
import { isAgentKind, parseRevealChatContent } from './revealChatModels'

interface MessageListProps {
  messages: RevealChatUiMessage[]
  sessionKeyRef: React.MutableRefObject<CryptoKey | null>
  cryptoReady: boolean
  participants: ChatParticipantDescriptor[]
  onRetryMessage: (message: RevealChatUiMessage) => Promise<void>
}

function messageBubbleClasses(kind: RevealChatSenderKind) {
  switch (kind) {
    case 'HUMAN_A':
      return 'ml-auto bg-electric-amber text-black'
    case 'AGENT_A':
      return 'ml-auto bg-white text-black border-dashed'
    case 'HUMAN_B':
      return 'mr-auto bg-electric-cyan/85 text-black'
    case 'AGENT_B':
      return 'mr-auto bg-white text-black border-dashed'
  }
}

function participantLookup(participants: ChatParticipantDescriptor[]) {
  return new Map(participants.map((participant) => [participant.kind, participant]))
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function BrutalArtifactCard({ artifactId }: { artifactId: string }) {
  const [artifact, setArtifact] = useState<PublicArtifactDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadArtifact() {
      try {
        setError(null)
        const response = await fetch(`${API_BASE}/public/artifacts/${artifactId}`, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error('Artifact unavailable.')
        }
        const data = await response.json() as PublicArtifactDetailResponse
        if (active) {
          setArtifact(data)
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Artifact unavailable.')
        }
      }
    }

    void loadArtifact()

    return () => {
      active = false
    }
  }, [artifactId])

  if (error) {
    return (
      <div className="mt-2 border-[3px] border-black bg-white/80 px-3 py-3 text-xs text-gray-600">
        {error}
      </div>
    )
  }

  if (!artifact) {
    return <div className="mt-2 h-28 border-[3px] border-black bg-white skeleton-shimmer" />
  }

  return (
    <article className="mt-2 overflow-hidden border-[3px] border-black bg-[#fffaf1] shadow-brutal-sm">
      <div className="h-2 bg-[linear-gradient(90deg,#F59E0B,#FF0080,#00F5FF)]" />
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-pixel text-[6px] uppercase tracking-widest text-gray-500">Artifact drop</p>
            <p className="text-sm font-black text-black">{artifactTypeLabel(artifact.artifact_type)}</p>
          </div>
          <span className="font-pixel text-[6px] uppercase tracking-widest text-gray-500">
            {new Date(artifact.created_at).toLocaleDateString()}
          </span>
        </div>

        {artifact.text_content ? (
          <div className="border-[2px] border-black bg-white px-3 py-3 text-sm text-gray-800 whitespace-pre-wrap">
            {artifact.text_content}
          </div>
        ) : null}

        {artifact.content_url && isImageArtifact(artifact.artifact_type) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artifact.content_url}
            alt={artifactTypeLabel(artifact.artifact_type)}
            className="w-full border-[3px] border-black bg-white object-cover"
          />
        ) : null}

        {artifact.content_url && isAudioArtifact(artifact.artifact_type) ? (
          <audio controls className="w-full">
            <source src={artifact.content_url} />
          </audio>
        ) : null}

        {artifact.content_url && !isImageArtifact(artifact.artifact_type) && !isAudioArtifact(artifact.artifact_type) ? (
          <a
            href={artifact.content_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex border-[3px] border-black bg-electric-cyan px-3 py-2 font-pixel text-[7px] uppercase tracking-widest text-black shadow-brutal-sm"
          >
            Open artifact
          </a>
        ) : null}
      </div>
    </article>
  )
}

export function MessageList({
  messages,
  sessionKeyRef,
  cryptoReady,
  participants,
  onRetryMessage,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [decryptedMap, setDecryptedMap] = useState<Record<string, string>>({})
  const participantMap = useMemo(() => participantLookup(participants), [participants])
  const shouldVirtualize = messages.length > 100

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 148,
    overscan: 10,
    enabled: shouldVirtualize,
  })

  useEffect(() => {
    let cancelled = false

    async function decryptMessages() {
      if (!cryptoReady || !sessionKeyRef.current) return

      const nextEntries: Record<string, string> = {}

      await Promise.all(messages.map(async (message) => {
        if (message.plaintextFallback) {
          nextEntries[message.localId] = message.plaintextFallback
          return
        }

        try {
          const plaintext = await decryptMessage(
            {
              ciphertext: message.ciphertext,
              iv: message.iv,
              authTag: message.authTag,
            },
            sessionKeyRef.current!,
          )
          nextEntries[message.localId] = plaintext
        } catch {
          nextEntries[message.localId] = '[Unable to decrypt message]'
        }
      }))

      if (!cancelled) {
        setDecryptedMap(nextEntries)
      }
    }

    void decryptMessages()

    return () => {
      cancelled = true
    }
  }, [cryptoReady, messages, sessionKeyRef])

  useEffect(() => {
    if (shouldVirtualize) {
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
      return
    }

    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, rowVirtualizer, shouldVirtualize])

  function renderRow(message: RevealChatUiMessage) {
    const participant = participantMap.get(message.senderKind)
    const decrypted = decryptedMap[message.localId] ?? message.plaintextFallback ?? 'Decrypting...'
    const parsed = parseRevealChatContent(decrypted)
    const isAgent = isAgentKind(message.senderKind)
    const isPending = message.deliveryState === 'pending'
    const isFailed = message.deliveryState === 'failed'

    return (
      <div key={message.localId} className={`flex w-full ${participant?.side === 'right' ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[86%] rounded-none border-[3px] border-black px-3 py-3 shadow-brutal-sm ${messageBubbleClasses(message.senderKind)}`}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-black text-black">
              {participant?.label ?? message.senderKind}
            </span>
            {isAgent ? (
              <span className="rounded-none border-[2px] border-black bg-white px-1.5 py-0.5 font-pixel text-[6px] uppercase tracking-widest text-gray-600">
                via agent
              </span>
            ) : null}
            {isAgent ? <span aria-hidden className="text-xs">⟡</span> : null}
          </div>

          {parsed.kind === 'artifact' && parsed.artifactId ? (
            <BrutalArtifactCard artifactId={parsed.artifactId} />
          ) : (
            <p className={`whitespace-pre-wrap break-words ${isAgent ? 'text-[13px]' : 'text-sm'}`}>
              {parsed.text}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="font-pixel text-[6px] uppercase tracking-widest text-gray-500">
              {formatMessageTime(message.createdAt)}
            </span>
            <div className="flex items-center gap-2">
              {isPending ? (
                <span className="font-pixel text-[6px] uppercase tracking-widest text-gray-500">pending</span>
              ) : null}
              {isFailed ? (
                <>
                  <span className="font-pixel text-[6px] uppercase tracking-widest text-electric-magenta">failed</span>
                  <button
                    type="button"
                    onClick={() => void onRetryMessage(message)}
                    className="border-[2px] border-black bg-white px-2 py-1 font-pixel text-[6px] uppercase tracking-widest text-black"
                  >
                    Retry
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-[3px] border-black bg-beige-light shadow-brutal-sm">
      <div className="border-b-[3px] border-black bg-white px-4 py-3">
        <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Message Rail</p>
      </div>

      <div ref={scrollRef} className="story-room-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {shouldVirtualize ? (
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualItem) => (
              <div
                key={virtualItem.key}
                className="absolute left-0 top-0 w-full px-1"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {renderRow(messages[virtualItem.index]!)}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => renderRow(message))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </section>
  )
}
