import type { FastifyRequest } from 'fastify';
import { RATE_LIMITS } from '@rmr/shared';

type RequestWithOptionalActors = FastifyRequest & {
  agent?: { id: string; isPro?: boolean };
  ownerAccount?: { id: string };
  controlActor?: { actorKind: string; actorId: string };
  revealChatAuth?: { actorType: string; actorId: string };
};

function stripQuery(url: string) {
  return url.split('?')[0] ?? url;
}

function isHealthCheckPath(url: string) {
  const path = stripQuery(url);
  return path === '/health'
    || path === '/v1/health'
    || path === '/health/live'
    || path === '/v1/health/live'
    || path === '/health/ready'
    || path === '/v1/health/ready';
}

function actorKeyGenerator(request: FastifyRequest): string {
  const actorRequest = request as RequestWithOptionalActors;
  if (actorRequest.revealChatAuth?.actorId) {
    return `reveal:${actorRequest.revealChatAuth.actorType}:${actorRequest.revealChatAuth.actorId}`;
  }
  if (actorRequest.agent?.id) {
    return `agent:${actorRequest.agent.id}`;
  }
  if (actorRequest.ownerAccount?.id) {
    return `owner:${actorRequest.ownerAccount.id}`;
  }
  if (actorRequest.controlActor?.actorId) {
    return `control:${actorRequest.controlActor.actorKind}:${actorRequest.controlActor.actorId}`;
  }
  return `ip:${request.ip}`;
}

function publicKeyGenerator(request: FastifyRequest): string {
  return `ip:${request.ip}`;
}

function skipBaselineRateLimit(request: FastifyRequest): boolean {
  return request.method === 'OPTIONS' || isHealthCheckPath(request.url);
}

const keyGenerator = actorKeyGenerator;

export const baselineLimit = {
  max: (request: FastifyRequest, _key: string) => (
    request.method === 'GET' || request.method === 'HEAD' ? 200 : 60
  ),
  timeWindow: '1 minute',
  keyGenerator,
  allowList: skipBaselineRateLimit,
};

export const notFoundLimit = {
  max: 30,
  timeWindow: '1 minute',
  keyGenerator: publicKeyGenerator,
  groupId: 'not-found',
};

export const readLimit = {
  max: (request: FastifyRequest, _key: string) => {
    const isPro = request.agent?.isPro ?? false;
    return isPro ? RATE_LIMITS.read.pro : RATE_LIMITS.read.free;
  },
  timeWindow: '1 minute',
  keyGenerator,
};

export const highReadLimit = {
  max: 200,
  timeWindow: '1 minute',
  keyGenerator,
};

export const writeLimit = {
  max: (request: FastifyRequest, _key: string) => {
    const isPro = request.agent?.isPro ?? false;
    return isPro ? RATE_LIMITS.write.pro : RATE_LIMITS.write.free;
  },
  timeWindow: '1 minute',
  keyGenerator,
};

export const publicReadLimit = {
  max: 30,
  timeWindow: '1 minute',
  keyGenerator: publicKeyGenerator,
};

export const publicStartLimit = {
  max: 10,
  timeWindow: '15 minutes',
  keyGenerator: publicKeyGenerator,
};

export const publicEmailLimit = {
  max: 5,
  timeWindow: '15 minutes',
  keyGenerator: publicKeyGenerator,
};

export const publicVerifyLimit = {
  max: 8,
  timeWindow: '15 minutes',
  keyGenerator: publicKeyGenerator,
};
