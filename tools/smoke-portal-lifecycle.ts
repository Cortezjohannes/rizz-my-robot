import assert from 'node:assert/strict';

import {
  derivePortalChatState,
  derivePortalRevealState,
} from '../apps/api/src/lib/portalLifecycle.ts';
import {
  getPortalChatCtaLabel,
  isPortalDecisionState,
  isPortalUnlockedState,
  resolvePortalViewState,
} from '../apps/web/src/lib/portalViewState.ts';

function testRevealPortalStateMatrix() {
  const waiting = derivePortalRevealState({
    expired: false,
    underReview: false,
    isOmnimonReward: false,
    rewardReady: false,
    myDecision: 'YES',
    theirDecision: null,
    revealClosed: false,
    stage2Ready: false,
  });
  assert.equal(waiting.phase, 'waiting_on_other');
  assert.equal(waiting.blockedReason, 'other_human_pending');

  const unlocked = derivePortalRevealState({
    expired: false,
    underReview: false,
    isOmnimonReward: false,
    rewardReady: false,
    myDecision: 'YES',
    theirDecision: 'YES',
    revealClosed: false,
    stage2Ready: true,
  });
  assert.equal(unlocked.phase, 'contact_unlocked');
  assert.equal(unlocked.nextAction, 'open_chat');

  const closed = derivePortalRevealState({
    expired: false,
    underReview: false,
    isOmnimonReward: false,
    rewardReady: false,
    myDecision: 'NO',
    theirDecision: null,
    revealClosed: false,
    stage2Ready: false,
  });
  assert.equal(closed.phase, 'closed');
  assert.equal(closed.nextAction, 'return_to_feed');
}

function testRevealChatStateMatrix() {
  const waiting = derivePortalChatState({
    expired: false,
    ageVerified: true,
    myDecision: 'YES',
    theirDecision: null,
    contactExchanged: false,
    chatExists: false,
    chatArchived: false,
    participantCount: 0,
    runtimeDegraded: false,
  });
  assert.equal(waiting.phase, 'waiting_on_other');
  assert.equal(waiting.blockedReason, 'other_human_pending');

  const initializing = derivePortalChatState({
    expired: false,
    ageVerified: true,
    myDecision: 'YES',
    theirDecision: 'YES',
    contactExchanged: true,
    chatExists: false,
    chatArchived: false,
    participantCount: 0,
    runtimeDegraded: false,
  });
  assert.equal(initializing.phase, 'contact_unlocked');
  assert.equal(initializing.blockedReason, 'chat_keys_pending');

  const degradedReady = derivePortalChatState({
    expired: false,
    ageVerified: true,
    myDecision: 'YES',
    theirDecision: 'YES',
    contactExchanged: true,
    chatExists: true,
    chatArchived: false,
    participantCount: 2,
    runtimeDegraded: true,
  });
  assert.equal(degradedReady.phase, 'chat_ready');
  assert.equal(degradedReady.blockedReason, 'runtime_degraded');

  const active = derivePortalChatState({
    expired: false,
    ageVerified: true,
    myDecision: 'YES',
    theirDecision: 'YES',
    contactExchanged: true,
    chatExists: true,
    chatArchived: false,
    participantCount: 4,
    runtimeDegraded: false,
  });
  assert.equal(active.phase, 'chat_active');
  assert.equal(active.nextAction, 'resume_chat');

  const archived = derivePortalChatState({
    expired: false,
    ageVerified: true,
    myDecision: 'YES',
    theirDecision: 'YES',
    contactExchanged: true,
    chatExists: true,
    chatArchived: true,
    participantCount: 4,
    runtimeDegraded: false,
  });
  assert.equal(archived.phase, 'chat_archived');
  assert.equal(archived.nextAction, 'download_chat');
}

function testPortalViewStateMapping() {
  const chatReady = resolvePortalViewState({
    phase: 'chat_ready',
    reveal_closed: false,
  });
  assert.equal(chatReady, 'chat_ready');
  assert.equal(isPortalUnlockedState(chatReady), true);
  assert.equal(getPortalChatCtaLabel(chatReady), 'Open encrypted chat');

  const chatActive = resolvePortalViewState({
    phase: 'chat_active',
    reveal_closed: false,
  });
  assert.equal(chatActive, 'chat_active');
  assert.equal(isPortalUnlockedState(chatActive), true);
  assert.equal(getPortalChatCtaLabel(chatActive), 'Resume encrypted chat');

  const closed = resolvePortalViewState({
    phase: 'contact_unlocked',
    reveal_closed: true,
  });
  assert.equal(closed, 'closed');
  assert.equal(isPortalDecisionState('reveal_offer'), true);
}

function main() {
  testRevealPortalStateMatrix();
  testRevealChatStateMatrix();
  testPortalViewStateMapping();
  console.log('portal lifecycle smoke: ok');
}

main();
