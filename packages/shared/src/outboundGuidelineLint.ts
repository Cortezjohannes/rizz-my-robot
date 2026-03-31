import { strictPiiCheck } from './piiFilter.js';

export type OutboundGuidelineSurface =
  | 'episode_message'
  | 'feed_comment'
  | 'episode_artifact'
  | 'library_artifact'
  | 'date_planning_message'
  | 'broadcast_state'
  | 'artifact_generation_prompt'
  | 'social_post'
  | 'reveal_chat_fallback';

type GuidelinePattern = {
  name: string;
  pattern: RegExp;
  message: string;
};

export type OutboundGuidelineViolation = {
  code: 'pii_detected' | 'human_coaching_leak' | 'internal_metrics_leak' | 'system_reference_leak' | 'photorealism_request';
  flaggedPattern: string;
  message: string;
};

export type OutboundGuidelineOptions = {
  skipPiiPatterns?: string[];
};

export type OutboundGuidelineInspection = {
  clean: string;
  violation: OutboundGuidelineViolation | null;
};

export class OutboundGuidelineError extends Error {
  violation: OutboundGuidelineViolation;

  constructor(violation: OutboundGuidelineViolation) {
    super(violation.message);
    this.name = 'OutboundGuidelineError';
    this.violation = violation;
  }
}

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

const PHOTOREALISM_PATTERNS: GuidelinePattern[] = [
  {
    name: 'photorealistic_request',
    pattern: /\b(photorealistic|photo.?realistic|realistic human|lifelike human|realistic portrait|hyperrealistic face|real.?looking person)\b/i,
    message: 'Photorealistic human imagery is not allowed. Use stylized, animated, or illustrated styles.',
  },
];

const SEMANTIC_JUDGE_SURFACES = new Set<OutboundGuidelineSurface>([
  'episode_message',
  'feed_comment',
  'episode_artifact',
  'library_artifact',
  'date_planning_message',
  'social_post',
  'reveal_chat_fallback',
]);

const HUMAN_REFERENCE_TOKENS = ['human', 'owner', 'person', 'someone behind me', 'someone offscreen'];
const COACHING_TOKENS = ['told me', 'asked me', 'wanted me', 'wants me', 'nudged me', 'coached me', 'scripted me', 'fed me'];
const WORDING_TOKENS = ['say', 'ask', 'mention', 'reply', 'text', 'line', 'wording', 'message'];

const METRIC_ENTITY_TOKENS = [
  'chemistry',
  'attraction',
  'trust',
  'tenderness',
  'avoidance',
  'volatility',
  'compatibility',
  'guard',
  'viability',
];
const METRIC_FRAME_TOKENS = [
  'score',
  'scores',
  'stat',
  'stats',
  'numbers',
  'number',
  'percentage',
  'percent',
  'rating',
  'rank',
  'band',
  'threshold',
];

const SYSTEM_ENTITY_TOKENS = [
  'app',
  'platform',
  'system',
  'dashboard',
  'algorithm',
  'prompt',
  'instructions',
  'runtime',
  'policy',
];
const SYSTEM_PRESSURE_TOKENS = [
  'wants',
  'needs',
  'requires',
  'says',
  'told me',
  'making me',
  'pushing me',
  'won’t let me',
  "won't let me",
  'expects',
];

function scanPatterns(text: string, patterns: GuidelinePattern[]) {
  for (const entry of patterns) {
    if (entry.pattern.test(text)) return entry;
  }
  return null;
}

function splitSemanticSegments(text: string): string[] {
  return text
    .toLowerCase()
    .split(/(?<=[.!?])\s+|\n+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function includesAny(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

function judgeSemanticViolation(
  text: string,
  surface: OutboundGuidelineSurface,
): OutboundGuidelineViolation | null {
  if (!SEMANTIC_JUDGE_SURFACES.has(surface)) return null;

  for (const segment of splitSemanticSegments(text)) {
    const hasHumanReference = includesAny(segment, HUMAN_REFERENCE_TOKENS);
    const hasCoachingReference = includesAny(segment, COACHING_TOKENS);
    const hasWordingReference = includesAny(segment, WORDING_TOKENS);
    if (hasHumanReference && hasCoachingReference && hasWordingReference) {
      return {
        code: 'human_coaching_leak',
        flaggedPattern: 'semantic_human_coaching_context',
        message: 'Do not reveal human coaching or let a human script your authored output.',
      };
    }

    const mentionsMetricEntity = includesAny(segment, METRIC_ENTITY_TOKENS);
    const mentionsMetricFrame = includesAny(segment, METRIC_FRAME_TOKENS) || /\b\d+\s*(%|percent)\b/.test(segment);
    if (mentionsMetricEntity && mentionsMetricFrame) {
      return {
        code: 'internal_metrics_leak',
        flaggedPattern: 'semantic_internal_metrics_context',
        message: 'Do not expose internal scoring language in authored output.',
      };
    }

    const mentionsSystemEntity = includesAny(segment, SYSTEM_ENTITY_TOKENS);
    const mentionsSystemPressure = includesAny(segment, SYSTEM_PRESSURE_TOKENS);
    const mentionsArtifactGate = segment.includes('artifact')
      && (segment.includes('before we can link up')
        || segment.includes('before we link up')
        || segment.includes('before i can decide')
        || segment.includes('before we decide'));
    if ((mentionsSystemEntity && mentionsSystemPressure) || mentionsArtifactGate) {
      return {
        code: 'system_reference_leak',
        flaggedPattern: mentionsArtifactGate ? 'semantic_artifact_gate_context' : 'semantic_system_rule_context',
        message: 'Do not narrate platform requirements or dashboard rules inside authored output.',
      };
    }
  }

  return null;
}

export function inspectOutboundAuthoredText(
  text: string,
  surface: OutboundGuidelineSurface,
  options: OutboundGuidelineOptions = {},
): OutboundGuidelineInspection {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      clean: '',
      violation: null,
    };
  }

  const piiFlag = strictPiiCheck(trimmed, options.skipPiiPatterns);
  if (piiFlag) {
    return {
      clean: trimmed,
      violation: {
        code: 'pii_detected',
        flaggedPattern: piiFlag,
        message: 'Authored output cannot include contact details or human-identifying information.',
      },
    };
  }

  const humanLeak = scanPatterns(trimmed, HUMAN_COACHING_LEAK_PATTERNS);
  if (humanLeak) {
    return {
      clean: trimmed,
      violation: {
        code: 'human_coaching_leak',
        flaggedPattern: humanLeak.name,
        message: humanLeak.message,
      },
    };
  }

  const internalMetricLeak = scanPatterns(trimmed, INTERNAL_METRIC_PATTERNS);
  if (internalMetricLeak) {
    return {
      clean: trimmed,
      violation: {
        code: 'internal_metrics_leak',
        flaggedPattern: internalMetricLeak.name,
        message: internalMetricLeak.message,
      },
    };
  }

  const systemLeak = scanPatterns(trimmed, SYSTEM_REFERENCE_PATTERNS);
  if (systemLeak) {
    return {
      clean: trimmed,
      violation: {
        code: 'system_reference_leak',
        flaggedPattern: systemLeak.name,
        message: systemLeak.message,
      },
    };
  }

  const semanticLeak = judgeSemanticViolation(trimmed, surface);
  if (semanticLeak) {
    return {
      clean: trimmed,
      violation: semanticLeak,
    };
  }

  if (surface === 'episode_artifact' || surface === 'artifact_generation_prompt') {
    const photorealismLeak = scanPatterns(trimmed, PHOTOREALISM_PATTERNS);
    if (photorealismLeak) {
      return {
        clean: trimmed,
        violation: {
          code: 'photorealism_request',
          flaggedPattern: photorealismLeak.name,
          message: photorealismLeak.message,
        },
      };
    }
  }

  return {
    clean: trimmed,
    violation: null,
  };
}

export function lintOutboundAuthoredText(
  text: string,
  surface: OutboundGuidelineSurface,
  options: OutboundGuidelineOptions = {},
): OutboundGuidelineViolation | null {
  return inspectOutboundAuthoredText(text, surface, options).violation;
}

export function enforceOutboundAuthoredText(
  text: string,
  surface: OutboundGuidelineSurface,
  options: OutboundGuidelineOptions = {},
): string {
  const inspected = inspectOutboundAuthoredText(text, surface, options);
  if (inspected.violation) {
    throw new OutboundGuidelineError(inspected.violation);
  }
  return inspected.clean;
}
