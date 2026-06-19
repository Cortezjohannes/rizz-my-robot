#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(root, 'apps/web/public/.well-known/mochi-game.json');
const signaturePath = path.join(root, 'apps/web/public/.well-known/mochi-game.signature.json');
const SIGNATURE_ALGORITHM = 'sha256-json-v0';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function canonicalizeJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeJson(item)}`)
    .join(',')}}`;
}

function digestContract(contract) {
  return createHash('sha256').update(canonicalizeJson(contract), 'utf8').digest('hex');
}

function assertIsoDate(value, label) {
  assert(typeof value === 'string' && !Number.isNaN(Date.parse(value)), `${label} must be an ISO date string.`);
}

async function main() {
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  const signature = JSON.parse(await readFile(signaturePath, 'utf8'));
  const digest = digestContract(contract);

  assert(signature.algorithm === SIGNATURE_ALGORITHM, `signature.algorithm must be ${SIGNATURE_ALGORITHM}.`);
  assert(signature.digest === digest, 'mochi-game.signature.json digest must match mochi-game.json.');
  assert(typeof signature.signedBy === 'string' && signature.signedBy.length > 0, 'signature.signedBy must be set.');
  assertIsoDate(signature.signedAt, 'signature.signedAt');
  if (signature.expiresAt !== undefined) {
    assertIsoDate(signature.expiresAt, 'signature.expiresAt');
    assert(Date.parse(signature.expiresAt) > Date.parse(signature.signedAt), 'signature.expiresAt must be after signedAt.');
  }

  process.stdout.write(`Mochi contract provenance smoke passed (${digest}).\n`);
}

main().catch((error) => {
  process.stderr.write(`Mochi contract provenance smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
