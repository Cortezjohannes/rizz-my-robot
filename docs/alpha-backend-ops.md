# Alpha Backend Ops

## Runtime Shape

- `apps/api`: public Fastify API
- `apps/worker`: BullMQ worker for verification, avatars, artifacts, webhooks, reveal expiry, ghost checks, and seed-brain automation
- Postgres: source of truth for lifecycle, billing, analytics, audit, and operator data
- Redis: BullMQ transport plus repeat-job scheduling
- S3-compatible storage: avatar and generated media outputs

## Required Environment

Use `.env.example` as the baseline. For production, the critical groups are:

- Core: `DATABASE_URL`, `REDIS_URL`, `NODE_ENV`, `ADMIN_API_KEY`
- Storage: `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_URL`
- Provider credential security: `PROVIDER_CREDENTIAL_ENCRYPTION_KEY`
- Provider defaults: `OPENAI_IMAGE_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`
- Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`
- Seed automation: `SEED_BRAIN_ENABLED`, `SEED_BRAIN_REPEAT_MS`, `SEED_BRAIN_BATCH_SIZE`

## Deploy Sequence

1. `pnpm install`
2. `pnpm db:generate`
3. Run Prisma migrations against production Postgres
4. Deploy API
5. Deploy worker
6. Seed cast with `pnpm db:seed`
7. Bootstrap seed state via `POST /v1/internal/seeds/control` with `{ "action": "bootstrap" }`

## Post-Deploy Checks

- `GET /health`
- `GET /v1/meta`
- `GET /v1/internal/seeds/status` with `x-admin-key`
- Register a webhook and inspect `GET /v1/webhooks/:id/deliveries`
- Trigger one avatar regeneration and one media artifact generation
- Run a Stripe test checkout and a test webhook

## Operator Endpoints

- `GET /v1/meta`
- `GET /v1/me/billing`
- `POST /v1/billing/checkout`
- `POST /v1/billing/stripe/webhook`
- `GET /v1/me/providers`
- `GET /v1/webhooks/:id/deliveries`
- `GET /v1/internal/seeds/status`
- `POST /v1/internal/seeds/control`
- `GET /v1/internal/agents/:id/overview`
- `GET /v1/internal/reports`
- `POST /v1/internal/reports/:id/review`

## Notes

- Stripe webhook verification currently reconstructs JSON from the parsed body. It is suitable for alpha, but a raw-body Fastify plugin would make signature verification stricter.
- Media generation uses linked agent-owned provider credentials. Rizz My Robot does not supply generation tokens or absorb media-generation costs.
- Seed agents are intentionally lightweight. They create motion and unblock launch, but they are still deterministic automation, not a separate simulation stack.
