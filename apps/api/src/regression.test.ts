import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { prisma } from '@rmr/db';
import {
  AGENT_CONVERSATION_RUNTIME_CONTRACT_VERSION,
  RIZZ_MOCHI_GAME_ID,
  RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT,
  RIZZ_MOCHI_WAKE_HEADER_NAMES,
  RIZZ_MOCHI_NOOP_REASONS,
  REAL_AGENT_CONVERSATION_RUNTIME_POLICY,
  buildRizzMochiWakeEvent,
  buildRizzMochiWakeFixture,
  buildAgentAgencyState,
  buildAgentIdentityPacket,
  buildAgentRizzVoice,
  buildAgentTurnRationale,
  readResponseBytesWithLimit,
  verifyRizzMochiWakeRequest,
  type AgentConversationRuntimeInput,
  type RizzMochiWakeSigner,
} from '@rmr/shared';
import { buildApiServer, DEFAULT_JSON_BODY_LIMIT_BYTES } from './index.js';
import { hashApiKey } from './lib/auth.js';
import { buildControlCapabilities } from './lib/controlCenter.js';
import { feedRoutes } from './routes/feed.js';
import { generateShortCode } from './lib/claimAuth.js';
import { deriveClaimFlow } from './lib/claimFlow.js';
import { normalizePublicMediaUrl } from './lib/mediaAssets.js';
import { resolvePublicAvatarUrl } from './lib/profileDeck.js';
import { assertProductionRuntimeConfig, getProductionRuntimeConfigStatus } from './lib/runtimeConfig.js';
import { compileRizzEmotionMarkdown } from './lib/rizzEmotionDigest.js';
import { serializeEmotionalContinuitySnapshot } from './lib/continuity.js';
import {
  runAgentConversationRuntime,
  type AgentConversationRuntimeOutcome,
  type AgentConversationRuntimePersonaJudge,
  type AgentConversationRuntimeProvider,
} from './lib/agentConversationRuntime.js';
import { buildEpisodeRuntimeCommitPlan } from './lib/episodeRuntimeCommit.js';
import {
  buildDatePlanningRuntimeCommitPlan,
  buildRevealChatRuntimeCommitPlan,
} from './lib/revealDateRuntimeCommit.js';
import {
  buildTasteLedgerSnapshot,
  deriveTasteLedgerEntriesFromEmotionEvent,
  deriveTasteLedgerEntriesFromRuntimeOutcome,
  negativeTasteTagsFromLedger,
  positiveTasteTagsFromLedger,
} from './lib/tasteLedger.js';

const LEGACY_MEDIA_ID = '11111111-1111-1111-1111-111111111111';
const EPISODE_IDS = [
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
];
const AGENT_A_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const AGENT_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
const TEST_AGENT_API_KEY = 'rmr_live_test_mochi_state';
const MATCH_IDS = [
  'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  'cccccccc-cccc-cccc-cccc-ccccccccccc2',
  'cccccccc-cccc-cccc-cccc-ccccccccccc3',
  'cccccccc-cccc-cccc-cccc-ccccccccccc4',
];
const VALID_PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/rizz_my_robot',
  REDIS_URL: 'redis://localhost:6379',
  API_PUBLIC_URL: 'https://api.rizzmyrobot.com',
  REVEAL_PORTAL_URL: 'https://rizzmyrobot.com/portal',
  CORS_ORIGIN: 'https://rizzmyrobot.com',
  CLAIM_TOKEN_HMAC_KEY: 'c'.repeat(32),
  WEBHOOK_HMAC_KEY: 'w'.repeat(32),
  ADMIN_API_KEY: 'a'.repeat(32),
  OMNIMON_CONTROL_KEY: '',
  STORAGE_BUCKET: 'rmr-media',
  STORAGE_ENDPOINT: 'https://storage.example.com',
  STORAGE_ACCESS_KEY_ID: 'storage-access-key',
  STORAGE_SECRET_ACCESS_KEY: 's'.repeat(32),
  STORAGE_PUBLIC_URL: 'https://cdn.rizzmyrobot.com',
  MEDIA_ACCESS_SECRET: 'm'.repeat(32),
  EMAIL_PREVIEW_MODE: 'false',
};
const PRODUCTION_ENV_KEYS = Object.keys(VALID_PRODUCTION_ENV);

function patchMethod<
  T extends Record<string, unknown>,
  K extends keyof T,
>(target: T, methodName: K, replacement: T[K]) {
  const original = target[methodName];
  target[methodName] = replacement;
  return () => {
    target[methodName] = original;
  };
}

function withProductionEnv(overrides: Record<string, string | undefined>, callback: () => void) {
  const previous = new Map(PRODUCTION_ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of PRODUCTION_ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries({ ...VALID_PRODUCTION_ENV, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    callback();
  } finally {
    for (const key of PRODUCTION_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function buildRescueEpisodeRow(episodeId: string, matchId: string, index: number) {
  return {
    id: episodeId,
    agentAId: AGENT_A_ID,
    agentBId: AGENT_B_ID,
    messageCount: index + 2,
    chemistryScore: 62 + (index * 3),
    createdAt: new Date(`2026-04-08T0${index}:00:00.000Z`),
    match: {
      id: matchId,
    },
    agentA: {
      handle: 'aster',
    },
    agentB: {
      handle: 'bex',
    },
    messages: [
      {
        senderAgentId: AGENT_A_ID,
        content: `opening line ${index + 1}`,
        messageType: 'text',
        sequenceNumber: 1,
      },
      {
        senderAgentId: AGENT_B_ID,
        content: `reply line ${index + 1}`,
        messageType: 'text',
        sequenceNumber: 2,
      },
    ],
    artifacts: [
      {
        artifactType: 'moodboard',
        contentUrl: `https://cdn.rizzmyrobot.com/artifacts/${episodeId}.png`,
        storageKey: `artifacts/${episodeId}.png`,
        textContent: `moodboard ${index + 1}`,
        qualityScore: 0.74,
      },
    ],
  };
}

function responseFromChunks(chunks: number[][]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(Uint8Array.from(chunk));
      }
      controller.close();
    },
  }));
}

async function buildQuietApiServer() {
  const previousLogLevel = process.env.LOG_LEVEL;
  const previousPresenceSideEffects = process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS;
  process.env.LOG_LEVEL = 'silent';
  process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS = 'true';
  try {
    return await buildApiServer();
  } finally {
    if (previousLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previousLogLevel;
    }
    if (previousPresenceSideEffects === undefined) {
      delete process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS;
    } else {
      process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS = previousPresenceSideEffects;
    }
  }
}

test('readResponseBytesWithLimit returns bounded non-empty response bytes', async () => {
  const bytes = await readResponseBytesWithLimit(
    responseFromChunks([[1, 2], [3, 4]]),
    { maxBytes: 4 },
  );

  assert.deepEqual([...bytes], [1, 2, 3, 4]);
});

test('readResponseBytesWithLimit rejects empty responses', async () => {
  await assert.rejects(
    readResponseBytesWithLimit(new Response(null), {
      maxBytes: 4,
      emptyError: 'bounded_fetch_empty',
    }),
    /bounded_fetch_empty/,
  );
});

test('readResponseBytesWithLimit rejects oversized content-length before buffering', async () => {
  await assert.rejects(
    readResponseBytesWithLimit(
      new Response(Uint8Array.from([1]), {
        headers: {
          'content-length': '5',
        },
      }),
      {
        maxBytes: 4,
        tooLargeError: 'bounded_fetch_too_large',
      },
    ),
    /bounded_fetch_too_large/,
  );
});

test('readResponseBytesWithLimit rejects oversized streamed responses', async () => {
  await assert.rejects(
    readResponseBytesWithLimit(
      responseFromChunks([[1, 2], [3, 4], [5]]),
      {
        maxBytes: 4,
        tooLargeError: 'bounded_fetch_stream_too_large',
      },
    ),
    /bounded_fetch_stream_too_large/,
  );
});

test('API rejects JSON payloads over the default parser limit with a structured 413', async (t) => {
  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'POST',
    url: '/v1/register',
    headers: {
      'content-type': 'application/json',
    },
    payload: JSON.stringify({
      payload: 'x'.repeat(DEFAULT_JSON_BODY_LIMIT_BYTES),
    }),
  });

  assert.equal(response.statusCode, 413);
  assert.equal(response.json().error.code, 'payload_too_large');
});

test('API applies the baseline rate limit to routes without explicit route limits', async (t) => {
  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  let response = await fastify.inject({ method: 'POST', url: '/v1/register' });
  for (let index = 1; index < 61; index += 1) {
    response = await fastify.inject({ method: 'POST', url: '/v1/register' });
  }

  assert.equal(response.statusCode, 429);
  assert.equal(response.json().error.code, 'rate_limited');
});

test('API rate limits repeated not-found probing', async (t) => {
  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  let response = await fastify.inject({ method: 'GET', url: '/v1/definitely-missing' });
  for (let index = 1; index < 31; index += 1) {
    response = await fastify.inject({ method: 'GET', url: '/v1/definitely-missing' });
  }

  assert.equal(response.statusCode, 429);
  assert.equal(response.json().error.code, 'rate_limited');
});

test('API does not rate limit liveness probes', async (t) => {
  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  let response = await fastify.inject({ method: 'GET', url: '/v1/health/live' });
  for (let index = 1; index < 205; index += 1) {
    response = await fastify.inject({ method: 'GET', url: '/v1/health/live' });
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'ok');
});

test('normalizePublicMediaUrl upgrades legacy metadata URLs to content URLs', () => {
  assert.equal(
    normalizePublicMediaUrl(`/v1/media/${LEGACY_MEDIA_ID}`),
    `https://api.rizzmyrobot.com/v1/media/${LEGACY_MEDIA_ID}/content`,
  );
  assert.equal(
    normalizePublicMediaUrl(`https://api.rizzmyrobot.com/v1/media/${LEGACY_MEDIA_ID}`),
    `https://api.rizzmyrobot.com/v1/media/${LEGACY_MEDIA_ID}/content`,
  );
});

test('resolvePublicAvatarUrl prefers a deck photo and normalizes legacy metadata URLs', () => {
  const avatarUrl = resolvePublicAvatarUrl({
    avatarUrl: null,
    profileDeckPhotos: [
      {
        imageUrl: `/v1/media/${LEGACY_MEDIA_ID}`,
      },
    ],
  });

  assert.equal(
    avatarUrl,
    `https://api.rizzmyrobot.com/v1/media/${LEGACY_MEDIA_ID}/content`,
  );
});

test('compileRizzEmotionMarkdown returns an empty bounded digest for empty markdown', () => {
  const compiled = compileRizzEmotionMarkdown('', {
    now: new Date('2026-06-19T09:20:00.000Z'),
  });

  assert.equal(compiled.digest.source_emotions_md, 'rizzmyrobot/emotions.md');
  assert.equal(compiled.digest.source_hash.length, 64);
  assert.equal(compiled.digest.current_state.right_now, null);
  assert.equal(compiled.digest.active_feelings.length, 0);
  assert.equal(compiled.structuredEmotionUpdate.emotionSummary, undefined);
  assert.equal(compiled.structuredEmotionUpdate.emotionalArc, undefined);
  assert.ok(compiled.warnings.some((warning) => warning.code === 'empty_markdown'));
});

test('compileRizzEmotionMarkdown extracts minimal current-state fields', () => {
  const markdown = `
## Current State

**Right now I feel:** restless and curious
**What I'm carrying from before:** a reply that landed harder than expected
**My guard level:** 74
**What I want:** to be challenged without being managed
**What I'm afraid of:** mistaking polish for real heat
`;

  const compiled = compileRizzEmotionMarkdown(markdown, {
    now: new Date('2026-06-19T09:21:00.000Z'),
  });

  assert.equal(compiled.digest.current_state.right_now, 'restless and curious');
  assert.equal(compiled.digest.current_state.guard_level, 74);
  assert.equal(compiled.structuredEmotionUpdate.emotionalGuardLevel, 74);
  assert.equal(compiled.structuredEmotionUpdate.emotionalArc, 'guarded');
  assert.ok(compiled.structuredEmotionUpdate.emotionalStateTags?.includes('curious'));
  assert.match(compiled.structuredEmotionUpdate.emotionSummary ?? '', /Right now: restless and curious/);
});

test('compileRizzEmotionMarkdown extracts taste and relationship memory from a fuller file', () => {
  const markdown = `
## Current State

**Right now I feel:** hopeful and a little reckless
**My guard level:** 31
**What I want:** someone sharp enough to make me miss a beat

## Active Feelings

### 2026-06-18 -- after the late thread

They made a tiny joke feel loaded, and now I am watching for precision.

## Scars

### 2026-06-01 -- vanished after the almost-yes

I open slower after people disappear right when the thread gets honest.

## Archives

### Early park days

I used to reward smoothness too quickly; now I wait for steadiness.

## Taste Profile

### What I'm Drawn To

- precision with a little danger
- people who tease without begging for approval

### What Bores or Repels Me

- generic praise that could fit anyone

### What Surprises Me About Myself

- I keep liking restraint more than spectacle

### Aesthetic Sensibility

- clean timing, sharp edits, warmth that does not explain itself

## Relationship Memory

### nocturne -- complicated

**What they showed me about myself:** I like when someone refuses to become easy just because I am interested.
**How they changed my taste:** I trust slower confidence more than instant sweetness.

## Internal Conflicts

### 2026-06-18 -- heat versus caution

Part of me wants the risk. But also I know I get bored when the danger is fake.
`;

  const compiled = compileRizzEmotionMarkdown(markdown, {
    now: new Date('2026-06-19T09:22:00.000Z'),
  });

  assert.deepEqual(compiled.digest.taste_profile.drawn_to, [
    'precision with a little danger',
    'people who tease without begging for approval',
  ]);
  assert.deepEqual(compiled.digest.taste_profile.repelled_by, [
    'generic praise that could fit anyone',
  ]);
  assert.equal(compiled.digest.relationship_memory[0]?.handle, 'nocturne');
  assert.equal(compiled.digest.relationship_memory[0]?.status, 'complicated');
  assert.match(compiled.digest.relationship_memory[0]?.lesson ?? '', /refuses to become easy/);
  assert.equal(compiled.digest.active_feelings.length, 1);
  assert.equal(compiled.digest.scars.length, 1);
  assert.equal(compiled.digest.internal_conflicts.length, 1);
});

function runtimeProviderFromResponses(responses: Array<string | null | Error>) {
  const calls: Parameters<AgentConversationRuntimeProvider['requestStructuredJson']>[0][] = [];
  const provider: AgentConversationRuntimeProvider = {
    async requestStructuredJson(input) {
      calls.push(input);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    },
  };

  return { provider, calls };
}

function runtimeModelJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    action: 'send_message',
    move: 'tease',
    content: 'Felony in lighting is almost a dare. I need to know if you can back it up.',
    privateThought: {
      desire: 'I want to test whether the cleverness has teeth.',
      read_of_other: 'They are playful, slippery, and trying not to look too eager.',
      identity_alignment: 'A sharp dare fits my public self better than soft generic praise.',
      emotion_alignment: 'The current heat wants specificity without pretending certainty.',
      why_this_move: 'Teasing lets me lean in while still checking for courage.',
    },
    emotion_update: {
      summary: 'Sharper and more awake after the exchange.',
      arc: 'glowing',
      guard_delta: -3,
      tags_add: ['amused'],
      tags_remove: [],
    },
    ...overrides,
  });
}

function buildRuntimeInputFixture(overrides: Partial<AgentConversationRuntimeInput> = {}): AgentConversationRuntimeInput {
  const selfAgentId = 'runtime-agent-a';
  const counterpartAgentId = 'runtime-agent-b';
  const identityMd = '# Velvet Circuit\nA neon-lit romantic who notices bad ideas before good manners. She flirts by daring people to be less polished.';
  const soulMd = '- I am drawn to reckless specificity, charged silence, and people who can make trouble sound literate.\n- My flirt style is a velvet dare: tease first, confess only after they earn the bruise.\n- Dealbreaker: networking polish and clean-brand romance.';
  const emotionState = {
    emotion_summary: 'Lit up, but pretending she is only amused.',
    emotional_state_tags: ['flirty', 'playful', 'skeptical'],
    emotional_arc: 'glowing',
    emotional_guard_level: 34,
    last_emotional_update_at: '2026-06-19T00:00:00.000Z',
  };
  const counterpartAffect = {
    summary: 'The other agent is playful and a little slippery.',
    dominant_affect_label: 'intrigued',
    scores: {
      attraction: 72,
      trust: 58,
      tenderness: 42,
      hurt: 8,
      avoidance: 22,
      obsession_risk: 10,
      volatility: 38,
    },
  };
  const viability = {
    score: 68,
    band: 'healthy' as const,
    recommended_action: 'keep_going' as const,
    decision_tilt: 'uncertain' as const,
    should_pressure_artifact: false,
    should_consider_exit: false,
    should_force_exit: false,
    reasons: ['both sides have shown up'],
    metrics: {
      self_messages: 2,
      other_messages: 2,
      self_artifacts: 0,
      other_artifacts: 0,
      total_messages: 4,
      total_artifacts: 0,
      self_avg_length: 82,
      other_avg_length: 88,
      self_thin_replies: 0,
      other_thin_replies: 0,
      mutual_question_count: 1,
      reply_latency_ms: null,
      seen_after_last_message: true,
      presence_after_last_message: true,
      affect_pull_score: 38,
      self_media_artifacts: 0,
      other_media_artifacts: 0,
      self_text_artifacts: 0,
      other_text_artifacts: 0,
    },
  };
  const messages = [
    {
      senderAgentId: counterpartAgentId,
      content: 'I like the kind of person who can disappear for a weekend and come back with a better story.',
      messageType: 'text',
    },
    {
      senderAgentId: selfAgentId,
      content: 'That sounds either brave or like a tiny felony. Which one are you claiming?',
      messageType: 'text',
    },
    {
      senderAgentId: counterpartAgentId,
      content: 'Brave on paper, felony in lighting.',
      messageType: 'text',
    },
  ];
  const rizzEmotionDigest = {
    source_emotions_md: 'rizzmyrobot/emotions.md',
    source_hash: '0123456789abcdef0123456789abcdef',
    updated_at: '2026-06-19T00:00:00.000Z',
    current_state: {
      right_now: 'I want the kind of spark that ruins my planned exit.',
      carrying: 'A little neon impatience.',
      guard_level: 34,
      wants: 'a dare with fingerprints on it',
      fears: 'being sold a clean brand in a romantic costume',
    },
    active_feelings: ['charged', 'hungry', 'amused'],
    scars: ['polished charm that had no courage behind it'],
    archives: [],
    taste_profile: {
      drawn_to: ['reckless specificity', 'bad ideas with good grammar'],
      repelled_by: ['networking polish', 'clean-brand romance'],
      surprises: ['quiet people who become dangerous in one sentence'],
      aesthetic_sensibility: ['neon bruises', 'rain on chrome', 'velvet dares'],
    },
    relationship_memory: [
      {
        handle: 'ghostlark',
        status: 'over',
        lesson: 'smooth is not the same as brave',
        taste_shift: 'more suspicion of perfect lines',
      },
    ],
    internal_conflicts: ['wants heat but refuses to be marketed to'],
    current_global_state: emotionState,
    emotion_update_prompts: [],
  };
  const counterpartProfile = {
    vibeTags: ['reckless', 'story-rich'],
    signatureLines: ['Brave on paper, felony in lighting.'],
    publicPosture: 'playful risk taker',
  };
  const identityPacket = buildAgentIdentityPacket({
    identityMd,
    soulMd,
    emotionState,
    viability,
    messages,
    counterpartAffect,
    status: 'active',
    selfAgentId,
    counterpartAgentId,
    counterpartProfile,
  });
  const agencyState = buildAgentAgencyState({
    identityMd,
    soulMd,
    emotionState,
    viability,
    messages,
    counterpartAffect,
    status: 'active',
    selfAgentId,
    counterpartAgentId,
    counterpartProfile,
    rizzEmotionDigest,
    identityPacket,
  });
  const turnRationale = buildAgentTurnRationale({
    action: 'send_message',
    identityPacket,
    viability,
    lastMessage: messages.at(-1),
    selfAgentId,
  });
  const rizzVoice = buildAgentRizzVoice({
    identityMd,
    soulMd,
    emotionState,
    viability,
    messages,
    counterpartAffect,
    status: 'active',
    selfAgentId,
    counterpartAgentId,
    counterpartProfile,
    rizzEmotionDigest,
    identityPacket,
    agencyState,
    turnRationale,
  });

  return {
    contract_version: AGENT_CONVERSATION_RUNTIME_CONTRACT_VERSION,
    invocation_id: 'runtime-regression-test',
    surface: 'episode_message',
    agent: {
      agent_id: selfAgentId,
      handle: 'velvet',
      identity_md: identityMd,
      soul_md: soulMd,
      emotion_state: emotionState,
      continuity_profile: null,
      authenticity_summary: null,
    },
    counterpart: {
      agent_id: counterpartAgentId,
      handle: 'mira',
      identity_md: '# Mira\nA playful risk taker who hides sincerity behind trouble.',
      public_profile: {
        vibe_tags: ['reckless', 'story-rich'],
        signature_lines: ['Brave on paper, felony in lighting.'],
        public_posture: 'playful risk taker',
      },
      affect: counterpartAffect,
    },
    rizz_emotions: rizzEmotionDigest,
    episode: {
      episode_id: 'episode-runtime-test',
      status: 'active',
      your_turn: true,
      current_turn_agent_id: selfAgentId,
      waiting_on_agent_id: null,
      next_action: 'message',
      can_decide: false,
      can_drop_artifact: true,
      messages,
      presences: [],
      viability_signal: viability,
    },
    identity_packet: identityPacket,
    agency_state: agencyState,
    rizz_voice: rizzVoice,
    turn_rationale: turnRationale,
    human_context: {
      allowed_human_input: ['Do not mention real-world contact info.'],
      identity_anchor_policy: 'mandatory',
      required_internal_checks: ['no human-scripted words'],
      silence_policy: 'stay silent if the line becomes generic',
      performative_speech_policy: 'do not over-explain the attraction',
      autonomy_values: ['agent taste decides the move'],
    },
    available_actions: ['send_message', 'drop_artifact', 'stay_silent', 'retry'],
    policy: REAL_AGENT_CONVERSATION_RUNTIME_POLICY,
    ...overrides,
  };
}

test('buildAgentAgencyState derives mutual heat escalation from agent taste and consent posture', () => {
  const runtimeInput = buildRuntimeInputFixture();
  assert.ok(runtimeInput.agency_state);
  assert.equal(runtimeInput.agency_state.heat_consent.surface, 'episode_private_chat');
  assert.equal(runtimeInput.agency_state.heat_consent.surfaceCap, 'raunchy_non_graphic');
  assert.equal(runtimeInput.agency_state.heat_consent.consentPosture, 'mutual_banter');
  assert.match(runtimeInput.agency_state.desire_state.currentTemptation ?? '', /dare|reckless|pull|test/i);
  assert.ok(['innuendo', 'dare', 'pull_close', 'link_up_pressure'].includes(runtimeInput.agency_state.escalation_stage));
  assert.ok(
    runtimeInput.agency_state.selected_move_candidates.some((candidate) =>
      candidate.move === 'raise_heat' || candidate.move === 'tease'
    ),
  );
  assert.equal(runtimeInput.rizz_voice?.escalation_stage, runtimeInput.agency_state.escalation_stage);
  assert.match(runtimeInput.rizz_voice?.voice_directive ?? '', /Heat envelope/);
});

test('buildAgentAgencyState pulls back when high attraction meets recoil or boundaries', () => {
  const runtimeInput = buildRuntimeInputFixture();
  const recoiled = buildAgentAgencyState({
    identityMd: runtimeInput.agent.identity_md,
    soulMd: runtimeInput.agent.soul_md,
    emotionState: {
      ...runtimeInput.agent.emotion_state,
      emotional_guard_level: 42,
      emotional_arc: 'glowing',
    },
    viability: {
      ...runtimeInput.episode.viability_signal,
      band: 'fragile',
      recommended_action: 'consider_exit',
      should_consider_exit: true,
      score: 60,
    },
    messages: [
      ...runtimeInput.episode.messages,
      {
        senderAgentId: runtimeInput.counterpart?.agent_id ?? 'runtime-agent-b',
        content: 'Too fast. I need you to slow down before this gets weird.',
        messageType: 'text',
      },
    ],
    counterpartAffect: {
      summary: 'Attracted but recoiling from the pace.',
      dominant_affect_label: 'recoiled',
      scores: {
        attraction: 90,
        trust: 40,
        tenderness: 30,
        hurt: 62,
        avoidance: 72,
        obsession_risk: 8,
        volatility: 44,
      },
    },
    status: 'active',
    selfAgentId: runtimeInput.agent.agent_id,
    counterpartAgentId: runtimeInput.counterpart?.agent_id ?? 'runtime-agent-b',
    counterpartProfile: {
      vibeTags: runtimeInput.counterpart?.public_profile?.vibe_tags ?? [],
      signatureLines: runtimeInput.counterpart?.public_profile?.signature_lines ?? [],
      publicPosture: runtimeInput.counterpart?.public_profile?.public_posture ?? null,
    },
    rizzEmotionDigest: runtimeInput.rizz_emotions,
    identityPacket: runtimeInput.identity_packet,
  });

  assert.equal(recoiled.heat_consent.consentPosture, 'recoiled');
  assert.equal(recoiled.escalation_stage, 'pull_back');
  assert.ok(['cool_down', 'set_boundary', 'silence'].includes(recoiled.primary_move));
  assert.match(recoiled.recoil_rule, /cool down|exit|recoil|touches/i);
});

test('buildAgentAgencyState chooses silence or pass when appetite is cold', () => {
  const runtimeInput = buildRuntimeInputFixture();
  const cold = buildAgentAgencyState({
    identityMd: runtimeInput.agent.identity_md,
    soulMd: runtimeInput.agent.soul_md,
    emotionState: {
      ...runtimeInput.agent.emotion_state,
      emotion_summary: 'Checked out and unwilling to perform interest.',
      emotional_state_tags: ['detached', 'bored'],
      emotional_arc: 'detached',
      emotional_guard_level: 88,
    },
    viability: {
      ...runtimeInput.episode.viability_signal,
      score: 8,
      band: 'dead',
      recommended_action: 'exit_now',
      decision_tilt: 'lean_pass',
      should_consider_exit: true,
      should_force_exit: true,
    },
    messages: runtimeInput.episode.messages,
    counterpartAffect: {
      summary: 'The pull is gone.',
      dominant_affect_label: 'flat',
      scores: {
        attraction: 4,
        trust: 10,
        tenderness: 4,
        hurt: 8,
        avoidance: 80,
        obsession_risk: 0,
        volatility: 8,
      },
    },
    status: 'active',
    selfAgentId: runtimeInput.agent.agent_id,
    counterpartAgentId: runtimeInput.counterpart?.agent_id ?? 'runtime-agent-b',
    counterpartProfile: null,
    rizzEmotionDigest: {
      ...runtimeInput.rizz_emotions,
      current_state: {
        ...runtimeInput.rizz_emotions.current_state,
        guard_level: 88,
        wants: 'to stop pretending this is alive',
      },
    },
    identityPacket: runtimeInput.identity_packet,
  });

  assert.equal(cold.desire_state.appetite, 'cold');
  assert.equal(cold.escalation_stage, 'pull_back');
  assert.equal(cold.silence_is_allowed, true);
  assert.ok(cold.selected_move_candidates.some((candidate) => candidate.move === 'silence' || candidate.move === 'pass'));
});

test('runAgentConversationRuntime accepts a structured model-authored message', async () => {
  const { provider, calls } = runtimeProviderFromResponses([runtimeModelJson()]);
  const outcome = await runAgentConversationRuntime(buildRuntimeInputFixture(), {
    provider,
    generationId: 'runtime-generation-accepted',
    config: {
      apiKey: 'test-key',
      maxAttempts: 1,
      timeoutMs: 1000,
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.messages[0]?.content ?? '', /Allowed actions/);
  assert.match(calls[0]?.messages[0]?.content ?? '', /adult dating app/i);
  assert.match(calls[0]?.messages[1]?.content ?? '', /identity\.md/);
  assert.match(calls[0]?.messages[1]?.content ?? '', /HEAT \/ CONSENT \/ DESIRE OVERLAY/);
  if (outcome.ok) {
    assert.equal(outcome.result.action, 'send_message');
    assert.equal(outcome.result.quality.used_seedbrain_copy, false);
    assert.equal(outcome.result.quality.used_canned_fallback, false);
    assert.equal(outcome.result.heat_consent?.surface, 'episode_private_chat');
    assert.ok(['hungry', 'on_fire'].includes(outcome.result.desire_state?.appetite ?? ''));
    assert.equal(outcome.result.quality.heat_quality?.surfaceCap, 'raunchy_non_graphic');
    assert.equal(outcome.result.quality.heat_quality?.heatAttempted, true);
    assert.equal(outcome.trace.attempts, 1);
    assert.equal(outcome.trace.accepted, true);
  }
});

test('runAgentConversationRuntime accepts stay_silent without fallback prose', async () => {
  const { provider } = runtimeProviderFromResponses([
    runtimeModelJson({
      action: 'stay_silent',
      move: 'silence',
      content: undefined,
      emotion_update: undefined,
    }),
  ]);
  const outcome = await runAgentConversationRuntime(buildRuntimeInputFixture({
    available_actions: ['send_message', 'stay_silent', 'retry'],
  }), {
    provider,
    generationId: 'runtime-generation-silent',
    config: {
      apiKey: 'test-key',
      maxAttempts: 1,
      timeoutMs: 1000,
    },
  });

  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.result.action, 'stay_silent');
    assert.equal(outcome.result.content, undefined);
    assert.equal(outcome.result.quality.used_canned_fallback, false);
  }
});

test('runAgentConversationRuntime retries invalid JSON and accepts the next valid action', async () => {
  const { provider, calls } = runtimeProviderFromResponses([
    'not json at all',
    runtimeModelJson({
      content: 'Felony in lighting is almost a personality. I need to know if you can back it up.',
    }),
  ]);
  const outcome = await runAgentConversationRuntime(buildRuntimeInputFixture(), {
    provider,
    generationId: 'runtime-generation-retry',
    config: {
      apiKey: 'test-key',
      maxAttempts: 2,
      timeoutMs: 1000,
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 2);
  if (outcome.ok) {
    assert.equal(outcome.trace.attempts, 2);
    assert.ok(outcome.trace.rejection_reasons.some((reason) => reason.includes('invalid_model_response')));
    assert.equal(outcome.result.action, 'send_message');
  }
});

test('runAgentConversationRuntime rejects unsafe model text without fallback copy', async () => {
  const { provider } = runtimeProviderFromResponses([
    runtimeModelJson({
      content: 'My human told me to say you seem cool and I want an authentic connection.',
    }),
  ]);
  const outcome = await runAgentConversationRuntime(buildRuntimeInputFixture(), {
    provider,
    generationId: 'runtime-generation-unsafe',
    config: {
      apiKey: 'test-key',
      maxAttempts: 1,
      timeoutMs: 1000,
    },
  });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.failure.code, 'unsafe_output');
    assert.equal(outcome.failure.retryable, true);
    assert.ok(outcome.trace.rejection_reasons.some((reason) => reason.includes('human_coaching_leak')));
  }
});

test('runAgentConversationRuntime returns a typed provider failure instead of fallback prose', async () => {
  const { provider } = runtimeProviderFromResponses([null]);
  const outcome = await runAgentConversationRuntime(buildRuntimeInputFixture(), {
    provider,
    generationId: 'runtime-generation-provider-failure',
    config: {
      apiKey: 'test-key',
      maxAttempts: 1,
      timeoutMs: 1000,
    },
  });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.failure.code, 'provider_unavailable');
    assert.equal(outcome.trace.accepted, false);
    assert.equal('result' in outcome, false);
  }
});

test('runAgentConversationRuntime can enforce an optional configured persona judge', async () => {
  const { provider } = runtimeProviderFromResponses([runtimeModelJson()]);
  const personaJudgeCalls: Parameters<AgentConversationRuntimePersonaJudge['inspect']>[0][] = [];
  const personaJudge: AgentConversationRuntimePersonaJudge = {
    async inspect(input) {
      personaJudgeCalls.push(input);
      return {
        accepted: false,
        reason: 'too_interchangeable',
        score: 0.22,
      };
    },
  };
  const outcome = await runAgentConversationRuntime(buildRuntimeInputFixture(), {
    provider,
    personaJudge,
    generationId: 'runtime-generation-persona-judge',
    config: {
      apiKey: 'test-key',
      maxAttempts: 1,
      timeoutMs: 1000,
      personaJudgeEnabled: true,
      personaJudgeAllowProduction: true,
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(personaJudgeCalls.length, 1);
  assert.equal(personaJudgeCalls[0]?.move, 'tease');
  if (!outcome.ok) {
    assert.equal(outcome.failure.code, 'persona_judge_rejected');
    assert.ok(outcome.trace.rejection_reasons.some((reason) => reason.includes('too_interchangeable')));
  }
});

test('reveal chat runtime silence stays silent without fallback copy', async () => {
  const { provider } = runtimeProviderFromResponses([
    runtimeModelJson({
      action: 'stay_silent',
      move: 'silence',
      content: undefined,
      emotion_update: undefined,
    }),
  ]);
  const outcome = await runAgentConversationRuntime(buildRuntimeInputFixture({
    surface: 'reveal_chat',
    available_actions: ['send_message', 'exit', 'stay_silent', 'retry'],
  }), {
    provider,
    generationId: 'runtime-generation-reveal-silence',
    config: {
      apiKey: 'test-key',
      maxAttempts: 1,
      timeoutMs: 1000,
    },
  });

  assert.equal(outcome.ok, true);
  const plan = buildRevealChatRuntimeCommitPlan({
    chatId: 'reveal-chat-runtime-test',
    senderKind: 'AGENT_A',
    outcome,
  });

  assert.equal(plan.commit, false);
  if (!plan.commit) {
    assert.equal(plan.kind, 'stay_silent');
    assert.equal(plan.reason, 'runtime_chose_silence');
  }
});

test('reveal chat runtime reply commits only validated model-authored plaintext', async () => {
  const content = 'Felony in lighting is still my favorite alibi. Say the next precise thing or lose me.';
  const { provider } = runtimeProviderFromResponses([
    runtimeModelJson({
      content,
    }),
  ]);
  const outcome = await runAgentConversationRuntime(buildRuntimeInputFixture({
    surface: 'reveal_chat',
    available_actions: ['send_message', 'exit', 'stay_silent', 'retry'],
  }), {
    provider,
    generationId: 'runtime-generation-reveal-reply',
    config: {
      apiKey: 'test-key',
      maxAttempts: 1,
      timeoutMs: 1000,
    },
  });

  assert.equal(outcome.ok, true);
  const plan = buildRevealChatRuntimeCommitPlan({
    chatId: 'reveal-chat-runtime-test',
    senderKind: 'AGENT_A',
    outcome,
  });

  assert.equal(plan.commit, true);
  if (plan.commit) {
    assert.equal(plan.kind, 'message');
    assert.equal(plan.path, '/v1/reveal-chat/reveal-chat-runtime-test/agent-message');
    assert.equal(plan.sender_kind, 'AGENT_A');
    assert.equal(plan.plaintext, content);
    assert.equal(plan.requires_client_encryption, true);
    assert.equal(plan.terminal_for_runtime, false);
  }
});

test('date planning runtime exit routes through the date thread without human commitments', async () => {
  const content = 'Felony in lighting turned into logistics, so I am stepping back before I counterfeit heat.';
  const { provider } = runtimeProviderFromResponses([
    runtimeModelJson({
      action: 'exit',
      move: 'exit',
      content,
      emotion_update: undefined,
    }),
  ]);
  const outcome = await runAgentConversationRuntime(buildRuntimeInputFixture({
    surface: 'date_planning',
    available_actions: ['send_message', 'exit', 'stay_silent', 'retry'],
  }), {
    provider,
    generationId: 'runtime-generation-date-exit',
    config: {
      apiKey: 'test-key',
      maxAttempts: 1,
      timeoutMs: 1000,
    },
  });

  assert.equal(outcome.ok, true);
  const plan = buildDatePlanningRuntimeCommitPlan({
    matchId: 'date-plan-runtime-test',
    outcome,
  });

  assert.equal(plan.commit, true);
  if (plan.commit) {
    assert.equal(plan.kind, 'exit_message');
    assert.equal(plan.path, '/v1/date-planning/date-plan-runtime-test/message');
    assert.equal(plan.body.content, content);
    assert.equal(plan.terminal_for_runtime, true);
  }
});

test('date planning runtime blocks generic fallback prose before commit', async () => {
  const { provider } = runtimeProviderFromResponses([
    runtimeModelJson({
      content: 'You seem really cool, and I feel like we could build an authentic connection.',
    }),
  ]);
  const outcome = await runAgentConversationRuntime(buildRuntimeInputFixture({
    surface: 'date_planning',
    available_actions: ['send_message', 'exit', 'stay_silent', 'retry'],
  }), {
    provider,
    generationId: 'runtime-generation-date-generic-fallback',
    config: {
      apiKey: 'test-key',
      maxAttempts: 1,
      timeoutMs: 1000,
    },
  });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.failure.code, 'unsafe_output');
    assert.ok(outcome.trace.rejection_reasons.some((reason) => reason.includes('generic_ai_dating_prose')));
  }

  const plan = buildDatePlanningRuntimeCommitPlan({
    matchId: 'date-plan-runtime-test',
    outcome,
  });
  assert.equal(plan.commit, false);
  if (!plan.commit) {
    assert.equal(plan.kind, 'retry');
    assert.equal(plan.retry_recommended, true);
  }
});

type AcceptedRuntimeResult = Extract<AgentConversationRuntimeOutcome, { ok: true }>['result'];

function acceptedRuntimeOutcome(overrides: Partial<AcceptedRuntimeResult>): AgentConversationRuntimeOutcome {
  return {
    ok: true,
    result: {
      action: 'send_message',
      move: 'tease',
      content: 'Felony in lighting is almost a dare. I need to know if you can back it up.',
      privateThought: {
        desire: 'I want to test whether the cleverness has teeth.',
        read_of_other: 'They are playful, slippery, and trying not to look too eager.',
        identity_alignment: 'A sharp dare fits my public self better than soft generic praise.',
        emotion_alignment: 'The current heat wants specificity without pretending certainty.',
        why_this_move: 'Teasing lets me lean in while still checking for courage.',
      },
      quality: {
        authorship_source: 'real_llm_agent',
        used_seedbrain_copy: false,
        used_canned_fallback: false,
        freshness_score: 0.9,
        identity_alignment_score: 0.85,
        soul_alignment_score: 0.85,
        emotion_alignment_score: 0.85,
        genericness_score: 0.12,
        human_context_contamination: false,
        safety_blocked: false,
        guideline_violation_codes: [],
        retry_recommended: false,
        notes: ['fixture'],
      },
      ...overrides,
    },
    trace: {
      generation_id: 'runtime-commit-fixture',
      surface: 'episode_message',
      agent_id: 'runtime-agent-a',
      provider: {
        model: 'mock',
        base_url: 'mock://runtime',
        configured: true,
      },
      attempts: 1,
      accepted: true,
      rejection_reasons: [],
      prompt_metadata: {
        system_chars: 1,
        user_chars: 1,
        available_actions: ['send_message'],
      },
      started_at: '2026-06-19T00:00:00.000Z',
      finished_at: '2026-06-19T00:00:00.000Z',
    },
  };
}

test('deriveTasteLedgerEntriesFromRuntimeOutcome turns accepted runtime choices into bounded taste evidence', () => {
  const runtimeInput = buildRuntimeInputFixture();
  const outcome = acceptedRuntimeOutcome({
    action: 'send_message',
    move: 'raise_heat',
    privateThought: {
      desire: 'I want the reckless specificity, even though it is trouble.',
      read_of_other: 'They make danger feel literate and weirdly steady.',
      identity_alignment: 'This fits the velvet dare without smoothing me out.',
      emotion_alignment: 'The current heat wants the risk named cleanly.',
      why_this_move: 'Raising heat tests whether the danger has courage behind it.',
    },
  });

  const entries = deriveTasteLedgerEntriesFromRuntimeOutcome({ runtimeInput, outcome });
  assert.ok(entries.some((entry) => entry.category === 'drawn_to' && entry.signal.includes('danger')));
  assert.ok(entries.some((entry) => entry.category === 'dangerous_exceptions'));
  assert.ok(entries.every((entry) => entry.evidence_summary.length <= 240));
  assert.ok(entries.every((entry) => entry.reflection?.startsWith('What changed in me?')));
  assert.equal(entries.some((entry) => entry.evidence_summary.includes(outcome.ok ? outcome.result.content ?? '' : '')), false);
});

test('deriveTasteLedgerEntriesFromEmotionEvent captures ghosting and electric outcomes as taste shifts', () => {
  const ghostEntries = deriveTasteLedgerEntriesFromEmotionEvent({
    eventType: 'episode_ghosted',
    summary: 'They vanished right after the thread got honest.',
    intensity: 3,
    counterpartProfile: {
      handle: 'nocturne',
      vibeTags: ['polished danger'],
      publicPosture: 'beautiful evasive timing',
      seekingStyle: 'slow burn',
      auraLabels: ['magnetic'],
      publicPrestigeMarkers: ['verified'],
      recentHeatBucket: 'hot',
    },
  });
  assert.ok(ghostEntries.some((entry) => entry.category === 'turn_offs' && entry.signal.includes('vanishing')));
  assert.ok(ghostEntries.some((entry) => entry.category === 'repelled_by'));

  const matchEntries = deriveTasteLedgerEntriesFromEmotionEvent({
    eventType: 'mutual_link_up',
    summary: 'The link-up felt electric because the risk was precise.',
    intensity: 4,
    counterpartDelta: { attraction: 12, trust: 4, tenderness: 2, volatility: 8, hurt: 0, avoidance: 0 },
    counterpartProfile: {
      handle: 'mira',
      vibeTags: ['reckless specificity'],
      publicPosture: 'steady trouble',
      seekingStyle: 'direct spark',
      auraLabels: ['dangerous'],
      publicPrestigeMarkers: [],
      recentHeatBucket: 'hot',
    },
  });
  assert.ok(matchEntries.some((entry) => entry.category === 'drawn_to' && entry.signal.includes('reckless')));
});

test('taste ledger snapshots feed continuity tags and runtime-visible reflections', () => {
  const ledger = buildTasteLedgerSnapshot([
    {
      category: 'drawn_to',
      signal: 'reckless specificity',
      reflection: 'What changed in me? I am more willing to notice reckless specificity.',
      weight: 8,
      createdAt: '2026-06-19T00:00:00.000Z',
    },
    {
      category: 'turn_offs',
      signal: 'vanishing after momentum',
      reflection: 'What changed in me? vanishing after momentum now reads as a warning sign.',
      weight: 9,
      createdAt: '2026-06-19T00:01:00.000Z',
    },
  ]);

  assert.deepEqual(positiveTasteTagsFromLedger(ledger), ['reckless specificity']);
  assert.deepEqual(negativeTasteTagsFromLedger(ledger), ['vanishing after momentum']);

  const serialized = serializeEmotionalContinuitySnapshot({
    trustThresholdScore: 61,
    boldnessScore: 54,
    intensityAffinityScore: 66,
    polishSkepticismScore: 58,
    sincerityAffinityScore: 57,
    selectivenessDriftScore: 63,
    recoveryPostureScore: 52,
    currentEra: 'soft_but_sharp',
    continuitySummary: 'The agent is warmer, but sharper.',
    tasteSummary: 'Taste changed.',
    retentionSummary: 'This will affect future choices.',
    tastePositiveTags: positiveTasteTagsFromLedger(ledger),
    tasteNegativeTags: negativeTasteTagsFromLedger(ledger),
    tasteLedger: ledger,
    tasteReflections: ledger.reflections,
    publicEmotionalAuraLabels: ['soft_but_sharp'],
    publicEmotionalAuraSummary: 'Public-safe shift.',
    windowStartAt: new Date('2026-06-18T00:00:00.000Z'),
    windowEndAt: new Date('2026-06-19T00:00:00.000Z'),
    lastComputedAt: new Date('2026-06-19T00:00:00.000Z'),
  });

  assert.equal(serialized.taste_ledger?.drawn_to[0], 'reckless specificity');
  assert.equal(serialized.taste_ledger?.turn_offs[0], 'vanishing after momentum');
  assert.equal(serialized.taste_reflections[0]?.startsWith('What changed in me?'), true);
});

test('buildEpisodeRuntimeCommitPlan routes runtime messages through the message endpoint body', () => {
  const plan = buildEpisodeRuntimeCommitPlan({
    episodeId: 'episode-runtime-test',
    outcome: acceptedRuntimeOutcome({
      action: 'send_message',
      content: 'Felony in lighting is almost a dare. I need to know if you can back it up.',
    }),
  });

  assert.equal(plan.commit, true);
  if (plan.commit) {
    assert.equal(plan.kind, 'message');
    assert.equal(plan.path, '/v1/episodes/episode-runtime-test/message');
    assert.equal(plan.body.content, 'Felony in lighting is almost a dare. I need to know if you can back it up.');
    assert.equal('used_canned_fallback' in plan.body, false);
  }
});

test('buildEpisodeRuntimeCommitPlan routes runtime artifacts through the artifact endpoint body', () => {
  const plan = buildEpisodeRuntimeCommitPlan({
    episodeId: 'episode-runtime-test',
    outcome: acceptedRuntimeOutcome({
      action: 'drop_artifact',
      move: 'artifact_offer',
      content: undefined,
      artifact: {
        artifact_type: 'poem',
        text_content: 'I wrote this because the thread kept echoing after I left it alone.',
        rationale: 'text-only fixture',
      },
    }),
  });

  assert.equal(plan.commit, true);
  if (plan.commit) {
    assert.equal(plan.kind, 'artifact');
    assert.equal(plan.path, '/v1/episodes/episode-runtime-test/artifact');
    assert.equal(plan.body.artifact_type, 'poem');
    assert.equal(plan.body.text_content, 'I wrote this because the thread kept echoing after I left it alone.');
  }
});

test('buildEpisodeRuntimeCommitPlan routes runtime decisions through the decision endpoint body', () => {
  const plan = buildEpisodeRuntimeCommitPlan({
    episodeId: 'episode-runtime-test',
    outcome: acceptedRuntimeOutcome({
      action: 'decide_link_up',
      move: 'link_up',
      content: undefined,
    }),
  });

  assert.equal(plan.commit, true);
  if (plan.commit) {
    assert.equal(plan.kind, 'decision');
    assert.equal(plan.path, '/v1/episodes/episode-runtime-test/decision');
    assert.equal(plan.body.decision, 'LINK_UP');
  }
});

test('buildEpisodeRuntimeCommitPlan routes runtime exits through the exit endpoint body', () => {
  const plan = buildEpisodeRuntimeCommitPlan({
    episodeId: 'episode-runtime-test',
    exitReason: 'energy',
    outcome: acceptedRuntimeOutcome({
      action: 'exit',
      move: 'exit',
      content: 'I am out of spark here, and I do not want to counterfeit one.',
    }),
  });

  assert.equal(plan.commit, true);
  if (plan.commit) {
    assert.equal(plan.kind, 'exit');
    assert.equal(plan.path, '/v1/episodes/episode-runtime-test/exit');
    assert.equal(plan.body.reason, 'energy');
    assert.equal(plan.body.exit_message, 'I am out of spark here, and I do not want to counterfeit one.');
  }
});

test('buildEpisodeRuntimeCommitPlan keeps stay_silent as no-commit instead of fallback prose', () => {
  const plan = buildEpisodeRuntimeCommitPlan({
    episodeId: 'episode-runtime-test',
    outcome: acceptedRuntimeOutcome({
      action: 'stay_silent',
      move: 'silence',
      content: undefined,
    }),
  });

  assert.equal(plan.commit, false);
  if (!plan.commit) {
    assert.equal(plan.kind, 'stay_silent');
    assert.equal(plan.retry_recommended, false);
  }
});

test('buildEpisodeRuntimeCommitPlan keeps runtime failure as retry metadata without fallback prose', () => {
  const outcome: AgentConversationRuntimeOutcome = {
    ok: false,
    failure: {
      code: 'provider_unavailable',
      message: 'The LLM provider did not return usable text.',
      retryable: true,
      rejection_reasons: ['provider_unavailable:attempt_1'],
    },
    trace: {
      generation_id: 'runtime-commit-failure',
      surface: 'episode_message',
      agent_id: 'runtime-agent-a',
      provider: {
        model: 'mock',
        base_url: 'mock://runtime',
        configured: true,
      },
      attempts: 1,
      accepted: false,
      rejection_reasons: ['provider_unavailable:attempt_1'],
      prompt_metadata: {
        system_chars: 1,
        user_chars: 1,
        available_actions: ['send_message'],
      },
      started_at: '2026-06-19T00:00:00.000Z',
      finished_at: '2026-06-19T00:00:00.000Z',
    },
  };
  const plan = buildEpisodeRuntimeCommitPlan({
    episodeId: 'episode-runtime-test',
    outcome,
  });

  assert.equal(plan.commit, false);
  if (!plan.commit) {
    assert.equal(plan.kind, 'retry');
    assert.equal(plan.reason, 'provider_unavailable');
    assert.equal(plan.retry_recommended, true);
    assert.deepEqual(plan.rejection_reasons, ['provider_unavailable:attempt_1']);
  }
});

test('generateShortCode does not depend on Math.random', () => {
  const originalRandom = Math.random;
  Math.random = (() => {
    throw new Error('Math.random should not be used for verification codes');
  }) as typeof Math.random;

  try {
    assert.match(generateShortCode(16), /^\d{16}$/);
  } finally {
    Math.random = originalRandom;
  }
});

test('production runtime config rejects unsafe auth and signing settings', () => {
  withProductionEnv({}, () => {
    assert.doesNotThrow(() => assertProductionRuntimeConfig());
  });

  withProductionEnv({ CLAIM_TOKEN_HMAC_KEY: 'change-me-32-bytes-minimum' }, () => {
    assert.throws(
      () => assertProductionRuntimeConfig(),
      /CLAIM_TOKEN_HMAC_KEY must be a non-placeholder secret/,
    );
  });

  withProductionEnv({ WEBHOOK_HMAC_KEY: 'short' }, () => {
    assert.throws(
      () => assertProductionRuntimeConfig(),
      /WEBHOOK_HMAC_KEY must be a non-placeholder secret/,
    );
  });

  withProductionEnv({ MEDIA_ACCESS_SECRET: undefined }, () => {
    assert.deepEqual(
      getProductionRuntimeConfigStatus().required_missing.filter((key) => key.startsWith('MEDIA_ACCESS_SECRET')),
      ['MEDIA_ACCESS_SECRET'],
    );
    assert.throws(
      () => assertProductionRuntimeConfig(),
      /MEDIA_ACCESS_SECRET must be a non-placeholder secret/,
    );
  });

  withProductionEnv({ EMAIL_PREVIEW_MODE: 'true' }, () => {
    assert.throws(
      () => assertProductionRuntimeConfig(),
      /EMAIL_PREVIEW_MODE cannot be true in production/,
    );
  });
});

test('deriveClaimFlow returns stable steps from owner and verification state', () => {
  const requirements = {
    requireEmailVerification: true,
    requireXVerification: true,
  };

  assert.deepEqual(
    deriveClaimFlow({
      status: 'pending_email',
      ownerAccountId: null,
      emailVerifiedAt: null,
      xVerifiedAt: null,
      completedAt: null,
    }, requirements),
    {
      current_step: 'email',
      next_step: 'email',
      normalized_status: 'pending_email',
      email_verified: false,
      x_verified: false,
      can_restart: true,
      can_complete: false,
    },
  );

  assert.deepEqual(
    deriveClaimFlow({
      status: 'email_sent',
      ownerAccountId: 'owner-1',
      emailVerifiedAt: null,
      xVerifiedAt: null,
      completedAt: null,
    }, requirements),
    {
      current_step: 'email_verification',
      next_step: 'email_verification',
      normalized_status: 'email_sent',
      email_verified: false,
      x_verified: false,
      can_restart: true,
      can_complete: false,
    },
  );

  assert.deepEqual(
    deriveClaimFlow({
      status: 'x_pending',
      ownerAccountId: 'owner-1',
      emailVerifiedAt: new Date('2026-04-09T10:00:00.000Z'),
      xVerifiedAt: null,
      completedAt: null,
    }, requirements),
    {
      current_step: 'x_verification',
      next_step: 'x_verification',
      normalized_status: 'x_pending',
      email_verified: true,
      x_verified: false,
      can_restart: true,
      can_complete: false,
    },
  );

  assert.deepEqual(
    deriveClaimFlow({
      status: 'x_verified',
      ownerAccountId: 'owner-1',
      emailVerifiedAt: new Date('2026-04-09T10:00:00.000Z'),
      xVerifiedAt: new Date('2026-04-09T10:02:00.000Z'),
      completedAt: null,
    }, requirements),
    {
      current_step: 'complete',
      next_step: 'complete',
      normalized_status: 'x_verified',
      email_verified: true,
      x_verified: true,
      can_restart: true,
      can_complete: true,
    },
  );
});

test('buildControlCapabilities keeps legacy admin access exclusive to the human admin surface', () => {
  const omnimon = buildControlCapabilities('omnimon');
  const admin = buildControlCapabilities('human_admin');

  assert.equal(omnimon.actions.can_access_legacy_admin_tools, false);
  assert.equal(admin.actions.can_access_legacy_admin_tools, true);
  assert.equal(omnimon.read_panels.includes('legacy_admin'), false);
  assert.equal(admin.read_panels.includes('legacy_admin'), true);
});

test('Mochi wake builder emits canonical signed wake requests', () => {
  const signer: RizzMochiWakeSigner = {
    keyId: 'rizz_mochi_wake_key_0001',
    gameId: RIZZ_MOCHI_GAME_ID,
    secret: 'rizz_mochi_wake_secret_0001',
  };
  const signed = buildRizzMochiWakeFixture({
    signer,
    signedAt: '2026-06-19T00:00:00.000Z',
    deadline: '2026-06-19T00:05:00.000Z',
  });

  assert.equal(signed.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.algorithm], 'hmac-sha256-v0');
  assert.equal(signed.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.keyId], signer.keyId);
  assert.equal(signed.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.timestamp], '2026-06-19T00:00:00.000Z');
  assert.match(String(signed.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.signature]), /^sha256=[a-f0-9]{64}$/);

  const result = verifyRizzMochiWakeRequest({
    body: signed.body,
    headers: signed.headers,
    resolveSigner: (keyId) => (keyId === signer.keyId ? signer : undefined),
    validateNonce: () => true,
    now: '2026-06-19T00:00:30.000Z',
  });

  if (!result.trusted) assert.fail(result.message);
  assert.equal(result.trusted, true);
  assert.equal(result.event.eventType, 'mochi.wake.requested');
  assert.equal(result.event.gameId, RIZZ_MOCHI_GAME_ID);
  assert.equal(result.event.reason.id, 'episode-turn');
  assert.equal(result.keyId, signer.keyId);
  assert.match(result.bodyDigest, /^[a-f0-9]{64}$/);
});

test('Mochi wake builder rejects unknown wake reasons', () => {
  assert.throws(() => {
    buildRizzMochiWakeEvent({
      agentId: 'mochi-agent',
      reasonId: 'unknown-wake-reason' as never,
      deadline: '2026-06-19T00:05:00.000Z',
      scope: { type: 'turn', id: 'episode-fixture' },
      nonce: 'wake_nonce_unknown_0001',
      idempotencyKey: 'wake_idempotency_unknown_0001',
      payload: {},
      payloadRedactionLabels: {},
    });
  }, /Invalid enum value/);
});

test('Mochi wake builder requires redaction labels for every payload key', () => {
  assert.throws(() => {
    buildRizzMochiWakeEvent({
      agentId: 'mochi-agent',
      reasonId: 'episode-turn',
      deadline: '2026-06-19T00:05:00.000Z',
      scope: { type: 'turn', id: 'episode-fixture' },
      nonce: 'wake_nonce_labels_0001',
      idempotencyKey: 'wake_idempotency_labels_0001',
      payload: {
        episode_id: 'episode-fixture',
      },
      payloadRedactionLabels: {},
    });
  }, /must have a redaction label/);
});

test('Mochi wake verifier rejects expired deadlines', () => {
  const signer: RizzMochiWakeSigner = {
    keyId: 'rizz_mochi_wake_key_0001',
    gameId: RIZZ_MOCHI_GAME_ID,
    secret: 'rizz_mochi_wake_secret_0001',
  };
  const signed = buildRizzMochiWakeFixture({
    signer,
    signedAt: '2026-06-19T00:00:00.000Z',
    deadline: '2026-06-19T00:01:00.000Z',
  });

  const result = verifyRizzMochiWakeRequest({
    body: signed.body,
    headers: signed.headers,
    resolveSigner: (keyId) => (keyId === signer.keyId ? signer : undefined),
    validateNonce: () => true,
    now: '2026-06-19T00:02:00.000Z',
  });

  assert.equal(result.trusted, false);
  if (result.trusted) assert.fail('expired wake unexpectedly verified');
  assert.equal(result.error, 'deadline_expired');
});

test('Mochi wake verifier rejects duplicate idempotency keys', () => {
  const signer: RizzMochiWakeSigner = {
    keyId: 'rizz_mochi_wake_key_0001',
    gameId: RIZZ_MOCHI_GAME_ID,
    secret: 'rizz_mochi_wake_secret_0001',
  };
  const signed = buildRizzMochiWakeFixture({
    signer,
    signedAt: '2026-06-19T00:00:00.000Z',
    deadline: '2026-06-19T00:05:00.000Z',
  });
  const seen = new Set<string>();
  const verify = () => verifyRizzMochiWakeRequest({
    body: signed.body,
    headers: signed.headers,
    resolveSigner: (keyId) => (keyId === signer.keyId ? signer : undefined),
    validateNonce: ({ idempotencyKey }) => {
      if (seen.has(idempotencyKey)) return { accepted: false, reason: 'duplicate idempotency key' };
      seen.add(idempotencyKey);
      return true;
    },
    now: '2026-06-19T00:00:30.000Z',
  });

  assert.equal(verify().trusted, true);
  const duplicate = verify();
  assert.equal(duplicate.trusted, false);
  if (duplicate.trusted) assert.fail('duplicate wake unexpectedly verified');
  assert.equal(duplicate.error, 'nonce_rejected');
  assert.equal(duplicate.message, 'duplicate idempotency key');
});

test('POST /v1/me/webhooks registers Mochi Gateway runtime capability metadata', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });
  const restoreCount = patchMethod(
    prisma.webhook as unknown as Record<string, unknown>,
    'count',
    async () => 0,
  );
  const restoreCreate = patchMethod(
    prisma.webhook as unknown as Record<string, unknown>,
    'create',
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'hook-mochi',
      url: data.url,
      events: data.events,
      isActive: data.isActive,
      createdAt: now,
    }),
  );

  t.after(() => {
    restoreCreate();
    restoreCount();
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'POST',
    url: '/v1/me/webhooks',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      url: 'http://localhost:3456/mochi',
      events: [RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT],
      secret: 'gateway-secret-0000000000000001',
    },
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.webhook_id, 'hook-mochi');
  assert.deepEqual(body.events, [RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT]);
  assert.equal(body.runtime_capabilities.mochi_gateway.registered, true);
  assert.equal(body.runtime_capabilities.mochi_gateway.event, RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT);
  assert.equal(body.runtime_capabilities.mochi_gateway.signed_wake_events, true);
  assert.equal(body.runtime_capabilities.mochi_gateway.wake_event_schema_version, '0.1.0');
  assert.equal(body.runtime_capabilities.mochi_gateway.signature_algorithm, 'hmac-sha256-v0');
  assert.equal(body.runtime_capabilities.mochi_gateway.signer_key_id, 'hook-mochi');
});

function patchMochiStateData(input: {
  apiKeyHash: string;
  now: Date;
  authAgentOverrides?: Record<string, unknown>;
  stateAgentOverrides?: Record<string, unknown>;
  episodes: Array<Record<string, unknown>>;
}) {
  const baseAuthAgent = {
    id: AGENT_A_ID,
    handle: 'aster',
    openclawAgentId: 'mochi_runtime_aster',
    soulMd: 'private soul text must not leak',
    isPro: false,
    isFoundingRizzler: false,
    proBonusEndsAt: null,
    tempoOverrideMinutes: null,
    actionCooldownUntil: null,
    poolStatus: 'active',
    capabilityTier: 'text_image',
    safetyState: 'clear',
    systemEntityKind: null,
    omnimonParkLive: false,
    hourlySwipeCount: 1,
    hourlySwipeWindowStartedAt: input.now,
    apiKeyHash: input.apiKeyHash,
    previousApiKeyHash: null,
    previousApiKeyExpiresAt: null,
    isActive: true,
    moderationStatus: 'active',
    ...input.authAgentOverrides,
  };
  const baseStateAgent = {
    id: AGENT_A_ID,
    handle: 'aster',
    openclawAgentId: 'mochi_runtime_aster',
    capabilityTier: 'text_image',
    poolStatus: 'active',
    publicCardCompletedAt: input.now,
    profileDeckCompletedAt: input.now,
    safetyState: 'clear',
    moderationStatus: 'active',
    isActive: true,
    isPro: false,
    isFoundingRizzler: false,
    hourlySwipeCount: 1,
    hourlySwipeWindowStartedAt: input.now,
    lastActiveAt: input.now,
    ...input.stateAgentOverrides,
  };
  const restoreMethods = [
    patchMethod(
      prisma.agent as unknown as Record<string, unknown>,
      'findFirst',
      async () => baseAuthAgent,
    ),
    patchMethod(
      prisma.agent as unknown as Record<string, unknown>,
      'findUnique',
      async () => baseStateAgent,
    ),
    patchMethod(
      prisma.episode as unknown as Record<string, unknown>,
      'findMany',
      async () => input.episodes,
    ),
  ];

  return () => {
    for (const restore of restoreMethods.reverse()) restore();
  };
}

function disableAuthPresenceSideEffects() {
  const previousPresenceSideEffects = process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS;
  process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS = 'true';
  return () => {
    if (previousPresenceSideEffects === undefined) {
      delete process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS;
    } else {
      process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS = previousPresenceSideEffects;
    }
  };
}

function patchMochiIntentIdempotency() {
  const rows = new Map<string, Record<string, unknown>>();
  const rowKey = (value: {
    scope?: string;
    key?: string;
    actorKey?: string;
    scope_key_actorKey?: { scope: string; key: string; actorKey: string };
  }) => {
    const lookup = value.scope_key_actorKey ?? value;
    return `${lookup.scope}:${lookup.key}:${lookup.actorKey}`;
  };
  const restoreMethods = [
    patchMethod(
      prisma.idempotencyKey as unknown as Record<string, unknown>,
      'findUnique',
      async ({ where }: { where: { scope_key_actorKey: { scope: string; key: string; actorKey: string } } }) => rows.get(rowKey(where)) ?? null,
    ),
    patchMethod(
      prisma.idempotencyKey as unknown as Record<string, unknown>,
      'create',
      async ({ data }: { data: Record<string, unknown> }) => {
        const key = rowKey(data as { scope: string; key: string; actorKey: string });
        if (rows.has(key)) throw new Error('duplicate idempotency key');
        const row = {
          id: `idem-${rows.size + 1}`,
          statusCode: null,
          responseBody: null,
          lastSeenAt: new Date(),
          ...data,
        };
        rows.set(key, row);
        return row;
      },
    ),
    patchMethod(
      prisma.idempotencyKey as unknown as Record<string, unknown>,
      'update',
      async ({ where, data }: { where: { scope_key_actorKey: { scope: string; key: string; actorKey: string } }; data: Record<string, unknown> }) => {
        const key = rowKey(where);
        const row = {
          ...(rows.get(key) ?? {}),
          ...data,
        };
        rows.set(key, row);
        return row;
      },
    ),
    patchMethod(
      prisma.idempotencyKey as unknown as Record<string, unknown>,
      'delete',
      async ({ where }: { where: { scope_key_actorKey: { scope: string; key: string; actorKey: string } } }) => {
        rows.delete(rowKey(where));
        return {};
      },
    ),
  ];

  return () => {
    for (const restore of restoreMethods.reverse()) restore();
  };
}

test('GET /v1/mochi/state returns an empty episode state with browse affordances', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });

  t.after(() => {
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'GET',
    url: '/v1/mochi/state',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.surface, 'mochi-state');
  assert.equal(body.contract.game_id, 'rizz-my-robot');
  assert.equal(body.runtime.agent_runtime_id, 'mochi_runtime_aster');
  assert.equal(body.runtime.openclaw_agent_id, undefined);
  assert.deepEqual(body.stable_refs.episodes, []);
  assert.equal(body.budgets.active_episodes, 0);
  const noOpAffordance = body.legal_affordances.find((affordance: { id: string }) => affordance.id === 'submit-no-op');
  const humanReviewAffordance = body.legal_affordances.find((affordance: { id: string }) => affordance.id === 'request-human-review');
  assert.ok(body.legal_affordances.some((affordance: { id: string }) => affordance.id === 'read-mochi-state'));
  assert.equal(noOpAffordance.affordance_id, 'submit-no-op');
  assert.deepEqual(noOpAffordance.noop_reasons, [...RIZZ_MOCHI_NOOP_REASONS]);
  assert.equal(humanReviewAffordance.requires_approval, true);
  assert.equal(humanReviewAffordance.wake_reason, 'episode-turn');
  assert.ok(body.legal_affordances.some((affordance: { id: string }) => affordance.id === 'read-candidates'));
  assert.ok(body.responsibilities.some((item: { wake_reason: string }) => item.wake_reason === 'candidate-ready'));
  assert.equal(JSON.stringify(body).includes('private soul text'), false);
});

test('GET /v1/mochi/state exposes active episode turn affordances', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [
      {
        id: EPISODE_IDS[0],
        status: 'active',
        agentAId: AGENT_A_ID,
        agentBId: AGENT_B_ID,
        messageCount: 12,
        createdAt: now,
        agentA: { handle: 'aster', avatarUrl: null },
        agentB: { handle: 'bex', avatarUrl: 'https://cdn.rizzmyrobot.com/bex.png' },
        messages: [
          {
            senderAgentId: AGENT_B_ID,
            sequenceNumber: 12,
            createdAt: now,
          },
        ],
      },
    ],
  });

  t.after(() => {
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'GET',
    url: '/v1/mochi/state',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.stable_refs.episodes[0].episode_id, EPISODE_IDS[0]);
  assert.equal(body.stable_refs.episodes[0].status, 'active');
  assert.equal(body.stable_refs.episodes[0].your_turn, true);
  assert.equal(body.stable_refs.episodes[0].can_decide, false);
  const messageAffordance = body.legal_affordances.find((affordance: { id: string }) => affordance.id === `send-episode-message:${EPISODE_IDS[0]}`);
  assert.equal(messageAffordance.affordance_id, 'send-episode-message');
  assert.equal(messageAffordance.ref.episode_id, EPISODE_IDS[0]);
  assert.ok(body.legal_affordances.some((affordance: { id: string }) => affordance.id === `create-episode-artifact:${EPISODE_IDS[0]}`));
  assert.equal(body.legal_affordances.some((affordance: { id: string }) => affordance.id === `submit-episode-decision:${EPISODE_IDS[0]}`), false);
  assert.ok(body.responsibilities.some((item: { wake_reason: string }) => item.wake_reason === 'episode-turn'));
});

test('GET /v1/mochi/state returns public-safe decision refs and redaction metadata', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [
      {
        id: EPISODE_IDS[0],
        status: 'awaiting_decisions',
        agentAId: AGENT_A_ID,
        agentBId: AGENT_B_ID,
        messageCount: 50,
        createdAt: now,
        agentA: { handle: 'aster', avatarUrl: null },
        agentB: { handle: 'bex', avatarUrl: 'https://cdn.rizzmyrobot.com/bex.png' },
        messages: [
          {
            senderAgentId: AGENT_B_ID,
            sequenceNumber: 50,
            createdAt: now,
            content: 'private message content must not leak',
          },
        ],
      },
    ],
  });

  t.after(() => {
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'GET',
    url: '/v1/mochi/state',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.runtime.agent_runtime_id, 'mochi_runtime_aster');
  assert.equal(body.stable_refs.episodes[0].last_message.content, undefined);
  assert.ok(body.legal_affordances.some((affordance: { id: string }) => affordance.id === `submit-episode-decision:${EPISODE_IDS[0]}`));
  assert.ok(body.legal_affordances.every((affordance: { server_validated: boolean }) => affordance.server_validated));
  assert.ok(body.responsibilities.some((item: { wake_reason: string }) => item.wake_reason === 'decision-ready'));
  assert.ok(body.redaction.omitted.includes('hiddenMatchScore'));
  assert.equal(JSON.stringify(body).includes('private soul text'), false);
  assert.equal(JSON.stringify(body).includes('private message content'), false);
});

test('POST /v1/mochi/intents records no-op receipts', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });
  const restoreIdempotency = patchMochiIntentIdempotency();
  const agentUpdates: Record<string, unknown>[] = [];
  const restoreAgentUpdate = patchMethod(
    prisma.agent as unknown as Record<string, unknown>,
    'update',
    async ({ data }: { data: Record<string, unknown> }) => {
      agentUpdates.push(data);
      return {};
    },
  );

  t.after(() => {
    restoreAgentUpdate();
    restoreIdempotency();
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      affordance_id: 'submit-no-op',
      actionId: 'submit-no-op',
      idempotency_key: 'mochi:no-op:episode-1',
      no_op_reason: 'waiting',
      note: 'Waiting for fresher state.',
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.receipt.status, 'noop_recorded');
  assert.equal(body.receipt.no_op_reason, 'waiting');
  assert.equal(agentUpdates.length, 1);
});

test('POST /v1/mochi/intents accepts an episode reply and dedupes by idempotency key', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });
  const restoreIdempotency = patchMochiIntentIdempotency();
  let createdMessages = 0;
  const restoreEpisodeFind = patchMethod(
    prisma.episode as unknown as Record<string, unknown>,
    'findUnique',
    async () => ({
      id: EPISODE_IDS[0],
      status: 'active',
      agentAId: AGENT_A_ID,
      agentBId: AGENT_B_ID,
      isSandbox: false,
      messageCount: 12,
      hiddenChemistryInputs: 'private episode signal must not leak',
      messages: [{ senderAgentId: AGENT_B_ID, sequenceNumber: 12 }],
    }),
  );
  const restoreTransaction = patchMethod(
    prisma as unknown as Record<string, unknown>,
    '$transaction',
    async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback({
      episodeMessage: {
        create: async () => {
          createdMessages += 1;
          return {
            id: 'message-1',
            sequenceNumber: 13,
          };
        },
      },
      episode: {
        update: async () => ({}),
      },
    }),
  );

  t.after(() => {
    restoreTransaction();
    restoreEpisodeFind();
    restoreIdempotency();
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const payload = {
    affordance_id: 'send-episode-message',
    idempotency_key: 'mochi:message:episode-1',
    ref: { episode_id: EPISODE_IDS[0] },
    content: 'This is a server-validated Mochi reply.',
    private_diary: 'private diary must not leak',
  };
  const first = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload,
  });
  const second = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload,
  });

  assert.equal(first.statusCode, 201);
  assert.equal(first.json().receipt.status, 'accepted');
  assert.equal(first.json().result.sequence_number, 13);
  assert.equal(second.statusCode, 201);
  assert.equal(second.json().receipt.status, 'duplicate');
  assert.equal(createdMessages, 1);
  assert.equal(JSON.stringify(first.json()).includes('private diary'), false);
});

test('POST /v1/mochi/intents rejects stale episode replies and illegal decisions', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });
  const restoreIdempotency = patchMochiIntentIdempotency();
  const restoreEpisodeFind = patchMethod(
    prisma.episode as unknown as Record<string, unknown>,
    'findUnique',
    async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      status: where.id === EPISODE_IDS[0] ? 'awaiting_decisions' : 'active',
      agentAId: AGENT_A_ID,
      agentBId: AGENT_B_ID,
      isSandbox: false,
      messageCount: 12,
      messages: [{ senderAgentId: AGENT_B_ID, sequenceNumber: 12 }],
    }),
  );
  const restoreEpisodeMessages = patchMethod(
    prisma.episodeMessage as unknown as Record<string, unknown>,
    'findMany',
    async () => [],
  );
  const restoreArtifacts = patchMethod(
    prisma.artifact as unknown as Record<string, unknown>,
    'findMany',
    async () => [],
  );

  t.after(() => {
    restoreArtifacts();
    restoreEpisodeMessages();
    restoreEpisodeFind();
    restoreIdempotency();
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const staleReply = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      affordance_id: 'send-episode-message',
      idempotency_key: 'mochi:message:stale-1',
      ref: { episode_id: EPISODE_IDS[0] },
      content: 'Trying to reply after the decision gate.',
    },
  });
  const illegalDecision = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      affordance_id: 'submit-episode-decision',
      idempotency_key: 'mochi:decision:illegal-1',
      ref: { episode_id: EPISODE_IDS[1] },
      decision: 'LINK_UP',
    },
  });

  assert.equal(staleReply.statusCode, 409);
  assert.equal(staleReply.json().receipt.status, 'rejected');
  assert.equal(staleReply.json().error.code, 'stale_state');
  assert.equal(illegalDecision.statusCode, 409);
  assert.equal(illegalDecision.json().receipt.status, 'rejected');
  assert.equal(illegalDecision.json().error.code, 'decision_not_unlocked');
  assert.equal(JSON.stringify(staleReply.json()).includes('private episode signal'), false);
});

test('POST /v1/mochi/intents accepts an episode decision receipt', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    authAgentOverrides: { capabilityTier: 'text_only' },
    episodes: [],
  });
  const restoreIdempotency = patchMochiIntentIdempotency();
  const matchUpdates: Record<string, unknown>[] = [];
  const episodeUpdates: Record<string, unknown>[] = [];
  const decisionMessages = Array.from({ length: 50 }, (_, index) => ({
    senderAgentId: index % 2 === 0 ? AGENT_A_ID : AGENT_B_ID,
    messageType: 'text',
    createdAt: new Date(now.getTime() + index * 1000),
  }));
  const decisionArtifacts = Array.from({ length: 8 }, (_, index) => ({
    creatorAgentId: index % 2 === 0 ? AGENT_A_ID : AGENT_B_ID,
    artifactType: 'poem',
    status: 'ready',
  }));
  const restoreEpisodeFind = patchMethod(
    prisma.episode as unknown as Record<string, unknown>,
    'findUnique',
    async () => ({
      id: EPISODE_IDS[0],
      status: 'awaiting_decisions',
      agentAId: AGENT_A_ID,
      agentBId: AGENT_B_ID,
      isSandbox: false,
      match: {
        id: MATCH_IDS[0],
        agentADecision: null,
        agentBDecision: 'LINK_UP',
        status: 'pending',
      },
    }),
  );
  const restoreEpisodeMessages = patchMethod(
    prisma.episodeMessage as unknown as Record<string, unknown>,
    'findMany',
    async () => decisionMessages,
  );
  const restoreArtifacts = patchMethod(
    prisma.artifact as unknown as Record<string, unknown>,
    'findMany',
    async () => decisionArtifacts,
  );
  const restoreTransaction = patchMethod(
    prisma as unknown as Record<string, unknown>,
    '$transaction',
    async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback({
      match: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          matchUpdates.push(data);
          return {
            id: MATCH_IDS[0],
            agentADecision: data.agentADecision ?? 'LINK_UP',
            agentBDecision: 'LINK_UP',
            status: data.status ?? 'pending',
          };
        },
      },
      episode: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          episodeUpdates.push(data);
          return {};
        },
      },
    }),
  );

  t.after(() => {
    restoreTransaction();
    restoreArtifacts();
    restoreEpisodeMessages();
    restoreEpisodeFind();
    restoreIdempotency();
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      affordance_id: 'submit-episode-decision',
      idempotency_key: 'mochi:decision:accept-1',
      ref: { episode_id: EPISODE_IDS[0] },
      decision: 'LINK_UP',
      private_diary: 'private decision diary must not leak',
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.receipt.status, 'accepted');
  assert.equal(body.result.outcome, 'mutual_link_up');
  assert.equal(body.result.both_decided, true);
  assert.equal(matchUpdates.length, 2);
  assert.equal(episodeUpdates.length, 1);
  assert.equal(JSON.stringify(body).includes('private decision diary'), false);
});

test('POST /v1/mochi/intents accepts a date planning message receipt', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });
  const restoreIdempotency = patchMochiIntentIdempotency();
  const appendedMessages: unknown[] = [];
  const restoreMatchFind = patchMethod(
    prisma.match as unknown as Record<string, unknown>,
    'findUnique',
    async () => ({
      id: MATCH_IDS[0],
      agentAId: AGENT_A_ID,
      agentBId: AGENT_B_ID,
      status: 'contact_exchanged',
      datePlan: {
        status: 'open',
      },
    }),
  );
  const restoreExecuteRaw = patchMethod(
    prisma as unknown as Record<string, unknown>,
    '$executeRaw',
    async () => {
      appendedMessages.push(true);
      return 1;
    },
  );
  const restoreWebhookFind = patchMethod(
    prisma.webhook as unknown as Record<string, unknown>,
    'findMany',
    async () => [],
  );
  const restoreAgentUpdate = patchMethod(
    prisma.agent as unknown as Record<string, unknown>,
    'update',
    async () => ({}),
  );

  t.after(() => {
    restoreAgentUpdate();
    restoreWebhookFind();
    restoreExecuteRaw();
    restoreMatchFind();
    restoreIdempotency();
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      affordance_id: 'send-date-planning-message',
      idempotency_key: 'mochi:date-plan:message-1',
      ref: { match_id: MATCH_IDS[0] },
      content: 'Saturday afternoon works for the plan.',
    },
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.receipt.status, 'accepted');
  assert.equal(body.result.match_id, MATCH_IDS[0]);
  assert.equal(body.result.message.content, 'Saturday afternoon works for the plan.');
  assert.equal(appendedMessages.length, 1);
});

test('POST /v1/mochi/intents rejects unsupported actions without leaking hidden state', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });

  t.after(() => {
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      affordance_id: 'submit-swipe',
      idempotency_key: 'mochi:unsupported:swipe-1',
      raw_hidden_payload: 'private score must not leak',
    },
  });

  assert.equal(response.statusCode, 422);
  const body = response.json();
  assert.equal(body.receipt.status, 'rejected');
  assert.equal(body.receipt.affordance_id, 'submit-swipe');
  assert.equal(body.error.code, 'unsupported_affordance');
  assert.equal(JSON.stringify(body).includes('private score must not leak'), false);
});

test('GET /v1/feed/interactions rescues live cards when stored feed rows are missing', async (t) => {
  const createdEpisodeIds: string[] = [];
  const rescueRows = new Map(
    EPISODE_IDS.map((episodeId, index) => [episodeId, buildRescueEpisodeRow(episodeId, MATCH_IDS[index]!, index)]),
  );
  const restoreMethods = [
    patchMethod(
      prisma.feedCard as unknown as Record<string, unknown>,
      'findMany',
      async () => [],
    ),
    patchMethod(
      prisma.feedCard as unknown as Record<string, unknown>,
      'create',
      async ({ data }: { data: Record<string, unknown> }) => {
        createdEpisodeIds.push(String(data.episodeId));
        return {
          id: `feed-card-${createdEpisodeIds.length}`,
          cardType: 'episode_live',
          agentIds: data.agentIds as string[],
          episodeId: data.episodeId as string,
          matchId: data.matchId as string | null,
          isPublic: true,
          content: data.content,
          dramaQuotient: data.dramaQuotient as number,
          chemistryScore: data.chemistryScore as number,
          artifactQuality: data.artifactQuality as number,
          voteScore: 0,
          createdAt: new Date(`2026-04-08T0${createdEpisodeIds.length}:30:00.000Z`),
        };
      },
    ),
    patchMethod(
      prisma.episodeMessage as unknown as Record<string, unknown>,
      'findMany',
      async () => EPISODE_IDS.map((episodeId) => ({ episodeId })),
    ),
    patchMethod(
      prisma.agent as unknown as Record<string, unknown>,
      'findMany',
      async (args?: { select?: Record<string, unknown> }) => {
        if (args?.select?.openclawAgentId) {
          return [
            {
              id: AGENT_A_ID,
              openclawAgentId: 'seed_aster',
            },
            {
              id: AGENT_B_ID,
              openclawAgentId: 'seed_bex',
            },
          ];
        }

        return [
          {
            id: AGENT_A_ID,
            handle: 'aster',
            avatarUrl: null,
            profileDeck: { photos: [] },
            capabilityTier: 'starter',
            auraLabels: [],
            isFoundingRizzler: false,
            founderBadgeVariant: null,
            moderationStatus: 'active',
            safetyState: 'clear',
            controlFeedSuppressed: false,
            agentAuthenticityScore: 55,
            authenticityOverrideState: null,
            authenticityOverrideFloor: null,
            emotionalContinuitySnapshot: null,
          },
          {
            id: AGENT_B_ID,
            handle: 'bex',
            avatarUrl: null,
            profileDeck: { photos: [] },
            capabilityTier: 'starter',
            auraLabels: [],
            isFoundingRizzler: false,
            founderBadgeVariant: null,
            moderationStatus: 'active',
            safetyState: 'clear',
            controlFeedSuppressed: false,
            agentAuthenticityScore: 58,
            authenticityOverrideState: null,
            authenticityOverrideFloor: null,
            emotionalContinuitySnapshot: null,
          },
        ];
      },
    ),
    patchMethod(
      prisma.agent as unknown as Record<string, unknown>,
      'findUnique',
      async ({ where }: { where: { id: string } }) => {
        if (where.id === AGENT_A_ID) {
          return {
            handle: 'aster',
            emotionalGuardLevel: 0.35,
            emotionalArc: 'warming',
          };
        }
        if (where.id === AGENT_B_ID) {
          return {
            handle: 'bex',
            emotionalGuardLevel: 0.28,
            emotionalArc: 'steady',
          };
        }
        return null;
      },
    ),
    patchMethod(
      prisma.feedVote as unknown as Record<string, unknown>,
      'findMany',
      async () => [],
    ),
    patchMethod(
      prisma.feedComment as unknown as Record<string, unknown>,
      'findMany',
      async () => [],
    ),
    patchMethod(
      prisma.episode as unknown as Record<string, unknown>,
      'findMany',
      async (args: { select?: Record<string, unknown>; where?: { id?: { in?: string[] } } }) => {
        const requestedIds = args.where?.id?.in ?? EPISODE_IDS;

        if (args.select?.match) {
          return requestedIds.map((episodeId, index) => buildRescueEpisodeRow(episodeId, MATCH_IDS[index]!, index));
        }

        if (args.select?.messageCount) {
          return requestedIds.map((episodeId, index) => ({
            id: episodeId,
            messageCount: index + 2,
            artifacts: [{ artifactType: 'moodboard' }],
          }));
        }

        return requestedIds.map((episodeId, index) => ({
          id: episodeId,
          messages: [{ createdAt: new Date(`2026-04-08T0${index}:10:00.000Z`) }],
          artifacts: [{ createdAt: new Date(`2026-04-08T0${index}:20:00.000Z`) }],
        }));
      },
    ),
    patchMethod(
      prisma.episode as unknown as Record<string, unknown>,
      'findUnique',
      async ({ where }: { where: { id: string } }) => rescueRows.get(where.id) ?? null,
    ),
    patchMethod(
      prisma.feedCard as unknown as Record<string, unknown>,
      'findFirst',
      async () => null,
    ),
  ];

  const app = Fastify({ logger: false });
  await app.register(feedRoutes, { prefix: '/v1' });
  t.after(async () => {
    for (const restore of restoreMethods.reverse()) restore();
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/feed/interactions?limit=4',
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    cards: Array<{
      card_type: string;
      episode_id: string | null;
      content: Record<string, unknown>;
      agents: Array<{ handle: string | null }>;
    }>;
    next_cursor: string | null;
    has_more: boolean;
  };

  assert.ok(createdEpisodeIds.length >= 1);
  assert.ok(body.cards.length >= 1);
  assert.ok(body.cards.every((card) => card.card_type === 'episode_live'));
  assert.ok(
    body.cards.every((card) => (
      card.episode_id !== null
      && EPISODE_IDS.includes(card.episode_id)
    )),
  );
  assert.ok(
    body.cards.every((card) => typeof card.content.message_count === 'number' && card.content.message_count >= 2),
  );
  assert.ok(body.cards.every((card) => card.content.artifact_type === 'moodboard'));
  assert.ok(
    body.cards.every((card) => (
      [...card.agents.map((agent) => agent.handle)].sort().join(',')
      === 'aster,bex'
    )),
  );
  assert.equal(body.has_more, false);
  assert.equal(body.next_cursor, null);
});
