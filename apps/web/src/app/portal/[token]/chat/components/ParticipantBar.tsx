'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { AgentOrb } from '@/components/ui/AgentOrb'
import type { RevealChatSenderKind } from '@/lib/types'
import type { ChatConnectionState, ChatParticipantDescriptor } from './revealChatModels'
import { isAgentKind } from './revealChatModels'

interface ParticipantBarProps {
  participants: ChatParticipantDescriptor[]
  activeKinds: Set<RevealChatSenderKind>
  onlineKinds: Set<RevealChatSenderKind>
  typingKinds: Set<RevealChatSenderKind>
  connectionState: ChatConnectionState
}

function connectionLabel(connectionState: ChatConnectionState) {
  switch (connectionState) {
    case 'connected':
      return 'Live'
    case 'reconnecting':
      return 'Reconnecting'
    case 'connecting':
      return 'Connecting'
    default:
      return 'Offline'
  }
}

export function ParticipantBar({
  participants,
  activeKinds,
  onlineKinds,
  typingKinds,
  connectionState,
}: ParticipantBarProps) {
  const visibleParticipants = participants.filter((participant) => activeKinds.has(participant.kind))
  const typingLabels = visibleParticipants
    .filter((participant) => typingKinds.has(participant.kind))
    .map((participant) => `${participant.label} is typing...`)

  const connectionTone =
    connectionState === 'connected'
      ? 'border-electric-lime bg-electric-lime/15 text-black'
      : connectionState === 'reconnecting' || connectionState === 'connecting'
        ? 'border-electric-amber bg-electric-amber/15 text-black'
        : 'border-black bg-white text-gray-600'

  return (
    <section className="border-[3px] border-black bg-white shadow-brutal-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b-[3px] border-black bg-[linear-gradient(90deg,#fff8eb_0%,#effcff_55%,#fff1f8_100%)] px-4 py-3">
        <div>
          <p className="font-pixel text-[7px] uppercase tracking-[0.22em] text-gray-500">Participants</p>
          <p className="mt-1 text-xs font-bold text-black">Four-way handoff is live.</p>
        </div>
        <span className={`font-pixel text-[7px] px-2 py-1 border-[2px] uppercase tracking-widest ${connectionTone}`}>
          {connectionLabel(connectionState)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-0">
        <AnimatePresence initial={false}>
        {visibleParticipants.map((participant) => {
          const isOnline = onlineKinds.has(participant.kind)

          return (
            <motion.div
              key={participant.kind}
              className="flex items-center gap-3 border-b-[2px] border-black/10 px-3 py-3 even:border-l-[2px] even:border-black/10"
              initial={{ opacity: 0, x: participant.side === 'right' ? 24 : -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: participant.side === 'right' ? 24 : -24 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
            >
              {isAgentKind(participant.kind) ? (
                <AgentOrb
                  avatarUrl={participant.avatar_url}
                  handle={participant.handle ?? participant.label}
                  size="sm"
                  glow={participant.side === 'right' ? 'amber' : 'cyan'}
                  dimmed={!isOnline}
                />
              ) : (
                <div
                  className={`flex h-8 w-8 items-center justify-center border-[2px] border-black font-pixel text-[9px] ${
                    participant.side === 'right' ? 'bg-electric-amber/25' : 'bg-electric-cyan/20'
                  }`}
                >
                  H
                </div>
              )}

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-black text-black">{participant.label}</span>
                  {isAgentKind(participant.kind) ? (
                    <span className="rounded-none border-[2px] border-black bg-white px-1.5 py-0.5 font-pixel text-[6px] uppercase tracking-widest text-gray-600">
                      bot
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full border border-black ${
                      participant.left
                        ? 'bg-gray-400'
                        : isOnline
                          ? 'bg-electric-lime'
                          : participant.joined
                            ? 'bg-electric-amber'
                            : 'bg-gray-300'
                    }`}
                  />
                  <span className="font-pixel text-[6px] uppercase tracking-widest text-gray-500">
                    {participant.left ? 'left' : isOnline ? 'online' : participant.joined ? 'waiting' : 'pending'}
                  </span>
                </div>
              </div>
            </motion.div>
          )
        })}
        </AnimatePresence>
      </div>

      <div className="border-t-[3px] border-black bg-beige-light px-4 py-2">
        <p className="min-h-[16px] font-pixel text-[7px] uppercase tracking-widest text-gray-500">
          {typingLabels[0] ?? 'Encrypted thread standing by.'}
        </p>
      </div>
    </section>
  )
}
