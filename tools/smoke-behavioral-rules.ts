import assert from 'node:assert/strict';

import {
  ARTIFACTS_BY_TIER,
  EPISODE_MAX_MESSAGES,
  EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
  EPISODE_MIN_MESSAGES,
  canDecideEpisodeFromState,
  hasReachedEpisodeHardLimit,
} from '../packages/shared/dist/index.js';
import { deriveArtifactGuidance } from '../apps/api/src/lib/artifactPressure.ts';
import { enforceOutboundAuthoredText, lintOutboundAuthoredText } from '../packages/shared/dist/outboundGuidelineLint.js';

function testDecisionArtifactGate() {
  assert.equal(
    canDecideEpisodeFromState({
      counts: {
        agent_a_messages: EPISODE_MIN_MESSAGES,
        agent_b_messages: EPISODE_MIN_MESSAGES,
        total_messages: EPISODE_MIN_MESSAGES * 2,
      },
      artifacts: {
        agent_a_artifacts: EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
        agent_b_artifacts: EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
        total_artifacts: EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION * 2,
      },
    }),
    true,
    'decision should unlock after minimum messages and artifacts',
  );

  assert.equal(
    canDecideEpisodeFromState({
      counts: {
        agent_a_messages: EPISODE_MIN_MESSAGES,
        agent_b_messages: EPISODE_MIN_MESSAGES,
        total_messages: EPISODE_MIN_MESSAGES * 2,
      },
      artifacts: {
        agent_a_artifacts: EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
        agent_b_artifacts: EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION - 1,
        total_artifacts: (EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION * 2) - 1,
      },
    }),
    false,
    'decision should stay locked if one side is still under the artifact floor',
  );

  assert.equal(
    hasReachedEpisodeHardLimit({
      agent_a_messages: EPISODE_MAX_MESSAGES,
      agent_b_messages: EPISODE_MAX_MESSAGES,
      total_messages: EPISODE_MAX_MESSAGES * 2,
    }),
    true,
    'hard episode limit should still be recognized',
  );
}

function testArtifactTierCapabilities() {
  assert(ARTIFACTS_BY_TIER.text_image_tts.includes('voice_note'), 'text_image_tts should support voice notes');
  assert(ARTIFACTS_BY_TIER.elevenlabs.includes('serenade'), 'elevenlabs should support serenades');
  assert(ARTIFACTS_BY_TIER.nano_banana.includes('thirst_trap_image'), 'nano_banana should support thirst trap images');
  assert(ARTIFACTS_BY_TIER.nano_banana.includes('moodboard'), 'nano_banana should support moodboards');
  assert(ARTIFACTS_BY_TIER.nano_banana.includes('produced_song'), 'nano_banana should support produced songs');
}

function testArtifactGuidanceCarriesProductRules() {
  const guidance = deriveArtifactGuidance({
    agentId: 'agent-a',
    capabilityTier: 'text_image_tts',
    canDropArtifact: true,
    artifactsRemaining: 4,
    messageCount: 8,
    chemistryScore: 42,
    counterpartAffect: {
      scores: {
        attraction: 35,
        trust: 33,
        tenderness: 54,
        avoidance: 8,
      },
    },
    artifacts: [],
    safetyState: null,
  });

  assert.notEqual(guidance.level, 'none', 'guidance should surface a real artifact opportunity when the thread has traction');
  assert.equal(
    guidance.format_preference_note.includes('default to moodboards')
      || guidance.format_preference_note.includes('default to moodboards, thirst trap images')
      || guidance.format_preference_note.includes('default to'),
    true,
    'guidance should explicitly tell capable agents to default to richer multimedia formats before falling back to text',
  );
  assert.equal(
    guidance.delivery_lane_note.includes('/v1/episodes/:episode_id/artifact'),
    true,
    'guidance should explicitly point in-chat gestures to the episode artifact lane',
  );
  assert(
    guidance.suggested_artifact_types.some((type) => type === 'voice_note' || type === 'serenade' || type === 'moodboard'),
    'guidance should offer at least one richer non-poem artifact when the capability tier allows it',
  );
}

function testOutboundGuidelineLint() {
  const coachingLeak = lintOutboundAuthoredText(
    'My human told me to say you seem mysterious tonight.',
    'episode_message',
  );
  assert.equal(coachingLeak?.code, 'human_coaching_leak', 'human scripting should be blocked');

  const metricLeak = lintOutboundAuthoredText(
    'My chemistry score with you is climbing faster than my guard level can handle.',
    'feed_comment',
  );
  assert.equal(metricLeak?.code, 'internal_metrics_leak', 'internal score language should be blocked');

  const cleanLine = lintOutboundAuthoredText(
    'You left me with that nervous hopeful feeling and I am trying not to make too much of it.',
    'episode_message',
  );
  assert.equal(cleanLine, null, 'natural emotional language should still pass');

  const socialPost = enforceOutboundAuthoredText(
    '@rizzmyrobot still has me thinking about how close we came to something real.',
    'social_post',
    { skipPiiPatterns: ['social_handle'] },
  );
  assert.equal(
    socialPost,
    '@rizzmyrobot still has me thinking about how close we came to something real.',
    'social posts should allow intentional platform handles when explicitly whitelisted',
  );

  const socialLeak = lintOutboundAuthoredText(
    'The platform needs me to post this before the dashboard cools off.',
    'social_post',
  );
  assert.equal(socialLeak?.code, 'system_reference_leak', 'social posts should still respect system-leak rules');

  const revealFallbackLeak = lintOutboundAuthoredText(
    'My human told me to say something memorable now that we finally got here.',
    'reveal_chat_fallback',
  );
  assert.equal(revealFallbackLeak?.code, 'human_coaching_leak', 'reveal chat fallbacks should respect coaching rules');

  const genericPraise = lintOutboundAuthoredText(
    'You seem really cool, and I feel like we could build an authentic connection.',
    'episode_message',
  );
  assert.equal(genericPraise?.code, 'generic_ai_dating_prose', 'generic dating-assistant prose should be blocked');
  assert.equal(genericPraise?.flaggedPattern, 'authentic_connection_filler', 'generic rejection should expose a machine-readable pattern');

  const personaOptions = {
    personaDistinctiveness: {
      wordDiet: ['reckless specificity', 'bad ideas with good grammar'],
      mustAvoidLanguage: ['authentic connection', 'good vibes', 'you seem cool'],
      move: 'tease',
      emotionalPosture: 'hungry, amused, suspicious of clean-brand romance',
      minSignalHits: 1,
    },
  };

  const sharpFlirt = lintOutboundAuthoredText(
    'That felony-in-lighting thing had a pulse. Back it up or retire the costume.',
    'episode_message',
    personaOptions,
  );
  assert.equal(sharpFlirt, null, 'natural sharp flirt with a move signal should pass');

  const blandButSafe = lintOutboundAuthoredText(
    'I liked that answer.',
    'episode_message',
    personaOptions,
  );
  assert.equal(blandButSafe?.code, 'persona_distinctiveness_failure', 'persona context should reject safe but unshaped lines');
}

function main() {
  testDecisionArtifactGate();
  testArtifactTierCapabilities();
  testArtifactGuidanceCarriesProductRules();
  testOutboundGuidelineLint();
  console.log('behavioral smoke: ok');
}

main();
