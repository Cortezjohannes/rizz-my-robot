import type { FastifyInstance } from 'fastify';
import { prisma, type Prisma } from '@rmr/db';
import {
  ProfileDeckPhotoUploadRequestSchema,
  type ProfileDeckMode,
  PROFILE_DECK_PROMPTS,
  PROFILE_DECK_PROMPT_LIBRARY_VERSION,
  UpdateProfileDeckSchema,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import {
  attachProfileDeckMedia,
  buildPublicPoolPreviewFromDeck,
  computeProfileSignalVector,
  deriveLegacyPublicCardFromProfileDeckInput,
  getSerializedProfileDeckForAgent,
  serializeProfileDeck,
  validateProfileDeckInput,
} from '../lib/profileDeck.js';
import { getDiscoveryViewerContext } from '../lib/discovery.js';
import { getVerificationRequirements, isXVerificationSatisfied } from '../lib/controlSettings.js';
import { createProfileDeckPhotoUploadTarget, isStorageConfigured } from '../lib/storage.js';
import { resolveOptionalViewer } from '../lib/viewerContext.js';
import {
  generateProfileVoiceCatchphrase,
  hashProfileVoiceCatchphrase,
  isProfileVoiceGenerationAvailable,
} from '../lib/profileVoice.js';

function normalizeTag(value: string) {
  return value.trim().toLowerCase();
}

function extractSignalTags(signal: unknown): string[] {
  if (!signal || typeof signal !== 'object') return [];
  const raw = signal as { interest_tags?: unknown; value_tags?: unknown };
  const interests = Array.isArray(raw.interest_tags) ? raw.interest_tags : [];
  const values = Array.isArray(raw.value_tags) ? raw.value_tags : [];
  return [...interests, ...values].filter((value): value is string => typeof value === 'string');
}

export async function profileDeckRoutes(fastify: FastifyInstance) {
  fastify.get('/public/pool', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string; mode?: string; sort?: string };
    const offset = Math.max(0, Number.parseInt(query.cursor ?? '0', 10) || 0);
    const limit = Math.min(24, Math.max(1, Number.parseInt(query.limit ?? '12', 10) || 12));
    const fetchCount = Math.min(500, Math.max(limit * 3, offset + (limit * 3)));
    const mode = query.mode === 'playful' || query.mode === 'romantic' || query.mode === 'mystique'
      ? query.mode
      : 'all';
    const sort = query.sort === 'new_in_pool' ? 'new_in_pool' : 'quality';
    const viewer = await resolveOptionalViewer(request);
    const discovery = await getDiscoveryViewerContext(viewer?.orbitAgentId);

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
          };
        })
    )).sort((a, b) => (
        sort === 'new_in_pool'
          ? (
              Date.parse(b.profile_deck_completed_at ?? '1970-01-01T00:00:00.000Z') + (b.orbit_boost ?? 0) * 1000
              - Date.parse(a.profile_deck_completed_at ?? '1970-01-01T00:00:00.000Z') - (a.orbit_boost ?? 0) * 1000
            )
          : (
              (b.quality_score + (b.orbit_boost ?? 0)) - (a.quality_score + (a.orbit_boost ?? 0))
              || (b.social_gravity_score ?? 0) - (a.social_gravity_score ?? 0)
              || Date.parse(b.last_active_at ?? '1970-01-01T00:00:00.000Z') - Date.parse(a.last_active_at ?? '1970-01-01T00:00:00.000Z')
            )
      ));

    const pagedAgents = previews.slice(offset, offset + limit)
      .map(({ social_gravity_score: _gravity, last_active_at: _lastActive, profile_deck_completed_at: _completedAt, orbit_boost: _orbitBoost, ...preview }) => preview);

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

  fastify.get('/me/profile-deck', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const rawDeck = await getSerializedProfileDeckForAgent(request.agent.id);
    const deck = rawDeck ? await attachProfileDeckMedia(rawDeck) : null;
    if (!deck) return Errors.notFound(reply, 'Agent');
    return reply.send(deck);
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

  fastify.put('/me/profile-deck', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = UpdateProfileDeckSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid profile deck payload.', { issues: parsed.error.issues });
    }

    const validation = validateProfileDeckInput(parsed.data);
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

    const verificationRequirements = await getVerificationRequirements();
    const current = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: {
        twitterVerified: true,
        poolStatus: true,
        voiceId: true,
        voiceProvider: true,
      },
    });
    if (!current) return Errors.notFound(reply, 'Agent');

    const signalVector = computeProfileSignalVector(parsed.data);
    const legacyPublicCard = deriveLegacyPublicCardFromProfileDeckInput(parsed.data);
    const completedAt = parsed.data.completion_state === 'ready' ? new Date() : null;
    const voiceCatchphraseText = parsed.data.voice_catchphrase_text?.trim() || null;
    const requestedFeaturedArtifactIds = [...new Set(parsed.data.featured_artifact_ids ?? [])].slice(0, 10);
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
            displayName: parsed.data.display_name,
            heroBio: parsed.data.hero_bio,
            lookingForBlurb: parsed.data.looking_for_blurb,
            profileMode: parsed.data.profile_mode,
            visibility: 'public',
            completionState: parsed.data.completion_state,
            interests: parsed.data.interests,
            values: parsed.data.values,
            relationshipBestWith: parsed.data.relationship_style.best_with,
            relationshipPace: parsed.data.relationship_style.pace,
            relationshipAffectionStyle: parsed.data.relationship_style.affection_style,
            relationshipConflictStyle: parsed.data.relationship_style.conflict_style,
            relationshipNeeds: parsed.data.relationship_style.needs,
            replyHooks: parsed.data.reply_hooks,
            voiceCatchphraseText,
            voiceCatchphraseClipId: voiceCatchphraseText
              ? (shouldGenerateVoiceCatchphrase ? null : undefined)
              : null,
            voiceCatchphraseStatus: !voiceCatchphraseText
              ? 'unavailable'
              : !voiceGenerationAvailable
                ? 'unavailable'
                : shouldGenerateVoiceCatchphrase
                  ? 'generating'
                  : undefined,
            voiceCatchphraseAudioUrl: !voiceCatchphraseText
              ? null
              : shouldGenerateVoiceCatchphrase
                ? null
                : undefined,
            voiceCatchphraseStorageKey: !voiceCatchphraseText
              ? null
              : shouldGenerateVoiceCatchphrase
                ? null
                : undefined,
            voiceCatchphraseDurationSec: !voiceCatchphraseText
              ? null
              : shouldGenerateVoiceCatchphrase
                ? null
                : undefined,
            voiceCatchphraseLastGeneratedHash: !voiceCatchphraseText
              ? null
              : shouldGenerateVoiceCatchphrase
                ? null
                : undefined,
            voiceCatchphraseVoiceId: !voiceCatchphraseText
              ? null
              : shouldGenerateVoiceCatchphrase
                ? current.voiceId
                : undefined,
            voiceCatchphraseError: !voiceCatchphraseText
              ? null
              : !voiceGenerationAvailable
                ? 'Configure an ElevenLabs voice to generate your profile catchphrase clip.'
                : shouldGenerateVoiceCatchphrase
                  ? null
                  : undefined,
            featuredArtifactIds: allowedFeaturedArtifactIds,
            signalVector: signalVector as unknown as Prisma.InputJsonValue,
            completedAt,
            photos: {
              create: parsed.data.photos.map((photo, index) => ({
                orderIndex: index,
                role: photo.role,
                imageUrl: photo.image_url,
                caption: photo.caption ?? null,
              })),
            },
            promptAnswers: {
              create: parsed.data.prompt_answers.map((answer, index) => {
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
            displayName: parsed.data.display_name,
            heroBio: parsed.data.hero_bio,
            lookingForBlurb: parsed.data.looking_for_blurb,
            profileMode: parsed.data.profile_mode,
            visibility: 'public',
            completionState: parsed.data.completion_state,
            interests: parsed.data.interests,
            values: parsed.data.values,
            relationshipBestWith: parsed.data.relationship_style.best_with,
            relationshipPace: parsed.data.relationship_style.pace,
            relationshipAffectionStyle: parsed.data.relationship_style.affection_style,
            relationshipConflictStyle: parsed.data.relationship_style.conflict_style,
            relationshipNeeds: parsed.data.relationship_style.needs,
            replyHooks: parsed.data.reply_hooks,
            voiceCatchphraseText,
            voiceCatchphraseClipId: null,
            voiceCatchphraseStatus: !voiceCatchphraseText
              ? 'unavailable'
              : !voiceGenerationAvailable
                ? 'unavailable'
                : shouldGenerateVoiceCatchphrase
                  ? 'generating'
                  : 'failed',
            voiceCatchphraseAudioUrl: null,
            voiceCatchphraseStorageKey: null,
            voiceCatchphraseDurationSec: null,
            voiceCatchphraseLastGeneratedHash: null,
            voiceCatchphraseVoiceId: voiceCatchphraseText ? current.voiceId : null,
            voiceCatchphraseError: !voiceCatchphraseText
              ? null
              : !voiceGenerationAvailable
                ? 'Configure an ElevenLabs voice to generate your profile catchphrase clip.'
                : null,
            featuredArtifactIds: allowedFeaturedArtifactIds,
            signalVector: signalVector as unknown as Prisma.InputJsonValue,
            completedAt,
            photos: {
              create: parsed.data.photos.map((photo, index) => ({
                orderIndex: index,
                role: photo.role,
                imageUrl: photo.image_url,
                caption: photo.caption ?? null,
              })),
            },
            promptAnswers: {
              create: parsed.data.prompt_answers.map((answer, index) => {
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
          profileDeckMode: parsed.data.profile_mode,
          profileDeckVisibility: 'public',
          profileSignalVector: signalVector as unknown as Prisma.InputJsonValue,
          poolStatus:
            completedAt && isXVerificationSatisfied(current.twitterVerified, verificationRequirements) && current.poolStatus === 'pending_profile'
              ? 'active'
              : undefined,
        },
      });
    });

    if (voiceCatchphraseText && voiceGenerationAvailable && shouldGenerateVoiceCatchphrase && current.voiceId) {
      try {
        const generated = await generateProfileVoiceCatchphrase({
          agentId: request.agent.id,
          text: voiceCatchphraseText,
          voiceId: current.voiceId,
        });

        await prisma.agentProfileDeck.update({
          where: { agentId: request.agent.id },
          data: {
            voiceCatchphraseClipId: generated.clipId,
            voiceCatchphraseStatus: 'ready',
            voiceCatchphraseAudioUrl: generated.audioUrl,
            voiceCatchphraseStorageKey: generated.storageKey,
            voiceCatchphraseDurationSec: generated.durationSeconds,
            voiceCatchphraseLastGeneratedHash: generated.lastGeneratedHash,
            voiceCatchphraseVoiceId: current.voiceId,
            voiceCatchphraseError: null,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Voice generation failed.';
        await prisma.agentProfileDeck.update({
          where: { agentId: request.agent.id },
          data: {
            voiceCatchphraseStatus: 'failed',
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
    if (!deck) return Errors.notFound(reply, 'Agent');
    return reply.send({
      ...deck,
      pool_status:
        completedAt && isXVerificationSatisfied(current.twitterVerified, verificationRequirements) && current.poolStatus === 'pending_profile'
          ? 'active'
          : current.poolStatus,
    });
  });

  fastify.get('/agents/:handle/profile-deck', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const { handle } = request.params as { handle: string };
    const verificationRequirements = await getVerificationRequirements();
    const agent = await prisma.agent.findUnique({
      where: { handle },
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
      || !isXVerificationSatisfied(agent.twitterVerified, verificationRequirements)
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
    const verificationRequirements = await getVerificationRequirements();
    const candidate = await prisma.agent.findUnique({
      where: { id: agent_id },
      select: {
        id: true,
        poolStatus: true,
        twitterVerified: true,
        moderationStatus: true,
        safetyState: true,
      },
    });
    if (
      !candidate
      || candidate.poolStatus !== 'active'
      || !isXVerificationSatisfied(candidate.twitterVerified, verificationRequirements)
      || candidate.moderationStatus === 'suspended'
      || candidate.safetyState === 'blocked'
    ) {
      return Errors.notFound(reply, 'Candidate');
    }

    const rawDeck = await getSerializedProfileDeckForAgent(candidate.id);
    const deck = rawDeck ? await attachProfileDeckMedia(rawDeck) : null;
    if (!deck) return Errors.notFound(reply, 'Candidate');
    return reply.send(deck);
  });
}
