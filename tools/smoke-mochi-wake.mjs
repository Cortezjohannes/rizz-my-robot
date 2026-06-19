#!/usr/bin/env node

import {
  RIZZ_MOCHI_GAME_ID,
  RIZZ_MOCHI_WAKE_HEADER_NAMES,
  buildRizzMochiWakeFixture,
  verifyRizzMochiWakeRequest,
} from '../packages/shared/dist/index.js';

const signer = {
  keyId: 'rizz_mochi_wake_key_0001',
  gameId: RIZZ_MOCHI_GAME_ID,
  secret: 'rizz_mochi_wake_secret_0001',
};

const fixture = {
  ...buildRizzMochiWakeFixture({
    signer,
    signedAt: '2026-06-19T00:00:00.000Z',
    deadline: '2026-06-19T00:05:00.000Z',
  }),
  signer,
  now: '2026-06-19T00:00:30.000Z',
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
  process.exit(0);
}

assert(fixture.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.algorithm] === 'hmac-sha256-v0', 'missing Mochi signature algorithm header.');
assert(fixture.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.keyId] === signer.keyId, 'missing Mochi key id header.');
assert(fixture.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.timestamp] === '2026-06-19T00:00:00.000Z', 'missing Mochi timestamp header.');
assert(/^sha256=[a-f0-9]{64}$/.test(fixture.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.signature] ?? ''), 'invalid Mochi signature header.');

const verified = verifyRizzMochiWakeRequest({
  body: fixture.body,
  headers: fixture.headers,
  resolveSigner: (keyId) => (keyId === signer.keyId ? signer : undefined),
  validateNonce: () => true,
  now: fixture.now,
});

assert(verified.trusted === true, verified.trusted ? 'wake should verify' : verified.message);

process.stdout.write('Mochi wake fixture smoke passed.\n');
