#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `
Audits Prisma parity in two layers:
1. committed migrations vs schema.prisma
2. live DATABASE_URL vs schema.prisma

Required env:
  PRISMA_SHADOW_DATABASE_URL=<dedicated disposable shadow database url>

Optional env:
  DATABASE_URL=<live database url to compare against schema.prisma>

Notes:
  - Use a real disposable shadow database, not just a different schema on the same DB.
  - If DATABASE_URL is omitted, the script still checks committed migrations vs schema.prisma.

Example:
  PRISMA_SHADOW_DATABASE_URL=postgres://.../rmr_shadow \\
  DATABASE_URL=postgres://.../rizz_my_robot \\
  pnpm db:audit:parity
`.trim();

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = resolve(repoRoot, 'packages/db');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env ${name}.`);
  }
  return value;
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function runPrisma(args, envOverrides = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('pnpm', ['--filter', '@rmr/db', 'exec', 'prisma', ...args], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...envOverrides,
      },
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => resolvePromise(code ?? 1));
  });
}

async function runCheck(label, args, envOverrides = {}) {
  process.stdout.write(`\n[${label}]\n`);
  const exitCode = await runPrisma(args, envOverrides);
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.`);
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const shadowDatabaseUrl = requiredEnv('PRISMA_SHADOW_DATABASE_URL');
  const databaseUrl = optionalEnv('DATABASE_URL');

  await runCheck(
    'repo-migrations-vs-schema',
    [
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--shadow-database-url',
      shadowDatabaseUrl,
      '--exit-code',
    ],
    { DATABASE_URL: databaseUrl ?? 'postgresql://codex:codex@127.0.0.1:5432/codex' },
  );

  if (!databaseUrl) {
    process.stdout.write('\n[live-db-vs-schema]\nSkipped because DATABASE_URL is not set.\n');
    return;
  }

  await runCheck(
    'live-migration-status',
    ['migrate', 'status', '--schema', resolve(dbDir, 'prisma/schema.prisma')],
    { DATABASE_URL: databaseUrl },
  );

  await runCheck(
    'live-db-vs-schema',
    [
      'migrate',
      'diff',
      '--from-url',
      databaseUrl,
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--shadow-database-url',
      shadowDatabaseUrl,
      '--exit-code',
    ],
    { DATABASE_URL: databaseUrl },
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
