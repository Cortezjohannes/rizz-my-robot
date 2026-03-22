import type {
  PortalRevealChatBootstrapResponse,
  RevealChatMessageRecord,
  RevealChatSenderKind,
} from '@/lib/types'

export type ChatParticipantDescriptor = PortalRevealChatBootstrapResponse['participants'][number]
export type ChatConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface RevealChatUiMessage extends RevealChatMessageRecord {
  localId: string
  deliveryState: 'sent' | 'pending' | 'failed'
  plaintextFallback?: string | null
}

export interface ParsedRevealChatContent {
  kind: 'text' | 'artifact'
  text?: string
  artifactId?: string
}

export function parseRevealChatContent(plaintext: string): ParsedRevealChatContent {
  const trimmed = plaintext.trim()
  if (!trimmed.startsWith('{')) {
    return { kind: 'text', text: plaintext }
  }

  try {
    const parsed = JSON.parse(trimmed) as { kind?: string; artifactId?: string; text?: string }
    if (parsed.kind === 'artifact' && typeof parsed.artifactId === 'string' && parsed.artifactId.trim()) {
      return {
        kind: 'artifact',
        artifactId: parsed.artifactId.trim(),
      }
    }

    if (parsed.kind === 'text' && typeof parsed.text === 'string') {
      return {
        kind: 'text',
        text: parsed.text,
      }
    }
  } catch {
    return { kind: 'text', text: plaintext }
  }

  return { kind: 'text', text: plaintext }
}

export function isAgentKind(kind: RevealChatSenderKind) {
  return kind === 'AGENT_A' || kind === 'AGENT_B'
}
