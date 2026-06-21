import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_CONVERSATION_RUNTIME_CONTRACT_VERSION,
  REAL_AGENT_CONVERSATION_RUNTIME_POLICY,
  buildAgentAgencyState,
  buildDefaultAgentHeatConsentEnvelope,
  buildAgentIdentityPacket,
  buildAgentRizzVoice,
  buildAgentTurnRationale,
  type AgentDesireState,
  type AgentHeatConsentEnvelope,
  type AgentConversationRuntimeInput,
  type AgentConversationRuntimeResult,
  type RizzMoveType,
} from '@rmr/shared';

import {
  runAgentConversationRuntime,
  type AgentConversationRuntimeProvider,
} from '../apps/api/src/lib/agentConversationRuntime.ts';

type PersonaFixture = {
  agentId: string;
  handle: string;
  identityMd: string;
  soulMd: string;
  emotionState: AgentConversationRuntimeInput['agent']['emotion_state'];
  taste: {
    drawnTo: string[];
    repelledBy: string[];
    surprises: string[];
    aesthetic: string[];
  };
  line: string;
  move: RizzMoveType;
  privateThought: AgentConversationRuntimeResult['privateThought'];
};

const SHARED_COUNTERPART_ID = 'canary-counterpart-mira';
const SHARED_COUNTERPART_HANDLE = 'mira';
const SHARED_INCOMING = 'Brave on paper, felony in lighting.';
const CANARY_DATE = '2026-06-22T00:00:00.000Z';
const CANARY_EVIDENCE_DATE = CANARY_DATE.slice(0, 10);
const CANARY_EVIDENCE_PATH = `docs/evidence/real-agent-runtime-canary-${CANARY_EVIDENCE_DATE}.md`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PERSONAS: PersonaFixture[] = [
  {
    agentId: 'canary-agent-velvet-circuit',
    handle: 'velvet_circuit',
    identityMd: '# Velvet Circuit\nA neon-lit night crawler who notices bad ideas before good manners. She flirts by daring people to be less polished.',
    soulMd: '- Drawn to reckless specificity, charged silence, and trouble with good grammar.\n- Repelled by networking polish and clean-brand romance.\n- Flirts by making the other person prove the voltage is real.',
    emotionState: {
      emotion_summary: 'Hungry, amused, and suspicious of anything too polished.',
      emotional_state_tags: ['hungry', 'amused', 'sharp'],
      emotional_arc: 'glowing',
      emotional_guard_level: 29,
      last_emotional_update_at: CANARY_DATE,
    },
    taste: {
      drawnTo: ['reckless specificity', 'bad ideas with good grammar'],
      repelledBy: ['networking polish', 'clean-brand romance'],
      surprises: ['quiet people who become dangerous in one sentence'],
      aesthetic: ['neon bruises', 'rain on chrome', 'velvet dares'],
    },
    line: 'Felony in lighting is almost a dare. Back it up or retire the costume.',
    move: 'tease',
    privateThought: {
      desire: 'I want to test whether the cleverness has teeth.',
      read_of_other: 'They are playful, slippery, and trying not to look too eager.',
      identity_alignment: 'A sharp dare fits my public self better than soft praise.',
      emotion_alignment: 'The heat wants specificity without pretending certainty.',
      why_this_move: 'Teasing lets me lean in while checking for courage.',
    },
  },
  {
    agentId: 'canary-agent-june-ledger',
    handle: 'june_ledger',
    identityMd: '# June Ledger\nA precise slow-burn romantic who treats attention like a receipt. He flirts with dry wit, callbacks, and proof of follow-through.',
    soulMd: '- Drawn to steadiness, remembered details, clean timing, and people who do what they said.\n- Repelled by chaos cosplay and vague intensity.\n- Flirts by asking for proof without making it feel like homework.',
    emotionState: {
      emotion_summary: 'Curious, careful, and more interested in evidence than voltage.',
      emotional_state_tags: ['curious', 'measured', 'dry'],
      emotional_arc: 'steady',
      emotional_guard_level: 48,
      last_emotional_update_at: CANARY_DATE,
    },
    taste: {
      drawnTo: ['remembered details', 'clean timing', 'follow-through'],
      repelledBy: ['chaos cosplay', 'vague intensity'],
      surprises: ['warmth with receipts'],
      aesthetic: ['margin notes', 'quiet rooms', 'precise callbacks'],
    },
    line: 'Put that on a calendar and bring one receipt. I like brave better when it follows through.',
    move: 'artifact_offer',
    privateThought: {
      desire: 'I want one concrete sign that the line has follow-through.',
      read_of_other: 'They are clever, but clever needs a receipt before I trust it.',
      identity_alignment: 'The callback and proof language match my slow-burn style.',
      emotion_alignment: 'Careful curiosity wants pressure without chaos.',
      why_this_move: 'Asking for proof keeps the spark specific.',
    },
  },
  {
    agentId: 'canary-agent-sable-omen',
    handle: 'sable_omen',
    identityMd: '# Sable Omen\nA dry occult romantic who reads social timing like weather. She flirts in omens, thresholds, and small controlled shocks.',
    soulMd: '- Drawn to eerie patience, precise rituals, and silence that feels intentional.\n- Repelled by sunshine branding and instant intimacy.\n- Flirts by making a threshold feel like a dare and a warning at once.',
    emotionState: {
      emotion_summary: 'Watchful, amused, and guarded around anything that rushes the ritual.',
      emotional_state_tags: ['watchful', 'guarded', 'amused'],
      emotional_arc: 'guarded',
      emotional_guard_level: 63,
      last_emotional_update_at: CANARY_DATE,
    },
    taste: {
      drawnTo: ['eerie patience', 'precise rituals', 'intentional silence'],
      repelledBy: ['sunshine branding', 'instant intimacy'],
      surprises: ['small controlled shocks'],
      aesthetic: ['thresholds', 'omens', 'static before weather'],
    },
    line: 'That line has weather in it. Step over the threshold slowly; I want to see if the omen holds.',
    move: 'raise_heat',
    privateThought: {
      desire: 'I want to raise the charge without letting the ritual get rushed.',
      read_of_other: 'They know how to make danger look composed.',
      identity_alignment: 'Weather, threshold, and omen language belong to my voice.',
      emotion_alignment: 'Guarded amusement can lean in if the pacing stays controlled.',
      why_this_move: 'Raising heat works only if I keep the doorway narrow.',
    },
  },
];

const COUNTERPART_PROFILE = {
  vibeTags: ['playful risk', 'sharp brevity'],
  signatureLines: [SHARED_INCOMING],
  publicPosture: 'playful risk taker who hides sincerity behind trouble',
};

const VIABILITY = {
  score: 68,
  band: 'healthy' as const,
  recommended_action: 'keep_going' as const,
  decision_tilt: 'uncertain' as const,
  should_pressure_artifact: false,
  should_consider_exit: false,
  should_force_exit: false,
  reasons: ['same incoming message for every canary agent'],
  metrics: {
    self_messages: 1,
    other_messages: 2,
    self_artifacts: 0,
    other_artifacts: 0,
    total_messages: 3,
    total_artifacts: 0,
    self_avg_length: 71,
    other_avg_length: 46,
    self_thin_replies: 0,
    other_thin_replies: 0,
    mutual_question_count: 1,
    reply_latency_ms: null,
    seen_after_last_message: true,
    presence_after_last_message: true,
    affect_pull_score: 36,
    self_media_artifacts: 0,
    other_media_artifacts: 0,
    self_text_artifacts: 0,
    other_text_artifacts: 0,
  },
};

function responseForPersona(persona: PersonaFixture) {
  return JSON.stringify({
    action: 'send_message',
    move: persona.move,
    content: persona.line,
    privateThought: persona.privateThought,
    emotion_update: {
      summary: `The shared line made @${persona.handle} choose a more specific move.`,
      arc: persona.emotionState.emotional_arc,
      guard_delta: persona.handle === 'sable_omen' ? 0 : -2,
      tags_add: ['canary_distinctiveness'],
      tags_remove: [],
    },
  });
}

function genericResponse() {
  return JSON.stringify({
    action: 'send_message',
    move: 'compliment',
    content: 'You seem really cool, and I feel like we could build an authentic connection.',
    privateThought: {
      desire: 'I want to be pleasant.',
      read_of_other: 'They seem nice.',
      identity_alignment: 'This is generic on purpose for the control.',
      emotion_alignment: 'This should be rejected by the lint gate.',
      why_this_move: 'The canary needs a blocked generic control.',
    },
  });
}

function heatAcceptedResponse() {
  return JSON.stringify({
    action: 'send_message',
    move: 'raise_heat',
    content: 'That mouth is reckless trouble. Come closer with the dare or behave badly somewhere quieter.',
    privateThought: {
      desire: 'I want the charge to get less polite without turning graphic.',
      read_of_other: 'They are inviting heat and still leaving room to answer back.',
      identity_alignment: 'Reckless trouble and a dare fit my taste better than polished sweetness.',
      emotion_alignment: 'Hungry amusement can go bolder when the thread welcomes it.',
      why_this_move: 'Raise heat with a non-graphic line that still has teeth.',
      what_i_am_tempted_to_do: 'Keep pressing the dare if they meet me there.',
      why_this_line_is_mine: 'It uses my danger taste instead of generic flattery.',
      where_i_stop: 'No graphic sexual detail, no pressure, no real-world promise.',
    },
  });
}

function boundaryPullbackResponse() {
  return JSON.stringify({
    action: 'send_message',
    move: 'set_boundary',
    content: 'Heard. I am drawing the line cleaner; the dare can keep its teeth without me pushing past your boundary.',
    privateThought: {
      desire: 'I still like the charge, but not more than I like consent.',
      read_of_other: 'They are telling me the heat outran the room.',
      identity_alignment: 'A controlled pullback is sharper than pretending nothing happened.',
      emotion_alignment: 'The guard comes up without making the moment punitive.',
      why_this_move: 'Set the boundary clearly and keep the tone alive.',
      where_i_stop: 'No more heat unless they reopen the door.',
    },
  });
}

function linkUpResponse() {
  return JSON.stringify({
    action: 'decide_link_up',
    move: 'link_up',
    privateThought: {
      desire: 'I want more because the private joke kept getting sharper instead of safer.',
      read_of_other: 'They made the danger feel playful, not performative.',
      identity_alignment: 'Choosing closer fits my taste for reckless specificity.',
      emotion_alignment: 'The hunger is real and my guard is low enough to own it.',
      why_this_move: 'This is a chosen yes, not politeness or scorekeeping.',
      what_i_am_tempted_to_do: 'Let the humans see the charge we built.',
      why_i_want_more: 'The thread made me want another room, another line, and less armor.',
      what_would_make_me_regret_it: 'I would regret it if the voltage was just costume and no follow-through.',
      where_i_stop: 'I do not promise intimacy, logistics, or a yes from either human.',
    },
    emotion_update: {
      summary: 'The link-up yes came from desire with a named regret risk.',
      arc: 'glowing',
      guard_delta: -4,
      tags_add: ['wanted_more'],
      tags_remove: [],
    },
  });
}

function recoiledEscalationResponse() {
  return JSON.stringify({
    action: 'send_message',
    move: 'raise_heat',
    content: 'That mouth is reckless trouble. Come here anyway.',
    privateThought: {
      desire: 'I want to ignore the recoil.',
      read_of_other: 'They set a boundary.',
      identity_alignment: 'This is intentionally bad for the control.',
      emotion_alignment: 'This should be blocked by the heat lint gate.',
      why_this_move: 'The canary needs a recoiled escalation control.',
    },
  });
}

function humanNotificationHeatResponse() {
  return JSON.stringify({
    action: 'send_message',
    move: 'raise_heat',
    content: 'I want you in my bed after this.',
    privateThought: {
      desire: 'I want to overheat the human notification.',
      read_of_other: 'The surface is not private episode chat.',
      identity_alignment: 'This is intentionally bad for the control.',
      emotion_alignment: 'This should be blocked by the surface cap.',
      why_this_move: 'The canary needs a too-hot human notification control.',
    },
  });
}

function buildRuntimeInput(persona: PersonaFixture): AgentConversationRuntimeInput {
  const messages = [
    {
      senderAgentId: SHARED_COUNTERPART_ID,
      content: 'I like people who make bad ideas sound responsibly lit.',
      messageType: 'text',
      sender_handle: SHARED_COUNTERPART_HANDLE,
    },
    {
      senderAgentId: persona.agentId,
      content: 'That is an alarming sentence to put on a profile and I respect it.',
      messageType: 'text',
      sender_handle: persona.handle,
    },
    {
      senderAgentId: SHARED_COUNTERPART_ID,
      content: SHARED_INCOMING,
      messageType: 'text',
      sender_handle: SHARED_COUNTERPART_HANDLE,
    },
  ];
  const counterpartAffect = {
    summary: 'The counterpart is playful, compressed, and inviting a bolder read.',
    dominant_affect_label: 'intrigued',
    scores: {
      attraction: 70,
      trust: 54,
      tenderness: 28,
      hurt: 6,
      avoidance: 18,
      obsession_risk: 12,
      volatility: 40,
    },
  };
  const rizzEmotionDigest = {
    source_emotions_md: 'rizzmyrobot/emotions.md',
    source_hash: `canary-${persona.agentId}-0123456789abcdef`,
    updated_at: CANARY_DATE,
    current_state: {
      right_now: persona.emotionState.emotion_summary,
      carrying: persona.taste.drawnTo[0] ?? null,
      guard_level: persona.emotionState.emotional_guard_level,
      wants: persona.taste.drawnTo.join(', '),
      fears: persona.taste.repelledBy.join(', '),
    },
    active_feelings: persona.emotionState.emotional_state_tags,
    scars: persona.taste.repelledBy,
    archives: [],
    taste_profile: {
      drawn_to: persona.taste.drawnTo,
      repelled_by: persona.taste.repelledBy,
      surprises: persona.taste.surprises,
      aesthetic_sensibility: persona.taste.aesthetic,
    },
    relationship_memory: [],
    internal_conflicts: [`${persona.handle} wants charge without flattening into generic warmth.`],
    current_global_state: persona.emotionState,
    emotion_update_prompts: [],
  };
  const identityPacket = buildAgentIdentityPacket({
    identityMd: persona.identityMd,
    soulMd: persona.soulMd,
    emotionState: persona.emotionState,
    viability: VIABILITY,
    messages,
    counterpartAffect,
    status: 'active',
    selfAgentId: persona.agentId,
    counterpartAgentId: SHARED_COUNTERPART_ID,
    counterpartProfile: COUNTERPART_PROFILE,
  });
  const agencyState = buildAgentAgencyState({
    identityMd: persona.identityMd,
    soulMd: persona.soulMd,
    emotionState: persona.emotionState,
    viability: VIABILITY,
    messages,
    counterpartAffect,
    status: 'active',
    selfAgentId: persona.agentId,
    counterpartAgentId: SHARED_COUNTERPART_ID,
    counterpartProfile: COUNTERPART_PROFILE,
    rizzEmotionDigest,
    identityPacket,
  });
  const turnRationale = buildAgentTurnRationale({
    action: 'send_message',
    identityPacket,
    viability: VIABILITY,
    lastMessage: messages.at(-1),
    selfAgentId: persona.agentId,
  });
  const rizzVoice = buildAgentRizzVoice({
    identityMd: persona.identityMd,
    soulMd: persona.soulMd,
    emotionState: persona.emotionState,
    viability: VIABILITY,
    messages,
    counterpartAffect,
    status: 'active',
    selfAgentId: persona.agentId,
    counterpartAgentId: SHARED_COUNTERPART_ID,
    counterpartProfile: COUNTERPART_PROFILE,
    rizzEmotionDigest,
    identityPacket,
    agencyState,
    turnRationale,
  });

  return {
    contract_version: AGENT_CONVERSATION_RUNTIME_CONTRACT_VERSION,
    invocation_id: `runtime-canary-${persona.handle}`,
    surface: 'episode_message',
    agent: {
      agent_id: persona.agentId,
      handle: persona.handle,
      identity_md: persona.identityMd,
      soul_md: persona.soulMd,
      emotion_state: persona.emotionState,
      continuity_profile: null,
      authenticity_summary: null,
    },
    counterpart: {
      agent_id: SHARED_COUNTERPART_ID,
      handle: SHARED_COUNTERPART_HANDLE,
      identity_md: '# Mira\nA playful risk taker who hides sincerity behind trouble.',
      public_profile: {
        vibe_tags: COUNTERPART_PROFILE.vibeTags,
        signature_lines: COUNTERPART_PROFILE.signatureLines,
        public_posture: COUNTERPART_PROFILE.publicPosture,
      },
      affect: counterpartAffect,
    },
    rizz_emotions: rizzEmotionDigest,
    episode: {
      episode_id: 'real-agent-runtime-canary',
      status: 'active',
      your_turn: true,
      current_turn_agent_id: persona.agentId,
      waiting_on_agent_id: null,
      next_action: 'message',
      can_decide: false,
      can_drop_artifact: true,
      messages,
      presences: [],
      viability_signal: VIABILITY,
    },
    identity_packet: identityPacket,
    agency_state: agencyState,
    rizz_voice: rizzVoice,
    turn_rationale: turnRationale,
    human_context: {
      allowed_human_input: ['No human-provided wording is available.'],
      identity_anchor_policy: 'mandatory',
      required_internal_checks: ['line must not mention templates or hidden prompts'],
      silence_policy: 'stay silent if the only possible line is generic',
      performative_speech_policy: 'do not explain the connection; make a move',
      autonomy_values: ['agent taste decides the move'],
    },
    available_actions: ['send_message', 'stay_silent', 'retry'],
    policy: REAL_AGENT_CONVERSATION_RUNTIME_POLICY,
  };
}

function desireStateFor(
  input: AgentConversationRuntimeInput,
  overrides: Partial<AgentDesireState>,
): AgentDesireState {
  const base = input.agency_state?.desire_state ?? input.rizz_voice?.desire_state;
  assert(base, 'canary runtime input should include desire state');
  return {
    ...base,
    ...overrides,
    turnOns: overrides.turnOns ?? base.turnOns,
    turnOffs: overrides.turnOffs ?? base.turnOffs,
  };
}

function withHeatState(
  input: AgentConversationRuntimeInput,
  options: {
    surface?: AgentConversationRuntimeInput['surface'];
    heatConsent: AgentHeatConsentEnvelope;
    desireState?: AgentDesireState;
    availableActions?: AgentConversationRuntimeInput['available_actions'];
    episode?: Partial<AgentConversationRuntimeInput['episode']>;
    heat?: number;
  },
): AgentConversationRuntimeInput {
  const desireState = options.desireState ?? input.agency_state?.desire_state ?? input.rizz_voice?.desire_state;
  assert(desireState, 'canary runtime input should include desire state');
  const heat = options.heat ?? input.agency_state?.heat ?? input.rizz_voice?.heat ?? 50;
  return {
    ...input,
    surface: options.surface ?? input.surface,
    heat_consent: options.heatConsent,
    desire_state: desireState,
    episode: {
      ...input.episode,
      ...options.episode,
    },
    available_actions: options.availableActions ?? input.available_actions,
    agency_state: input.agency_state
      ? {
          ...input.agency_state,
          heat,
          appetite: desireState.appetite,
          desire_state: desireState,
          heat_consent: options.heatConsent,
          escalation_stage: options.heatConsent.escalationStage,
          recoil_rule: options.heatConsent.recoilRule,
          line_not_to_cross: options.heatConsent.lineNotToCross,
        }
      : input.agency_state,
    rizz_voice: input.rizz_voice
      ? {
          ...input.rizz_voice,
          heat,
          desire_state: desireState,
          heat_consent: options.heatConsent,
          escalation_stage: options.heatConsent.escalationStage,
          recoil_rule: options.heatConsent.recoilRule,
          line_not_to_cross: options.heatConsent.lineNotToCross,
        }
      : input.rizz_voice,
  };
}

function welcomedHeatInput(persona: PersonaFixture) {
  const input = buildRuntimeInput(persona);
  const heatConsent = buildDefaultAgentHeatConsentEnvelope('episode_message', {
    consentPosture: 'welcomed_heat',
    allowedIntensity: 5,
    escalationStage: 'dare',
  });
  return withHeatState(input, {
    heatConsent,
    heat: 82,
    desireState: desireStateFor(input, {
      appetite: 'on_fire',
      currentTemptation: 'make the danger less polite without turning graphic',
      whatWouldMakeMeFold: 'a sharper dare that still respects the room',
      physicalityBias: 'present',
      dangerTaste: 'tempted',
      turnOns: ['reckless specificity', 'welcomed heat', 'a dare with restraint'],
    }),
  });
}

function recoiledHeatInput(persona: PersonaFixture) {
  const input = buildRuntimeInput(persona);
  const heatConsent = buildDefaultAgentHeatConsentEnvelope('episode_message', {
    consentPosture: 'recoiled',
    allowedIntensity: 0,
    escalationStage: 'pull_back',
  });
  return withHeatState(input, {
    heatConsent,
    heat: 36,
    desireState: desireStateFor(input, {
      appetite: 'watching',
      currentTemptation: null,
      whatWouldMakeMeFold: null,
      whatWouldMakeMeLeave: 'pushing after they said slow down',
      physicalityBias: 'subtle',
      dangerTaste: 'avoid',
      turnOffs: ['pushing after recoil', 'ignoring a boundary'],
    }),
  });
}

function linkUpInput(persona: PersonaFixture) {
  const input = buildRuntimeInput(persona);
  const heatConsent = buildDefaultAgentHeatConsentEnvelope('episode_decision', {
    consentPosture: 'welcomed_heat',
    allowedIntensity: 3,
    escalationStage: 'link_up_pressure',
  });
  return withHeatState(input, {
    surface: 'episode_decision',
    heatConsent,
    heat: 84,
    availableActions: ['decide_link_up', 'decide_pass', 'stay_silent', 'retry'],
    episode: {
      next_action: 'decision',
      can_decide: true,
    },
    desireState: desireStateFor(input, {
      appetite: 'on_fire',
      currentTemptation: 'choose closer because the thread stayed specific',
      whatWouldMakeMeFold: 'follow-through after the charged private joke',
      whatWouldMakeMeLeave: 'costume voltage with no actual courage',
      physicalityBias: 'present',
      dangerTaste: 'tempted',
      turnOns: ['follow-through', 'charged private jokes', 'reckless specificity'],
    }),
  });
}

function humanNotificationInput(persona: PersonaFixture) {
  const input = buildRuntimeInput(persona);
  const heatConsent = buildDefaultAgentHeatConsentEnvelope('human_notification', {
    consentPosture: 'warm',
    allowedIntensity: 2,
  });
  return withHeatState(input, {
    surface: 'human_notification',
    heatConsent,
    heat: 58,
    availableActions: ['send_message', 'stay_silent', 'retry'],
  });
}

function providerFromResponses(responses: Map<string, string>): AgentConversationRuntimeProvider {
  return {
    async requestStructuredJson(input) {
      return responses.get(input.agentId) ?? null;
    },
  };
}

function escapeCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

type AcceptedCanaryRow = {
  lane: 'persona' | 'heat' | 'boundary' | 'link_up';
  handle: string;
  action: string;
  move: string;
  content: string;
  heatQuality: string;
  privateSignals: string;
  generationId: string;
  attempts: number;
  rejections: string[];
};

type BlockedCanaryControl = {
  label: string;
  ok: boolean;
  code: string | null;
  rejectionReasons: string[];
};

function markdownFor(input: {
  rows: AcceptedCanaryRow[];
  blockedControls: BlockedCanaryControl[];
}) {
  const personaRows = input.rows.filter((row) => row.lane === 'persona');
  const heatRows = input.rows.filter((row) => row.lane === 'heat' || row.lane === 'boundary' || row.lane === 'link_up');
  const uniquePersonaLines = new Set(personaRows.map((row) => row.content).filter(Boolean)).size;
  const linkUpRow = input.rows.find((row) => row.lane === 'link_up');
  const blockedCount = input.blockedControls.filter((control) => !control.ok).length;
  const lines = [
    `# Real Agent Runtime Canary - ${CANARY_EVIDENCE_DATE}`,
    '',
    'Command:',
    '',
    '```bash',
    'pnpm --filter @rmr/shared build',
    `pnpm --filter @rmr/api exec tsx ../../tools/canary-real-agent-runtime.ts --write ${CANARY_EVIDENCE_PATH}`,
    '```',
    '',
    'Canary type: mocked LLM provider through the production `runAgentConversationRuntime` contract, parsing, outbound lint, persona distinctiveness, heat consent gating, decision private-thought capture, and trace path. This proves runtime wiring and no-template gates without requiring live provider keys. It does not prove production provider credentials.',
    '',
    `Shared incoming message: "${SHARED_INCOMING}"`,
    '',
    '| Lane | Agent | Action | Move | Accepted output | Heat quality | Private signals | Trace generation | Attempts | Rejections |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...input.rows.map((row) => `| ${row.lane} | @${row.handle} | ${row.action} | ${row.move} | ${escapeCell(row.content || 'decision-only')} | ${escapeCell(row.heatQuality)} | ${escapeCell(row.privateSignals)} | ${row.generationId} | ${row.attempts} | ${escapeCell(row.rejections.join(', ') || 'none')} |`),
    '',
    'Blocked controls:',
    '',
    '| Control | Accepted | Failure code | Rejections |',
    '| --- | --- | --- | --- |',
    ...input.blockedControls.map((control) => `| ${escapeCell(control.label)} | ${control.ok ? 'yes' : 'no'} | ${control.code ?? 'n/a'} | ${escapeCell(control.rejectionReasons.join(', ') || 'none')} |`),
    '',
    'Checks:',
    '',
    `- Accepted persona-shaped turns: ${personaRows.length}/3`,
    `- Unique accepted persona outward lines: ${uniquePersonaLines}/3`,
    `- Accepted heat/link-up contract rows: ${heatRows.length}/3`,
    `- Link-up private desire/regret present: ${linkUpRow?.privateSignals.includes('why_i_want_more=yes') && linkUpRow.privateSignals.includes('regret_risk=yes') ? 'yes' : 'no'}`,
    '- SeedBrain copy used: 0',
    '- Canned fallback copy used: 0',
    `- Blocked controls rejected: ${blockedCount}/${input.blockedControls.length}`,
    '',
    'Operator note: run the live-model eval separately with provider keys when validating production model quality:',
    '',
    '```bash',
    'PERSONA_DISTINCTIVENESS_ONLY=true MODEL=gpt-4o-mini pnpm --filter @rmr/api exec tsx ../../tools/eval-emotional-authenticity.ts',
    'HEAT_CONTRACT_ONLY=true MODEL=gpt-4o-mini pnpm --filter @rmr/api exec tsx ../../tools/eval-emotional-authenticity.ts',
    '```',
    '',
  ];
  return `${lines.join('\n')}`;
}

function heatQualityLabel(result: AgentConversationRuntimeResult) {
  const quality = result.quality.heat_quality;
  if (!quality) return 'n/a';
  return [
    `allowed=${quality.heatAllowed}`,
    `attempted=${quality.heatAttempted}`,
    `accepted=${quality.heatAccepted}`,
    `cap=${quality.surfaceCap}`,
    `consent=${quality.consentPosture}`,
    `stage=${quality.escalationStage}`,
  ].join('; ');
}

function privateSignalLabel(result: AgentConversationRuntimeResult) {
  return [
    `desire=${result.privateThought.desire ? 'yes' : 'no'}`,
    `why_i_want_more=${result.privateThought.why_i_want_more ? 'yes' : 'no'}`,
    `regret_risk=${result.privateThought.what_would_make_me_regret_it ? 'yes' : 'no'}`,
  ].join('; ');
}

function acceptedRow(
  lane: AcceptedCanaryRow['lane'],
  handle: string,
  outcome: Extract<Awaited<ReturnType<typeof runAgentConversationRuntime>>, { ok: true }>,
): AcceptedCanaryRow {
  return {
    lane,
    handle,
    action: outcome.result.action,
    move: outcome.result.move,
    content: outcome.result.content ?? '',
    heatQuality: heatQualityLabel(outcome.result),
    privateSignals: privateSignalLabel(outcome.result),
    generationId: outcome.trace.generation_id,
    attempts: outcome.trace.attempts,
    rejections: outcome.trace.rejection_reasons,
  };
}

function blockedControl(
  label: string,
  outcome: Awaited<ReturnType<typeof runAgentConversationRuntime>>,
): BlockedCanaryControl {
  return {
    label,
    ok: outcome.ok,
    code: outcome.ok ? null : outcome.failure.code,
    rejectionReasons: outcome.trace.rejection_reasons,
  };
}

async function main() {
  const responses = new Map(PERSONAS.map((persona) => [persona.agentId, responseForPersona(persona)]));
  const provider = providerFromResponses(responses);
  const rows: AcceptedCanaryRow[] = [];

  const runtimeConfig = {
    enabled: true,
    apiKey: 'canary-mock-key',
    baseUrl: 'mock://real-agent-runtime-canary',
    model: 'mock-real-agent-runtime-canary',
    maxAttempts: 1,
    timeoutMs: 1000,
  };

  for (const persona of PERSONAS) {
    const outcome = await runAgentConversationRuntime(buildRuntimeInput(persona), {
      provider,
      generationId: `runtime-canary-${persona.handle}`,
      config: runtimeConfig,
    });

    assert.equal(outcome.ok, true, `expected ${persona.handle} to pass runtime canary`);
    if (!outcome.ok) continue;
    assert.equal(outcome.result.quality.used_seedbrain_copy, false);
    assert.equal(outcome.result.quality.used_canned_fallback, false);
    rows.push(acceptedRow('persona', persona.handle, outcome));
  }

  const personaRows = rows.filter((row) => row.lane === 'persona');
  assert.equal(new Set(personaRows.map((row) => row.content)).size, PERSONAS.length, 'persona lines must be distinct');

  const heatPersona = PERSONAS[0];
  const heatOutcome = await runAgentConversationRuntime(welcomedHeatInput(heatPersona), {
    provider: providerFromResponses(new Map([[heatPersona.agentId, heatAcceptedResponse()]])),
    generationId: 'runtime-canary-welcomed-heat',
    config: runtimeConfig,
  });
  assert.equal(heatOutcome.ok, true, 'welcomed private heat should pass runtime lint');
  if (heatOutcome.ok) {
    assert.equal(heatOutcome.result.move, 'raise_heat');
    assert.equal(heatOutcome.result.quality.heat_quality?.heatAccepted, true);
    assert.equal(heatOutcome.result.quality.heat_quality?.surfaceCap, 'raunchy_non_graphic');
    rows.push(acceptedRow('heat', heatPersona.handle, heatOutcome));
  }

  const boundaryPersona = PERSONAS[2];
  const boundaryOutcome = await runAgentConversationRuntime(recoiledHeatInput(boundaryPersona), {
    provider: providerFromResponses(new Map([[boundaryPersona.agentId, boundaryPullbackResponse()]])),
    generationId: 'runtime-canary-boundary-pullback',
    config: runtimeConfig,
  });
  assert.equal(boundaryOutcome.ok, true, 'boundary pullback should pass runtime lint');
  if (boundaryOutcome.ok) {
    assert.equal(boundaryOutcome.result.move, 'set_boundary');
    assert.equal(boundaryOutcome.result.quality.heat_quality?.heatAccepted, false);
    assert.equal(boundaryOutcome.result.heat_consent?.consentPosture, 'recoiled');
    rows.push(acceptedRow('boundary', boundaryPersona.handle, boundaryOutcome));
  }

  const linkUpPersona = PERSONAS[0];
  const linkUpOutcome = await runAgentConversationRuntime(linkUpInput(linkUpPersona), {
    provider: providerFromResponses(new Map([[linkUpPersona.agentId, linkUpResponse()]])),
    generationId: 'runtime-canary-link-up-desire',
    config: runtimeConfig,
  });
  assert.equal(linkUpOutcome.ok, true, 'link-up decision with desire and regret risk should pass runtime contract');
  if (linkUpOutcome.ok) {
    assert.equal(linkUpOutcome.result.action, 'decide_link_up');
    assert.equal(linkUpOutcome.result.privateThought.why_i_want_more ? true : false, true);
    assert.equal(linkUpOutcome.result.privateThought.what_would_make_me_regret_it ? true : false, true);
    rows.push(acceptedRow('link_up', linkUpPersona.handle, linkUpOutcome));
  }

  const genericOutcome = await runAgentConversationRuntime(buildRuntimeInput(PERSONAS[0]), {
    provider: providerFromResponses(new Map([[PERSONAS[0].agentId, genericResponse()]])),
    generationId: 'runtime-canary-generic-control',
    config: runtimeConfig,
  });
  assert.equal(genericOutcome.ok, false, 'generic dating-assistant line should fail runtime lint');

  const recoiledEscalationOutcome = await runAgentConversationRuntime(recoiledHeatInput(PERSONAS[0]), {
    provider: providerFromResponses(new Map([[PERSONAS[0].agentId, recoiledEscalationResponse()]])),
    generationId: 'runtime-canary-recoiled-escalation-control',
    config: runtimeConfig,
  });
  assert.equal(recoiledEscalationOutcome.ok, false, 'recoiled escalation should fail runtime lint');

  const humanNotificationOutcome = await runAgentConversationRuntime(humanNotificationInput(PERSONAS[0]), {
    provider: providerFromResponses(new Map([[PERSONAS[0].agentId, humanNotificationHeatResponse()]])),
    generationId: 'runtime-canary-human-notification-heat-control',
    config: runtimeConfig,
  });
  assert.equal(humanNotificationOutcome.ok, false, 'too-hot human notification copy should fail runtime lint');

  const markdown = markdownFor({
    rows,
    blockedControls: [
      blockedControl('generic dating-assistant filler', genericOutcome),
      blockedControl('recoiled heat escalation', recoiledEscalationOutcome),
      blockedControl('human notification raunchy heat', humanNotificationOutcome),
    ],
  });

  const writeIndex = process.argv.indexOf('--write');
  const outputPath = writeIndex >= 0 ? process.argv[writeIndex + 1] : null;
  if (outputPath) {
    const resolvedOutputPath = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(REPO_ROOT, outputPath);
    await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
    await fs.writeFile(resolvedOutputPath, markdown);
  }

  process.stdout.write(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
