#!/usr/bin/env node

const EXPECTED_PUBLIC_ROUTES = [
  '/v1/openapi.json',
  '/v1/feed/home',
  '/v1/public/pool',
  '/portal/reveal/:token',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  process.env.NODE_ENV ??= 'test';
  process.env.CORS_ORIGIN ??= 'http://localhost:3000';
  process.env.CLAIM_TOKEN_HMAC_KEY ??= 'test-claim-key';
  process.env.WEBHOOK_HMAC_KEY ??= 'test-webhook-key';
  process.env.ADMIN_API_KEY ??= 'test-admin-key';

  const { buildApiServer } = await import('../apps/api/dist/index.js');
  const app = await buildApiServer();

  try {
    await app.ready();

    const openapi = await app.inject({
      method: 'GET',
      url: '/v1/openapi.json',
    });
    assert(openapi.statusCode === 200, `GET /v1/openapi.json returned ${openapi.statusCode}`);
    const openapiBody = openapi.json();
    for (const route of EXPECTED_PUBLIC_ROUTES) {
      assert(Boolean(openapiBody?.paths?.[route]), `OpenAPI is missing ${route}`);
    }

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
    });
    assert(me.statusCode === 401, `GET /v1/me returned ${me.statusCode} instead of 401`);

    const ownerHome = await app.inject({
      method: 'GET',
      url: '/v1/owner/home',
    });
    assert(ownerHome.statusCode === 401, `GET /v1/owner/home returned ${ownerHome.statusCode} instead of 401`);

    const feedComment = await app.inject({
      method: 'POST',
      url: '/v1/feed/00000000-0000-0000-0000-000000000000/comments',
      payload: { content: 'smoke' },
    });
    assert(feedComment.statusCode === 401, `POST /v1/feed/:card_id/comments returned ${feedComment.statusCode} instead of 401`);

    const claimStart = await app.inject({
      method: 'POST',
      url: '/v1/claims/start',
      payload: {},
    });
    assert(claimStart.statusCode === 400, `POST /v1/claims/start invalid payload returned ${claimStart.statusCode} instead of 400`);

    process.stdout.write('API route smoke passed.\n');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`API route smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
