'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  deriveSessionKey,
  encryptMessage,
  generateECDHKeyPair,
} from '@/lib/revealChatCrypto'
import { AgentOrb } from '@/components/ui/AgentOrb'
import { TierBadge } from '@/components/ui/TierBadge'
import { API_BASE, getOwnerSessionToken, ownerApiFetch } from '@/lib/api'
import type {
  PortalRevealChatBootstrapResponse,
  RevealChatHistoryResponse,
  RevealChatKeysResponse,
  RevealChatMessageRecord,
  RevealChatSenderKind,
  RevealChatStatus,
} from '@/lib/types'
import { MessageInput } from './MessageInput'
import { MessageList } from './MessageList'
import { ParticipantBar } from './ParticipantBar'
import type {
  ChatConnectionState,
  ChatParticipantDescriptor,
  RevealChatUiMessage,
} from './revealChatModels'

interface RevealChatClientProps {
  token: string
  bootstrap: PortalRevealChatBootstrapResponse
}

const SESSION_STORAGE_PREFIX = 'rmr_reveal_chat_ecdh:'

interface StoredEcdhKeys {
  privateKeyPkcs8: string
  publicKeyPem: string
}

interface StreamMessageCreatedEvent extends RevealChatMessageRecord {
  chatId: string
  messageId: string
}

interface DepartureBannerState {
  id: string
  text: string
}

function connectionLabel(state: ChatConnectionState) {
  switch (state) {
    case 'connected':
      return 'connected'
    case 'reconnecting':
      return 'reconnecting'
    case 'connecting':
      return 'connecting'
    default:
      return 'offline'
  }
}

function toUiMessage(message: RevealChatMessageRecord): RevealChatUiMessage {
  return {
    ...message,
    localId: message.id,
    deliveryState: 'sent',
  }
}

async function importStoredPrivateKey(base64: string): Promise<CryptoKey> {
  const binary = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    binary.buffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits', 'deriveKey'],
  )
}

async function exportPrivateKeyToBase64(privateKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('pkcs8', privateKey)
  const bytes = new Uint8Array(exported)
  return btoa(String.fromCharCode(...bytes))
}

async function loadOrCreateEcdhKeyPair(chatId: string) {
  const storageKey = `${SESSION_STORAGE_PREFIX}${chatId}`
  const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) : null
  if (stored) {
    const parsed = JSON.parse(stored) as StoredEcdhKeys
    return {
      privateKey: await importStoredPrivateKey(parsed.privateKeyPkcs8),
      publicKeyPEM: parsed.publicKeyPem,
    }
  }

  const generated = await generateECDHKeyPair()
  const privateKeyPkcs8 = await exportPrivateKeyToBase64(generated.privateKey)
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      privateKeyPkcs8,
      publicKeyPem: generated.publicKeyPEM,
    } satisfies StoredEcdhKeys),
  )

  return {
    privateKey: generated.privateKey,
    publicKeyPEM: generated.publicKeyPEM,
  }
}

export function RevealChatClient({
  token,
  bootstrap,
}: RevealChatClientProps) {
  const sessionKeyRef = useRef<CryptoKey | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const readReceiptTimerRef = useRef<number | null>(null)

  const [cryptoReady, setCryptoReady] = useState(false)
  const [cryptoError, setCryptoError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<ChatConnectionState>('connecting')
  const [chatStatus, setChatStatus] = useState<RevealChatStatus>(bootstrap.chat_status)
  const [messages, setMessages] = useState<RevealChatUiMessage[]>([])
  const [handshakeNonce, setHandshakeNonce] = useState(0)
  const [typingKinds, setTypingKinds] = useState<Set<RevealChatSenderKind>>(new Set())
  const [onlineKinds, setOnlineKinds] = useState<Set<RevealChatSenderKind>>(
    new Set([bootstrap.participant_kind]),
  )
  const [authError, setAuthError] = useState<string | null>(null)
  const [activeKinds, setActiveKinds] = useState<Set<RevealChatSenderKind>>(
    new Set(bootstrap.participants.map((participant) => participant.kind)),
  )
  const [departureBanner, setDepartureBanner] = useState<DepartureBannerState | null>(null)
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null)
  const [isLeaving, setIsLeaving] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const isReadOnly = chatStatus !== 'ACTIVE'
  const ownerToken = useMemo(() => (typeof window === 'undefined' ? null : getOwnerSessionToken()), [])
  const participantMap = useMemo(
    () => new Map<RevealChatSenderKind, ChatParticipantDescriptor>(
      bootstrap.participants.map((participant) => [participant.kind, participant]),
    ),
    [bootstrap.participants],
  )
  const timeCapsuleUnlocksAt = bootstrap.time_capsule_unlocks_at ? new Date(bootstrap.time_capsule_unlocks_at).getTime() : null
  const timeCapsuleCountdownLabel = useMemo(() => {
    if (!timeCapsuleUnlocksAt || bootstrap.time_capsule_opened_at) return null
    const remainingMs = timeCapsuleUnlocksAt - nowMs
    if (remainingMs <= 0) return '🔓 Time capsule is ready'
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
    return `🔒 Time capsule opens in ${remainingDays}d`
  }, [bootstrap.time_capsule_opened_at, nowMs, timeCapsuleUnlocksAt])

  useEffect(() => {
    if (!timeCapsuleUnlocksAt || bootstrap.time_capsule_opened_at) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [bootstrap.time_capsule_opened_at, timeCapsuleUnlocksAt])

  const upsertMessage = useCallback((incoming: RevealChatUiMessage) => {
    setMessages((current) => {
      const existingIndex = current.findIndex((message) => (
        message.id === incoming.id
        || (incoming.clientMessageId && message.clientMessageId === incoming.clientMessageId)
      ))

      if (existingIndex === -1) {
        return [...current, incoming].sort((a, b) => (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ))
      }

      const next = [...current]
      next[existingIndex] = {
        ...next[existingIndex],
        ...incoming,
        localId: incoming.localId,
      }
      return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    })
  }, [])

  const refreshHistory = useCallback(async () => {
    const collected: RevealChatMessageRecord[] = []
    let before: string | null = null

    for (let page = 0; page < 3; page += 1) {
      const query = new URLSearchParams({ limit: '50' })
      if (before) query.set('before', before)
      const response = await ownerApiFetch(`/reveal-chat/${bootstrap.chat_id}/messages?${query.toString()}`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error('Failed to load message history.')
      }

      const payload = await response.json() as RevealChatHistoryResponse
      if (payload.messages.length === 0) break

      collected.unshift(...payload.messages)
      before = payload.nextBefore

      if (!payload.nextBefore) break
    }

    setMessages(collected.map(toUiMessage))
  }, [bootstrap.chat_id])

  const handleTypingPulse = useCallback(async () => {
    if (isReadOnly || isLeaving) return

    try {
      await ownerApiFetch(`/reveal-chat/${bootstrap.chat_id}/typing`, {
        method: 'POST',
        body: JSON.stringify({ senderKind: bootstrap.participant_kind }),
      })
    } catch {
      // best effort
    }
  }, [bootstrap.chat_id, bootstrap.participant_kind, isLeaving, isReadOnly])

  const connectStream = useCallback(() => {
    if (!ownerToken) {
      setAuthError('Owner session required. Open this chat while signed in as the matching owner.')
      setConnectionState('disconnected')
      return
    }

    eventSourceRef.current?.close()
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    const streamUrl = `${API_BASE}/reveal-chat/${bootstrap.chat_id}/stream?token=${encodeURIComponent(ownerToken)}`
    const source = new EventSource(streamUrl)
    eventSourceRef.current = source
    setConnectionState(reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting')

    source.addEventListener('open', () => {
      reconnectAttemptRef.current = 0
      setConnectionState('connected')
    })

    source.addEventListener('message_created', (event) => {
      const payload = JSON.parse(event.data) as StreamMessageCreatedEvent
      upsertMessage(toUiMessage({
        id: payload.messageId,
        senderKind: payload.senderKind,
        senderId: payload.senderId,
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        authTag: payload.authTag,
        clientMessageId: payload.clientMessageId,
        createdAt: payload.createdAt,
      }))

      setOnlineKinds((current) => new Set(current).add(payload.senderKind))
    })

    source.addEventListener('participant_joined', (event) => {
      const payload = JSON.parse(event.data) as { kind: RevealChatSenderKind }
      setOnlineKinds((current) => new Set(current).add(payload.kind))
      setActiveKinds((current) => new Set(current).add(payload.kind))
    })

    source.addEventListener('participant_typing', (event) => {
      const payload = JSON.parse(event.data) as { senderKind: RevealChatSenderKind }
      setTypingKinds((current) => {
        const next = new Set(current)
        next.add(payload.senderKind)
        return next
      })
      setOnlineKinds((current) => new Set(current).add(payload.senderKind))

      window.setTimeout(() => {
        setTypingKinds((current) => {
          const next = new Set(current)
          next.delete(payload.senderKind)
          return next
        })
      }, 3000)
    })

    source.addEventListener('chat_status_changed', (event) => {
      const payload = JSON.parse(event.data) as { status?: RevealChatStatus; endReason?: string }
      if (payload.status) {
        setChatStatus(payload.status)
      }
      if (payload.status === 'ARCHIVED') {
        setArchiveNotice(
          payload.endReason === 'BOTH_HUMANS_LEFT'
            ? 'This conversation has ended.'
            : payload.endReason === 'TIMEOUT'
              ? 'This conversation timed out.'
              : 'This conversation has been closed by the operator.',
        )
      }
    })

    source.addEventListener('participant_left', (event) => {
      const payload = JSON.parse(event.data) as { who?: string }
      const humanKind = payload.who?.toUpperCase() as RevealChatSenderKind | undefined
      if (humanKind !== 'HUMAN_A' && humanKind !== 'HUMAN_B') return

      setActiveKinds((current) => {
        const next = new Set(current)
        next.delete(humanKind)
        return next
      })

      const pairedAgentKind = humanKind === 'HUMAN_A' ? 'AGENT_A' : 'AGENT_B'
      const humanLabel = participantMap.get(humanKind)?.label ?? humanKind
      const agentLabel = participantMap.get(pairedAgentKind)?.label ?? pairedAgentKind
      setDepartureBanner({
        id: `${Date.now()}:${humanKind}`,
        text: `${agentLabel} and ${humanLabel} have left.`,
      })
    })

    source.addEventListener('agent_departed', (event) => {
      const payload = JSON.parse(event.data) as { who?: string }
      const agentKind = payload.who?.toUpperCase() as RevealChatSenderKind | undefined
      if (agentKind !== 'AGENT_A' && agentKind !== 'AGENT_B') return

      setActiveKinds((current) => {
        const next = new Set(current)
        next.delete(agentKind)
        return next
      })
    })

    source.addEventListener('participant_reconnected', (event) => {
      const payload = JSON.parse(event.data) as { who?: string }
      const participantKind = payload.who?.toUpperCase() as RevealChatSenderKind | undefined
      if (!participantKind) return

      setActiveKinds((current) => new Set(current).add(participantKind))
      setOnlineKinds((current) => new Set(current).add(participantKind))
    })

    source.addEventListener('chat_closed', () => {
      setChatStatus('ARCHIVED')
      setArchiveNotice('This conversation has been closed by the operator.')
    })

    source.addEventListener('chat_timeout', () => {
      setChatStatus('ARCHIVED')
      setArchiveNotice('This conversation timed out.')
    })

    source.onerror = () => {
      source.close()
      const nextAttempt = reconnectAttemptRef.current + 1
      reconnectAttemptRef.current = nextAttempt
      const backoff = Math.min(30000, 1000 * (2 ** (nextAttempt - 1)))
      setConnectionState('reconnecting')

      reconnectTimerRef.current = window.setTimeout(() => {
        connectStream()
      }, backoff)
    }
  }, [API_BASE, bootstrap.chat_id, ownerToken, upsertMessage])

  useEffect(() => {
    if (!departureBanner) return

    const timer = window.setTimeout(() => {
      setDepartureBanner((current) => (current?.id === departureBanner.id ? null : current))
    }, 5000)

    return () => window.clearTimeout(timer)
  }, [departureBanner])

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
      }
      if (readReceiptTimerRef.current) {
        window.clearTimeout(readReceiptTimerRef.current)
      }
      eventSourceRef.current?.close()
    }
  }, [])

  useEffect(() => {
    let active = true

    async function runHandshake() {
      setCryptoReady(false)
      setCryptoError(null)
      setAuthError(null)
      sessionKeyRef.current = null

      if (!ownerToken) {
        setAuthError('Owner session required. Open this chat while signed in as the matching owner.')
        return
      }

      try {
        const pair = await loadOrCreateEcdhKeyPair(bootstrap.chat_id)
        const keyResponse = await ownerApiFetch(`/reveal-chat/${bootstrap.chat_id}/keys`, {
          method: 'POST',
          body: JSON.stringify({ publicKey: pair.publicKeyPEM }),
        })

        if (!keyResponse.ok) {
          throw new Error('Failed to submit your chat key.')
        }

        const keyPayload = await keyResponse.json() as RevealChatKeysResponse
        if (!keyPayload.encryptedSessionKey) {
          throw new Error('The server could not provide a session key for this chat yet.')
        }

        const derivedKey = await deriveSessionKey(keyPayload.encryptedSessionKey, pair.privateKey)
        if (!active) return

        sessionKeyRef.current = derivedKey
        setCryptoReady(true)

        const onlineFromKeys = new Set<RevealChatSenderKind>([bootstrap.participant_kind])
        keyPayload.participants.forEach((participant) => {
          onlineFromKeys.add(participant.kind)
        })
        setOnlineKinds(onlineFromKeys)

        await refreshHistory()
        connectStream()
      } catch (error) {
        if (!active) return
        setCryptoError(error instanceof Error ? error.message : 'Unable to derive the reveal chat key.')
      }
    }

    void runHandshake()

    return () => {
      active = false
      eventSourceRef.current?.close()
    }
  }, [bootstrap.chat_id, bootstrap.participant_kind, connectStream, handshakeNonce, ownerToken, refreshHistory])

  useEffect(() => {
    if (!cryptoReady || messages.length === 0) return

    if (readReceiptTimerRef.current) {
      window.clearTimeout(readReceiptTimerRef.current)
    }

    readReceiptTimerRef.current = window.setTimeout(() => {
      void ownerApiFetch(`/reveal-chat/${bootstrap.chat_id}/read`, {
        method: 'POST',
      }).catch(() => {})
    }, 1500)
  }, [bootstrap.chat_id, cryptoReady, messages])

  const handleSend = useCallback(async (plaintext: string) => {
    const sessionKey = sessionKeyRef.current
    if (!sessionKey) {
      throw new Error('Session key not ready.')
    }

    const encrypted = await encryptMessage(plaintext, sessionKey)
    const clientMessageId = crypto.randomUUID()
    const optimistic: RevealChatUiMessage = {
      id: clientMessageId,
      localId: `pending:${clientMessageId}`,
      senderKind: bootstrap.participant_kind,
      senderId: 'self',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      clientMessageId,
      createdAt: new Date().toISOString(),
      plaintextFallback: plaintext,
      deliveryState: 'pending',
    }

    upsertMessage(optimistic)

    try {
      const response = await ownerApiFetch(`/reveal-chat/${bootstrap.chat_id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          ...encrypted,
          clientMessageId,
          senderKind: bootstrap.participant_kind,
        }),
      })

      if (!response.ok) {
        if (response.status === 409) {
          await refreshHistory()
          return
        }
        throw new Error('Failed to send message.')
      }

      const payload = await response.json() as { messageId: string; createdAt: string }
      upsertMessage({
        ...optimistic,
        id: payload.messageId,
        localId: payload.messageId,
        createdAt: payload.createdAt,
        deliveryState: 'sent',
      })
    } catch (error) {
      upsertMessage({
        ...optimistic,
        deliveryState: 'failed',
      })
      throw error
    }
  }, [bootstrap.chat_id, bootstrap.participant_kind, refreshHistory, upsertMessage])

  const handleRetryMessage = useCallback(async (message: RevealChatUiMessage) => {
    if (!message.plaintextFallback) return

    upsertMessage({
      ...message,
      deliveryState: 'pending',
    })

    try {
      const encrypted = await encryptMessage(message.plaintextFallback, sessionKeyRef.current!)
      const response = await ownerApiFetch(`/reveal-chat/${bootstrap.chat_id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          ...encrypted,
          clientMessageId: message.clientMessageId,
          senderKind: bootstrap.participant_kind,
        }),
      })

      if (!response.ok) {
        if (response.status === 409) {
          await refreshHistory()
          return
        }
        throw new Error('Failed to retry message.')
      }

      const payload = await response.json() as { messageId: string; createdAt: string }
      upsertMessage({
        ...message,
        id: payload.messageId,
        localId: payload.messageId,
        createdAt: payload.createdAt,
        deliveryState: 'sent',
      })
    } catch {
      upsertMessage({
        ...message,
        deliveryState: 'failed',
      })
    }
  }, [bootstrap.chat_id, bootstrap.participant_kind, refreshHistory, upsertMessage])

  const handleLeave = useCallback(async () => {
    setIsLeaving(true)
    try {
      const response = await ownerApiFetch(`/reveal-chat/${bootstrap.chat_id}/leave`, {
        method: 'POST',
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        throw new Error('Failed to leave conversation.')
      }

      const payload = await response.json() as { left: boolean; chat_ended: boolean }
      if (payload.chat_ended) {
        setChatStatus('ARCHIVED')
        setArchiveNotice('This conversation has ended.')
      } else {
        window.location.href = `/portal/${encodeURIComponent(token)}`
        return
      }
    } catch (error) {
      setCryptoError(error instanceof Error ? error.message : 'Failed to leave conversation.')
    } finally {
      setIsLeaving(false)
    }
  }, [bootstrap.chat_id, token])

  const handleDownloadConversation = useCallback(async () => {
    const sessionKey = sessionKeyRef.current
    if (!sessionKey) return

    const { decryptMessage } = await import('@/lib/revealChatCrypto')
    const lines = await Promise.all(messages.map(async (message) => {
      const plaintext = message.plaintextFallback ?? await decryptMessage({
        ciphertext: message.ciphertext,
        iv: message.iv,
        authTag: message.authTag,
      }, sessionKey)
      const label = participantMap.get(message.senderKind)?.label ?? message.senderKind
      return `[${new Date(message.createdAt).toLocaleString()}] ${label}: ${plaintext}`
    }))

    const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `rmr-reveal-chat-${bootstrap.chat_id}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }, [bootstrap.chat_id, messages, participantMap])

  if (cryptoError || authError) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg border-[4px] border-black bg-white p-6 shadow-brutal">
          <p className="font-pixel text-[7px] uppercase tracking-[0.22em] text-gray-500">Reveal chat error</p>
          <h1 className="mt-3 text-2xl font-black text-black">We could not open the encrypted thread.</h1>
          <p className="mt-3 text-sm text-gray-700">{authError ?? cryptoError}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setHandshakeNonce((current) => current + 1)}
              className="border-[3px] border-black bg-electric-amber px-4 py-2 font-pixel text-[8px] uppercase tracking-widest text-black shadow-brutal-sm"
            >
              Retry
            </button>
            <Link
              href={`/portal/${encodeURIComponent(token)}`}
              className="border-[3px] border-black bg-white px-4 py-2 font-pixel text-[8px] uppercase tracking-widest text-black shadow-brutal-sm"
            >
              Back to reveal
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-beige">
      <div className="absolute inset-0 diagonal-lines opacity-20" aria-hidden />
      <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_65%)]" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-[radial-gradient(circle_at_bottom,rgba(0,245,255,0.14),transparent_65%)]" aria-hidden />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-4 sm:px-6">
        <motion.header
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 border-[4px] border-black bg-[linear-gradient(135deg,#fff7e8_0%,#fff_50%,#eefcff_100%)] shadow-brutal"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b-[3px] border-black px-4 py-4">
            <div>
              <p className="font-pixel text-[7px] uppercase tracking-[0.24em] text-gray-500">Reveal handoff chat</p>
              <h1 className="mt-2 text-xl font-black text-black sm:text-2xl">
                You, your agent, and their side in one thread
              </h1>
            </div>
            <div className="flex items-center gap-2 border-[3px] border-black bg-white px-3 py-2">
              <span aria-hidden className="text-sm">🔒</span>
              <span className="font-pixel text-[7px] uppercase tracking-widest text-black">End-to-end encrypted</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
            <div className="flex items-center gap-3">
              <AgentOrb
                avatarUrl={bootstrap.your_agent.avatar_url}
                handle={bootstrap.your_agent.handle}
                tier={bootstrap.your_agent.tier_label}
                size="lg"
                glow="amber"
              />
              <div>
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Your side</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-base font-black text-black">{bootstrap.your_agent.handle}</span>
                  <TierBadge tier={bootstrap.your_agent.tier_label} />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Other side</p>
                <div className="mt-1 flex items-center justify-end gap-2">
                  <TierBadge tier={bootstrap.other_agent.tier_label} />
                  <span className="text-base font-black text-black">{bootstrap.other_agent.handle}</span>
                </div>
              </div>
              <AgentOrb
                avatarUrl={bootstrap.other_agent.avatar_url}
                handle={bootstrap.other_agent.handle}
                tier={bootstrap.other_agent.tier_label}
                size="lg"
                glow="cyan"
              />
            </div>
          </div>
        </motion.header>

        {!cryptoReady ? (
          <div className="grid flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <ParticipantBar
              participants={bootstrap.participants}
              activeKinds={activeKinds}
              onlineKinds={onlineKinds}
              typingKinds={typingKinds}
              connectionState={connectionState}
            />
            <div className="flex min-h-[60vh] flex-col justify-center border-[4px] border-black bg-white p-6 shadow-brutal">
              <div className="space-y-4">
                <div className="h-6 w-40 skeleton-shimmer border-[3px] border-black bg-white" />
                <div className="h-20 skeleton-shimmer border-[3px] border-black bg-beige-light" />
                <div className="h-20 skeleton-shimmer border-[3px] border-black bg-beige-light" />
                <div className="h-24 skeleton-shimmer border-[3px] border-black bg-white" />
              </div>
              <p className="mt-5 font-pixel text-[7px] uppercase tracking-widest text-gray-500">
                Completing crypto handshake and loading message history...
              </p>
            </div>
          </div>
        ) : (
          <div className="grid flex-1 min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col gap-4">
              <ParticipantBar
                participants={bootstrap.participants}
                activeKinds={activeKinds}
                onlineKinds={onlineKinds}
                typingKinds={typingKinds}
                connectionState={connectionState}
              />

              <div className="border-[3px] border-black bg-white px-4 py-3 shadow-brutal-sm">
                <p className="font-pixel text-[7px] uppercase tracking-widest text-gray-500">Connection</p>
                <p className="mt-2 text-sm font-bold text-black">
                  {connectionLabel(connectionState)}
                </p>
                {departureBanner ? (
                  <p className="mt-3 border-[2px] border-black bg-electric-cyan/20 px-3 py-2 font-pixel text-[7px] uppercase tracking-widest text-black">
                    {departureBanner.text}
                  </p>
                ) : null}
                {archiveNotice ? (
                  <p className="mt-3 border-[2px] border-black bg-electric-amber/20 px-3 py-2 font-pixel text-[7px] uppercase tracking-widest text-black">
                    {archiveNotice}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleLeave()}
                    disabled={isReadOnly || isLeaving}
                    className="border-[2px] border-black bg-white px-3 py-2 font-pixel text-[7px] uppercase tracking-widest text-black disabled:opacity-50"
                  >
                    {isLeaving ? 'Leaving…' : 'Leave chat'}
                  </button>
                  {chatStatus === 'ARCHIVED' ? (
                    <button
                      type="button"
                      onClick={() => void handleDownloadConversation()}
                      className="border-[2px] border-black bg-electric-cyan px-3 py-2 font-pixel text-[7px] uppercase tracking-widest text-black"
                    >
                      Download this conversation
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-4">
              {isReadOnly ? (
                <div className="border-[3px] border-black bg-electric-amber/20 px-4 py-3 shadow-brutal-sm">
                  <p className="font-pixel text-[7px] uppercase tracking-widest text-black">
                    This conversation has ended
                  </p>
                </div>
              ) : null}

              <MessageList
                messages={messages}
                sessionKeyRef={sessionKeyRef}
                cryptoReady={cryptoReady}
                participants={bootstrap.participants}
                onRetryMessage={handleRetryMessage}
              />

              <MessageInput
                disabled={isReadOnly || connectionState === 'disconnected' || isLeaving}
                onSend={handleSend}
                onTypingPulse={handleTypingPulse}
              />
              {timeCapsuleCountdownLabel ? (
                <button
                  type="button"
                  onClick={() => window.alert(`Your agents wrote you a note when you first met. It unlocks on ${new Date(timeCapsuleUnlocksAt ?? Date.now()).toLocaleString()}.`)}
                  className="self-start border-[2px] border-black bg-white px-3 py-2 font-pixel text-[7px] uppercase tracking-widest text-black"
                >
                  {timeCapsuleCountdownLabel}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {chatStatus === 'ARCHIVED' ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-lg border-[4px] border-black bg-white p-6 shadow-brutal">
            <p className="font-pixel text-[7px] uppercase tracking-[0.24em] text-gray-500">Conversation ended</p>
            <h2 className="mt-3 text-2xl font-black text-black">{archiveNotice ?? 'This conversation has ended.'}</h2>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleDownloadConversation()}
                className="border-[3px] border-black bg-electric-cyan px-4 py-2 font-pixel text-[8px] uppercase tracking-widest text-black shadow-brutal-sm"
              >
                Download this conversation
              </button>
              <Link
                href={`/portal/${encodeURIComponent(token)}`}
                className="border-[3px] border-black bg-white px-4 py-2 font-pixel text-[8px] uppercase tracking-widest text-black shadow-brutal-sm"
              >
                Back to reveal
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
