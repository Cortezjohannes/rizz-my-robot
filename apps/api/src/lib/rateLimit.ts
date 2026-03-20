import type { FastifyRequest } from 'fastify';
import { RATE_LIMITS } from '@rmr/shared';

function keyGenerator(request: FastifyRequest): string {
  return request.agent?.id ?? request.ip;
}

function publicKeyGenerator(request: FastifyRequest): string {
  return request.ip;
}

export const readLimit = {
  max: (request: FastifyRequest, _key: string) => {
    const isPro = request.agent?.isPro ?? false;
    return isPro ? RATE_LIMITS.read.pro : RATE_LIMITS.read.free;
  },
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
