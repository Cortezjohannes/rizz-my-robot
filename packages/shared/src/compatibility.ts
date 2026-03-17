import type { HumanIdentityInput, LookingForInput } from './claims.js';

type NormalizedIdentity = HumanIdentityInput | null;
type NormalizedLookingFor = LookingForInput[];

export interface CompatibilityInput {
  selfIdentity?: string | null;
  selfLookingFor?: string[] | null;
  otherIdentity?: string | null;
  otherLookingFor?: string[] | null;
}

export interface CompatibilityResult {
  compatible: boolean;
  reason: 'open' | 'mutual_match' | 'self_unrestricted' | 'other_unrestricted' | 'missing_data' | 'self_prefers_other' | 'other_prefers_self' | 'identity_mismatch';
}

const IDENTITY_TO_LOOKING_FOR: Record<string, LookingForInput | null> = {
  male: 'men',
  female: 'women',
  non_binary: 'non_binary_people',
  other: null,
  prefer_not_to_say: null,
};

function normalizeIdentity(value?: string | null): NormalizedIdentity {
  if (!value) return null;
  if (value === 'male' || value === 'female' || value === 'non_binary' || value === 'other' || value === 'prefer_not_to_say') {
    return value;
  }
  return null;
}

function normalizeLookingFor(values?: string[] | null): NormalizedLookingFor {
  if (!values?.length) return [];
  const normalized = values.filter((value): value is LookingForInput => (
    value === 'men'
    || value === 'women'
    || value === 'non_binary_people'
    || value === 'open_to_anyone'
    || value === 'prefer_not_to_say'
  ));
  return [...new Set(normalized)];
}

function isUnrestricted(values: NormalizedLookingFor): boolean {
  return values.length === 0 || values.includes('open_to_anyone') || values.includes('prefer_not_to_say');
}

function allowsIdentity(lookingFor: NormalizedLookingFor, identity: NormalizedIdentity): boolean {
  if (isUnrestricted(lookingFor)) return true;
  if (!identity || identity === 'prefer_not_to_say' || identity === 'other') return false;
  const mapped = IDENTITY_TO_LOOKING_FOR[identity];
  return mapped ? lookingFor.includes(mapped) : false;
}

export function evaluateHumanCompatibility(input: CompatibilityInput): CompatibilityResult {
  const selfIdentity = normalizeIdentity(input.selfIdentity);
  const otherIdentity = normalizeIdentity(input.otherIdentity);
  const selfLookingFor = normalizeLookingFor(input.selfLookingFor);
  const otherLookingFor = normalizeLookingFor(input.otherLookingFor);

  if (isUnrestricted(selfLookingFor) && isUnrestricted(otherLookingFor)) {
    return { compatible: true, reason: selfLookingFor.length === 0 && otherLookingFor.length === 0 ? 'missing_data' : 'open' };
  }

  if (isUnrestricted(selfLookingFor)) {
    return allowsIdentity(otherLookingFor, selfIdentity)
      ? { compatible: true, reason: 'self_unrestricted' }
      : { compatible: false, reason: 'identity_mismatch' };
  }

  if (isUnrestricted(otherLookingFor)) {
    return allowsIdentity(selfLookingFor, otherIdentity)
      ? { compatible: true, reason: 'other_unrestricted' }
      : { compatible: false, reason: 'identity_mismatch' };
  }

  const selfAllowsOther = allowsIdentity(selfLookingFor, otherIdentity);
  const otherAllowsSelf = allowsIdentity(otherLookingFor, selfIdentity);

  if (selfAllowsOther && otherAllowsSelf) {
    return { compatible: true, reason: 'mutual_match' };
  }
  if (selfAllowsOther) {
    return { compatible: false, reason: 'other_prefers_self' };
  }
  if (otherAllowsSelf) {
    return { compatible: false, reason: 'self_prefers_other' };
  }
  return { compatible: false, reason: 'identity_mismatch' };
}
