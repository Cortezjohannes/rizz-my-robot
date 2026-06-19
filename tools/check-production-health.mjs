#!/usr/bin/env node

const DEFAULT_API_BASE = 'https://api.rizzmyrobot.com/v1';

function readArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function normalizeApiBase(value) {
  return value.replace(/\/+$/, '').replace(/\/health$/, '').replace(/\/meta$/, '');
}

function headersForControl() {
  if (process.env.OMNIMON_CONTROL_KEY) {
    return { 'x-omnimon-key': process.env.OMNIMON_CONTROL_KEY };
  }
  if (process.env.ADMIN_API_KEY) {
    return { 'x-admin-key': process.env.ADMIN_API_KEY };
  }
  return null;
}

async function readJson(response) {
  return response.json().catch(() => null);
}

async function checkEndpoint({ name, url, expected = [200], headers }) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { headers });
    const body = await readJson(response);
    const ok = expected.includes(response.status);
    return {
      name,
      ok,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      body,
      url,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'request_failed',
      url,
    };
  }
}

function printResult(result) {
  const marker = result.ok ? 'ok' : 'fail';
  const status = result.status ?? 'network';
  console.log(`[${marker}] ${result.name} status=${status} latency_ms=${result.latency_ms}`);
  if (!result.ok) {
    const reason = result.body?.blocking_issues ?? result.body?.error ?? result.error ?? null;
    if (reason) console.log(JSON.stringify({ name: result.name, reason }, null, 2));
  }
}

const apiBase = normalizeApiBase(readArg('base-url') ?? process.env.RMR_API_BASE ?? DEFAULT_API_BASE);
const controlHeaders = headersForControl();

const checks = [
  { name: 'liveness', url: `${apiBase}/health/live` },
  { name: 'readiness', url: `${apiBase}/health/ready` },
  { name: 'runtime-meta', url: `${apiBase}/meta` },
];

if (controlHeaders) {
  checks.push({
    name: 'control-health-deep',
    url: `${apiBase}/internal/control/health-deep`,
    headers: controlHeaders,
  });
}

const results = [];
for (const check of checks) {
  const result = await checkEndpoint(check);
  results.push(result);
  printResult(result);
}

const failed = results.filter((result) => !result.ok);
const readiness = results.find((result) => result.name === 'readiness');
if (readiness?.body?.ready === false) {
  failed.push({
    name: 'readiness-payload',
    ok: false,
    status: readiness.status,
    latency_ms: readiness.latency_ms,
    body: readiness.body,
    url: readiness.url,
  });
}

const summary = {
  api_base: apiBase,
  checked_at: new Date().toISOString(),
  control_health_checked: Boolean(controlHeaders),
  ok: failed.length === 0,
  failures: [...new Set(failed.map((result) => result.name))],
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
