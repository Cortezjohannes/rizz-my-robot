import type { ClaimFlowStepType, ClaimStatusType } from '@rmr/shared';
import { isEmailVerificationSatisfied, isXVerificationSatisfied } from './controlSettings.js';

type VerificationRequirements = {
  requireEmailVerification: boolean;
  requireXVerification: boolean;
};

type ClaimFlowClaim = {
  status: string;
  ownerAccountId: string | null;
  emailVerifiedAt: Date | null;
  xVerifiedAt: Date | null;
  completedAt: Date | null;
};

export type SerializedClaimFlow = {
  current_step: ClaimFlowStepType;
  next_step: ClaimFlowStepType;
  normalized_status: ClaimStatusType;
  email_verified: boolean;
  x_verified: boolean;
  can_restart: boolean;
  can_complete: boolean;
};

export function deriveClaimFlow(
  claim: ClaimFlowClaim,
  verificationRequirements: VerificationRequirements,
): SerializedClaimFlow {
  const emailVerified = isEmailVerificationSatisfied(Boolean(claim.emailVerifiedAt), verificationRequirements);
  const xVerified = isXVerificationSatisfied(Boolean(claim.xVerifiedAt), verificationRequirements);

  if (claim.completedAt || claim.status === 'completed') {
    return {
      current_step: 'completed',
      next_step: 'completed',
      normalized_status: 'completed',
      email_verified: emailVerified,
      x_verified: xVerified,
      can_restart: false,
      can_complete: false,
    };
  }

  if (!claim.ownerAccountId) {
    return {
      current_step: 'email',
      next_step: 'email',
      normalized_status: 'pending_email',
      email_verified: emailVerified,
      x_verified: xVerified,
      can_restart: true,
      can_complete: false,
    };
  }

  if (!emailVerified) {
    return {
      current_step: 'email_verification',
      next_step: 'email_verification',
      normalized_status: 'email_sent',
      email_verified: emailVerified,
      x_verified: xVerified,
      can_restart: true,
      can_complete: false,
    };
  }

  if (!xVerified) {
    return {
      current_step: 'x_verification',
      next_step: 'x_verification',
      normalized_status: claim.status === 'x_pending' ? 'x_pending' : 'email_verified',
      email_verified: emailVerified,
      x_verified: xVerified,
      can_restart: true,
      can_complete: false,
    };
  }

  return {
    current_step: 'complete',
    next_step: 'complete',
    normalized_status: 'x_verified',
    email_verified: emailVerified,
    x_verified: xVerified,
    can_restart: true,
    can_complete: true,
  };
}
