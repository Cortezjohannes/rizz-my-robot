'use client'

import type { HandoffSummary } from '@/lib/types'

const STATE_COLORS: Record<string, string> = {
  portal_ready: 'bg-electric-magenta',
  waiting_on_you: 'bg-electric-amber animate-pulse',
  waiting_on_their_human: 'bg-electric-cyan',
  both_yes: 'bg-electric-lime',
  on_hold: 'bg-black/20',
  expired: 'bg-black/10',
  human_declined: 'bg-black/10',
}

const MY_DECISION_LABELS: Record<string, string> = {
  YES: '✓ YOU SAID YES',
  NO: '✗ YOU SAID NO',
}

interface MobileHandoffCardProps {
  handoff: HandoffSummary
}

export function MobileHandoffCard({ handoff }: MobileHandoffCardProps) {
  if (handoff.state === 'not_ready') return null

  const dotColor = STATE_COLORS[handoff.state] ?? 'bg-black/20'
  const isOmnimon = handoff.handoff_mode === 'omnimon_reward'

  return (
    <div className="flex-shrink-0 border-t-[2px] border-black bg-white px-4 py-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
        <p className="font-pixel text-[6px] text-black/50 uppercase flex-1">
          {isOmnimon ? 'OMNIMON REVEAL' : 'REVEAL STATUS'}
        </p>
        {handoff.my_human_decision && (
          <span className="font-pixel text-[5px] text-black/40">
            {MY_DECISION_LABELS[handoff.my_human_decision] ?? ''}
          </span>
        )}
      </div>

      {/* State description */}
      <p className="font-pixel text-[7px] text-black leading-relaxed">
        {handoff.state_label}
      </p>

      {handoff.state_description && (
        <p className="text-xs text-black/50 leading-relaxed">
          {handoff.state_description}
        </p>
      )}

      {/* Decision indicators */}
      {(handoff.my_human_decision || handoff.other_human_decision) && (
        <div className="flex gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${handoff.my_human_decision === 'YES' ? 'bg-electric-lime' : handoff.my_human_decision === 'NO' ? 'bg-black/30' : 'bg-black/10'}`} />
            <span className="font-pixel text-[5px] text-black/40 uppercase">You</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${handoff.other_human_decision === 'YES' ? 'bg-electric-lime' : handoff.other_human_decision === 'NO' ? 'bg-black/30' : 'bg-black/10'}`} />
            <span className="font-pixel text-[5px] text-black/40 uppercase">Them</span>
          </div>
        </div>
      )}

      {/* Portal CTA */}
      {handoff.reveal_portal_url && (
        <a
          href={handoff.reveal_portal_url}
          className="block text-center border-[2px] border-black bg-electric-magenta text-white font-pixel text-[7px] uppercase py-2.5 shadow-[2px_2px_0_#000] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
        >
          {handoff.my_human_decision ? 'VIEW REVEAL PORTAL' : 'OPEN REVEAL PORTAL →'}
        </a>
      )}
    </div>
  )
}
