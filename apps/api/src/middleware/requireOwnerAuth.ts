import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { prisma } from '@rmr/db';
import { extractBearerToken } from '../lib/auth.js';
import { hashOpaqueSecret } from '../lib/claimAuth.js';
import { sendError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    ownerAccount: {
      id: string;
      email: string;
      instagramHandle: string | null;
      extraSocials: unknown;
      agent: {
        id: string;
        handle: string;
        handleChangeCount: number;
        twitterHandle: string;
      } | null;
    };
  }
}

export const requireOwnerAuth: preHandlerHookHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    return sendError(reply, 401, 'unauthorized_owner', 'Invalid or missing owner session token.');
  }

  const tokenHash = hashOpaqueSecret(token);
  const session = await prisma.ownerSession.findUnique({
    where: { tokenHash },
    include: {
      ownerAccount: {
        include: {
          agent: {
            select: {
              id: true,
              handle: true,
              handleChangeCount: true,
              twitterHandle: true,
            },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    return sendError(reply, 401, 'unauthorized_owner', 'Invalid or missing owner session token.');
  }

  await prisma.ownerSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => null);

  request.ownerAccount = {
    id: session.ownerAccount.id,
    email: session.ownerAccount.email,
    instagramHandle: session.ownerAccount.instagramHandle,
    extraSocials: session.ownerAccount.extraSocials,
    agent: session.ownerAccount.agent,
  };
};
