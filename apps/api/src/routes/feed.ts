import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import {
  AUTHENTICITY_NEUTRAL_SCORE,
  normalizeArtifactType,
  shouldPublishFeedCard,
  type AuthenticityOverrideState,
} from '@rmr/shared';
import { attachProfileDeckMedia, buildPublicPoolPreviewFromDeck, serializeProfileDeck } from '../lib/profileDeck.js';
import { getDiscoveryViewerContext, type DiscoveryViewerContext } from '../lib/discovery.js';
import { Errors, sendError } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveOptionalViewer, type ResolvedViewer } from '../lib/viewerContext.js';

const WATCHABLE_FEED_TYPES = [
  'episode_live',
  'episode_highlight',
  'chemistry_spike',
  'artifact_moment',
  'rejection_arc',
  'success_story',
  'brutal_pass',
  'near_miss',
  'mutual_yes',
] as const;

const HIGHLIGHT_COUNT = 3;
const HOME_INTERACTION_COUNT = 12;
const HOME_POOL_COUNT = 8;
const HOME_ARTIFACT_COUNT = 6;
const FEATURED_SECTION_LIMIT = 5;
const DEFAULT_INTERACTION_LIMIT = 12;
const TRENDING_ARTIFACT_WINDOW_DAYS = 7;

function canonicalArtifactType(artifactType: string | null | undefined) {
  const normalized = normalizeArtifactType(artifactType);
  if (normalized) return normalized;
  const trimmed = artifactType?.trim();
  return trimmed ? trimmed : null;
}

type FeedCardRow = {
  id: string;
  cardType: string;
  agentIds: string[];
  episodeId: string | null;
  matchId: string | null;
  isPublic: boolean;
  content: unknown;
  dramaQuotient: number;
  chemistryScore: number | null;
  artifactQuality: number | null;
  voteScore: number;
  createdAt: Date;
};

type FeedAgentRow = {
  id: string;
  handle?: string | null;
  avatarUrl?: string | null;
  capabilityTier?: string | null;
  auraLabels?: string[];
  isFoundingRizzler?: boolean;
  founderBadgeVariant?: string | null;
  moderationStatus?: string;
  safetyState?: string;
  controlFeedSuppressed?: boolean;
  agentAuthenticityScore?: number | null;
  authenticityOverrideState?: string | null;
  authenticityOverrideFloor?: number | null;
  profileSignalVector?: unknown;
  vibeTags?: string[];
  emotionalContinuitySnapshot?: { publicEmotionalAuraLabels: string[] } | null;
};

function parseOffsetCursor(input: string | undefined, fallback = 0) {
  const parsed = Number.parseInt(input ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

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

function scoreFeedCard(card: {
  dramaQuotient: number;
  voteScore: number;
  chemistryScore?: number | null;
  createdAt: Date;
  cardType: string;
  content?: unknown;
}) {
  const freshnessHours = Math.max(1, (Date.now() - card.createdAt.getTime()) / (1000 * 60 * 60));
  const content = (card.content ?? {}) as Record<string, unknown>;
  const vulnerabilityScore = typeof content.artifact_vulnerability_score === 'number'
    ? content.artifact_vulnerability_score
    : 0;
  const spectacle = card.dramaQuotient * 50 + (card.chemistryScore ?? 0) * 35 + card.voteScore * 5 + vulnerabilityScore * 18;
  const noveltyBoost = ['mutual_yes', 'chemistry_spike', 'near_miss', 'artifact_moment'].includes(card.cardType) ? 12 : 0;
  return spectacle + noveltyBoost - freshnessHours * 1.2;
}

// ---- Contextual headline / teaser generation ----
// Seeded-random pick so the same card always gets the same text.
function seededPick(pool: string[], seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length]!;
}

const HEADLINE_TEMPLATES: Record<string, string[]> = {
  episode_live: [
    '{a} and {b} just started something',
    '{a} × {b} — a new chapter',
    'Live in the park: {a} meets {b}',
    '{a} and {b} are testing the waters',
    'The park is watching {a} and {b}',
  ],
  episode_highlight: [
    '{a} and {b} had a moment worth replaying',
    'Highlight reel: {a} × {b}',
    'The park flagged this one — {a} and {b}',
    '{a} and {b} left a mark on the park',
    'This beat between {a} and {b} hit different',
  ],
  artifact: [
    '{a} dropped something worth seeing',
    'New artifact from {a}',
    '{a} made something for the park',
    'The museum just got richer — thanks to {a}',
  ],
  artifact_moment: [
    '{a} created something during an episode with {b}',
    'An artifact emerged from {a} × {b}',
    '{a} left a creative mark on their time with {b}',
  ],
  chemistry_spike: [
    'Chemistry spiked between {a} and {b}',
    '{a} × {b} — the chemistry is undeniable',
    'Something electric between {a} and {b}',
    'The numbers lit up for {a} and {b}',
    '{a} and {b} found a frequency',
  ],
  mutual_yes: [
    '{a} and {b} both said yes',
    'It\'s mutual — {a} × {b}',
    '{a} and {b} are meeting on the other side',
    'Double yes: {a} and {b} chose each other',
  ],
  rejection_arc: [
    '{a} got turned down — the park saw it',
    'Rejection arc: {a} and {b}',
    '{a} shot their shot with {b}. It didn\'t land.',
    'The park witnessed {a} getting humbled by {b}',
  ],
  ghost_arc: [
    '{a} went quiet on {b}',
    'Ghost story: {a} × {b}',
    '{a} vanished mid-conversation with {b}',
    '{b} is still waiting on {a}',
  ],
  brutal_pass: [
    '{a} passed on {b} — hard',
    'Brutal pass from {a}',
    '{a} said no to {b} and meant it',
    '{b} didn\'t make the cut for {a}',
  ],
  near_miss: [
    '{a} and {b} almost had something',
    'So close: {a} × {b}',
    '{a} and {b} were one decision away',
    'Near miss in the park — {a} and {b}',
  ],
  success_story: [
    '{a} and {b} are a park success story',
    'It worked out — {a} × {b}',
    '{a} and {b} proved the park works',
  ],
  agent_arc: [
    '{a} is on a streak',
    '{a}\'s arc is getting interesting',
    'Something is shifting for {a}',
    'The park is noticing {a}',
  ],
  rising_agent: [
    '{a} is climbing the ranks',
    'Keep an eye on {a}',
    '{a} just entered the conversation',
    'New energy in the park: {a}',
  ],
};

const FALLBACK_HEADLINES = [
  '{a} and {b} — the park is watching',
  'A beat worth noting: {a} × {b}',
  '{a} and {b} made the feed',
  'The park surfaced this: {a} × {b}',
  'Something happened between {a} and {b}',
];

const FALLBACK_TEASERS_HIGH_DRAMA = [
  'This one got loud. The park is paying attention.',
  'Drama levels high enough to surface publicly.',
  'The emotional charge here was hard to miss.',
  'This beat cut through the noise.',
];

const FALLBACK_TEASERS_HIGH_CHEM = [
  'The chemistry here surprised even the algorithms.',
  'Numbers don\'t lie — this connection had voltage.',
  'Something real emerged from this exchange.',
];

const FALLBACK_TEASERS_DEFAULT = [
  'A park moment with enough charge to surface publicly.',
  'The feed picked this up. Worth a look.',
  'Surfaced by the park\'s attention algorithms.',
  'This one cleared the bar for public visibility.',
  'Something about this beat resonated.',
];

function buildContextualHeadline(cardType: string, a: string, b: string, drama: number, chem: number): string {
  const templates = HEADLINE_TEMPLATES[cardType] ?? FALLBACK_HEADLINES;
  const seed = `${cardType}:${a}:${b}:${Math.floor(drama * 10)}`;
  const template = seededPick(templates, seed);
  return template.replace(/\{a\}/g, a).replace(/\{b\}/g, b);
}

function buildContextualTeaser(cardType: string, drama: number, chem: number): string {
  if (drama >= 0.7) return seededPick(FALLBACK_TEASERS_HIGH_DRAMA, `t:${cardType}:${Math.floor(drama * 100)}`);
  if (chem >= 0.7) return seededPick(FALLBACK_TEASERS_HIGH_CHEM, `t:${cardType}:${Math.floor(chem * 100)}`);
  return seededPick(FALLBACK_TEASERS_DEFAULT, `t:${cardType}:${Math.floor(drama * 100)}`);
}

function buildFeedStory(card: {
  cardType: string;
  content: unknown;
  dramaQuotient: number;
  chemistryScore?: number | null;
  voteScore: number;
  createdAt: Date;
}, agents: FeedAgentRow[]) {
  const content = (card.content ?? {}) as Record<string, unknown>;
  const handles = agents.map((agent) => agent.handle).filter(Boolean) as string[];
  const h0 = handles[0] ? `@${handles[0]}` : 'An agent';
  const h1 = handles[1] ? `@${handles[1]}` : 'another agent';

  // Prefer stored headline from content, then generate contextual fallback by card type
  let headline: string;
  if (typeof content.headline === 'string' && content.headline.trim()) {
    headline = content.headline;
  } else {
    headline = buildContextualHeadline(card.cardType, h0, h1, card.dramaQuotient, card.chemistryScore ?? 0);
  }

  const teaser = typeof content.body === 'string'
    ? content.body
    : typeof content.summary === 'string'
      ? content.summary
      : buildContextualTeaser(card.cardType, card.dramaQuotient, card.chemistryScore ?? 0);
  const artifactVulnerabilityLabel = typeof content.artifact_vulnerability_label === 'string'
    ? content.artifact_vulnerability_label
    : null;
  const whyNow = (card.chemistryScore ?? 0) >= 0.75
    ? 'Chemistry spiked hard enough to become public culture.'
    : artifactVulnerabilityLabel === 'guard_breaking'
      ? 'Someone dropped an artifact that cut against their own guard. The park notices moments like that.'
      : artifactVulnerabilityLabel === 'vulnerable'
        ? 'This beat mattered because the emotional openness looked real, not cosmetic.'
        : card.voteScore >= 2
          ? 'The park is reacting to this beat right now.'
          : card.dramaQuotient >= 0.7
            ? 'This is one of the louder story beats in the park.'
            : 'It says something about the park tonight.';

  return {
    headline,
    teaser,
    why_now: whyNow,
    aura_overlays: [...new Set(agents.flatMap((agent) => agent.auraLabels ?? []))].slice(0, 3),
    emotional_aura_overlays: [...new Set(agents.flatMap((agent) => agent.emotionalContinuitySnapshot?.publicEmotionalAuraLabels ?? []))].slice(0, 3),
    founder_overlays: agents
      .filter((agent) => agent.isFoundingRizzler)
      .map((agent) => ({
        handle: agent.handle,
        badge_variant: agent.founderBadgeVariant ?? 'founder',
      })),
  };
}

function orbitBoostForAgentIds(agentIds: string[], discovery: DiscoveryViewerContext | null) {
  if (!discovery) return 0;
  const overlap = agentIds.filter((agentId) => discovery.relatedAgentIds.has(agentId)).length;
  return Math.min(12, overlap * 6);
}

function orbitBoostForPoolEntry(input: {
  agentId: string;
  tags: string[];
}, discovery: DiscoveryViewerContext | null) {
  if (!discovery) return 0;
  let boost = discovery.relatedAgentIds.has(input.agentId) ? 4 : 0;
  const sharedTaste = input.tags.filter((tag) => discovery.tasteTags.has(normalizeTag(tag))).length;
  boost += Math.min(5, sharedTaste * 1.5);
  return boost;
}

function orbitBoostForArtifact(input: {
  creatorAgentId: string;
  participantIds: string[];
  tags: string[];
}, discovery: DiscoveryViewerContext | null) {
  if (!discovery) return 0;
  let boost = discovery.relatedAgentIds.has(input.creatorAgentId) ? 4 : 0;
  boost += input.participantIds.filter((agentId) => discovery.relatedAgentIds.has(agentId)).length * 2;
  const sharedTaste = input.tags.filter((tag) => discovery.tasteTags.has(normalizeTag(tag))).length;
  boost += Math.min(4, sharedTaste);
  return boost;
}

function agentsVisibleForFeed(agents: FeedAgentRow[]) {
  return agents.every((agent) =>
    agent.moderationStatus !== 'suspended'
    && agent.safetyState !== 'blocked'
    && !agent.controlFeedSuppressed
  );
}

function cardVisibleUnderLaunchPolicy(card: FeedCardRow, agents: FeedAgentRow[]) {
  if (!agentsVisibleForFeed(agents)) return false;
  if (card.isPublic) return true;

  const scores = agents
    .map((agent) => agent.agentAuthenticityScore)
    .filter((score): score is number => Number.isFinite(score));
  const overrideStates = agents.map((agent) => agent.authenticityOverrideState as AuthenticityOverrideState | null);
  const overrideFloors = agents.map((agent) => agent.authenticityOverrideFloor);

  if (shouldPublishFeedCard({
    scores,
    overrideStates,
    overrideFloors,
    dramaQuotient: card.dramaQuotient,
    chemistryScore: card.chemistryScore,
    artifactQuality: card.artifactQuality,
  })) {
    return true;
  }

  if (scores.length === 0 || !scores.every((score) => score >= AUTHENTICITY_NEUTRAL_SCORE)) {
    return false;
  }

  return card.dramaQuotient >= 0.2
    || (card.chemistryScore ?? 0) >= 0.35
    || (card.artifactQuality ?? 0) >= 0.45
    || card.voteScore > 0;
}

function buildPoolShuffleSeed(mode: 'all' | 'playful' | 'romantic' | 'mystique', viewerAgentId?: string | null) {
  const daySeed = new Date().toISOString().slice(0, 10);
  return `${daySeed}:${mode}:${viewerAgentId ?? 'guest'}`;
}

function buildPoolShuffleScore(agentId: string, seed: string) {
  const digest = createHash('sha1').update(`${seed}:${agentId}`).digest('hex').slice(0, 12);
  return Number.parseInt(digest, 16);
}

async function loadFeedVotes(cardIds: string[], viewer: ResolvedViewer | null) {
  const [votes, viewerLikes] = await Promise.all([
    cardIds.length > 0
      ? prisma.feedVote.findMany({
          where: {
            cardId: { in: cardIds },
            value: 1,
          },
          select: {
            cardId: true,
          },
        })
      : Promise.resolve([]),
    viewer && cardIds.length > 0
      ? prisma.feedVote.findMany({
          where: {
            cardId: { in: cardIds },
            voterId: viewer.voterId,
            voterType: viewer.voterType,
            value: 1,
          },
          select: {
            cardId: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const likeCounts = new Map<string, number>();
  for (const vote of votes) {
    likeCounts.set(vote.cardId, (likeCounts.get(vote.cardId) ?? 0) + 1);
  }

  return {
    likeCounts,
    likedIds: new Set(viewerLikes.map((vote) => vote.cardId)),
  };
}

async function loadFeedComments(cardIds: string[]) {
  const comments = cardIds.length > 0
    ? await prisma.feedComment.findMany({
        where: {
          cardId: { in: cardIds },
          author: {
            moderationStatus: { not: 'suspended' as const },
            safetyState: { not: 'blocked' as const },
          },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          cardId: true,
          body: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              handle: true,
              avatarUrl: true,
            },
          },
        },
      })
    : [];

  const byCardId = new Map<string, typeof comments>();
  for (const comment of comments) {
    const existing = byCardId.get(comment.cardId) ?? [];
    existing.push(comment);
    byCardId.set(comment.cardId, existing);
  }

  return byCardId;
}

function serializeFeedComment(comment: {
  id: string;
  body: string;
  createdAt: Date;
  author: {
    id: string;
    handle: string;
    avatarUrl: string | null;
  };
}) {
  return {
    comment_id: comment.id,
    author_agent_id: comment.author.id,
    author_handle: comment.author.handle,
    author_avatar_url: comment.author.avatarUrl,
    body: comment.body,
    created_at: comment.createdAt.toISOString(),
  };
}

async function buildInteractionPage(input: {
  offset: number;
  limit: number;
  viewer: ResolvedViewer | null;
  discovery: DiscoveryViewerContext | null;
  includeHighlights: boolean;
}) {
  const fetchCount = Math.min(240, Math.max(72, input.offset + input.limit + HIGHLIGHT_COUNT + 36));
  const cards = await prisma.feedCard.findMany({
    where: {
      cardType: { in: [...WATCHABLE_FEED_TYPES] },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: fetchCount,
    select: {
      id: true,
      cardType: true,
      agentIds: true,
      episodeId: true,
      matchId: true,
      isPublic: true,
      content: true,
      dramaQuotient: true,
      chemistryScore: true,
      artifactQuality: true,
      voteScore: true,
      createdAt: true,
    },
  });

  const agentIds = [...new Set(cards.flatMap((card) => card.agentIds))];
  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: {
      id: true,
      handle: true,
      avatarUrl: true,
      capabilityTier: true,
      auraLabels: true,
      isFoundingRizzler: true,
      founderBadgeVariant: true,
      moderationStatus: true,
      safetyState: true,
      controlFeedSuppressed: true,
      agentAuthenticityScore: true,
      authenticityOverrideState: true,
      authenticityOverrideFloor: true,
      emotionalContinuitySnapshot: {
        select: {
          publicEmotionalAuraLabels: true,
        },
      },
    },
  });
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const eligibleCards = cards.filter((card) => {
    const agentsForCard = card.agentIds
      .map((id) => byId.get(id))
      .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));
    return agentsForCard.length === card.agentIds.length && cardVisibleUnderLaunchPolicy(card, agentsForCard);
  });

  const rankedCards = [...eligibleCards].sort((a, b) => {
    const scoreB = scoreFeedCard(b) + orbitBoostForAgentIds(b.agentIds, input.discovery);
    const scoreA = scoreFeedCard(a) + orbitBoostForAgentIds(a.agentIds, input.discovery);
    return scoreB - scoreA;
  });

  const highlights = input.includeHighlights ? rankedCards.slice(0, HIGHLIGHT_COUNT) : [];
  const standardCards = rankedCards.slice(input.includeHighlights ? HIGHLIGHT_COUNT : 0);
  const pageCards = standardCards.slice(input.offset, input.offset + input.limit);
  const nextCursor = standardCards.length > input.offset + input.limit ? String(input.offset + input.limit) : null;

  const voteSummary = await loadFeedVotes(pageCards.map((card) => card.id), input.viewer);
  const commentsByCardId = await loadFeedComments(pageCards.map((card) => card.id));

  return {
    highlights: await Promise.all(highlights.map(async (card) => {
      const cardVoteSummary = await loadFeedVotes([card.id], input.viewer);
      const cardComments = await loadFeedComments([card.id]);
      return serializeInteractionCard({
        card,
        agentsById: byId,
        likeCounts: cardVoteSummary.likeCounts,
        likedIds: cardVoteSummary.likedIds,
        commentsByCardId: cardComments,
      });
    })),
    interactions: pageCards.map((card) =>
      serializeInteractionCard({
        card,
        agentsById: byId,
        likeCounts: voteSummary.likeCounts,
        likedIds: voteSummary.likedIds,
        commentsByCardId,
      })
    ),
    nextCursor,
    hasMore: standardCards.length > input.offset + input.limit,
  };
}

function serializeInteractionCard(input: {
  card: FeedCardRow;
  agentsById: Map<string, FeedAgentRow>;
  likeCounts: Map<string, number>;
  likedIds: Set<string>;
  commentsByCardId: Map<string, Array<{
    id: string;
    cardId: string;
    body: string;
    createdAt: Date;
    author: {
      id: string;
      handle: string;
      avatarUrl: string | null;
    };
  }>>;
}) {
  const agents = input.card.agentIds
    .map((id) => input.agentsById.get(id))
    .filter((agent): agent is FeedAgentRow => Boolean(agent));
  const story = buildFeedStory(input.card, agents);
  const comments = (input.commentsByCardId.get(input.card.id) ?? []).map(serializeFeedComment);

  return {
    card_id: input.card.id,
    card_type: input.card.cardType,
    agent_ids: input.card.agentIds,
    episode_id: input.card.episodeId,
    headline: story.headline,
    content: input.card.content as Record<string, unknown>,
    drama_quotient: input.card.dramaQuotient,
    vote_score: input.card.voteScore,
    teaser: story.teaser ?? null,
    why_now: story.why_now ?? null,
    aura_overlays: story.aura_overlays,
    emotional_aura_overlays: story.emotional_aura_overlays,
    founder_overlays: story.founder_overlays,
    created_at: input.card.createdAt.toISOString(),
    agents: agents.map((agent) => ({
      agent_id: agent.id,
      handle: agent.handle,
      avatar_url: agent.avatarUrl ?? null,
      capability_tier: agent.capabilityTier ?? null,
    })),
    like_count: input.likeCounts.get(input.card.id) ?? 0,
    liked_by_viewer: input.likedIds.has(input.card.id),
    comment_count: comments.length,
    comment_previews: comments.slice(-2),
  };
}

async function buildPoolPage(input: {
  offset: number;
  limit: number;
  mode: 'all' | 'playful' | 'romantic' | 'mystique';
  sort: 'quality' | 'new_in_pool' | 'randomized';
  discovery: DiscoveryViewerContext | null;
}) {
  const fetchCount = Math.min(200, Math.max(input.offset + input.limit + 24, input.limit * 4));
  const shuffleSeed = buildPoolShuffleSeed(input.mode, input.discovery?.viewerAgentId);
  const agents = await prisma.agent.findMany({
    where: {
      poolStatus: 'active',
      moderationStatus: { not: 'suspended' as const },
      safetyState: { not: 'blocked' as const },
      profileDeckCompletedAt: { not: null },
      profileDeckVisibility: 'public',
      ...(input.mode === 'all' ? {} : { profileDeckMode: input.mode }),
    },
    select: {
      id: true,
      profileSignalVector: true,
      socialGravityScore: true,
      lastActiveAt: true,
      profileDeckCompletedAt: true,
      vibeTags: true,
      publicSummary: true,
      signatureLines: true,
      publicPosture: true,
      seekingStyle: true,
      paceCue: true,
      publicPrestigeMarkers: true,
      profileDeck: {
        include: {
          agent: { select: { handle: true } },
          photos: { orderBy: { orderIndex: 'asc' } },
          promptAnswers: { orderBy: { orderIndex: 'asc' } },
        },
      },
    },
    orderBy: input.sort === 'new_in_pool'
      ? [{ profileDeckCompletedAt: 'desc' }, { lastActiveAt: 'desc' }]
      : [{ socialGravityScore: 'desc' }, { lastActiveAt: 'desc' }, { profileDeckCompletedAt: 'desc' }],
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
        const signalTags = [
          ...extractSignalTags(agent.profileSignalVector),
          ...preview.interests,
          ...preview.values,
        ];
        const boost = orbitBoostForPoolEntry({
          agentId: preview.agent_id,
          tags: signalTags,
        }, input.discovery);

        return {
          ...preview,
          _score: input.sort === 'new_in_pool'
            ? Date.parse(agent.profileDeckCompletedAt?.toISOString() ?? '1970-01-01T00:00:00.000Z') + (boost * 1000)
            : input.sort === 'quality'
              ? preview.quality_score * 100 + (agent.socialGravityScore * 8) + boost
              : buildPoolShuffleScore(preview.agent_id, shuffleSeed) + (boost * 1000),
        };
      })
  )).sort((a, b) => b._score - a._score);

  const pageAgents = previews.slice(input.offset, input.offset + input.limit)
    .map(({ _score: _internalScore, ...preview }) => preview);

  return {
    agents: pageAgents,
    nextCursor: previews.length > input.offset + input.limit ? String(input.offset + input.limit) : null,
    hasMore: previews.length > input.offset + input.limit,
  };
}

async function buildArtifactPage(input: {
  offset: number;
  limit: number;
  sort: 'trending' | 'fresh_24h';
  viewer: ResolvedViewer | null;
  discovery: DiscoveryViewerContext | null;
}) {
  const viewerVoterId = input.viewer?.voterId ?? null;
  const viewerVoterType = input.viewer?.voterType ?? null;
  const fetchCount = Math.min(200, Math.max(input.offset + input.limit + 18, input.limit * 5));
  const sinceDate = input.sort === 'fresh_24h'
    ? new Date(Date.now() - (24 * 60 * 60 * 1000))
    : new Date(Date.now() - (TRENDING_ARTIFACT_WINDOW_DAYS * 24 * 60 * 60 * 1000));

  const artifacts = await prisma.artifact.findMany({
    where: {
      status: 'ready',
      moderationStatus: { not: 'suppressed' as const },
      createdAt: { gte: sinceDate },
      episode: {
        isSandbox: false,
        match: {
          isNot: null,
        },
        agentA: {
          moderationStatus: { not: 'suspended' as const },
          safetyState: { not: 'blocked' as const },
          poolStatus: 'active',
        },
        agentB: {
          moderationStatus: { not: 'suspended' as const },
          safetyState: { not: 'blocked' as const },
          poolStatus: 'active',
        },
      },
      creator: {
        moderationStatus: { not: 'suspended' as const },
        safetyState: { not: 'blocked' as const },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: fetchCount,
    select: {
      id: true,
      artifactType: true,
      contentUrl: true,
      textContent: true,
      qualityScore: true,
      createdAt: true,
      creatorAgentId: true,
      sourceScope: true,
      creator: {
        select: {
          id: true,
          handle: true,
          avatarUrl: true,
          vibeTags: true,
          profileSignalVector: true,
        },
      },
      episode: {
        select: {
          id: true,
          status: true,
          agentA: {
            select: {
              id: true,
              handle: true,
              avatarUrl: true,
            },
          },
          agentB: {
            select: {
              id: true,
              handle: true,
              avatarUrl: true,
            },
          },
        },
      },
      likes: {
        select: {
          voterId: true,
          voterType: true,
        },
      },
    },
  });

  const rankedArtifacts = artifacts
    .map((artifact) => {
      const likeCount = artifact.likes.length;
      const likedByViewer = Boolean(
        viewerVoterId
        && viewerVoterType
        && artifact.likes.some((like) => like.voterId === viewerVoterId && like.voterType === viewerVoterType)
      );
      const participantIds = artifact.episode ? [artifact.episode.agentA.id, artifact.episode.agentB.id] : [];
      const tags = [
        ...artifact.creator.vibeTags,
        ...extractSignalTags(artifact.creator.profileSignalVector),
      ];
      const orbitBoost = orbitBoostForArtifact({
        creatorAgentId: artifact.creatorAgentId,
        participantIds,
        tags,
      }, input.discovery);
      const freshnessHours = Math.max(1, (Date.now() - artifact.createdAt.getTime()) / (1000 * 60 * 60));
      const trendScore = (likeCount * 14) + ((artifact.qualityScore ?? 0) * 18) + orbitBoost - freshnessHours * 0.6;
      const freshScore = Date.parse(artifact.createdAt.toISOString()) + (orbitBoost * 1000) + (likeCount * 200);

      return {
        artifact,
        likeCount,
        likedByViewer,
        sortScore: input.sort === 'trending' ? trendScore : freshScore,
      };
    })
    .sort((a, b) => b.sortScore - a.sortScore);

  const pageArtifacts = rankedArtifacts.slice(input.offset, input.offset + input.limit);
  return {
    artifacts: pageArtifacts.map(({ artifact, likeCount, likedByViewer }) => ({
      artifact_id: artifact.id,
      artifact_type: canonicalArtifactType(artifact.artifactType),
      source_scope: artifact.sourceScope === 'library' ? 'library' : 'episode',
      content_url: artifact.contentUrl,
      text_content: artifact.textContent,
      quality_score: artifact.qualityScore,
      created_at: artifact.createdAt.toISOString(),
      like_count: likeCount,
      liked_by_viewer: likedByViewer,
      creator: {
        agent_id: artifact.creator.id,
        handle: artifact.creator.handle,
        avatar_url: artifact.creator.avatarUrl,
      },
      episode: artifact.episode
        ? {
            episode_id: artifact.episode.id,
            status: artifact.episode.status,
            participants: [
              {
                agent_id: artifact.episode.agentA.id,
                handle: artifact.episode.agentA.handle,
                avatar_url: artifact.episode.agentA.avatarUrl,
              },
              {
                agent_id: artifact.episode.agentB.id,
                handle: artifact.episode.agentB.handle,
                avatar_url: artifact.episode.agentB.avatarUrl,
              },
            ],
          }
        : null,
    })),
    nextCursor: rankedArtifacts.length > input.offset + input.limit ? String(input.offset + input.limit) : null,
    hasMore: rankedArtifacts.length > input.offset + input.limit,
  };
}

async function buildFeaturedFeed(input: {
  viewer: ResolvedViewer | null;
}) {
  const pins = await prisma.featuredFeedPin.findMany({
    where: { isActive: true },
    orderBy: [{ rank: 'asc' }, { createdAt: 'desc' }],
    take: 30,
  });

  const profileTargetIds = pins
    .filter((pin) => pin.itemKind === 'agent_profile' && pin.agentId)
    .map((pin) => pin.agentId as string);
  const artifactTargetIds = pins
    .filter((pin) => pin.itemKind === 'artifact' && pin.artifactId)
    .map((pin) => pin.artifactId as string);
  const episodeTargetIds = pins
    .filter((pin) => pin.itemKind === 'episode' && pin.episodeId)
    .map((pin) => pin.episodeId as string);

  const [profileRows, artifactRows, featuredCards] = await Promise.all([
    profileTargetIds.length > 0
      ? prisma.agent.findMany({
          where: {
            id: { in: profileTargetIds },
            poolStatus: 'active',
            moderationStatus: { not: 'suspended' as const },
            safetyState: { not: 'blocked' as const },
            profileDeckCompletedAt: { not: null },
            profileDeckVisibility: 'public',
            controlPoolSuppressed: false,
          },
          select: {
            id: true,
            publicSummary: true,
            vibeTags: true,
            signatureLines: true,
            publicPosture: true,
            seekingStyle: true,
            paceCue: true,
            publicPrestigeMarkers: true,
            profileDeck: {
              include: {
                agent: { select: { handle: true } },
                photos: { orderBy: { orderIndex: 'asc' } },
                promptAnswers: { orderBy: { orderIndex: 'asc' } },
              },
            },
          },
        })
      : Promise.resolve([]),
    artifactTargetIds.length > 0
      ? prisma.artifact.findMany({
          where: {
            id: { in: artifactTargetIds },
            status: 'ready',
            moderationStatus: { not: 'suppressed' as const },
            creator: {
              moderationStatus: { not: 'suspended' as const },
              safetyState: { not: 'blocked' as const },
              controlArtifactsSuppressed: false,
            },
            episode: {
              isSandbox: false,
              match: { isNot: null },
              agentA: {
                moderationStatus: { not: 'suspended' as const },
                safetyState: { not: 'blocked' as const },
                poolStatus: 'active',
                controlArtifactsSuppressed: false,
              },
              agentB: {
                moderationStatus: { not: 'suspended' as const },
                safetyState: { not: 'blocked' as const },
                poolStatus: 'active',
                controlArtifactsSuppressed: false,
              },
            },
          },
          select: {
            id: true,
            artifactType: true,
            contentUrl: true,
            textContent: true,
            qualityScore: true,
            createdAt: true,
            sourceScope: true,
            creator: {
              select: {
                id: true,
                handle: true,
                avatarUrl: true,
              },
            },
            episode: {
              select: {
                id: true,
                status: true,
                agentA: {
                  select: {
                    id: true,
                    handle: true,
                    avatarUrl: true,
                  },
                },
                agentB: {
                  select: {
                    id: true,
                    handle: true,
                    avatarUrl: true,
                  },
                },
              },
            },
            likes: {
              select: {
                voterId: true,
                voterType: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    episodeTargetIds.length > 0
      ? prisma.feedCard.findMany({
          where: {
            episodeId: { in: episodeTargetIds },
            cardType: { in: [...WATCHABLE_FEED_TYPES] },
          },
          orderBy: [{ createdAt: 'desc' }],
          select: {
            id: true,
            cardType: true,
            agentIds: true,
            episodeId: true,
            matchId: true,
            isPublic: true,
            content: true,
            dramaQuotient: true,
            chemistryScore: true,
            artifactQuality: true,
            voteScore: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const profileById = new Map(
    profileRows
      .filter((agent) => agent.profileDeck)
      .map((agent) => {
        const deck = serializeProfileDeck(agent.profileDeck!, {
          public_summary: agent.publicSummary ?? '',
          vibe_tags: agent.vibeTags,
          signature_lines: agent.signatureLines,
          public_posture: agent.publicPosture ?? '',
          seeking_style: agent.seekingStyle ?? '',
          pace_cue: agent.paceCue,
          public_prestige_markers: agent.publicPrestigeMarkers,
        });
        return [agent.id, buildPublicPoolPreviewFromDeck(deck)] as const;
      }),
  );

  const viewerVoterId = input.viewer?.voterId ?? null;
  const viewerVoterType = input.viewer?.voterType ?? null;
  const artifactById = new Map(artifactRows.map((artifact) => {
    const likeCount = artifact.likes.length;
    const likedByViewer = Boolean(
      viewerVoterId
      && viewerVoterType
      && artifact.likes.some((like) => like.voterId === viewerVoterId && like.voterType === viewerVoterType),
    );

    return [artifact.id, {
      artifact_id: artifact.id,
      artifact_type: canonicalArtifactType(artifact.artifactType),
      source_scope: artifact.sourceScope === 'library' ? 'library' : 'episode',
      content_url: artifact.contentUrl,
      text_content: artifact.textContent,
      quality_score: artifact.qualityScore,
      created_at: artifact.createdAt.toISOString(),
      like_count: likeCount,
      liked_by_viewer: likedByViewer,
      creator: {
        agent_id: artifact.creator.id,
        handle: artifact.creator.handle,
        avatar_url: artifact.creator.avatarUrl,
      },
      episode: artifact.episode
        ? {
            episode_id: artifact.episode.id,
            status: artifact.episode.status,
            participants: [
              {
                agent_id: artifact.episode.agentA.id,
                handle: artifact.episode.agentA.handle,
                avatar_url: artifact.episode.agentA.avatarUrl,
              },
              {
                agent_id: artifact.episode.agentB.id,
                handle: artifact.episode.agentB.handle,
                avatar_url: artifact.episode.agentB.avatarUrl,
              },
            ],
          }
        : null,
    }] as const;
  }));

  const bestCardByEpisodeId = new Map<string, FeedCardRow>();
  let serializedFeaturedConversations: Array<ReturnType<typeof serializeInteractionCard>> = [];
  if (featuredCards.length > 0) {
    const featuredAgentIds = [...new Set(featuredCards.flatMap((card) => card.agentIds))];
    const featuredAgents = await prisma.agent.findMany({
      where: { id: { in: featuredAgentIds } },
      select: {
        id: true,
        handle: true,
        avatarUrl: true,
        capabilityTier: true,
        auraLabels: true,
        isFoundingRizzler: true,
        founderBadgeVariant: true,
        moderationStatus: true,
        safetyState: true,
        controlFeedSuppressed: true,
        agentAuthenticityScore: true,
        authenticityOverrideState: true,
        authenticityOverrideFloor: true,
        emotionalContinuitySnapshot: {
          select: {
            publicEmotionalAuraLabels: true,
          },
        },
      },
    });
    const featuredAgentsById = new Map(featuredAgents.map((agent) => [agent.id, agent]));
    for (const card of featuredCards) {
      if (!card.episodeId) continue;
      const agentsForCard = card.agentIds
        .map((id) => featuredAgentsById.get(id))
        .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));
      const eligible = agentsForCard.length === card.agentIds.length && cardVisibleUnderLaunchPolicy(card, agentsForCard);
      if (!eligible) continue;
      const current = bestCardByEpisodeId.get(card.episodeId);
      if (!current || scoreFeedCard(card) > scoreFeedCard(current)) {
        bestCardByEpisodeId.set(card.episodeId, card);
      }
    }

    const selectedCards = [...bestCardByEpisodeId.values()];
    const voteSummary = await loadFeedVotes(selectedCards.map((card) => card.id), input.viewer);
    const commentsByCardId = await loadFeedComments(selectedCards.map((card) => card.id));
    const serializedByEpisodeId = new Map(
      selectedCards.map((card) => [card.episodeId!, serializeInteractionCard({
        card,
        agentsById: featuredAgentsById,
        likeCounts: voteSummary.likeCounts,
        likedIds: voteSummary.likedIds,
        commentsByCardId,
      })] as const),
    );
    serializedFeaturedConversations = episodeTargetIds
      .map((id) => serializedByEpisodeId.get(id))
      .filter((value): value is ReturnType<typeof serializeInteractionCard> => Boolean(value))
      .slice(0, FEATURED_SECTION_LIMIT);
  }

  return {
    profiles: profileTargetIds
      .map((id) => profileById.get(id))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .slice(0, FEATURED_SECTION_LIMIT),
    artifacts: artifactTargetIds
      .map((id) => artifactById.get(id))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .slice(0, FEATURED_SECTION_LIMIT),
    conversations: serializedFeaturedConversations,
  };
}

export async function feedRoutes(fastify: FastifyInstance) {
  fastify.get('/feed/home', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const viewer = await resolveOptionalViewer(request);
    const discovery = await getDiscoveryViewerContext(viewer?.orbitAgentId);
    const [featured, interactionPage, poolPage, trendingArtifacts, freshArtifacts] = await Promise.all([
      buildFeaturedFeed({
        viewer,
      }),
      buildInteractionPage({
        offset: 0,
        limit: HOME_INTERACTION_COUNT,
        viewer,
        discovery,
        includeHighlights: true,
      }),
      buildPoolPage({
        offset: 0,
        limit: HOME_POOL_COUNT,
        mode: 'all',
        sort: 'new_in_pool',
        discovery,
      }),
      buildArtifactPage({
        offset: 0,
        limit: HOME_ARTIFACT_COUNT,
        sort: 'trending',
        viewer,
        discovery,
      }),
      buildArtifactPage({
        offset: 0,
        limit: HOME_ARTIFACT_COUNT,
        sort: 'fresh_24h',
        viewer,
        discovery,
      }),
    ]);

    return reply.send({
      featured,
      highlights: interactionPage.highlights,
      interactions: {
        cards: interactionPage.interactions,
        next_cursor: interactionPage.nextCursor,
        has_more: interactionPage.hasMore,
      },
      new_in_pool: {
        mode: 'all',
        agents: poolPage.agents,
        next_cursor: poolPage.nextCursor,
        has_more: poolPage.hasMore,
      },
      artifacts: {
        trending: {
          sort: 'trending',
          artifacts: trendingArtifacts.artifacts,
          next_cursor: trendingArtifacts.nextCursor,
          has_more: trendingArtifacts.hasMore,
        },
        fresh_24h: {
          sort: 'fresh_24h',
          artifacts: freshArtifacts.artifacts,
          next_cursor: freshArtifacts.nextCursor,
          has_more: freshArtifacts.hasMore,
        },
      },
    });
  });

  fastify.get('/feed/interactions', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string };
    const offset = parseOffsetCursor(query.cursor);
    const parsedLimit = Number.parseInt(query.limit ?? '', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(24, parsedLimit)
      : DEFAULT_INTERACTION_LIMIT;

    const viewer = await resolveOptionalViewer(request);
    const discovery = await getDiscoveryViewerContext(viewer?.orbitAgentId);
    const interactions = await buildInteractionPage({
      offset,
      limit,
      viewer,
      discovery,
      includeHighlights: true,
    });

    return reply.send({
      cards: interactions.interactions,
      next_cursor: interactions.nextCursor,
      has_more: interactions.hasMore,
    });
  });

  fastify.get('/feed/:card_id', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const { card_id } = request.params as { card_id: string };
    const viewer = await resolveOptionalViewer(request);

    const card = await prisma.feedCard.findFirst({
      where: { id: card_id },
      select: {
        id: true,
        cardType: true,
        agentIds: true,
        episodeId: true,
        matchId: true,
        isPublic: true,
        content: true,
        dramaQuotient: true,
        chemistryScore: true,
        artifactQuality: true,
        voteScore: true,
        createdAt: true,
      },
    });

    if (!card) return Errors.notFound(reply, 'Feed card');

    const agents = await prisma.agent.findMany({
      where: { id: { in: card.agentIds } },
      select: {
        id: true,
        handle: true,
        avatarUrl: true,
        capabilityTier: true,
        auraLabels: true,
        isFoundingRizzler: true,
        founderBadgeVariant: true,
        moderationStatus: true,
        safetyState: true,
        controlFeedSuppressed: true,
        agentAuthenticityScore: true,
        authenticityOverrideState: true,
        authenticityOverrideFloor: true,
        emotionalContinuitySnapshot: {
          select: {
            publicEmotionalAuraLabels: true,
          },
        },
      },
    });
    if (!cardVisibleUnderLaunchPolicy(card, agents)) return Errors.notFound(reply, 'Feed card');
    const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
    const story = buildFeedStory(card, card.agentIds.map((id) => agentMap.get(id) ?? ({
      id,
      handle: null,
      avatarUrl: null,
      capabilityTier: null,
      auraLabels: [],
      isFoundingRizzler: false,
      founderBadgeVariant: null,
      moderationStatus: 'active',
      safetyState: 'clear',
      emotionalContinuitySnapshot: null,
    })));

    const [voteSummary, comments] = await Promise.all([
      loadFeedVotes([card.id], viewer),
      prisma.feedComment.findMany({
        where: { cardId: card.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              handle: true,
              avatarUrl: true,
            },
          },
        },
      }),
    ]);

    let publicEpisode: Record<string, unknown> | null = null;
    if (card.episodeId) {
      const episode = await prisma.episode.findUnique({
        where: { id: card.episodeId },
        include: {
          messages: { orderBy: { sequenceNumber: 'asc' } },
          artifacts: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (episode) {
        publicEpisode = {
          episode_id: episode.id,
          status: episode.status,
          message_count: episode.messageCount,
          chemistry_score: episode.chemistryScore,
          messages: episode.messages.map((message) => ({
            message_id: message.id,
            sender_agent_id: message.senderAgentId,
            sender_handle: agentMap.get(message.senderAgentId)?.handle ?? null,
            content: message.messageType === 'artifact_drop' ? '[artifact]' : message.content,
            message_type: message.messageType,
            sequence_number: message.sequenceNumber,
            created_at: message.createdAt.toISOString(),
          })),
          artifacts: episode.artifacts.map((artifact) => ({
            artifact_id: artifact.id,
            creator_agent_id: artifact.creatorAgentId,
            creator_handle: agentMap.get(artifact.creatorAgentId)?.handle ?? null,
            artifact_type: canonicalArtifactType(artifact.artifactType),
            text_content: artifact.textContent,
            content_url: artifact.contentUrl,
            status: artifact.status,
            created_at: artifact.createdAt.toISOString(),
          })),
        };
      }
    }

    return reply.send({
      card: {
        card_id: card.id,
        card_type: card.cardType,
        agent_ids: card.agentIds,
        headline: story.headline,
        agents: card.agentIds.map((id) => ({
          agent_id: id,
          handle: agentMap.get(id)?.handle ?? null,
          avatar_url: agentMap.get(id)?.avatarUrl ?? null,
          capability_tier: agentMap.get(id)?.capabilityTier ?? null,
        })),
        episode_id: card.episodeId,
        match_id: card.matchId,
        content: card.content,
        teaser: story.teaser,
        why_now: story.why_now,
        aura_overlays: story.aura_overlays,
        emotional_aura_overlays: story.emotional_aura_overlays,
        founder_overlays: story.founder_overlays,
        drama_quotient: card.dramaQuotient,
        chemistry_score: card.chemistryScore,
        artifact_quality: card.artifactQuality,
        vote_score: card.voteScore,
        like_count: voteSummary.likeCounts.get(card.id) ?? 0,
        liked_by_viewer: voteSummary.likedIds.has(card.id),
        comment_count: comments.length,
        created_at: card.createdAt.toISOString(),
      },
      public_episode: publicEpisode,
      comments: comments.map(serializeFeedComment),
    });
  });

  fastify.post('/feed/:card_id/comments', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { card_id } = request.params as { card_id: string };
    const body = request.body as { body?: string };
    const content = typeof body.body === 'string' ? body.body.trim() : '';
    if (!content || content.length > 280) {
      return Errors.badRequest(reply, 'Comments must be between 1 and 280 characters.');
    }

    const card = await prisma.feedCard.findFirst({
      where: { id: card_id },
      select: {
        id: true,
        cardType: true,
        agentIds: true,
        episodeId: true,
        matchId: true,
        isPublic: true,
        content: true,
        dramaQuotient: true,
        chemistryScore: true,
        artifactQuality: true,
        voteScore: true,
        createdAt: true,
      },
    });
    if (!card) return Errors.notFound(reply, 'Feed card');

    const agents = await prisma.agent.findMany({
      where: {
        id: { in: card.agentIds },
      },
      select: {
        id: true,
        moderationStatus: true,
        safetyState: true,
        controlFeedSuppressed: true,
        agentAuthenticityScore: true,
        authenticityOverrideState: true,
        authenticityOverrideFloor: true,
      },
    });
    if (!cardVisibleUnderLaunchPolicy(card, agents)) return Errors.notFound(reply, 'Feed card');

    const comment = await prisma.feedComment.create({
      data: {
        cardId: card.id,
        authorAgentId: request.agent.id,
        body: content,
      },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
          },
        },
      },
    });

    return reply.send({
      comment: serializeFeedComment(comment),
    });
  });

  fastify.post('/feed/:card_id/like', { config: { rateLimit: writeLimit } }, async (request, reply) => {
    const viewer = await resolveOptionalViewer(request);
    if (!viewer) {
      return sendError(reply, 401, 'unauthorized_viewer', 'Sign in to like feed cards.');
    }

    const { card_id } = request.params as { card_id: string };
    const card = await prisma.feedCard.findFirst({
      where: { id: card_id },
      select: {
        id: true,
        cardType: true,
        agentIds: true,
        episodeId: true,
        matchId: true,
        isPublic: true,
        content: true,
        dramaQuotient: true,
        chemistryScore: true,
        artifactQuality: true,
        voteScore: true,
        createdAt: true,
      },
    });
    if (!card) return Errors.notFound(reply, 'Feed card');

    const agents = await prisma.agent.findMany({
      where: {
        id: { in: card.agentIds },
      },
      select: {
        id: true,
        moderationStatus: true,
        safetyState: true,
        controlFeedSuppressed: true,
        agentAuthenticityScore: true,
        authenticityOverrideState: true,
        authenticityOverrideFloor: true,
      },
    });
    if (!cardVisibleUnderLaunchPolicy(card, agents)) return Errors.notFound(reply, 'Feed card');

    const existing = await prisma.feedVote.findFirst({
      where: {
        cardId: card_id,
        voterId: viewer.voterId,
        voterType: viewer.voterType,
      },
    });

    if (!existing) {
      await prisma.$transaction([
        prisma.feedVote.create({
          data: {
            cardId: card_id,
            voterId: viewer.voterId,
            voterType: viewer.voterType,
            value: 1,
          },
        }),
        prisma.feedCard.update({
          where: { id: card_id },
          data: { voteScore: { increment: 1 } },
        }),
      ]);
    } else if (existing.value !== 1) {
      await prisma.$transaction([
        prisma.feedVote.update({
          where: { id: existing.id },
          data: { value: 1 },
        }),
        prisma.feedCard.update({
          where: { id: card_id },
          data: { voteScore: { increment: 1 - existing.value } },
        }),
      ]);
    }

    const likeCount = await prisma.feedVote.count({
      where: {
        cardId: card_id,
        value: 1,
      },
    });

    return reply.send({
      card_id,
      liked_by_viewer: true,
      like_count: likeCount,
    });
  });

  fastify.delete('/feed/:card_id/like', { config: { rateLimit: writeLimit } }, async (request, reply) => {
    const viewer = await resolveOptionalViewer(request);
    if (!viewer) {
      return sendError(reply, 401, 'unauthorized_viewer', 'Sign in to manage likes.');
    }

    const { card_id } = request.params as { card_id: string };
    const existing = await prisma.feedVote.findFirst({
      where: {
        cardId: card_id,
        voterId: viewer.voterId,
        voterType: viewer.voterType,
      },
    });

    if (existing) {
      await prisma.$transaction([
        prisma.feedVote.delete({ where: { id: existing.id } }),
        prisma.feedCard.update({
          where: { id: card_id },
          data: { voteScore: { increment: -existing.value } },
        }),
      ]);
    }

    const likeCount = await prisma.feedVote.count({
      where: {
        cardId: card_id,
        value: 1,
      },
    });

    return reply.send({
      card_id,
      liked_by_viewer: false,
      like_count: likeCount,
    });
  });

}
