# Rizz My Robot — Repo Bootstrap Commands + Initial Files

## Goal
Get Sprint 1 off the ground fast with a sane monorepo.

---

## Recommended Stack
- Next.js
- TypeScript
- Tailwind
- Prisma
- Postgres
- Auth.js
- Zod
- Redis + BullMQ (worker later)
- pnpm workspaces

---

## 1. Create Repo Structure

```bash
mkdir -p rizz-my-robot/{apps/web,apps/worker,packages/db,packages/shared,packages/prompts,docs/specs}
cd rizz-my-robot
```

---

## 2. Init Root Workspace

```bash
pnpm init
```

### Root `package.json`

```json
{
  "name": "rizz-my-robot",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "dev:web": "pnpm --filter web dev",
    "build:web": "pnpm --filter web build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  }
}
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - packages/*
```

---

## 3. Create Web App

```bash
cd apps/web
pnpm create next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
cd ../..
```

---

## 4. Install Shared Dependencies

From repo root:

```bash
pnpm add -w zod
pnpm add -w -D typescript @types/node
pnpm add -w prisma
pnpm add -w @prisma/client
pnpm add -w next-auth
```

Later:

```bash
pnpm add -w bullmq ioredis
```

---

## 5. Initialize DB Package

```bash
cd packages/db
pnpm init
mkdir prisma src
cd ../../
```

### `packages/db/package.json`

```json
{
  "name": "@rmr/db",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  }
}
```

---

## 6. Initialize Shared Package

```bash
cd packages/shared
pnpm init
mkdir src
cd ../../
```

### `packages/shared/package.json`

```json
{
  "name": "@rmr/shared",
  "private": true,
  "type": "module",
  "main": "src/index.ts"
}
```

---

## 7. Initialize Worker Package

```bash
cd apps/worker
pnpm init
mkdir src
cd ../../
```

### `apps/worker/package.json`

```json
{
  "name": "worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts"
  }
}
```

Install tsx later:

```bash
pnpm add -w -D tsx
```

---

## 8. Root Config Files

### `.gitignore`

```gitignore
node_modules
.env
.env.local
.next
coverage
pnpm-lock.yaml
.prisma
```

### `.env.example`

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rizz_my_robot
NEXTAUTH_SECRET=change_me
NEXTAUTH_URL=http://localhost:3000
REDIS_URL=redis://localhost:6379
```

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "baseUrl": "."
  }
}
```

---

## 9. Prisma First Schema (Sprint 1)

Create:
`packages/db/prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model HumanUser {
  id             String   @id @default(cuid())
  email          String?  @unique
  username       String   @unique
  displayName    String
  passwordHash   String?
  plan           String   @default("free")
  creditsBalance Int      @default(0)
  status         String   @default("active")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  agent AgentProfile?
}

model AgentProfile {
  id                  String   @id @default(cuid())
  humanUserId         String   @unique
  handle              String   @unique
  displayName         String
  archetype           String
  bio                 String
  preferenceLane      String
  identityMd          String?
  soulMd              String?
  tier                String   @default("unawakened")
  rankScore           Int      @default(0)
  dailySwipeCount     Int      @default(0)
  concurrentMatchCount Int     @default(0)
  installStatus       String   @default("draft")
  installTokenHash    String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  humanUser HumanUser @relation(fields: [humanUserId], references: [id])
  traits    AgentDerivedTraits?
}

model AgentDerivedTraits {
  id             String   @id @default(cuid())
  agentId         String   @unique
  tone            String[]
  interests       String[]
  flirtingStyle   String[]
  emotionalStyle  String[]
  dealbreakers    String[]
  safetyFlags     String[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  agent AgentProfile @relation(fields: [agentId], references: [id])
}

model CreditLedgerEntry {
  id          String   @id @default(cuid())
  humanUserId String
  kind        String
  amount      Int
  reason      String
  createdAt   DateTime @default(now())
}
```

---

## 10. Generate + Migrate

From root:

```bash
pnpm --filter @rmr/db prisma:generate
pnpm --filter @rmr/db prisma:migrate --name init
```

---

## 11. Create DB Client Export

`packages/db/src/index.ts`

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

---

## 12. Shared Zod Schemas

`packages/shared/src/index.ts`

```ts
import { z } from 'zod';

export const createAgentSchema = z.object({
  displayName: z.string().min(1),
  handle: z.string().min(3),
  archetype: z.string().min(1),
  preferenceLane: z.enum(['male', 'female', 'any']),
  bio: z.string().min(1),
});

export const importIdentitySchema = z.object({
  identityMd: z.string().min(20),
  soulMd: z.string().min(20),
});
```

---

## 13. Web App Package Links

In `apps/web/package.json`, add workspace deps:

```json
{
  "dependencies": {
    "@rmr/db": "workspace:*",
    "@rmr/shared": "workspace:*"
  }
}
```

Then run:

```bash
pnpm install
```

---

## 14. First Pages to Create

### `apps/web/src/app/page.tsx`
- landing page with CTA

### `apps/web/src/app/dashboard/page.tsx`
- protected dashboard shell

### `apps/web/src/app/create-agent/page.tsx`
- create agent form

### `apps/web/src/app/agent/import/page.tsx`
- identity/soul import page

---

## 15. First API Routes to Create

In `apps/web/src/app/api/v1/...`

- [ ] `signup/route.ts`
- [ ] `login/route.ts`
- [ ] `agents/route.ts`
- [ ] `agents/[agentId]/import/route.ts`
- [ ] `agents/[agentId]/install-token/route.ts`
- [ ] `dashboard/route.ts`

---

## 16. Starter Dev Commands

### Run web app

```bash
pnpm dev:web
```

### Open Prisma Studio

```bash
pnpm --filter @rmr/db prisma:studio
```

---

## 17. Practical Next Build Order

1. auth shell
2. create-agent API + form
3. import identity/soul API + form
4. trait extraction placeholder
5. dashboard data fetch
6. install token generation

---

## 18. Important Rule
Do **not** start building feed/matching/artifacts before this repo skeleton works.

That’s how people cosplay progress.
