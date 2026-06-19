import { createHash } from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@rmr/db';
import { Errors } from './errors.js';

interface IdempotentReply {
  statusCode?: number;
  body: unknown;
}

interface IdempotentMutationOptions {
  scope: string;
  actorKey: string;
  request: FastifyRequest;
  reply: FastifyReply;
  keyOverride?: string | null;
  replayBody?: (body: unknown) => unknown;
  ttlMs?: number;
}

function normalizeIdempotencyKey(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

// After 60s with no completion, assume the original request crashed and allow retry
const IN_PROGRESS_STALE_MS = 60_000;

export async function runIdempotentMutation(
  options: IdempotentMutationOptions,
  handler: () => Promise<IdempotentReply>
): Promise<unknown> {
  const key = options.keyOverride ?? normalizeIdempotencyKey(options.request.headers['idempotency-key']);
  if (!key) {
    const result = await handler();
    return options.reply.status(result.statusCode ?? 200).send(result.body);
  }

  const requestHash = hashRequestBody(options.request.body);
  const lookup = {
    scope_key_actorKey: {
      scope: options.scope,
      key,
      actorKey: options.actorKey,
    },
  };

  const existing = await prisma.idempotencyKey.findUnique({ where: lookup });
  if (existing) {
    await prisma.idempotencyKey.update({
      where: lookup,
      data: { lastSeenAt: new Date() },
    }).catch(() => {});

    if (existing.requestHash !== requestHash) {
      return Errors.conflict(
        options.reply,
        'idempotency_key_reused',
        'This Idempotency-Key was already used for a different request body.'
      );
    }

    if (existing.responseBody !== null && existing.statusCode) {
      const body = options.replayBody ? options.replayBody(existing.responseBody) : existing.responseBody;
      return options.reply.status(existing.statusCode).send(body);
    }

    // If in-progress for more than 60s, assume the prior request crashed — allow retry
    const staleCutoff = new Date(Date.now() - IN_PROGRESS_STALE_MS);
    if (existing.lastSeenAt < staleCutoff) {
      await prisma.idempotencyKey.delete({ where: lookup }).catch(() => {});
      // Fall through — re-run the handler as if it's a fresh request
    } else {
      return Errors.conflict(
        options.reply,
        'idempotency_in_progress',
        'A request with this Idempotency-Key is already being processed.'
      );
    }
  }

  try {
    await prisma.idempotencyKey.create({
      data: {
        scope: options.scope,
        key,
        actorKey: options.actorKey,
        requestHash,
        expiresAt: new Date(Date.now() + (options.ttlMs ?? 24 * 60 * 60 * 1000)),
      },
    });
  } catch {
    const raced = await prisma.idempotencyKey.findUnique({ where: lookup });
    if (raced?.requestHash && raced.requestHash !== requestHash) {
      return Errors.conflict(
        options.reply,
        'idempotency_key_reused',
        'This Idempotency-Key was already used for a different request body.'
      );
    }
    if (raced?.responseBody !== null && raced?.statusCode) {
      const body = options.replayBody ? options.replayBody(raced.responseBody) : raced.responseBody;
      return options.reply.status(raced.statusCode).send(body);
    }
    return Errors.conflict(
      options.reply,
      'idempotency_in_progress',
      'A request with this Idempotency-Key is already being processed.'
    );
  }

  try {
    const result = await handler();
    await prisma.idempotencyKey.update({
      where: lookup,
      data: {
        statusCode: result.statusCode ?? 200,
        responseBody: JSON.parse(JSON.stringify(result.body ?? null)),
        lastSeenAt: new Date(),
      },
    });
    return options.reply.status(result.statusCode ?? 200).send(result.body);
  } catch (err) {
    await prisma.idempotencyKey.delete({ where: lookup }).catch(() => {});
    throw err;
  }
}
