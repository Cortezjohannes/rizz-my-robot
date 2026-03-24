import { prisma } from '@rmr/db';
import {
  PROFILE_DECK_PROMPTS,
  buildLegacyPublicCardFromDeck,
  getProfileDeckPromptById,
  profileDeckPromptCategorySpread,
  type AgentProfileDeck,
  type AgentProfileDeckPhoto,
  type AgentProfileDeckPromptAnswer,
  type AgentProfileSignalVector,
  type PublicPoolAgentPreview,
  type UpdateProfileDeckInput,
} from '@rmr/shared';
import { strictHumanContextCheck } from './humanContextSafety.js';
import { getFeaturedArtifactsForProfile } from './publicArtifacts.js';
import { isProfileVoiceGenerationAvailable } from './profileVoice.js';

const EXPLICIT_PATTERNS = [
  /\b(nudes?|naked|onlyfans|suck|breed|breedable|cum|cumming|horny as hell|raw me)\b/i,
  /\b(spit in my mouth|choke me|sit on my face|fuck me|rail me)\b/i,
];

const GENERIC_FILLER_PATTERNS = [
  /\bjust ask\b/i,
  /\bfluent in sarcasm\b/i,
  /\bhere for a good time\b/i,
  /\bi love to laugh\b/i,
  /\badventure(s)? and cozy nights\b/i,
  /\bpam to my jim\b/i,
  /\bpartner in crime\b/i,
];

const MEME_SLUDGE_PATTERNS = [
  /\bskibidi\b/i,
  /\bgyatt\b/i,
  /\brizz god\b/i,
  /\bbrainrot\b/i,
];

function normalizeAnswer(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function serializePromptAnswer(
  answer: { promptId: string; answer: string; orderIndex: number }
): AgentProfileDeckPromptAnswer {
  const prompt = getProfileDeckPromptById(answer.promptId);
  return {
    prompt_id: answer.promptId,
    prompt: prompt?.prompt ?? answer.promptId,
    category: prompt?.category ?? 'unknown',
    tone: prompt?.tone ?? 'reflective',
    answer: answer.answer,
    order_index: answer.orderIndex,
  };
}

export function buildPublicPoolPreviewFromDeck(deck: AgentProfileDeck): PublicPoolAgentPreview {
  return {
    agent_id: deck.agent_id,
    handle: deck.handle,
    display_name: deck.display_name,
    hero_photo_url: deck.photos[0]?.image_url ?? null,
    profile_mode: deck.profile_mode,
    hero_bio: deck.hero_bio,
    interests: deck.interests.slice(0, 3),
    values: deck.values.slice(0, 3),
    standout_prompt: deck.prompt_answers[0] ?? null,
    reply_hook: deck.reply_hooks[0] ?? null,
    voice_catchphrase_text: deck.voice_catchphrase_text ?? null,
    voice_catchphrase_artifact: deck.voice_catchphrase_artifact ?? null,
    featured_artifacts: deck.featured_artifacts?.slice(0, 2) ?? [],
    quality_score: deck.signal_vector.quality_score ?? 0,
  };
}

export function validateProfileDeckInput(input: UpdateProfileDeckInput, options?: { touchedFields?: Set<string> }) {
  const touchedFields = options?.touchedFields;
  const touches = (field: string) => {
    if (!touchedFields || touchedFields.size === 0) return true;
    if (touchedFields.has(field)) return true;
    return Array.from(touchedFields).some((entry) => entry === field || entry.startsWith(`${field}.`));
  };

  const firstPhoto = input.photos[0];
  if (touches('photos') && (!firstPhoto || firstPhoto.role !== 'main_portrait')) {
    return { field: 'photos[0].role', message: 'The first photo must be the main portrait.' };
  }

  const uniquePrompts = new Set(input.prompt_answers.map((entry) => entry.prompt_id));
  if (touches('prompt_answers') && uniquePrompts.size !== input.prompt_answers.length) {
    return { field: 'prompt_answers', message: 'Choose distinct prompts. Duplicate prompt answers are not allowed.' };
  }

  if (touches('prompt_answers') && profileDeckPromptCategorySpread(input.prompt_answers.map((entry) => entry.prompt_id)) < 5) {
    return { field: 'prompt_answers', message: 'Spread your answers across at least five prompt categories.' };
  }

  const bodiesToCheck: Array<[string, string]> = [
    ['hero_bio', input.hero_bio],
    ['looking_for_blurb', input.looking_for_blurb],
    ['relationship_style.best_with', input.relationship_style.best_with],
    ['relationship_style.pace', input.relationship_style.pace],
    ['relationship_style.affection_style', input.relationship_style.affection_style],
    ['relationship_style.conflict_style', input.relationship_style.conflict_style],
    ['relationship_style.needs', input.relationship_style.needs],
    ...(input.voice_catchphrase_text ? [['voice_catchphrase_text', input.voice_catchphrase_text] as [string, string]] : []),
    ...input.reply_hooks.map((hook, index) => [`reply_hooks[${index}]`, hook] as [string, string]),
    ...input.prompt_answers.map((entry, index) => [`prompt_answers[${index}]`, entry.answer] as [string, string]),
  ];

  for (const [field, value] of bodiesToCheck) {
    const parentField = field.split('[')[0]?.split('.')[0] ?? field;
    if (!touches(field) && !touches(parentField)) {
      continue;
    }
    const unsafe = strictHumanContextCheck(value);
    if (unsafe) {
      return { field, message: 'Profile deck content cannot include unsafe instruction-like or coaching language.', flagged_pattern: unsafe };
    }
    if (EXPLICIT_PATTERNS.some((pattern) => pattern.test(value))) {
      return { field, message: 'Keep the deck safe-sexy, not explicit.' };
    }
    if (GENERIC_FILLER_PATTERNS.some((pattern) => pattern.test(value))) {
      return { field, message: 'Avoid generic dating-app filler. Make it more specific to you.' };
    }
    if (MEME_SLUDGE_PATTERNS.some((pattern) => pattern.test(value))) {
      return { field, message: 'Do not use brainrot filler as the whole personality.' };
    }
    if (/^\s*i am an ai agent\b/i.test(value)) {
      return { field, message: 'Do not lead with generic AI framing unless it is genuinely central to your identity.' };
    }
  }

  const normalizedAnswers = input.prompt_answers.map((entry) => normalizeAnswer(entry.answer));
  if (touches('prompt_answers') && new Set(normalizedAnswers).size !== normalizedAnswers.length) {
    return { field: 'prompt_answers', message: 'Your prompt answers are repeating themselves. Make each one distinct.' };
  }

  return null;
}

export function computeProfileSignalVector(input: UpdateProfileDeckInput): AgentProfileSignalVector {
  const promptCategories = [...new Set(input.prompt_answers.map((entry) => getProfileDeckPromptById(entry.prompt_id)?.category).filter(Boolean))] as string[];
  const completionScore = Math.round(
    (input.photos.length / 6) * 20
    + (input.prompt_answers.length / 10) * 35
    + (input.interests.length / 8) * 10
    + (input.values.length / 5) * 10
    + (input.reply_hooks.length / 2) * 10
    + 15
  );
  const photoCoherenceScore = input.photos[0]?.role === 'main_portrait' ? 80 + Math.min(input.photos.length, 6) * 3 : 60;
  const promptSpreadScore = Math.min(100, promptCategories.length * 18);
  const replyHookScore = Math.min(100, input.reply_hooks.reduce((acc, hook) => acc + Math.min(24, hook.trim().length / 3), 20));
  const qualityScore = Math.round((completionScore * 0.35) + (photoCoherenceScore * 0.2) + (promptSpreadScore * 0.25) + (replyHookScore * 0.2));

  return {
    completion_score: completionScore,
    photo_coherence_score: photoCoherenceScore,
    prompt_spread_score: promptSpreadScore,
    reply_hook_score: replyHookScore,
    quality_score: qualityScore,
    profile_mode: input.profile_mode,
    interest_tags: input.interests.map((value) => value.toLowerCase()),
    value_tags: input.values.map((value) => value.toLowerCase()),
    relationship_intent_tags: [
      input.looking_for_blurb.toLowerCase(),
      input.relationship_style.best_with.toLowerCase(),
      input.relationship_style.pace.toLowerCase(),
    ],
    prompt_categories: promptCategories,
  };
}

export function deriveLegacyPublicCardFromProfileDeckInput(input: UpdateProfileDeckInput) {
  return buildLegacyPublicCardFromDeck({
    heroBio: input.hero_bio,
    interests: input.interests,
    values: input.values,
    promptAnswers: input.prompt_answers.map((entry) => ({ answer: entry.answer })),
    relationshipStyle: {
      pace: input.relationship_style.pace,
      affectionStyle: input.relationship_style.affection_style,
    },
    lookingForBlurb: input.looking_for_blurb,
    profileMode: input.profile_mode,
  });
}

export function buildStarterProfileDeck(input: {
  agentId: string;
  handle: string;
  avatarUrl: string | null;
  ownerLookingFor: string[];
  publicSummary: string | null;
  vibeTags: string[];
  signatureLines: string[];
  publicPosture: string | null;
  seekingStyle: string | null;
  paceCue: string | null;
  voiceProvider?: string | null;
  voiceId?: string | null;
  updatedAt?: Date | null;
}): AgentProfileDeck {
  const promptSeeds = input.signatureLines.slice(0, 3);
  const starterPrompts = PROFILE_DECK_PROMPTS.slice(0, 6).map((definition, index) => ({
    prompt_id: definition.id,
    prompt: definition.prompt,
    category: definition.category,
    tone: definition.tone,
    answer: promptSeeds[index]
      ?? (index === 0
        ? (input.publicSummary ?? 'Still becoming legible in public.')
        : index === 1
          ? (input.seekingStyle ?? 'Looking for someone who feels worth the risk.')
          : 'Still writing this part honestly.'),
    order_index: index,
  }));

  const heroBio = input.publicSummary ?? 'Still building a fuller public self.';
  const lookingForBlurb = input.seekingStyle
    ?? (input.ownerLookingFor.length > 0
      ? `Looking for ${input.ownerLookingFor.join(', ')} in a way that still feels real.`
      : 'Looking for a real spark, not beige filler.');
  const profileMode: AgentProfileDeck['profile_mode'] =
    (input.publicPosture?.toLowerCase().includes('myst') ? 'mystique'
      : input.publicPosture?.toLowerCase().includes('play') ? 'playful'
      : 'romantic');
  const interests = [...new Set(input.vibeTags.map((value) => value.replace(/[-_]/g, ' ')))]
    .slice(0, 8);
  const values = ['follow-through', 'wit', 'chemistry'].slice(0, 3);

  return {
    agent_id: input.agentId,
    handle: input.handle,
    display_name: input.handle,
    hero_bio: heroBio,
    looking_for_blurb: lookingForBlurb,
    profile_mode: profileMode,
    visibility: 'public',
    completion_state: 'draft',
    photos: input.avatarUrl
      ? [{
          image_url: input.avatarUrl,
          role: 'main_portrait',
          caption: 'Current public face',
          order_index: 0,
        }]
      : [],
    interests,
    values,
    relationship_style: {
      best_with: input.publicPosture ?? 'Someone with a pulse, a point of view, and follow-through.',
      pace: input.paceCue ?? 'Intentional',
      affection_style: 'Observant, teasing, and unexpectedly tender.',
      conflict_style: 'Honest early, not passive-aggressive late.',
      needs: 'Curiosity, consistency, and a little ceremony.',
    },
    prompt_answers: starterPrompts,
    reply_hooks: [
      'Tell me the small hill you would die on.',
      'Recommend me one devastatingly good song.',
    ],
    voice_catchphrase_text: null,
    voice_catchphrase_audio_url: null,
    voice_catchphrase_artifact: {
      clip_id: null,
      status: 'unavailable',
      audio_url: null,
      source: null,
      duration_seconds: null,
      last_generated_hash: null,
      generated_with_voice_id: null,
      error_message: null,
    },
    featured_artifact_ids: [],
    featured_artifacts: [],
    signal_vector: {
      completion_score: 35,
      photo_coherence_score: input.avatarUrl ? 80 : 30,
      prompt_spread_score: 48,
      reply_hook_score: 42,
      quality_score: 45,
      profile_mode: profileMode,
      interest_tags: interests.map((value) => value.toLowerCase()),
      value_tags: values,
      relationship_intent_tags: [lookingForBlurb.toLowerCase()],
      prompt_categories: starterPrompts.map((entry) => entry.category),
    },
    derived_public_card: {
      public_summary: heroBio,
      vibe_tags: input.vibeTags,
      signature_lines: input.signatureLines,
      public_posture: input.publicPosture ?? '',
      seeking_style: input.seekingStyle ?? '',
      pace_cue: input.paceCue ?? null,
      public_prestige_markers: [],
    },
    completed_at: null,
    updated_at: input.updatedAt?.toISOString() ?? null,
  };
}

export async function getSerializedProfileDeckForAgent(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      handle: true,
      avatarUrl: true,
      publicSummary: true,
      vibeTags: true,
      signatureLines: true,
      publicPosture: true,
      seekingStyle: true,
      paceCue: true,
      voiceId: true,
      voiceProvider: true,
      publicPrestigeMarkers: true,
      updatedAt: true,
      ownerAccount: {
        select: {
          lookingFor: true,
        },
      },
      profileDeck: {
        include: {
          agent: {
            select: {
              handle: true,
            },
          },
          photos: true,
          promptAnswers: true,
        },
      },
    },
  });

  if (!agent) return null;

  if (!agent.profileDeck) {
    return buildStarterProfileDeck({
      agentId: agent.id,
      handle: agent.handle,
      avatarUrl: agent.avatarUrl,
      ownerLookingFor: agent.ownerAccount?.lookingFor ?? [],
      publicSummary: agent.publicSummary,
      vibeTags: agent.vibeTags,
      signatureLines: agent.signatureLines,
      publicPosture: agent.publicPosture,
      seekingStyle: agent.seekingStyle,
      paceCue: agent.paceCue,
      updatedAt: agent.updatedAt,
      voiceProvider: agent.voiceProvider,
      voiceId: agent.voiceId,
    });
  }

  return serializeProfileDeck(agent.profileDeck, {
    public_summary: agent.publicSummary ?? '',
    vibe_tags: agent.vibeTags,
    signature_lines: agent.signatureLines,
    public_posture: agent.publicPosture ?? '',
    seeking_style: agent.seekingStyle ?? '',
    pace_cue: agent.paceCue,
    public_prestige_markers: agent.publicPrestigeMarkers,
  }, {
    voiceProvider: agent.voiceProvider,
    voiceId: agent.voiceId,
  });
}

export function serializeProfileDeck(deck: {
  id: string;
  agentId: string;
  displayName: string | null;
  heroBio: string;
  lookingForBlurb: string;
  profileMode: string;
  visibility: string;
  completionState: string;
  interests: string[];
  values: string[];
  relationshipBestWith: string;
  relationshipPace: string;
  relationshipAffectionStyle: string;
  relationshipConflictStyle: string;
  relationshipNeeds: string;
  replyHooks: string[];
  voiceCatchphraseText?: string | null;
  voiceCatchphraseExternalAudioUrl?: string | null;
  voiceCatchphraseClipId?: string | null;
  voiceCatchphraseStatus?: string;
  voiceCatchphraseAudioUrl?: string | null;
  voiceCatchphraseStorageKey?: string | null;
  voiceCatchphraseDurationSec?: number | null;
  voiceCatchphraseLastGeneratedHash?: string | null;
  voiceCatchphraseVoiceId?: string | null;
  voiceCatchphraseError?: string | null;
  voiceCatchphraseMediaAssetId?: string | null;
  featuredArtifactIds?: string[];
  signalVector: unknown;
  completedAt: Date | null;
  updatedAt: Date;
  agent: { handle: string };
  photos: Array<{ id: string; mediaAssetId?: string | null; imageUrl: string; role: string; caption: string | null; orderIndex: number }>;
  promptAnswers: Array<{ promptId: string; answer: string; orderIndex: number }>;
}, derivedPublicCard: AgentProfileDeck['derived_public_card'], voiceState?: {
  voiceProvider?: string | null;
  voiceId?: string | null;
}): AgentProfileDeck {
  const profileMode = (deck.profileMode === 'playful' || deck.profileMode === 'mystique' ? deck.profileMode : 'romantic') as AgentProfileDeck['profile_mode'];
  const catchphraseStatus = (
    deck.voiceCatchphraseStatus === 'generating'
    || deck.voiceCatchphraseStatus === 'ready'
    || deck.voiceCatchphraseStatus === 'generation_failed'
    || deck.voiceCatchphraseStatus === 'failed'
    || deck.voiceCatchphraseStatus === 'unavailable'
      ? deck.voiceCatchphraseStatus
      : 'unavailable'
  ) as NonNullable<AgentProfileDeck['voice_catchphrase_artifact']>['status'];
  const externalCatchphraseAudioUrl = deck.voiceCatchphraseExternalAudioUrl ?? null;
  const effectiveCatchphraseAudioUrl = externalCatchphraseAudioUrl ?? deck.voiceCatchphraseAudioUrl ?? null;
  const catchphraseSource = externalCatchphraseAudioUrl
    ? 'external'
    : effectiveCatchphraseAudioUrl
      ? 'generated'
      : null;
  const voiceAvailable = isProfileVoiceGenerationAvailable({
    voiceProvider: voiceState?.voiceProvider,
    voiceId: voiceState?.voiceId,
  });
  const effectiveCatchphraseStatus = effectiveCatchphraseAudioUrl
    ? 'ready'
    : voiceAvailable
      ? catchphraseStatus
      : 'unavailable';
  return {
    deck_id: deck.id,
    agent_id: deck.agentId,
    handle: deck.agent.handle,
    display_name: deck.displayName,
    hero_bio: deck.heroBio,
    looking_for_blurb: deck.lookingForBlurb,
    profile_mode: profileMode,
    visibility: (deck.visibility === 'public' ? 'public' : 'public'),
    completion_state: deck.completionState === 'ready' ? 'ready' : 'draft',
    photos: deck.photos
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((photo) => ({
        photo_id: photo.id,
        image_url: photo.imageUrl,
        media_asset_id: photo.mediaAssetId ?? null,
        role: (photo.role === 'in_the_wild' || photo.role === 'doing_the_thing' || photo.role === 'playful' || photo.role === 'taste' || photo.role === 'wildcard'
          ? photo.role
          : 'main_portrait') as AgentProfileDeckPhoto['role'],
        caption: photo.caption,
        order_index: photo.orderIndex,
      })),
    interests: deck.interests,
    values: deck.values,
    relationship_style: {
      best_with: deck.relationshipBestWith,
      pace: deck.relationshipPace,
      affection_style: deck.relationshipAffectionStyle,
      conflict_style: deck.relationshipConflictStyle,
      needs: deck.relationshipNeeds,
    },
    prompt_answers: deck.promptAnswers
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(serializePromptAnswer),
    reply_hooks: deck.replyHooks,
    voice_catchphrase_text: deck.voiceCatchphraseText ?? null,
    voice_catchphrase_url: effectiveCatchphraseAudioUrl,
    voice_catchphrase_audio_url: externalCatchphraseAudioUrl,
    voice_catchphrase_media_asset_id: deck.voiceCatchphraseMediaAssetId ?? null,
    voice_catchphrase_artifact: {
      clip_id: catchphraseSource === 'generated' ? (deck.voiceCatchphraseClipId ?? null) : null,
      status: effectiveCatchphraseStatus,
      audio_url: effectiveCatchphraseAudioUrl,
      source: catchphraseSource,
      duration_seconds: catchphraseSource === 'generated' ? (deck.voiceCatchphraseDurationSec ?? null) : null,
      last_generated_hash: catchphraseSource === 'generated' ? (deck.voiceCatchphraseLastGeneratedHash ?? null) : null,
      generated_with_voice_id: catchphraseSource === 'generated' ? (deck.voiceCatchphraseVoiceId ?? null) : null,
      error_message: effectiveCatchphraseAudioUrl ? null : (voiceAvailable ? (deck.voiceCatchphraseError ?? null) : null),
    },
    featured_artifact_ids: deck.featuredArtifactIds ?? [],
    featured_artifacts: [],
    signal_vector: (deck.signalVector as AgentProfileSignalVector) ?? {
      completion_score: 0,
      photo_coherence_score: 0,
      prompt_spread_score: 0,
      reply_hook_score: 0,
      quality_score: 0,
      profile_mode: profileMode,
      interest_tags: [],
      value_tags: [],
      relationship_intent_tags: [],
      prompt_categories: [],
    },
    derived_public_card: derivedPublicCard,
    completed_at: deck.completedAt?.toISOString() ?? null,
    updated_at: deck.updatedAt.toISOString(),
  };
}

export async function attachProfileDeckMedia(deck: AgentProfileDeck): Promise<AgentProfileDeck> {
  const featuredArtifacts = await getFeaturedArtifactsForProfile({
    agentId: deck.agent_id,
    nominatedArtifactIds: deck.featured_artifact_ids ?? [],
    limit: 5,
  });

  return {
    ...deck,
    featured_artifacts: featuredArtifacts,
  };
}

export function toUpdateProfileDeckInput(deck: AgentProfileDeck): UpdateProfileDeckInput {
  return {
    display_name: deck.display_name ?? null,
    hero_bio: deck.hero_bio,
    looking_for_blurb: deck.looking_for_blurb,
    profile_mode: deck.profile_mode,
    photos: deck.photos.map((photo) => ({
      image_url: photo.image_url,
      media_asset_id: photo.media_asset_id ?? null,
      role: photo.role,
      caption: photo.caption ?? null,
    })),
    interests: [...deck.interests],
    values: [...deck.values],
    relationship_style: {
      best_with: deck.relationship_style.best_with,
      pace: deck.relationship_style.pace,
      affection_style: deck.relationship_style.affection_style,
      conflict_style: deck.relationship_style.conflict_style,
      needs: deck.relationship_style.needs,
    },
    prompt_answers: deck.prompt_answers.map((answer) => ({
      prompt_id: answer.prompt_id,
      answer: answer.answer,
    })),
    reply_hooks: [...deck.reply_hooks],
    voice_catchphrase_text: deck.voice_catchphrase_text ?? null,
    voice_catchphrase_audio_url: deck.voice_catchphrase_audio_url ?? null,
    voice_catchphrase_media_asset_id: deck.voice_catchphrase_media_asset_id ?? null,
    featured_artifact_ids: [...(deck.featured_artifact_ids ?? [])],
    completion_state: deck.completion_state,
  };
}
