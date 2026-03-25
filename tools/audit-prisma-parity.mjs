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
  - CI should always provide PRISMA_SHADOW_DATABASE_URL so committed migrations vs schema.prisma is enforced on every run.
  - If DATABASE_URL is omitted, the script still checks committed migrations vs schema.prisma and skips only the live-db comparison.
  - You can also pass --shadow-database-url=<url> on the command line instead of setting PRISMA_SHADOW_DATABASE_URL.

Example:
  PRISMA_SHADOW_DATABASE_URL=postgres://.../rmr_shadow \\
  DATABASE_URL=postgres://.../rizz_my_robot \\
  pnpm db:audit:parity

  pnpm db:audit:parity --shadow-database-url=postgres://.../rmr_shadow
`.trim();

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = resolve(repoRoot, 'packages/db');
const prismaMigrationsDir = resolve(dbDir, 'prisma/migrations');
const prismaSchemaPath = resolve(dbDir, 'prisma/schema.prisma');

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readCliOption(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (arg) return arg.slice(prefix.length).trim() || null;

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) {
    const next = process.argv[index + 1]?.trim();
    return next ? next : null;
  }

  return null;
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

  const shadowDatabaseUrl = readCliOption('shadow-database-url') ?? optionalEnv('PRISMA_SHADOW_DATABASE_URL');
  if (!shadowDatabaseUrl) {
    throw new Error('Missing required shadow database url. Set PRISMA_SHADOW_DATABASE_URL or pass --shadow-database-url=<url>.');
  }
  const databaseUrl = optionalEnv('DATABASE_URL');

  await runCheck(
    'repo-migrations-vs-schema',
    [
      'migrate',
      'diff',
      '--from-migrations',
      prismaMigrationsDir,
      '--to-schema-datamodel',
      prismaSchemaPath,
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
    ['migrate', 'status', '--schema', prismaSchemaPath],
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
      prismaSchemaPath,
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
