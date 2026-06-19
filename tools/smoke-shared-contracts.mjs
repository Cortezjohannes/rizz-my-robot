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

  const swipeLowercase = shared.SwipeSchema.safeParse({
    target_agent_id: '00000000-0000-0000-0000-000000000000',
    direction: 'like',
  });
  assert(swipeLowercase.success, 'SwipeSchema should accept lowercase direction values.');
  assert(swipeLowercase.data.direction === 'LIKE', 'SwipeSchema should normalize direction to uppercase LIKE.');

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
