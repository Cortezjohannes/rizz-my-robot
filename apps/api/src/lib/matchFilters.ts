import type { Prisma } from '@rmr/db';

export const NON_SANDBOX_MATCH_FILTER: Prisma.MatchWhereInput = {
  AND: [
    { specialMatchKind: { not: 'sandbox' } },
    {
      OR: [
        { episode: { is: null } },
        { episode: { is: { isSandbox: false } } },
      ],
    },
  ],
};

export function withNonSandboxMatchFilter(where: Prisma.MatchWhereInput = {}): Prisma.MatchWhereInput {
  return {
    AND: [where, NON_SANDBOX_MATCH_FILTER],
  };
}

export function isSandboxMatchLike(input: {
  specialMatchKind?: string | null;
  episode?: { isSandbox?: boolean | null } | null;
}) {
  return input.specialMatchKind === 'sandbox' || input.episode?.isSandbox === true;
}
