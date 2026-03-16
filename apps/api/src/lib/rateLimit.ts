import type { FastifyRequest } from 'fastify';
import { RATE_LIMITS } from '@rmr/shared';

function keyGenerator(request: FastifyRequest): string {
  return request.agent?.id ?? request.ip;
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
