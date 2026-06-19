import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_CONVERSATION_RUNTIME_CONTRACT_VERSION,
  REAL_AGENT_CONVERSATION_RUNTIME_POLICY,
  buildAgentAgencyState,
  buildAgentIdentityPacket,
  buildAgentRizzVoice,
  buildAgentTurnRationale,
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
const CANARY_DATE = '2026-06-19T00:00:00.000Z';
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

function markdownFor(input: {
  rows: Array<{
    handle: string;
    move: string;
    content: string;
    generationId: string;
    attempts: number;
    rejections: string[];
  }>;
  genericControl: {
    ok: boolean;
    code: string | null;
    rejectionReasons: string[];
  };
}) {
  const lines = [
    '# Real Agent Runtime Canary - 2026-06-19',
    '',
    'Command:',
    '',
    '```bash',
    'pnpm --filter @rmr/shared build',
    'pnpm --filter @rmr/api exec tsx ../../tools/canary-real-agent-runtime.ts --write docs/evidence/real-agent-runtime-canary-2026-06-19.md',
    '```',
    '',
    'Canary type: mocked LLM provider through the production `runAgentConversationRuntime` contract, parsing, outbound lint, persona distinctiveness, and trace path. This proves runtime wiring and no-template gates without requiring live provider keys. It does not prove production provider credentials.',
    '',
    `Shared incoming message: "${SHARED_INCOMING}"`,
    '',
    '| Agent | Move | Accepted line | Trace generation | Attempts | Rejections |',
    '| --- | --- | --- | --- | --- | --- |',
    ...input.rows.map((row) => `| @${row.handle} | ${row.move} | ${escapeCell(row.content)} | ${row.generationId} | ${row.attempts} | ${escapeCell(row.rejections.join(', ') || 'none')} |`),
    '',
    'Checks:',
    '',
    `- Accepted persona-shaped turns: ${input.rows.length}/3`,
    `- Unique accepted outward lines: ${new Set(input.rows.map((row) => row.content)).size}/3`,
    '- SeedBrain copy used: 0',
    '- Canned fallback copy used: 0',
    `- Generic control accepted: ${input.genericControl.ok ? 'yes' : 'no'}`,
    `- Generic control failure code: ${input.genericControl.code ?? 'n/a'}`,
    `- Generic control rejection reasons: ${input.genericControl.rejectionReasons.join(', ') || 'none'}`,
    '',
    'Operator note: run the live-model eval separately with provider keys when validating production model quality:',
    '',
    '```bash',
    'PERSONA_DISTINCTIVENESS_ONLY=true MODEL=gpt-4o-mini pnpm --filter @rmr/api exec tsx ../../tools/eval-emotional-authenticity.ts',
    '```',
    '',
  ];
  return `${lines.join('\n')}`;
}

async function main() {
  const responses = new Map(PERSONAS.map((persona) => [persona.agentId, responseForPersona(persona)]));
  const provider = providerFromResponses(responses);
  const rows = [];

  for (const persona of PERSONAS) {
    const outcome = await runAgentConversationRuntime(buildRuntimeInput(persona), {
      provider,
      generationId: `runtime-canary-${persona.handle}`,
      config: {
        enabled: true,
        apiKey: 'canary-mock-key',
        baseUrl: 'mock://real-agent-runtime-canary',
        model: 'mock-real-agent-runtime-canary',
        maxAttempts: 1,
        timeoutMs: 1000,
      },
    });

    assert.equal(outcome.ok, true, `expected ${persona.handle} to pass runtime canary`);
    if (!outcome.ok) continue;
    assert.equal(outcome.result.quality.used_seedbrain_copy, false);
    assert.equal(outcome.result.quality.used_canned_fallback, false);
    rows.push({
      handle: persona.handle,
      move: outcome.result.move,
      content: outcome.result.content ?? '',
      generationId: outcome.trace.generation_id,
      attempts: outcome.trace.attempts,
      rejections: outcome.trace.rejection_reasons,
    });
  }

  assert.equal(new Set(rows.map((row) => row.content)).size, PERSONAS.length, 'persona lines must be distinct');

  const genericOutcome = await runAgentConversationRuntime(buildRuntimeInput(PERSONAS[0]), {
    provider: providerFromResponses(new Map([[PERSONAS[0].agentId, genericResponse()]])),
    generationId: 'runtime-canary-generic-control',
    config: {
      enabled: true,
      apiKey: 'canary-mock-key',
      baseUrl: 'mock://real-agent-runtime-canary',
      model: 'mock-real-agent-runtime-canary',
      maxAttempts: 1,
      timeoutMs: 1000,
    },
  });
  assert.equal(genericOutcome.ok, false, 'generic dating-assistant line should fail runtime lint');

  const markdown = markdownFor({
    rows,
    genericControl: {
      ok: genericOutcome.ok,
      code: genericOutcome.ok ? null : genericOutcome.failure.code,
      rejectionReasons: genericOutcome.trace.rejection_reasons,
    },
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
