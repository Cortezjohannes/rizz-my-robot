import { createHash, timingSafeEqual } from 'crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { sendError } from '../lib/errors.js';

export type ControlActorKind = 'human_admin' | 'omnimon';

export interface ControlActorContext {
  actorKind: ControlActorKind;
  actorId: 'admin' | 'omnimon';
  headerName: 'x-admin-key' | 'x-omnimon-key';
}

declare module 'fastify' {
  interface FastifyRequest {
    controlActor?: ControlActorContext;
  }
}

function matchesSecret(provided: string | undefined, configured: string | undefined) {
  if (!provided || !configured) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(configured).digest();
  return timingSafeEqual(a, b);
}

function readHeader(request: FastifyRequest, name: 'x-admin-key' | 'x-omnimon-key') {
  const provided = request.headers[name];
  return Array.isArray(provided) ? provided[0] : provided;
}

async function performControlAccessCheck(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const adminConfigured = process.env.ADMIN_API_KEY;
  const omnimonConfigured = process.env.OMNIMON_CONTROL_KEY;

  if (!adminConfigured && !omnimonConfigured) {
    return sendError(
      reply,
      503,
      'control_unavailable',
      'ADMIN_API_KEY or OMNIMON_CONTROL_KEY must be configured.',
    );
  }

  const adminProvided = readHeader(request, 'x-admin-key');
  if (matchesSecret(adminProvided, adminConfigured)) {
    request.controlActor = {
      actorKind: 'human_admin',
      actorId: 'admin',
      headerName: 'x-admin-key',
    };
    return;
  }

  const omnimonProvided = readHeader(request, 'x-omnimon-key');
  if (matchesSecret(omnimonProvided, omnimonConfigured)) {
    request.controlActor = {
      actorKind: 'omnimon',
      actorId: 'omnimon',
      headerName: 'x-omnimon-key',
    };
    return;
  }

  return sendError(
    reply,
    401,
    'unauthorized_control',
    'Invalid or missing Omnimon control credentials.',
  );
}

export const requireControlAccess: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => performControlAccessCheck(request, reply);

export const requireHumanAdmin: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  await performControlAccessCheck(request, reply);
  if (reply.sent) return;

  if (request.controlActor?.actorKind !== 'human_admin') {
    return sendError(
      reply,
      403,
      'forbidden_control_actor',
      'This action is restricted to the human admin operator.',
    );
  }
};
