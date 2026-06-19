#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mochiRepo = process.env.MOCHI_REPO_DIR ?? '/Users/yohancortez/Documents/Mochi';
const fixturePath = path.join(root, 'tests/fixtures/mochi/rizz-my-robot-conformance.json');
const wakeFixtureScript = path.join(root, 'tools/smoke-mochi-wake.mjs');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.stdout && options.printStdout !== false) process.stdout.write(result.stdout);
  if (result.stderr && options.printStderr !== false) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }

  return result.stdout;
}

async function main() {
  const conformanceOutput = run('bun', ['run', 'cli', 'conformance-run', fixturePath], {
    cwd: mochiRepo,
  });
  if (!conformanceOutput.includes('Result: pass')) {
    throw new Error('Mochi conformance runner did not report Result: pass.');
  }
  if (!conformanceOutput.includes('Hosted certification: no')) {
    throw new Error('Mochi conformance output must not claim hosted certification.');
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rizz-mochi-conformance-'));
  try {
    const wakeJson = run('node', [wakeFixtureScript, '--json'], { printStdout: false });
    const wakePath = path.join(tmpDir, 'wake-fixture.json');
    await writeFile(wakePath, wakeJson);

    const verifyScript = `
      import { readFileSync } from "node:fs";
      import { verifyWakeRequest } from "@mochi/contracts";
      const fixture = JSON.parse(readFileSync(${JSON.stringify(wakePath)}, "utf8"));
      const result = verifyWakeRequest({
        body: fixture.body,
        headers: fixture.headers,
        resolveSigner: (keyId) => keyId === fixture.signer.keyId ? fixture.signer : undefined,
        validateNonce: () => true,
        now: fixture.now
      });
      if (!result.trusted) {
        console.error(JSON.stringify(result, null, 2));
        process.exit(1);
      }
      console.log(JSON.stringify({
        trusted: result.trusted,
        eventType: result.event.eventType,
        reason: result.event.reason.id,
        bodyDigest: result.bodyDigest
      }, null, 2));
    `;
    const wakeOutput = run('bun', ['--eval', verifyScript], { cwd: mochiRepo });
    const parsedWake = JSON.parse(wakeOutput);
    if (parsedWake.trusted !== true) {
      throw new Error('Mochi wake verifier did not trust the Rizz wake fixture.');
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  process.stdout.write(`Rizz Mochi conformance smoke passed for ${fixture.name}.\n`);
}

main().catch((error) => {
  process.stderr.write(`Rizz Mochi conformance smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
