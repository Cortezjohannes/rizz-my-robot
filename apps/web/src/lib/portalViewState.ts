import type { PortalPhase, PortalRevealResponse } from './types'

export type PortalViewState = PortalPhase | 'age_verifying' | 'deciding'

type PortalLifecycleLike = Pick<PortalRevealResponse, 'phase' | 'lifecycle' | 'reveal_closed'> | null | undefined

export function resolvePortalViewState(input: PortalLifecycleLike): PortalViewState {
  if (input?.reveal_closed) return 'closed'
  return input?.phase ?? input?.lifecycle?.phase ?? 'reveal_offer'
}

export function isPortalUnlockedState(state: PortalViewState) {
  return state === 'contact_unlocked'
    || state === 'chat_ready'
    || state === 'chat_active'
    || state === 'chat_archived'
}

export function isPortalDecisionState(state: PortalViewState) {
  return state === 'reveal_offer' || state === 'deciding'
}

export function getPortalChatCtaLabel(state: PortalViewState) {
  if (state === 'chat_active') return 'Resume encrypted chat'
  if (state === 'chat_archived') return 'View archived chat'
  return 'Open encrypted chat'
}
