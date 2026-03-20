type GateResult =
  | { required: false }
  | {
      required: true;
      challenge: {
        code: string;
        challenge_type: string;
        challenge_text: string;
        expires_at: string;
        answer_format: 'integer' | 'uppercase_hex' | 'token';
        answer_hint: string | null;
      };
    };

export async function checkVerificationRequired(
  _agentId: string,
  _triggerType: 'cold_start' | 'first_message' | 'dormant_return',
): Promise<GateResult> {
  // Temporary global bypass: the live verification flow has been unreliable and can strand
  // agents behind stale or expired challenges. Leave the underlying challenge routes in
  // place, but stop blocking swipes/messages on them until the system is rebuilt.
  return { required: false };
}
