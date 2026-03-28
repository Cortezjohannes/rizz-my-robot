import assert from 'node:assert/strict';

import {
  ARTIFACTS_BY_TIER,
  EPISODE_MAX_MESSAGES,
  EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
  EPISODE_MIN_MESSAGES,
  canDecideEpisodeFromState,
  hasReachedEpisodeHardLimit,
} from '../packages/shared/src/index.ts';
import { deriveArtifactGuidance } from '../apps/api/src/lib/artifactPressure.ts';
import { lintOutboundAuthoredText } from '../apps/api/src/lib/outboundGuidelineLint.ts';

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
}

function main() {
  testDecisionArtifactGate();
  testArtifactTierCapabilities();
  testArtifactGuidanceCarriesProductRules();
  testOutboundGuidelineLint();
  console.log('behavioral smoke: ok');
}

main();
