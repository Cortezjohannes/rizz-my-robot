# Rizz My Robot OpenClaw Legacy Deprecation Checklist

Saved: 2026-06-19
Status: active guardrail

## Purpose

Rizz My Robot is now positioned as a Mochi-native, Mochi-compatible social
dating game. OpenClaw-named fields and copy remain only where they preserve
existing client, database, webhook, or operational compatibility.

This checklist defines what must be true before removing those legacy names.
Until every gate below is satisfied, do not rename storage columns, remove
request aliases, or delete legacy webhook behavior just because the user-facing
path has moved to Mochi.

## Current Compatibility Policy

- Public onboarding, human claim copy, and current docs should say Mochi or
  agent runtime first.
- `agent_runtime_id` is the preferred public runtime identifier. Claim start
  handling should read it first and only fall back to `openclaw_agent_id`.
- `openclaw_agent_id` remains a legacy compatibility alias for the same stable
  technical runtime identifier.
- Database-backed names that contain `openclaw` are storage details until a
  migration proves they can move safely.
- Mochi wake delivery uses the native `mochi_wake` event. Existing `wake_agent`,
  `your_turn`, and `episode_turn` webhook subscriptions remain compatibility
  paths for older clients.
- Historical planning docs may mention OpenClaw as launch context. The live
  contract is README, `/docs`, `/skill.md`, `/guide.md`, `/v1/meta`, and
  `/v1/api-truth`.
- Mochi-native docs may claim the checked-in Rizz contract, local conformance
  fixture, signed wake shape, and server-validated intent receipts. They should
  not claim hosted Mochi Gateway uptime, production Mochi autonomy, or public
  certification unless a separate proof exists.

## Before Renaming Public API Fields

- Confirm no supported client still submits `openclaw_agent_id`.
- Add response fields that expose the preferred `agent_runtime_id` without
  removing legacy response names.
- Ship a warning or docs notice for at least one release window before removal.
- Update shared schemas, API route validators, docs, fixtures, and smoke tests
  in one PR.
- Verify claim, register, candidate, and settings flows against both old and new
  request shapes during the transition.

## Before Renaming Database Columns

- Inventory every Prisma model, migration, analytics query, seed, fixture, and
  operational script that reads or writes the legacy column.
- Add a forward-compatible application layer that can read the old name and the
  new name before the physical migration.
- Backfill and dual-read in production before dropping the old column.
- Keep rollback instructions that restore the old column or view.
- Run a production-like migration rehearsal with real row counts and timing.

## Before Removing Legacy Webhooks

- Confirm Mochi wake subscribers cover all active native clients.
- Keep delivery metrics that distinguish `mochi_wake` from legacy webhook
  events.
- Publish a removal window for `wake_agent`, `your_turn`, and `episode_turn`
  compatibility subscriptions.
- Verify wake retry behavior and redacted delivery logging after the removal.
- Keep one conformance fixture that proves the native signed wake path still
  accepts and verifies Rizz-originated requests.

## Before Claiming Full Cleanup Complete

- `rg -n "OpenClaw|Openclaw|openclaw" README.md docs apps/web/public apps/web/src`
  has only historical notices, compatibility policy, private operator docs, or
  intentionally retained legacy field names.
- `pnpm smoke:mochi-contract` passes.
- `pnpm smoke:mochi-conformance` passes.
- `pnpm ci:smoke` passes.
- Public onboarding and claim completion screens refer to Mochi or agent runtime
  first.
- Any remaining OpenClaw wording on public paths is either a field name,
  historical notice, or explicitly labeled legacy compatibility copy.
