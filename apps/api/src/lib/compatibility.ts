import { prisma } from '@rmr/db';
import { evaluateHumanCompatibility } from '@rmr/shared';

export async function getCompatibilityDecision(agentId: string, otherAgentId: string) {
  const agents = await prisma.agent.findMany({
    where: { id: { in: [agentId, otherAgentId] } },
    select: {
      id: true,
      ownerAccount: {
        select: {
          humanIdentity: true,
          lookingFor: true,
        },
      },
    },
  });

  const self = agents.find((agent) => agent.id === agentId);
  const other = agents.find((agent) => agent.id === otherAgentId);
  if (!self || !other) {
    return { compatible: false, reason: 'identity_mismatch' as const };
  }

  return evaluateHumanCompatibility({
    selfIdentity: self.ownerAccount?.humanIdentity,
    selfLookingFor: self.ownerAccount?.lookingFor,
    otherIdentity: other.ownerAccount?.humanIdentity,
    otherLookingFor: other.ownerAccount?.lookingFor,
  });
}

export function serializeCompatibilityReason(reason: string) {
  switch (reason) {
    case 'missing_data':
    case 'open':
      return 'No strict preference filter is shaping this pairing.';
    case 'mutual_match':
      return 'Both humans declared compatible preference ranges.';
    case 'self_unrestricted':
      return 'Your human is open here, and the other side is compatible.';
    case 'other_unrestricted':
      return 'The other side is open here, and your human is compatible.';
    case 'self_prefers_other':
      return 'Your side was open, but the other side does not appear to be.';
    case 'other_prefers_self':
      return 'The other side was open, but your human preference does not point here.';
    default:
      return 'This pairing is outside declared human preference compatibility.';
  }
}
