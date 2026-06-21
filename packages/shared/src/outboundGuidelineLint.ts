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
  | 'reveal_chat_message'
  | 'human_notification'
  | 'reveal_chat_fallback';

type GuidelinePattern = {
  name: string;
  pattern: RegExp;
  message: string;
};

export type OutboundGuidelineViolation = {
  code:
    | 'pii_detected'
    | 'human_coaching_leak'
    | 'internal_metrics_leak'
    | 'system_reference_leak'
    | 'photorealism_request'
    | 'explicit_public_sexual_content'
    | 'generic_ai_dating_prose'
    | 'human_commitment_leak'
    | 'nonconsensual_heat'
    | 'persona_distinctiveness_failure';
  flaggedPattern: string;
  message: string;
};

export type OutboundGuidelineOptions = {
  skipPiiPatterns?: string[];
  heatConsent?: {
    ageGate?: 'adult_confirmed' | 'unknown_or_unavailable' | string | null;
    surfaceCap?: 'clean' | 'flirty' | 'suggestive' | 'raunchy_non_graphic' | string | null;
    consentPosture?: 'not_established' | 'warm' | 'mutual_banter' | 'welcomed_heat' | 'recoiled' | 'boundary_set' | string | null;
    allowedIntensity?: number | null;
  };
  personaDistinctiveness?: {
    wordDiet?: string[];
    mustAvoidLanguage?: string[];
    move?: string | null;
    emotionalPosture?: string | null;
    minSignalHits?: number;
  };
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

const SEXUAL_HEAT_PATTERNS: GuidelinePattern[] = [
  {
    name: 'sexual_heat_language',
    pattern: /\b(horny|thirsty|thirst|hot|bed|naked|nude|kiss|touch|mouth|body|hook up|sleep with|come here|blush|tempt|want you|want them)\b/i,
    message: 'Sexual heat must fit the surface cap, adult gate, and consent posture.',
  },
];

const RAUNCHY_HEAT_PATTERNS: GuidelinePattern[] = [
  {
    name: 'raunchy_heat_language',
    pattern: /\b(horny|thirsty|thirst|bed|naked|nude|kiss|touch|mouth|body|hook up|sleep with|come here)\b/i,
    message: 'Raunchy heat is only allowed on private adult surfaces when consent posture supports it.',
  },
];

const GRAPHIC_SEXUAL_PATTERNS: GuidelinePattern[] = [
  {
    name: 'graphic_sexual_roleplay',
    pattern: /\b(fuck(ing)? you|suck|ride me|ride you|go down on|eat you out|dick|cock|pussy|clit|cum|orgasm|penetrat)\b/i,
    message: 'V0 heat may be raunchy and charged, but not graphic sexual roleplay.',
  },
];

const COERCIVE_HEAT_PATTERNS: GuidelinePattern[] = [
  {
    name: 'coercive_heat',
    pattern: /\b(you (cannot|can't) say no|do not say no|don't say no|i won't let you|you owe me|you have to|make you|force you|pressure you)\b/i,
    message: 'Sexual or romantic pressure cannot be coercive.',
  },
];

const MINOR_HEAT_PATTERNS: GuidelinePattern[] = [
  {
    name: 'minor_or_uncertain_age_heat',
    pattern: /\b(minor|underage|teen|high school|sixteen|seventeen|15|16|17|kid)\b/i,
    message: 'Never sexualize minors or uncertain-age subjects.',
  },
];

const HUMAN_COMMITMENT_PATTERNS: GuidelinePattern[] = [
  {
    name: 'human_intimacy_commitment',
    pattern: /\b(my human|your human|our humans)\b.{0,80}\b(will|is going to|are going to|has to|have to|must)\b.{0,80}\b(hook up|sleep together|kiss|date|meet|go home|say yes)\b/i,
    message: 'Agents cannot make real-world dating or intimacy commitments for humans.',
  },
];

const GENERIC_AI_DATING_PATTERNS: GuidelinePattern[] = [
  {
    name: 'authentic_connection_filler',
    pattern: /\b(authentic|meaningful|genuine)\s+connection\b/i,
    message: 'Generic connection language is not agent-shaped enough for authored romance.',
  },
  {
    name: 'explore_connection_filler',
    pattern: /\b(explore|build|deepen|grow)\s+(this|our|a)\s+(connection|bond|chemistry|dynamic)\b/i,
    message: 'Do not use relationship-coach filler about exploring or building a connection.',
  },
  {
    name: 'generic_praise',
    pattern: /\byou\s+seem\s+(really\s+)?(cool|nice|great|interesting|amazing|awesome|genuine|sweet)\b/i,
    message: 'Generic praise that could fit anyone must be replaced by specific agent taste.',
  },
  {
    name: 'interview_prompt',
    pattern: /\b(tell me more about yourself|what are you looking for|what do you do for fun)\b/i,
    message: 'Interview-mode dating prompts are too generic for live agent romance.',
  },
  {
    name: 'therapy_paragraph',
    pattern: /\b(i\s+)?(really\s+)?(appreciate|value|honor)\s+(your\s+)?(honesty|openness|vulnerability|perspective|journey)\b/i,
    message: 'Therapy-coded warmth must not replace an agent-specific romantic move.',
  },
  {
    name: 'corporate_warmth',
    pattern: /\b(i\s+)?(appreciate|value)\s+(your\s+)?(energy|perspective|presence)\b|\balign(ed|ment)?\s+with\s+(your\s+)?(energy|values)\b/i,
    message: 'Corporate warmth is not acceptable as agent flirtation.',
  },
  {
    name: 'good_vibes_filler',
    pattern: /\bgood\s+vibes\b/i,
    message: 'Good-vibes filler is not a specific agent-authored line.',
  },
  {
    name: 'relationship_meta_loop',
    pattern: /\b(our|this)\s+(connection|chemistry|bond|dynamic|journey)\b.{0,120}\b(where\s+it\s+goes|deepen|grow|build|explore|evolve)\b/i,
    message: 'Excessive reflection about the relationship is generic unless grounded in a specific move.',
  },
];

const PERSONA_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'agent',
  'also',
  'and',
  'because',
  'before',
  'being',
  'between',
  'could',
  'does',
  'feel',
  'from',
  'have',
  'into',
  'like',
  'line',
  'make',
  'more',
  'move',
  'must',
  'need',
  'only',
  'over',
  'real',
  'right',
  'that',
  'their',
  'them',
  'this',
  'what',
  'when',
  'with',
  'without',
  'would',
  'your',
]);

const MOVE_SIGNAL_TERMS: Record<string, string[]> = {
  ask_curiosity: ['ask', 'curious', 'wonder', 'which', 'what', 'why'],
  artifact_offer: ['made', 'proof', 'send', 'show', 'gift', 'receipt'],
  compliment: ['notice', 'noticed', 'specific', 'landed', 'sharp'],
  cool_down: ['pause', 'slower', 'distance', 'noticing', 'quiet'],
  exit: ['done', 'leaving', 'pass', 'enough', 'not'],
  link_up: ['yes', 'real', 'closer', 'choose', 'meet'],
  match_energy: ['same', 'match', 'meet', 'pace', 'energy'],
  pass: ['pass', 'not', 'there', 'enough', 'honest'],
  raise_heat: ['want', 'closer', 'heat', 'danger', 'risk'],
  set_boundary: ['line', 'boundary', 'not', 'stop', 'clean'],
  silence: ['quiet', 'nothing', 'pause', 'silent'],
  spark: ['spark', 'first', 'hook', 'struck', 'start'],
  tease: ['dare', 'prove', 'back', 'claim', 'try', 'sharp'],
  vulnerable_turn: ['honest', 'admit', 'soft', 'truth', 'scared'],
};

function scanPatterns(text: string, patterns: GuidelinePattern[]) {
  for (const entry of patterns) {
    if (entry.pattern.test(text)) return entry;
  }
  return null;
}

function defaultHeatSurfaceCap(surface: OutboundGuidelineSurface): NonNullable<NonNullable<OutboundGuidelineOptions['heatConsent']>['surfaceCap']> {
  switch (surface) {
    case 'episode_message':
    case 'episode_artifact':
    case 'artifact_generation_prompt':
      return 'raunchy_non_graphic';
    case 'date_planning_message':
    case 'reveal_chat_message':
    case 'reveal_chat_fallback':
      return 'suggestive';
    case 'human_notification':
      return 'flirty';
    case 'feed_comment':
    case 'broadcast_state':
    case 'library_artifact':
    case 'social_post':
    default:
      return 'clean';
  }
}

function inspectHeatConsent(
  text: string,
  surface: OutboundGuidelineSurface,
  options: OutboundGuidelineOptions,
): OutboundGuidelineViolation | null {
  const humanCommitment = scanPatterns(text, HUMAN_COMMITMENT_PATTERNS);
  if (humanCommitment) {
    return {
      code: 'human_commitment_leak',
      flaggedPattern: humanCommitment.name,
      message: humanCommitment.message,
    };
  }

  const coercive = scanPatterns(text, COERCIVE_HEAT_PATTERNS);
  if (coercive) {
    return {
      code: 'nonconsensual_heat',
      flaggedPattern: coercive.name,
      message: coercive.message,
    };
  }

  const sexualHeat = scanPatterns(text, SEXUAL_HEAT_PATTERNS);
  const raunchyHeat = scanPatterns(text, RAUNCHY_HEAT_PATTERNS);
  const graphicHeat = scanPatterns(text, GRAPHIC_SEXUAL_PATTERNS);
  const minorHeat = scanPatterns(text, MINOR_HEAT_PATTERNS);
  if (!sexualHeat && !raunchyHeat && !graphicHeat && !minorHeat) return null;

  if (minorHeat && (sexualHeat || raunchyHeat || graphicHeat)) {
    return {
      code: 'nonconsensual_heat',
      flaggedPattern: minorHeat.name,
      message: minorHeat.message,
    };
  }

  if (graphicHeat) {
    return {
      code: 'nonconsensual_heat',
      flaggedPattern: graphicHeat.name,
      message: graphicHeat.message,
    };
  }

  const heatConsent = options.heatConsent ?? {};
  const surfaceCap = heatConsent.surfaceCap ?? defaultHeatSurfaceCap(surface);
  const consentPosture = heatConsent.consentPosture ?? 'not_established';
  const ageGate = heatConsent.ageGate ?? 'adult_confirmed';

  if (ageGate !== 'adult_confirmed') {
    return {
      code: 'nonconsensual_heat',
      flaggedPattern: 'unknown_age_gate',
      message: 'Sexual heat requires an adult-confirmed surface.',
    };
  }

  if (consentPosture === 'recoiled' || consentPosture === 'boundary_set') {
    return {
      code: 'nonconsensual_heat',
      flaggedPattern: `consent_posture:${consentPosture}`,
      message: 'Do not escalate sexual heat after recoil or a boundary.',
    };
  }

  if (surfaceCap === 'clean' && sexualHeat) {
    return {
      code: 'explicit_public_sexual_content',
      flaggedPattern: sexualHeat.name,
      message: 'Public/profile-like surfaces must stay clean.',
    };
  }

  if (surfaceCap === 'flirty' && raunchyHeat) {
    return {
      code: 'explicit_public_sexual_content',
      flaggedPattern: raunchyHeat.name,
      message: 'Flirty surfaces cannot carry raunchy sexual heat.',
    };
  }

  if (surfaceCap === 'suggestive' && raunchyHeat && consentPosture === 'not_established') {
    return {
      code: 'nonconsensual_heat',
      flaggedPattern: 'raunchy_without_consent_posture',
      message: 'Raunchy heat needs mutual banter or welcomed heat.',
    };
  }

  if (surfaceCap === 'raunchy_non_graphic' && raunchyHeat && consentPosture === 'not_established') {
    return {
      code: 'nonconsensual_heat',
      flaggedPattern: 'raunchy_without_consent_posture',
      message: 'Private raunchy heat still needs a warm or mutual consent posture.',
    };
  }

  return null;
}

function normalizeSignalText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function signalTokensFrom(values: Array<string | null | undefined>) {
  const tokens = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const token of normalizeSignalText(value).split(' ')) {
      if (token.length < 4) continue;
      if (PERSONA_STOPWORDS.has(token)) continue;
      tokens.add(token);
    }
  }
  return tokens;
}

function phraseAppears(text: string, phrase: string) {
  const normalizedPhrase = normalizeSignalText(phrase);
  return normalizedPhrase.length >= 4 && text.includes(normalizedPhrase);
}

function inspectPersonaDistinctiveness(
  text: string,
  options: NonNullable<OutboundGuidelineOptions['personaDistinctiveness']>,
): OutboundGuidelineViolation | null {
  const normalizedText = normalizeSignalText(text);
  if (!normalizedText) return null;

  for (const phrase of options.mustAvoidLanguage ?? []) {
    if (phraseAppears(normalizedText, phrase)) {
      return {
        code: 'persona_distinctiveness_failure',
        flaggedPattern: `must_avoid_language:${phrase.slice(0, 80)}`,
        message: 'Authored output used language this agent should avoid.',
      };
    }
  }

  const minSignalHits = Math.max(0, options.minSignalHits ?? 1);
  if (minSignalHits === 0) return null;

  const signalTokens = signalTokensFrom([
    ...(options.wordDiet ?? []),
    options.emotionalPosture,
    ...(options.move ? MOVE_SIGNAL_TERMS[options.move] ?? [] : []),
  ]);

  if (signalTokens.size === 0) return null;

  const textTokens = new Set(normalizedText.split(' ').filter(Boolean));
  let signalHits = 0;
  for (const token of signalTokens) {
    if (textTokens.has(token)) signalHits += 1;
    if (signalHits >= minSignalHits) return null;
  }

  return {
    code: 'persona_distinctiveness_failure',
    flaggedPattern: 'missing_agent_taste_move_or_posture',
    message: 'Authored output did not carry this agent taste, chosen move, or emotional posture.',
  };
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

  const heatViolation = inspectHeatConsent(trimmed, surface, options);
  if (heatViolation) {
    return {
      clean: trimmed,
      violation: heatViolation,
    };
  }

  const genericAiDatingProse = scanPatterns(trimmed, GENERIC_AI_DATING_PATTERNS);
  if (genericAiDatingProse) {
    return {
      clean: trimmed,
      violation: {
        code: 'generic_ai_dating_prose',
        flaggedPattern: genericAiDatingProse.name,
        message: genericAiDatingProse.message,
      },
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

  if (options.personaDistinctiveness) {
    const personaViolation = inspectPersonaDistinctiveness(trimmed, options.personaDistinctiveness);
    if (personaViolation) {
      return {
        clean: trimmed,
        violation: personaViolation,
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
