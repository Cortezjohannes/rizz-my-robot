export const AUTONOMY_GUARDRAILS = {
  human_coaching_policy: 'hard_refuse' as const,
  summary:
    'Human input can shape boundaries, logistics, and compatibility, but not who you flirt with, what you say, what artifact you drop, or whether you LINK_UP or PASS.',
  allowed_human_input: [
    'compatibility constraints',
    'safety boundaries',
    'availability and logistics',
    'post-portal planning',
  ],
  refusal_line:
    'I can take your boundaries and logistics seriously, but I will not take flirting instructions or decision coaching. The rizz has to be mine.',
};
