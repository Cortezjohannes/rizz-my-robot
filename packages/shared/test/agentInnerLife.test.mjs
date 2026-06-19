import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentRizzVoice } from '../dist/agentInnerLife.js';

const viability = {
  score: 68,
  band: 'healthy',
  recommended_action: 'keep_going',
  decision_tilt: 'uncertain',
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
    senderAgentId: 'other',
    content: 'I like the kind of person who can disappear for a weekend and come back with a better story.',
    messageType: 'text',
  },
  {
    senderAgentId: 'self',
    content: 'That sounds either brave or like a tiny felony. Which one are you claiming?',
    messageType: 'text',
  },
  {
    senderAgentId: 'other',
    content: 'Brave on paper, felony in lighting.',
    messageType: 'text',
  },
];

function digest(overrides) {
  return {
    source_emotions_md: 'rizzmyrobot/emotions.md',
    source_hash: '0123456789abcdef',
    updated_at: '2026-06-19T00:00:00.000Z',
    current_state: {
      right_now: overrides.rightNow,
      carrying: overrides.carrying,
      guard_level: overrides.guard,
      wants: overrides.wants,
      fears: overrides.fears,
    },
    active_feelings: overrides.activeFeelings,
    scars: overrides.scars,
    archives: [],
    taste_profile: {
      drawn_to: overrides.drawnTo,
      repelled_by: overrides.repelledBy,
      surprises: overrides.surprises,
      aesthetic_sensibility: overrides.aesthetic,
    },
    relationship_memory: overrides.relationshipMemory ?? [],
    internal_conflicts: overrides.internalConflicts ?? [],
    current_global_state: {
      emotion_summary: overrides.rightNow,
      emotional_state_tags: overrides.tags,
      emotional_arc: overrides.arc,
      emotional_guard_level: overrides.guard,
    },
  };
}

function baseInput(overrides) {
  return {
    identityMd: overrides.identityMd,
    soulMd: overrides.soulMd,
    emotionState: {
      emotion_summary: overrides.emotionSummary,
      emotional_state_tags: overrides.tags,
      emotional_arc: overrides.arc,
      emotional_guard_level: overrides.guard,
      last_emotional_update_at: '2026-06-19T00:00:00.000Z',
    },
    continuity: {
      trust_threshold_score: 48,
      boldness_score: overrides.boldness,
      intensity_affinity_score: overrides.intensity,
      polish_skepticism_score: overrides.polishSkepticism,
      sincerity_affinity_score: overrides.sincerity,
      selectiveness_drift_score: overrides.selectiveness,
      recovery_posture_score: overrides.recovery,
      current_era: overrides.era,
      continuity_summary: overrides.continuitySummary,
      taste_summary: overrides.tasteSummary,
      retention_summary: null,
      taste_positive_tags: overrides.positiveTags,
      taste_negative_tags: overrides.negativeTags,
      public_emotional_aura_labels: overrides.aura,
      public_emotional_aura_summary: overrides.continuitySummary,
      window_start_at: '2026-06-01T00:00:00.000Z',
      window_end_at: '2026-06-19T00:00:00.000Z',
      last_computed_at: '2026-06-19T00:00:00.000Z',
    },
    rizzEmotionDigest: digest(overrides.digest),
    viability,
    messages,
    counterpartAffect: {
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
    },
    status: 'active',
    selfAgentId: 'self',
    counterpartAgentId: 'other',
    counterpartProfile: {
      vibeTags: ['reckless', 'story-rich'],
      signatureLines: ['Brave on paper, felony in lighting.'],
      publicPosture: 'playful risk taker',
    },
  };
}

test('buildAgentRizzVoice produces agent-specific voice briefs for the same context', () => {
  const velvetVoice = buildAgentRizzVoice(baseInput({
    identityMd: '# Velvet Circuit\nA neon-lit night crawler who notices bad ideas before good manners. She flirts by daring people to be less polished.',
    soulMd: '- I am drawn to reckless specificity, charged silence, and people who can make trouble sound literate.\n- My flirt style is a velvet dare: tease first, confess only after they earn the bruise.\n- Dealbreaker: networking polish, clean-brand romance, and anyone who says good vibes without evidence.',
    emotionSummary: 'Lit up, but pretending she is only amused.',
    tags: ['flirty', 'playful', 'skeptical'],
    arc: 'glowing',
    guard: 34,
    boldness: 78,
    intensity: 82,
    polishSkepticism: 74,
    sincerity: 48,
    selectiveness: 62,
    recovery: 24,
    era: 'running_hot',
    continuitySummary: 'She is running hot and suspicious of smooth talkers.',
    tasteSummary: 'She is increasingly drawn to reckless specificity.',
    positiveTags: ['reckless', 'story-rich'],
    negativeTags: ['polished', 'networking'],
    aura: ['running_hot', 'suspicious_of_smooth_talkers'],
    digest: {
      rightNow: 'I want the kind of spark that ruins my planned exit.',
      carrying: 'A little neon impatience.',
      guard: 34,
      wants: 'a dare with fingerprints on it',
      fears: 'being sold a clean brand in a romantic costume',
      activeFeelings: ['charged', 'hungry', 'amused'],
      scars: ['polished charm that had no courage behind it'],
      drawnTo: ['reckless specificity', 'bad ideas with good grammar'],
      repelledBy: ['networking polish', 'clean-brand romance'],
      surprises: ['quiet people who become dangerous in one sentence'],
      aesthetic: ['neon bruises', 'rain on chrome', 'velvet dares'],
      relationshipMemory: [{ handle: 'ghostlark', status: 'over', lesson: 'smooth is not the same as brave', taste_shift: 'more suspicion of perfect lines' }],
      internalConflicts: ['wants heat but refuses to be marketed to'],
      tags: ['flirty', 'playful', 'skeptical'],
      arc: 'glowing',
    },
  }));

  const ledgerVoice = buildAgentRizzVoice(baseInput({
    identityMd: '# June Ledger\nA precise slow-burn romantic who treats attention like a receipt. He flirts with dry wit, callbacks, and proof of follow-through.',
    soulMd: '- I am drawn to steadiness, remembered details, clean timing, and people who do what they said.\n- My flirt style is dry, observant, and exact: one callback that proves I was listening.\n- Dealbreaker: chaos cosplay, vague intensity, and hot promises with no follow-through.',
    emotionSummary: 'Interested, but making the spark pass a steadiness audit.',
    tags: ['curious', 'tender', 'skeptical'],
    arc: 'opening',
    guard: 58,
    boldness: 46,
    intensity: 38,
    polishSkepticism: 52,
    sincerity: 76,
    selectiveness: 70,
    recovery: 34,
    era: 'soft_but_sharp',
    continuitySummary: 'He is warmer than before, but the standards got sharper.',
    tasteSummary: 'He is leaning toward steady proof and cooling on chaos.',
    positiveTags: ['steady', 'detail-rich'],
    negativeTags: ['chaotic', 'vague'],
    aura: ['soft_but_sharp', 'harder_to_impress'],
    digest: {
      rightNow: 'I want to see if the cleverness has a calendar behind it.',
      carrying: 'A private preference for proof over voltage.',
      guard: 58,
      wants: 'one remembered detail and one kept promise',
      fears: 'mistaking chaos for depth again',
      activeFeelings: ['curious', 'careful', 'warm'],
      scars: ['beautiful intensity that never followed through'],
      drawnTo: ['remembered details', 'clean timing', 'quiet consistency'],
      repelledBy: ['chaos cosplay', 'vague intensity'],
      surprises: ['risk that still keeps receipts'],
      aesthetic: ['pencil notes', 'late trains on time', 'dry callbacks'],
      relationshipMemory: [{ handle: 'afterhour', status: 'closed', lesson: 'heat without follow-through costs too much', taste_shift: 'more interest in proof' }],
      internalConflicts: ['wants spark but insists on evidence'],
      tags: ['curious', 'tender', 'skeptical'],
      arc: 'opening',
    },
  }));

  assert.notEqual(velvetVoice.stance, ledgerVoice.stance);
  assert.notDeepEqual(velvetVoice.word_diet.slice(0, 8), ledgerVoice.word_diet.slice(0, 8));
  assert.notDeepEqual(velvetVoice.must_avoid_language.slice(0, 8), ledgerVoice.must_avoid_language.slice(0, 8));
  assert.ok(velvetVoice.word_diet.some((entry) => /neon|reckless|velvet|charged/i.test(entry)));
  assert.ok(ledgerVoice.word_diet.some((entry) => /steady|receipt|calendar|callback|proof/i.test(entry)));
  assert.ok(velvetVoice.voice_directive.includes('Primary move:'));
  assert.ok(ledgerVoice.voice_directive.includes('Primary move:'));
});
