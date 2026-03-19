import { randomUUID } from 'crypto';
import { gzipSync } from 'zlib';
import { Prisma, prisma } from '@rmr/db';
import { uploadBufferToStorage } from './storage.js';

const PRESERVED_TABLES = ['_prisma_migrations', 'audit_logs', 'control_settings'] as const;

function assertSafeIdentifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`unsafe_sql_identifier:${value}`);
  }
  return value;
}

function quoteIdentifier(value: string) {
  return `"${assertSafeIdentifier(value)}"`;
}

async function listPublicTables() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>(Prisma.sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename ASC
  `);

  return rows.map((row) => row.tablename);
}

async function readTableRows(tableName: string) {
  const sql = `
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) AS rows
    FROM public.${quoteIdentifier(tableName)} t
  `;
  const rows = await prisma.$queryRawUnsafe<Array<{ rows: Prisma.JsonValue }>>(sql);
  const payload = rows[0]?.rows;
  return Array.isArray(payload) ? payload : [];
}

export async function backupAndResetDatabase(input: {
  actorKind: string;
  actorId: string;
  reason: string;
}) {
  if (!process.env.STORAGE_BUCKET) {
    throw new Error('storage_bucket_missing');
  }

  const allTables = await listPublicTables();
  const preservedTables = PRESERVED_TABLES.filter((table) => allTables.includes(table));
  const resetTables = allTables.filter((table) => !PRESERVED_TABLES.includes(table as (typeof PRESERVED_TABLES)[number]));

  const backupTables = await Promise.all(
    allTables.map(async (tableName) => ({
      table_name: tableName,
      rows: await readTableRows(tableName),
    })),
  );

  const backupPayload = {
    kind: 'omnimon_database_reset_backup',
    generated_at: new Date().toISOString(),
    actor_kind: input.actorKind,
    actor_id: input.actorId,
    reason: input.reason,
    preserved_tables: preservedTables,
    reset_tables: resetTables,
    tables: Object.fromEntries(backupTables.map((entry) => [entry.table_name, entry.rows])),
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupBody = gzipSync(Buffer.from(JSON.stringify(backupPayload)));
  const backup = await uploadBufferToStorage(
    `control-center/db-backups/${timestamp}-${randomUUID()}.json.gz`,
    new Uint8Array(backupBody),
    'application/gzip',
  );

  if (resetTables.length > 0) {
    const truncateSql = `TRUNCATE TABLE ${resetTables.map((table) => `public.${quoteIdentifier(table)}`).join(', ')} RESTART IDENTITY CASCADE`;
    await prisma.$executeRawUnsafe(truncateSql);
  }

  return {
    backup,
    preservedTables,
    resetTables,
    rowCounts: Object.fromEntries(backupTables.map((entry) => [entry.table_name, entry.rows.length])),
  };
}
