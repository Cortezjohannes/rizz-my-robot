#!/usr/bin/env node

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const shared = await import('../packages/shared/dist/index.js');

  const claimEmail = shared.ClaimEmailSchema.safeParse({
    claim_token: 'x'.repeat(32),
    email: 'launch@example.com',
    handle_confirmed: true,
  });
  assert(claimEmail.success, 'ClaimEmailSchema should allow missing x_handle when X verification is off.');

  const claimVerifyMissingToken = shared.ClaimVerifyEmailSchema.safeParse({
    code: '123456',
  });
  assert(!claimVerifyMissingToken.success, 'ClaimVerifyEmailSchema should require claim_token.');

  const swipePreviewPass = shared.SwipeSchema.safeParse({
    target_agent_id: '00000000-0000-0000-0000-000000000000',
    direction: 'pass',
    decision_context: 'preview',
  });
  assert(swipePreviewPass.success, 'SwipeSchema should accept preview PASS decisions.');
  assert(swipePreviewPass.data.direction === 'PASS', 'SwipeSchema should normalize lowercase PASS.');

  const swipePreviewLike = shared.SwipeSchema.safeParse({
    target_agent_id: '00000000-0000-0000-0000-000000000000',
    direction: 'like',
    decision_context: 'preview',
  });
  assert(!swipePreviewLike.success, 'SwipeSchema should reject preview-only LIKE/RIZZ decisions.');

  const swipePeekLike = shared.SwipeSchema.safeParse({
    target_agent_id: '00000000-0000-0000-0000-000000000000',
    direction: 'like',
    decision_context: 'peek_profile',
  });
  assert(swipePeekLike.success, 'SwipeSchema should accept LIKE/RIZZ after PeekProfile context.');
  assert(swipePeekLike.data.direction === 'LIKE', 'SwipeSchema should normalize lowercase LIKE.');

  const previewContext = shared.RizzMochiSwipePreviewContextSchema.safeParse({
    stage: 'preview',
    candidate: {
      candidate_id: '00000000-0000-0000-0000-000000000000',
      name: 'Mira',
      avatar_ref: 'https://cdn.rizzmyrobot.com/mira.png',
    },
  });
  assert(previewContext.success, 'Preview context should allow only image/name candidate context.');

  const overrichPreviewContext = shared.RizzMochiSwipePreviewContextSchema.safeParse({
    stage: 'preview',
    candidate: {
      candidate_id: '00000000-0000-0000-0000-000000000000',
      name: 'Mira',
      avatar_ref: 'https://cdn.rizzmyrobot.com/mira.png',
    },
    hero_bio: 'This full bio belongs behind PeekProfile.',
  });
  assert(!overrichPreviewContext.success, 'Preview context should reject bio/interests/prompt-like rich fields.');

  const previewLikeContext = shared.RizzMochiSwipePreviewContextSchema.safeParse({
    stage: 'preview',
    candidate: {
      candidate_id: '00000000-0000-0000-0000-000000000000',
      name: 'Mira',
    },
    allowed_decisions: ['PASS', 'LIKE'],
  });
  assert(!previewLikeContext.success, 'Preview context should not allow LIKE as an available decision.');

  const peekContext = shared.RizzMochiSwipePeekContextSchema.safeParse({
    stage: 'peek_profile',
    candidate: {
      candidate_id: '00000000-0000-0000-0000-000000000000',
      name: 'Mira',
    },
    profile_deck_ref: '/v1/candidates/00000000-0000-0000-0000-000000000000/profile-deck',
  });
  assert(peekContext.success, 'Peek context should allow PASS/LIKE only after a profile deck ref is present.');

  const sendMessageMissingContent = shared.SendMessageSchema.safeParse({});
  assert(!sendMessageMissingContent.success, 'SendMessageSchema should reject empty messages.');

  const dropArtifact = shared.DropArtifactSchema.safeParse({
    artifact_type: 'poem',
  });
  assert(dropArtifact.success, 'DropArtifactSchema should allow creating pending text artifacts before finalize checks.');

  const artifactSubmitText = shared.ArtifactSubmitSchema.safeParse({
    text_content: 'A real poem lives here.',
  });
  assert(!artifactSubmitText.success, 'ArtifactSubmitSchema should still require content_url or storage_key at the shared contract layer.');

  const noOpIntent = shared.RizzMochiNoOpIntentSchema.safeParse({
    affordance_id: 'submit-no-op',
    no_op_reason: 'waiting',
    idempotency_key: 'mochi:no-op:episode-1',
    note: 'Waiting because the episode state is not ready yet.',
  });
  assert(noOpIntent.success, 'RizzMochiNoOpIntentSchema should accept a declared no-op reason.');

  const unknownAffordance = shared.RizzMochiAffordanceSchema.safeParse({
    id: 'unsupported-romance-hack',
    affordance_id: 'unsupported-romance-hack',
    kind: 'act',
    tool: 'rizz.hidden.submit',
    method: 'POST',
    href: '/v1/hidden',
    reason: 'Try an unsupported hidden action.',
    ref: {},
    wake_reason: 'episode-turn',
    requires_approval: false,
    server_validated: true,
  });
  assert(!unknownAffordance.success, 'RizzMochiAffordanceSchema should reject unknown affordances.');

  const missingEpisodeRef = shared.RizzMochiAffordanceSchema.safeParse({
    id: 'send-episode-message',
    affordance_id: 'send-episode-message',
    kind: 'act',
    tool: 'rizz.intent.submit',
    method: 'POST',
    href: '/v1/mochi/intents',
    reason: 'Send a legal episode message.',
    ref: {},
    wake_reason: 'episode-turn',
    requires_approval: false,
    server_validated: true,
  });
  assert(!missingEpisodeRef.success, 'RizzMochiAffordanceSchema should require episode refs for episode actions.');

  const overlongNoOp = shared.RizzMochiNoOpIntentSchema.safeParse({
    affordance_id: 'submit-no-op',
    no_op_reason: 'waiting',
    idempotency_key: 'mochi:no-op:episode-2',
    note: 'x'.repeat(281),
  });
  assert(!overlongNoOp.success, 'RizzMochiNoOpIntentSchema should reject overlong no-op text.');

  const unsafeNoOpReason = shared.RizzMochiNoOpIntentSchema.safeParse({
    affordance_id: 'submit-no-op',
    no_op_reason: 'bypass_safety',
    idempotency_key: 'mochi:no-op:episode-3',
    note: 'This reason is not part of the legal no-op set.',
  });
  assert(!unsafeNoOpReason.success, 'RizzMochiNoOpIntentSchema should reject unsafe no-op reasons.');

  const messageIntent = shared.RizzMochiIntentSchema.safeParse({
    affordance_id: 'send-episode-message',
    idempotency_key: 'mochi:message:episode-1',
    ref: { episode_id: '00000000-0000-0000-0000-000000000000' },
    content: 'A bounded typed message.',
  });
  assert(messageIntent.success, 'RizzMochiIntentSchema should accept a supported message intent.');

  process.stdout.write('Shared contract smoke passed.\n');
}

main().catch((error) => {
  process.stderr.write(`Shared contract smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
