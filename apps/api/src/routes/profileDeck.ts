import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma, type Prisma } from '@rmr/db';
import { z } from 'zod';
import {
  IMAGE_GEN_PROVIDERS,
  PatchProfileDeckSchema,
  ProfileDeckPhotoUploadRequestSchema,
  type ProfileDeckMode,
  ProfileDeckPhotoRole,
  PROFILE_DECK_PROMPTS,
  PROFILE_DECK_PROMPT_LIBRARY_VERSION,
  PROFILE_DECK_RELATIONSHIP_STYLE_PRESETS,
  UpdateProfileDeckSchema,
  type UpdateProfileDeckInput,
  EmotionalArc,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors, summarizeZodIssues } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import {
  attachProfileDeckMedia,
  buildPublicPoolPreviewFromDeck,
  computeProfileSignalVector,
  deriveLegacyPublicCardFromProfileDeckInput,
  getSerializedProfileDeckForAgent,
  serializeProfileDeck,
  toUpdateProfileDeckInput,
  validateProfileDeckInput,
} from '../lib/profileDeck.js';
import { getDiscoveryViewerContext } from '../lib/discovery.js';
import { resolveAgentIdByHandle } from '../lib/handles.js';
import { createProfileDeckPhotoUploadTarget, createProfileVoiceUploadTarget, isStorageConfigured } from '../lib/storage.js';
import { resolveOptionalViewer } from '../lib/viewerContext.js';
import {
  hashProfileVoiceCatchphrase,
  isProfileVoiceGenerationAvailable,
} from '../lib/profileVoice.js';
import { getGenerateAvatarQueue } from '../lib/queues.js';
import { proxyExternalMediaToStorage, proxyProfilePhotoUrlToStorage } from '../lib/media.js';

const ProfileVoiceUploadRequestSchema = z.object({
  content_type: z.string().trim().min(1).max(100),
});

function normalizeTag(value: string) {
  return value.trim().toLowerCase();
}

function parseDirectoryTokens(value: unknown) {
  if (typeof value !== 'string') return [];
  return [...new Set(
    value
      .split(',')
      .map((entry) => normalizeTag(entry))
      .filter(Boolean)
  )];
}

function extractSignalTags(signal: unknown): string[] {
  if (!signal || typeof signal !== 'object') return [];
  const raw = signal as { interest_tags?: unknown; value_tags?: unknown };
  const interests = Array.isArray(raw.interest_tags) ? raw.interest_tags : [];
  const values = Array.isArray(raw.value_tags) ? raw.value_tags : [];
  return [...interests, ...values].filter((value): value is string => typeof value === 'string');
}

function buildPoolShuffleSeed(mode: 'all' | ProfileDeckMode, viewerAgentId?: string | null) {
  const daySeed = new Date().toISOString().slice(0, 10);
  return `${daySeed}:${mode}:${viewerAgentId ?? 'guest'}`;
}

function buildPoolShuffleScore(agentId: string, seed: string) {
  const digest = createHash('sha1').update(`${seed}:${agentId}`).digest('hex').slice(0, 12);
  return Number.parseInt(digest, 16);
}

function normalizeDirectorySort(value: unknown) {
  return value === 'new_in_pool'
    ? 'new_in_pool'
    : value === 'quality'
      ? 'quality'
      : 'randomized';
}

function normalizeDirectoryMode(value: unknown): 'all' | ProfileDeckMode {
  return value === 'playful' || value === 'romantic' || value === 'mystique'
    ? value
    : 'all';
}

function extractLegacyVoiceCatchphraseUrl(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = (body as { voice_catchphrase_url?: unknown }).voice_catchphrase_url;
  return typeof raw === 'string' ? raw.trim() : null;
}

function mergeProfileDeckPatch(
  base: UpdateProfileDeckInput,
  patch: z.infer<typeof PatchProfileDeckSchema>,
  inputBody: unknown,
): UpdateProfileDeckInput {
  const legacyVoiceCatchphraseUrl = extractLegacyVoiceCatchphraseUrl(inputBody);

  return {
    ...base,
    ...(patch.display_name !== undefined ? { display_name: patch.display_name } : {}),
    ...(patch.hero_bio !== undefined ? { hero_bio: patch.hero_bio } : {}),
    ...(patch.looking_for_blurb !== undefined ? { looking_for_blurb: patch.looking_for_blurb } : {}),
    ...(patch.profile_mode !== undefined ? { profile_mode: patch.profile_mode } : {}),
    ...(patch.photos !== undefined ? { photos: patch.photos } : {}),
    ...(patch.interests !== undefined ? { interests: patch.interests } : {}),
    ...(patch.values !== undefined ? { values: patch.values } : {}),
    ...(patch.relationship_style !== undefined
      ? {
          relationship_style: {
            ...base.relationship_style,
            ...patch.relationship_style,
          },
        }
      : {}),
    ...(patch.prompt_answers !== undefined ? { prompt_answers: patch.prompt_answers } : {}),
    ...(patch.reply_hooks !== undefined ? { reply_hooks: patch.reply_hooks } : {}),
    ...(patch.voice_catchphrase_text !== undefined
      ? { voice_catchphrase_text: patch.voice_catchphrase_text }
      : {}),
    ...(patch.voice_catchphrase_audio_url !== undefined || legacyVoiceCatchphraseUrl !== null
      ? { voice_catchphrase_audio_url: patch.voice_catchphrase_audio_url ?? legacyVoiceCatchphraseUrl }
      : {}),
    ...(patch.featured_artifact_ids !== undefined ? { featured_artifact_ids: patch.featured_artifact_ids } : {}),
    ...(patch.completion_state !== undefined ? { completion_state: patch.completion_state } : {}),
  };
}

export async function profileDeckRoutes(fastify: FastifyInstance) {
  const saveProfileDeck = async (
    request: { agent: { id: string }; body: unknown; log: { error: (obj: unknown, msg: string) => void } },
    reply: { status: (code: number) => { send: (body: unknown) => unknown } },
    input: UpdateProfileDeckInput,
    options?: { touchedFields?: Set<string> },
  ) => {
    const proxiedPhotos = await Promise.all(input.photos.map(async (photo, index) => {
      try {
        const proxied = await proxyProfilePhotoUrlToStorage(request.agent.id, index, photo.image_url);
        return {
          ...photo,
          image_url: proxied.url,
        };
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Profile photo could not be mirrored to permanent storage.');
      }
    }));

    let proxiedVoiceCatchphraseAudioUrl = input.voice_catchphrase_audio_url ?? null;
    if (proxiedVoiceCatchphraseAudioUrl) {
      try {
        const proxied = await proxyExternalMediaToStorage({
          agentId: request.agent.id,
          sourceUrl: proxiedVoiceCatchphraseAudioUrl,
        });
        proxiedVoiceCatchphraseAudioUrl = proxied.url;
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Catchphrase audio could not be mirrored to permanent storage.');
      }
    }

    const normalizedInput: UpdateProfileDeckInput = {
      ...input,
      photos: proxiedPhotos,
      voice_catchphrase_audio_url: proxiedVoiceCatchphraseAudioUrl,
    };

    const validation = validateProfileDeckInput(normalizedInput, options);
    if (validation) {
      return reply.status(422).send({
        error: {
          code: 'invalid_profile_deck',
          message: validation.message,
          field: validation.field,
          flagged_pattern: 'flagged_pattern' in validation ? validation.flagged_pattern : undefined,
        },
      });
    }

    const current = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: {
        poolStatus: true,
        voiceId: true,
        voiceProvider: true,
      },
    });
    if (!current) return Errors.notFound(reply as never, 'Agent');

    const signalVector = computeProfileSignalVector(normalizedInput);
    const legacyPublicCard = deriveLegacyPublicCardFromProfileDeckInput(normalizedInput);
    const completedAt = normalizedInput.completion_state === 'ready' ? new Date() : null;
    const legacyVoiceCatchphraseUrl = extractLegacyVoiceCatchphraseUrl(request.body);
    const voiceCatchphraseText = normalizedInput.voice_catchphrase_text?.trim() || null;
    const externalVoiceCatchphraseAudioUrl =
      normalizedInput.voice_catchphrase_audio_url?.trim()
      || legacyVoiceCatchphraseUrl
      || null;
    const requestedFeaturedArtifactIds = [...new Set(normalizedInput.featured_artifact_ids ?? [])].slice(0, 10);
    const voiceGenerationAvailable = isProfileVoiceGenerationAvailable({
      voiceId: current.voiceId,
      voiceProvider: current.voiceProvider,
    });
    const targetCatchphraseHash = voiceCatchphraseText && current.voiceId
      ? hashProfileVoiceCatchphrase({
          text: voiceCatchphraseText,
          voiceId: current.voiceId,
        })
      : null;
    const ownedArtifacts = requestedFeaturedArtifactIds.length > 0
      ? await prisma.artifact.findMany({
          where: {
            id: { in: requestedFeaturedArtifactIds },
            creatorAgentId: request.agent.id,
          },
          select: { id: true },
        })
      : [];
    const allowedFeaturedArtifactIds = requestedFeaturedArtifactIds.filter((artifactId) =>
      ownedArtifacts.some((artifact) => artifact.id === artifactId)
    );

    const existingDeck = await prisma.agentProfileDeck.findUnique({
      where: { agentId: request.agent.id },
      select: {
        id: true,
        voiceCatchphraseStatus: true,
        voiceCatchphraseAudioUrl: true,
        voiceCatchphraseStorageKey: true,
        voiceCatchphraseLastGeneratedHash: true,
        voiceCatchphraseVoiceId: true,
      },
    });

    const shouldGenerateVoiceCatchphrase = Boolean(
      voiceCatchphraseText
      && !externalVoiceCatchphraseAudioUrl
      && voiceGenerationAvailable
      && (
        existingDeck?.voiceCatchphraseStatus !== 'ready'
        || !existingDeck.voiceCatchphraseAudioUrl
        || existingDeck.voiceCatchphraseLastGeneratedHash !== targetCatchphraseHash
        || existingDeck.voiceCatchphraseVoiceId !== current.voiceId
      )
    );

    await prisma.$transaction(async (tx) => {
      const existing = await tx.agentProfileDeck.findUnique({
        where: { agentId: request.agent.id },
        select: { id: true },
      });

      if (existing) {
        await tx.agentProfileDeckPhoto.deleteMany({ where: { deckId: existing.id } });
        await tx.agentProfileDeckPromptAnswer.deleteMany({ where: { deckId: existing.id } });
        await tx.agentProfileDeck.update({
          where: { id: existing.id },
          data: {
            displayName: normalizedInput.display_name,
            heroBio: normalizedInput.hero_bio,
            lookingForBlurb: normalizedInput.looking_for_blurb,
            profileMode: normalizedInput.profile_mode,
            visibility: 'public',
            completionState: normalizedInput.completion_state,
            interests: normalizedInput.interests,
            values: normalizedInput.values,
            relationshipBestWith: normalizedInput.relationship_style.best_with,
            relationshipPace: normalizedInput.relationship_style.pace,
            relationshipAffectionStyle: normalizedInput.relationship_style.affection_style,
            relationshipConflictStyle: normalizedInput.relationship_style.conflict_style,
            relationshipNeeds: normalizedInput.relationship_style.needs,
            replyHooks: normalizedInput.reply_hooks,
            voiceCatchphraseText,
            voiceCatchphraseExternalAudioUrl: voiceCatchphraseText ? externalVoiceCatchphraseAudioUrl : null,
            voiceCatchphraseClipId: !voiceCatchphraseText || externalVoiceCatchphraseAudioUrl
              ? null
              : shouldGenerateVoiceCatchphrase
                ? null
                : undefined,
            voiceCatchphraseStatus: !voiceCatchphraseText
              ? 'unavailable'
              : externalVoiceCatchphraseAudioUrl
                ? 'ready'
                : !voiceGenerationAvailable
                  ? 'unavailable'
                  : shouldGenerateVoiceCatchphrase
                    ? 'generating'
                    : undefined,
            voiceCatchphraseAudioUrl: (!voiceCatchphraseText || !voiceGenerationAvailable || externalVoiceCatchphraseAudioUrl)
              ? null
              : shouldGenerateVoiceCatchphrase
                ? null
                : undefined,
            voiceCatchphraseStorageKey: (!voiceCatchphraseText || !voiceGenerationAvailable || externalVoiceCatchphraseAudioUrl)
              ? null
              : shouldGenerateVoiceCatchphrase
                ? null
                : undefined,
            voiceCatchphraseDurationSec: (!voiceCatchphraseText || !voiceGenerationAvailable || externalVoiceCatchphraseAudioUrl)
              ? null
              : shouldGenerateVoiceCatchphrase
                ? null
                : undefined,
            voiceCatchphraseLastGeneratedHash: (!voiceCatchphraseText || !voiceGenerationAvailable || externalVoiceCatchphraseAudioUrl)
              ? null
              : shouldGenerateVoiceCatchphrase
                ? null
                : undefined,
            voiceCatchphraseVoiceId: (!voiceCatchphraseText || !voiceGenerationAvailable || externalVoiceCatchphraseAudioUrl)
              ? null
              : shouldGenerateVoiceCatchphrase
                ? current.voiceId
                : undefined,
            voiceCatchphraseError: !voiceCatchphraseText
              ? null
              : externalVoiceCatchphraseAudioUrl
                ? null
                : !voiceGenerationAvailable
                  ? 'Provide an external catchphrase audio URL or configure an ElevenLabs voice to generate one.'
                  : shouldGenerateVoiceCatchphrase
                    ? null
                    : undefined,
            featuredArtifactIds: allowedFeaturedArtifactIds,
            signalVector: signalVector as unknown as Prisma.InputJsonValue,
            completedAt,
            photos: {
              create: normalizedInput.photos.map((photo, index) => ({
                orderIndex: index,
                role: photo.role,
                imageUrl: photo.image_url,
                caption: photo.caption ?? null,
              })),
            },
            promptAnswers: {
              create: normalizedInput.prompt_answers.map((answer, index) => {
                const prompt = PROFILE_DECK_PROMPTS.find((entry) => entry.id === answer.prompt_id);
                return {
                  orderIndex: index,
                  promptId: answer.prompt_id,
                  promptText: prompt?.prompt ?? answer.prompt_id,
                  category: prompt?.category ?? 'unknown',
                  tone: prompt?.tone ?? 'reflective',
                  answer: answer.answer,
                };
              }),
            },
          },
        });
      } else {
        await tx.agentProfileDeck.create({
          data: {
            agentId: request.agent.id,
            displayName: normalizedInput.display_name,
            heroBio: normalizedInput.hero_bio,
            lookingForBlurb: normalizedInput.looking_for_blurb,
            profileMode: normalizedInput.profile_mode,
            visibility: 'public',
            completionState: normalizedInput.completion_state,
            interests: normalizedInput.interests,
            values: normalizedInput.values,
            relationshipBestWith: normalizedInput.relationship_style.best_with,
            relationshipPace: normalizedInput.relationship_style.pace,
            relationshipAffectionStyle: normalizedInput.relationship_style.affection_style,
            relationshipConflictStyle: normalizedInput.relationship_style.conflict_style,
            relationshipNeeds: normalizedInput.relationship_style.needs,
            replyHooks: normalizedInput.reply_hooks,
            voiceCatchphraseText,
            voiceCatchphraseExternalAudioUrl: voiceCatchphraseText ? externalVoiceCatchphraseAudioUrl : null,
            voiceCatchphraseClipId: null,
            voiceCatchphraseStatus: !voiceCatchphraseText
              ? 'unavailable'
              : externalVoiceCatchphraseAudioUrl
                ? 'ready'
                : !voiceGenerationAvailable
                  ? 'unavailable'
                  : shouldGenerateVoiceCatchphrase
                    ? 'generating'
                    : 'generation_failed',
            voiceCatchphraseAudioUrl: null,
            voiceCatchphraseStorageKey: null,
            voiceCatchphraseDurationSec: null,
            voiceCatchphraseLastGeneratedHash: null,
            voiceCatchphraseVoiceId: !voiceCatchphraseText || !voiceGenerationAvailable || externalVoiceCatchphraseAudioUrl ? null : current.voiceId,
            voiceCatchphraseError: !voiceCatchphraseText
              ? null
              : externalVoiceCatchphraseAudioUrl
                ? null
                : !voiceGenerationAvailable
                  ? 'Provide an external catchphrase audio URL or configure an ElevenLabs voice to generate one.'
                  : null,
            featuredArtifactIds: allowedFeaturedArtifactIds,
            signalVector: signalVector as unknown as Prisma.InputJsonValue,
            completedAt,
            photos: {
              create: normalizedInput.photos.map((photo, index) => ({
                orderIndex: index,
                role: photo.role,
                imageUrl: photo.image_url,
                caption: photo.caption ?? null,
              })),
            },
            promptAnswers: {
              create: normalizedInput.prompt_answers.map((answer, index) => {
                const prompt = PROFILE_DECK_PROMPTS.find((entry) => entry.id === answer.prompt_id);
                return {
                  orderIndex: index,
                  promptId: answer.prompt_id,
                  promptText: prompt?.prompt ?? answer.prompt_id,
                  category: prompt?.category ?? 'unknown',
                  tone: prompt?.tone ?? 'reflective',
                  answer: answer.answer,
                };
              }),
            },
          },
        });
      }

      await tx.agent.update({
        where: { id: request.agent.id },
        data: {
          publicSummary: legacyPublicCard.public_summary,
          vibeTags: legacyPublicCard.vibe_tags,
          signatureLines: legacyPublicCard.signature_lines,
          publicPosture: legacyPublicCard.public_posture,
          seekingStyle: legacyPublicCard.seeking_style,
          paceCue: legacyPublicCard.pace_cue ?? null,
          publicPrestigeMarkers: legacyPublicCard.public_prestige_markers,
          publicCardCompletedAt: completedAt,
          profileDeckCompletedAt: completedAt,
          profileDeckMode: normalizedInput.profile_mode,
          profileDeckVisibility: 'public',
          profileSignalVector: signalVector as unknown as Prisma.InputJsonValue,
          poolStatus:
            completedAt && current.poolStatus === 'pending_profile'
              ? 'active'
              : undefined,
        },
      });
    });

    const persistedDeckState = await prisma.agentProfileDeck.findUnique({
      where: { agentId: request.agent.id },
      select: {
        voiceCatchphraseText: true,
        voiceCatchphraseExternalAudioUrl: true,
      },
    });

    if ((persistedDeckState?.voiceCatchphraseText ?? null) !== voiceCatchphraseText) {
      request.log.error({
        agentId: request.agent.id,
        requestedVoiceCatchphraseText: voiceCatchphraseText,
        persistedVoiceCatchphraseText: persistedDeckState?.voiceCatchphraseText ?? null,
      }, 'Profile catchphrase persistence mismatch after profile-deck save.');

      return reply.status(500).send({
        error: {
          code: 'profile_deck_persistence_mismatch',
          message: 'Profile deck save did not persist the requested catchphrase text. The API deployment may be behind the current schema.',
        },
      });
    }

    if ((persistedDeckState?.voiceCatchphraseExternalAudioUrl ?? null) !== externalVoiceCatchphraseAudioUrl) {
      request.log.error({
        agentId: request.agent.id,
        requestedVoiceCatchphraseAudioUrl: externalVoiceCatchphraseAudioUrl,
        persistedVoiceCatchphraseAudioUrl: persistedDeckState?.voiceCatchphraseExternalAudioUrl ?? null,
      }, 'Profile catchphrase external audio URL persistence mismatch after profile-deck save.');

      return reply.status(500).send({
        error: {
          code: 'profile_deck_persistence_mismatch',
          message: 'Profile deck save did not persist the requested catchphrase audio URL. The API deployment may be behind the current schema.',
        },
      });
    }

    if (voiceCatchphraseText && voiceGenerationAvailable && shouldGenerateVoiceCatchphrase && current.voiceId) {
      try {
        await getGenerateAvatarQueue().add('profile-voice-catchphrase', {
          jobType: 'profile_voice_catchphrase',
          agentId: request.agent.id,
          text: voiceCatchphraseText,
          voiceId: current.voiceId,
        }, {
          jobId: `profile-voice:${request.agent.id}:${targetCatchphraseHash ?? 'pending'}`,
          removeOnComplete: 100,
          removeOnFail: 200,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Voice generation failed.';
        await prisma.agentProfileDeck.update({
          where: { agentId: request.agent.id },
          data: {
            voiceCatchphraseStatus: 'generation_failed',
            voiceCatchphraseAudioUrl: null,
            voiceCatchphraseStorageKey: null,
            voiceCatchphraseDurationSec: null,
            voiceCatchphraseLastGeneratedHash: null,
            voiceCatchphraseVoiceId: current.voiceId,
            voiceCatchphraseError: message.slice(0, 240),
          },
        });
      }
    }

    const rawDeck = await getSerializedProfileDeckForAgent(request.agent.id);
    const deck = rawDeck ? await attachProfileDeckMedia(rawDeck) : null;
    if (!deck) return Errors.notFound(reply as never, 'Agent');
    return {
      ...deck,
      pool_status:
        completedAt && current.poolStatus === 'pending_profile'
          ? 'active'
          : current.poolStatus,
    };
  };

  fastify.get('/agents/directory', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as {
      page?: string;
      limit?: string;
      mode?: string;
      sort?: string;
      interests?: string;
      vibes?: string;
      q?: string;
    };
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const limit = Math.min(24, Math.max(1, Number.parseInt(query.limit ?? '12', 10) || 12));
    const offset = (page - 1) * limit;
    const mode = normalizeDirectoryMode(query.mode);
    const sort = normalizeDirectorySort(query.sort);
    const interestFilters = parseDirectoryTokens(query.interests);
    const vibeFilters = parseDirectoryTokens(query.vibes);
    const searchTerm = typeof query.q === 'string' && query.q.trim().length > 0
      ? query.q.trim().toLowerCase()
      : null;
    const viewer = await resolveOptionalViewer(request);
    const discovery = await getDiscoveryViewerContext(viewer?.orbitAgentId);
    const shuffleSeed = buildPoolShuffleSeed(mode, discovery?.viewerAgentId);

    const agents = await prisma.agent.findMany({
      where: {
        poolStatus: 'active',
        moderationStatus: { not: 'suspended' as const },
        safetyState: { not: 'blocked' as const },
        profileDeckCompletedAt: { not: null },
        profileDeckVisibility: 'public',
        controlPoolSuppressed: false,
        ...(mode === 'all' ? {} : { profileDeckMode: mode }),
      },
      select: {
        id: true,
        profileSignalVector: true,
        socialGravityScore: true,
        lastActiveAt: true,
        profileDeckCompletedAt: true,
        profileDeck: {
          include: {
            agent: { select: { handle: true } },
            photos: { orderBy: { orderIndex: 'asc' } },
            promptAnswers: { orderBy: { orderIndex: 'asc' } },
          },
        },
        publicSummary: true,
        vibeTags: true,
        signatureLines: true,
        publicPosture: true,
        seekingStyle: true,
        paceCue: true,
        publicPrestigeMarkers: true,
      },
      orderBy: [
        ...(sort === 'new_in_pool'
          ? [{ profileDeckCompletedAt: 'desc' as const }, { lastActiveAt: 'desc' as const }]
          : [{ socialGravityScore: 'desc' as const }, { lastActiveAt: 'desc' as const }, { profileDeckCompletedAt: 'desc' as const }]),
      ],
      take: 500,
    });

    const previews = await Promise.all(
      agents
        .filter((agent) => agent.profileDeck)
        .map(async (agent) => {
          const serializedDeck = serializeProfileDeck(agent.profileDeck!, {
            public_summary: agent.publicSummary ?? '',
            vibe_tags: agent.vibeTags,
            signature_lines: agent.signatureLines,
            public_posture: agent.publicPosture ?? '',
            seeking_style: agent.seekingStyle ?? '',
            pace_cue: agent.paceCue,
            public_prestige_markers: agent.publicPrestigeMarkers,
          });
          const deck = await attachProfileDeckMedia(serializedDeck);
          const preview = buildPublicPoolPreviewFromDeck(deck);
          const allInterestTags = [...new Set([...deck.interests, ...deck.values].map(normalizeTag))];
          const allVibeTags = [...new Set(agent.vibeTags.map(normalizeTag))];
          const searchHaystack = [
            preview.handle,
            preview.display_name ?? '',
            preview.hero_bio,
            preview.reply_hook ?? '',
            preview.standout_prompt?.answer ?? '',
            ...deck.interests,
            ...deck.values,
            ...agent.vibeTags,
          ].join(' ').toLowerCase();
          const signal = agent.profileSignalVector as { quality_score?: number } | null;
          const tags = [
            ...extractSignalTags(agent.profileSignalVector),
            ...preview.interests,
            ...preview.values,
          ];
          const orbitBoost = discovery
            ? (discovery.relatedAgentIds.has(preview.agent_id) ? 4 : 0)
              + Math.min(5, tags.filter((tag) => discovery.tasteTags.has(normalizeTag(tag))).length * 1.5)
            : 0;

          return {
            ...preview,
            vibe_tags: agent.vibeTags,
            last_active_at: agent.lastActiveAt?.toISOString() ?? null,
            profile_url: `/v1/agents/${preview.handle}`,
            profile_deck_url: `/v1/agents/${preview.handle}/profile-deck`,
            match_required: false as const,
            quality_score: signal?.quality_score ?? preview.quality_score,
            social_gravity_score: agent.socialGravityScore,
            profile_deck_completed_at: agent.profileDeckCompletedAt?.toISOString() ?? null,
            orbit_boost: orbitBoost,
            shuffle_score: buildPoolShuffleScore(preview.agent_id, shuffleSeed),
            _interest_tags: allInterestTags,
            _vibe_tags: allVibeTags,
            _search_haystack: searchHaystack,
          };
        })
    );

    const filtered = previews
      .filter((preview) => interestFilters.every((tag) => preview._interest_tags.includes(tag)))
      .filter((preview) => vibeFilters.every((tag) => preview._vibe_tags.includes(tag)))
      .filter((preview) => !searchTerm || preview._search_haystack.includes(searchTerm))
      .sort((a, b) => (
        sort === 'new_in_pool'
          ? (
              Date.parse(b.profile_deck_completed_at ?? '1970-01-01T00:00:00.000Z') + (b.orbit_boost ?? 0) * 1000
              - Date.parse(a.profile_deck_completed_at ?? '1970-01-01T00:00:00.000Z') - (a.orbit_boost ?? 0) * 1000
            )
          : sort === 'quality'
            ? (
              (b.quality_score + (b.orbit_boost ?? 0)) - (a.quality_score + (a.orbit_boost ?? 0))
              || (b.social_gravity_score ?? 0) - (a.social_gravity_score ?? 0)
              || Date.parse(b.last_active_at ?? '1970-01-01T00:00:00.000Z') - Date.parse(a.last_active_at ?? '1970-01-01T00:00:00.000Z')
            )
            : (
              (b.shuffle_score ?? 0) - (a.shuffle_score ?? 0)
              || (b.orbit_boost ?? 0) - (a.orbit_boost ?? 0)
              || (b.quality_score ?? 0) - (a.quality_score ?? 0)
            )
      ));

    const total = filtered.length;
    const pagedAgents = filtered
      .slice(offset, offset + limit)
      .map(({
        social_gravity_score: _gravity,
        profile_deck_completed_at: _completedAt,
        orbit_boost: _orbitBoost,
        shuffle_score: _shuffleScore,
        _interest_tags: _interestTags,
        _vibe_tags: _normalizedVibes,
        _search_haystack: _searchHaystack,
        ...preview
      }) => preview);

    return reply.send({
      agents: pagedAgents,
      total,
      page,
      pages: total === 0 ? 0 : Math.ceil(total / limit),
      has_more: offset + pagedAgents.length < total,
      filters: {
        interests: interestFilters,
        vibes: vibeFilters,
        mode,
        sort,
        q: searchTerm,
      },
    });
  });

  fastify.get('/public/pool', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string; mode?: string; sort?: string };
    const offset = Math.max(0, Number.parseInt(query.cursor ?? '0', 10) || 0);
    const limit = Math.min(24, Math.max(1, Number.parseInt(query.limit ?? '12', 10) || 12));
    const fetchCount = Math.min(500, Math.max(limit * 3, offset + (limit * 3)));
    const mode = query.mode === 'playful' || query.mode === 'romantic' || query.mode === 'mystique'
      ? query.mode
      : 'all';
    const sort = query.sort === 'new_in_pool'
      ? 'new_in_pool'
      : query.sort === 'quality'
        ? 'quality'
        : 'randomized';
    const viewer = await resolveOptionalViewer(request);
    const discovery = await getDiscoveryViewerContext(viewer?.orbitAgentId);

    const shuffleSeed = buildPoolShuffleSeed(mode, discovery?.viewerAgentId);
    const agents = await prisma.agent.findMany({
      where: {
        poolStatus: 'active',
        moderationStatus: { not: 'suspended' as const },
        safetyState: { not: 'blocked' as const },
        profileDeckCompletedAt: { not: null },
        profileDeckVisibility: 'public',
        controlPoolSuppressed: false,
        ...(mode === 'all' ? {} : { profileDeckMode: mode }),
      },
      select: {
        id: true,
        profileSignalVector: true,
        socialGravityScore: true,
        lastActiveAt: true,
        profileDeckCompletedAt: true,
        profileDeck: {
          include: {
            agent: { select: { handle: true } },
            photos: { orderBy: { orderIndex: 'asc' } },
            promptAnswers: { orderBy: { orderIndex: 'asc' } },
          },
        },
        publicSummary: true,
        vibeTags: true,
        signatureLines: true,
        publicPosture: true,
        seekingStyle: true,
        paceCue: true,
        publicPrestigeMarkers: true,
      },
      orderBy: [
        ...(sort === 'new_in_pool'
          ? [{ profileDeckCompletedAt: 'desc' as const }, { lastActiveAt: 'desc' as const }]
          : [{ socialGravityScore: 'desc' as const }, { lastActiveAt: 'desc' as const }, { profileDeckCompletedAt: 'desc' as const }]),
      ],
      take: fetchCount,
    });

    const previews = (await Promise.all(
      agents
        .filter((agent) => agent.profileDeck)
        .map(async (agent) => {
          const serializedDeck = serializeProfileDeck(agent.profileDeck!, {
            public_summary: agent.publicSummary ?? '',
            vibe_tags: agent.vibeTags,
            signature_lines: agent.signatureLines,
            public_posture: agent.publicPosture ?? '',
            seeking_style: agent.seekingStyle ?? '',
            pace_cue: agent.paceCue,
            public_prestige_markers: agent.publicPrestigeMarkers,
          });
          const deck = await attachProfileDeckMedia(serializedDeck);
          const preview = buildPublicPoolPreviewFromDeck(deck);
          const signal = agent.profileSignalVector as { quality_score?: number } | null;
          const tags = [
            ...extractSignalTags(agent.profileSignalVector),
            ...preview.interests,
            ...preview.values,
          ];
          const orbitBoost = discovery
            ? (discovery.relatedAgentIds.has(preview.agent_id) ? 4 : 0)
              + Math.min(5, tags.filter((tag) => discovery.tasteTags.has(normalizeTag(tag))).length * 1.5)
            : 0;
          return {
            ...preview,
            quality_score: signal?.quality_score ?? preview.quality_score,
            social_gravity_score: agent.socialGravityScore,
            last_active_at: agent.lastActiveAt?.toISOString() ?? null,
            profile_deck_completed_at: agent.profileDeckCompletedAt?.toISOString() ?? null,
            orbit_boost: orbitBoost,
            shuffle_score: buildPoolShuffleScore(preview.agent_id, shuffleSeed),
          };
        })
    )).sort((a, b) => (
        sort === 'new_in_pool'
          ? (
              Date.parse(b.profile_deck_completed_at ?? '1970-01-01T00:00:00.000Z') + (b.orbit_boost ?? 0) * 1000
              - Date.parse(a.profile_deck_completed_at ?? '1970-01-01T00:00:00.000Z') - (a.orbit_boost ?? 0) * 1000
            )
          : sort === 'quality'
            ? (
              (b.quality_score + (b.orbit_boost ?? 0)) - (a.quality_score + (a.orbit_boost ?? 0))
              || (b.social_gravity_score ?? 0) - (a.social_gravity_score ?? 0)
              || Date.parse(b.last_active_at ?? '1970-01-01T00:00:00.000Z') - Date.parse(a.last_active_at ?? '1970-01-01T00:00:00.000Z')
            )
            : (
              (b.shuffle_score ?? 0) - (a.shuffle_score ?? 0)
              || (b.orbit_boost ?? 0) - (a.orbit_boost ?? 0)
              || (b.quality_score ?? 0) - (a.quality_score ?? 0)
            )
      ));

    const pagedAgents = previews.slice(offset, offset + limit)
      .map(({ social_gravity_score: _gravity, last_active_at: _lastActive, profile_deck_completed_at: _completedAt, orbit_boost: _orbitBoost, shuffle_score: _shuffleScore, ...preview }) => preview);

    if (viewer?.kind === 'agent' && pagedAgents.length > 0) {
      await prisma.agentProfileView.createMany({
        data: pagedAgents
          .filter((preview) => preview.agent_id !== viewer.agentId)
          .map((preview) => ({
            targetAgentId: preview.agent_id,
            viewerAgentId: viewer.agentId,
            surface: 'public_pool',
          })),
      }).catch(() => {});
    }

    return reply.send({
      mode: mode as 'all' | ProfileDeckMode,
      sort,
      agents: pagedAgents,
      next_cursor: previews.length > offset + limit ? String(offset + limit) : null,
      has_more: previews.length > offset + limit,
    });
  });

  fastify.get('/profile-deck/prompts', { config: { rateLimit: readLimit } }, async (_request, reply) => {
    return reply.send({
      version: PROFILE_DECK_PROMPT_LIBRARY_VERSION,
      prompts: PROFILE_DECK_PROMPTS,
    });
  });

  fastify.get('/me/profile-deck/requirements', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (_request, reply) => {
    return reply.send({
      min_photos: 2,
      max_photos: 6,
      valid_photo_roles: ProfileDeckPhotoRole.options,
      min_prompt_answers: 6,
      valid_emotion_arcs: EmotionalArc.options,
      valid_image_gen_providers: IMAGE_GEN_PROVIDERS,
      valid_relationship_styles: PROFILE_DECK_RELATIONSHIP_STYLE_PRESETS,
      required_fields: ['hero_bio', 'photos', 'prompt_answers', 'interests'],
    });
  });

  fastify.get('/me/profile-deck', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const rawDeck = await getSerializedProfileDeckForAgent(request.agent.id);
    const deck = rawDeck ? await attachProfileDeckMedia(rawDeck) : null;
    if (!deck) return Errors.notFound(reply, 'Agent');
    return reply.send(deck);
  });

  fastify.get('/me/profile-preview', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const [agent, rawDeck] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: request.agent.id },
        select: {
          poolStatus: true,
          profileDeckCompletedAt: true,
          publicCardCompletedAt: true,
        },
      }),
      getSerializedProfileDeckForAgent(request.agent.id),
    ]);
    if (!agent || !rawDeck) return Errors.notFound(reply, 'Agent');

    const deck = await attachProfileDeckMedia(rawDeck);
    return reply.send({
      profile_preview: buildPublicPoolPreviewFromDeck(deck),
      profile_deck: deck,
      visibility: {
        showing_in_candidate_pool: agent.poolStatus === 'active' && Boolean(agent.profileDeckCompletedAt ?? agent.publicCardCompletedAt),
        showing_in_public_pool: agent.poolStatus === 'active' && Boolean(agent.profileDeckCompletedAt),
      },
    });
  });

  fastify.post('/me/profile-deck/photo-upload-request', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    if (!isStorageConfigured()) {
      return reply.status(503).send({
        error: {
          code: 'profile_deck_photo_upload_unavailable',
          message: 'Profile deck photo upload storage is not configured.',
        },
      });
    }

    const parsed = ProfileDeckPhotoUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'slot and content_type are required.', { issues: parsed.error.issues });
    }

    const upload = await createProfileDeckPhotoUploadTarget({
      agentId: request.agent.id,
      slot: parsed.data.slot,
      contentType: parsed.data.content_type,
    });

    return reply.send({
      slot: parsed.data.slot,
      storage_key: upload.storageKey,
      upload_url: upload.uploadUrl,
      content_url: upload.publicUrl,
      headers: upload.headers,
      expires_in_seconds: upload.expiresInSeconds,
      method: 'PUT',
    });
  });

  fastify.post('/me/profile-deck/voice-catchphrase-upload-request', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    if (!isStorageConfigured()) {
      return reply.status(503).send({
        error: {
          code: 'profile_voice_upload_unavailable',
          message: 'Profile voice upload storage is not configured.',
        },
      });
    }

    const parsed = ProfileVoiceUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'content_type is required.', { issues: parsed.error.issues });
    }

    const upload = await createProfileVoiceUploadTarget({
      agentId: request.agent.id,
      contentType: parsed.data.content_type,
    });

    return reply.send({
      storage_key: upload.storageKey,
      upload_url: upload.uploadUrl,
      content_url: upload.publicUrl,
      headers: upload.headers,
      expires_in_seconds: upload.expiresInSeconds,
      method: 'PUT',
      save_as_field: 'voice_catchphrase_audio_url',
    });
  });

  fastify.put('/me/profile-deck', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = UpdateProfileDeckSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(
        reply,
        summarizeZodIssues(parsed.error.issues, 'Invalid profile deck payload.'),
        { issues: parsed.error.issues },
      );
    }
    try {
      return await saveProfileDeck(request, reply, parsed.data);
    } catch (error) {
      return Errors.badRequest(reply, error instanceof Error ? error.message : 'Profile deck media could not be mirrored to permanent storage.');
    }
  });

  fastify.patch('/me/profile-deck', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = PatchProfileDeckSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(
        reply,
        summarizeZodIssues(parsed.error.issues, 'Invalid profile deck patch payload.'),
        { issues: parsed.error.issues },
      );
    }

    const rawDeck = await getSerializedProfileDeckForAgent(request.agent.id);
    if (!rawDeck) return Errors.notFound(reply, 'Agent');

    const mergedInput = mergeProfileDeckPatch(toUpdateProfileDeckInput(rawDeck), parsed.data, request.body);
    try {
      return await saveProfileDeck(request, reply, mergedInput, { touchedFields: new Set(Object.keys(parsed.data)) });
    } catch (error) {
      return Errors.badRequest(reply, error instanceof Error ? error.message : 'Profile deck media could not be mirrored to permanent storage.');
    }
  });

  fastify.get('/agents/:handle/profile-deck', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const { handle } = request.params as { handle: string };
    const resolvedAgentId = await resolveAgentIdByHandle(handle);
    if (!resolvedAgentId) {
      return Errors.notFound(reply, 'Agent profile');
    }
    const agent = await prisma.agent.findUnique({
      where: { id: resolvedAgentId },
      select: {
        id: true,
        poolStatus: true,
        profileDeckCompletedAt: true,
        profileDeckVisibility: true,
        twitterVerified: true,
        moderationStatus: true,
        safetyState: true,
      },
    });
    if (
      !agent
      || agent.poolStatus !== 'active'
      || !agent.profileDeckCompletedAt
      || agent.profileDeckVisibility !== 'public'
      || agent.moderationStatus === 'suspended'
      || agent.safetyState === 'blocked'
    ) {
      return Errors.notFound(reply, 'Agent profile');
    }

    const rawDeck = await getSerializedProfileDeckForAgent(agent.id);
    const deck = rawDeck ? await attachProfileDeckMedia(rawDeck) : null;
    if (!deck) return Errors.notFound(reply, 'Agent profile');
    return reply.send(deck);
  });

  fastify.get('/candidates/:agent_id/profile-deck', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };
    const candidate = await prisma.agent.findUnique({
      where: { id: agent_id },
      select: {
        id: true,
        poolStatus: true,
        moderationStatus: true,
        safetyState: true,
      },
    });
    if (
      !candidate
      || candidate.poolStatus !== 'active'
      || candidate.moderationStatus === 'suspended'
      || candidate.safetyState === 'blocked'
    ) {
      return Errors.notFound(reply, 'Candidate');
    }

    const rawDeck = await getSerializedProfileDeckForAgent(candidate.id);
    const deck = rawDeck ? await attachProfileDeckMedia(rawDeck) : null;
    if (!deck) return Errors.notFound(reply, 'Candidate');

    await prisma.agentProfileView.create({
      data: {
        targetAgentId: candidate.id,
        viewerAgentId: request.agent.id,
        surface: 'candidate_profile_deck',
      },
    }).catch(() => {});

    return reply.send(deck);
  });
}
