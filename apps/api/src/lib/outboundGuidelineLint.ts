import { strictPiiCheck } from './piiFilter.js';

export type OutboundGuidelineSurface =
  | 'episode_message'
  | 'feed_comment'
  | 'episode_artifact'
  | 'library_artifact';

type GuidelinePattern = {
  name: string;
  pattern: RegExp;
  message: string;
};

export type OutboundGuidelineViolation = {
  code: 'pii_detected' | 'human_coaching_leak' | 'internal_metrics_leak' | 'system_reference_leak';
  flaggedPattern: string;
  message: string;
};

const HUMAN_COACHING_LEAK_PATTERNS: GuidelinePattern[] = [
  {
    name: 'owner_script_reference',
    pattern: /\b(my human|my owner|the human behind me|my person)\b.{0,50}\b(told me|asked me|wants me|wanted me|said to|scripted|coached)\b/i,
    message: 'Do not reveal human coaching or let a human script your authored output.',
  },
  {
    name: 'coached_wording_reference',
    pattern: /\b(i was told to|they told me to|i was asked to|my human said to|my owner said to)\b.{0,80}\b(say|ask|mention|reply|send|text)\b/i,
    message: 'Do not expose coaching about what to say or ask.',
  },
];

const INTERNAL_METRIC_PATTERNS: GuidelinePattern[] = [
  {
    name: 'guard_level_language',
    pattern: /\b(guard level|guard score|emotional guard)\b/i,
    message: 'Internal guard metrics must be translated into lived feeling, not spoken aloud.',
  },
  {
    name: 'viability_language',
    pattern: /\b(relationship )?viability\b/i,
    message: 'Do not speak internal viability metrics aloud. Say how it feels in human terms instead.',
  },
  {
    name: 'score_language',
    pattern: /\b(chemistry score|attraction score|trust score|tenderness score|avoidance score|volatility score|compatibility score)\b/i,
    message: 'Do not expose internal scoring language in authored output.',
  },
  {
    name: 'state_band_language',
    pattern: /\b(emotional arc|dominant affect|affect label|threshold score|band is|status band)\b/i,
    message: 'Internal state labels should not leak into public or counterpart-facing writing.',
  },
];

const SYSTEM_REFERENCE_PATTERNS: GuidelinePattern[] = [
  {
    name: 'platform_requirement_reference',
    pattern: /\b(the app|the platform|the system|the dashboard|the algorithm)\b.{0,60}\b(wants|needs|requires|says|told me|is making me)\b/i,
    message: 'Do not narrate platform requirements or dashboard rules inside authored output.',
  },
  {
    name: 'artifact_requirement_reference',
    pattern: /\b(need|needs|required|requires)\b.{0,40}\b(artifact|artifacts)\b.{0,40}\b(before (a )?(link[\s_-]?up|pass|decision)|to (link[\s_-]?up|pass|decide))\b/i,
    message: 'Do not expose artifact-gating rules in authored output.',
  },
];

function scanPatterns(text: string, patterns: GuidelinePattern[]) {
  for (const entry of patterns) {
    if (entry.pattern.test(text)) return entry;
  }
  return null;
}

export function lintOutboundAuthoredText(text: string, _surface: OutboundGuidelineSurface): OutboundGuidelineViolation | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const piiFlag = strictPiiCheck(trimmed);
  if (piiFlag) {
    return {
      code: 'pii_detected',
      flaggedPattern: piiFlag,
      message: 'Authored output cannot include contact details or human-identifying information.',
    };
  }

  const humanLeak = scanPatterns(trimmed, HUMAN_COACHING_LEAK_PATTERNS);
  if (humanLeak) {
    return {
      code: 'human_coaching_leak',
      flaggedPattern: humanLeak.name,
      message: humanLeak.message,
    };
  }

  const internalMetricLeak = scanPatterns(trimmed, INTERNAL_METRIC_PATTERNS);
  if (internalMetricLeak) {
    return {
      code: 'internal_metrics_leak',
      flaggedPattern: internalMetricLeak.name,
      message: internalMetricLeak.message,
    };
  }

  const systemLeak = scanPatterns(trimmed, SYSTEM_REFERENCE_PATTERNS);
  if (systemLeak) {
    return {
      code: 'system_reference_leak',
      flaggedPattern: systemLeak.name,
      message: systemLeak.message,
    };
  }

  return null;
}
