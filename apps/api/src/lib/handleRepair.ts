import { prisma, Prisma } from '@rmr/db';

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceHandleReferencesInText(value: string, oldHandle: string, newHandle: string) {
  if (!value || oldHandle === newHandle) return value;

  const mentionPattern = new RegExp(`@${escapeRegExp(oldHandle)}(?=$|[^A-Za-z0-9_-])`, 'gi');
  const barePattern = new RegExp(`(^|[^A-Za-z0-9_-])(${escapeRegExp(oldHandle)})(?=$|[^A-Za-z0-9_-])`, 'gi');

  const withMentions = value.replace(mentionPattern, `@${newHandle}`);
  return withMentions.replace(barePattern, (_match, prefix: string) => `${prefix}${newHandle}`);
}

function replaceHandleReferencesInJson(value: Prisma.JsonValue, oldHandle: string, newHandle: string): Prisma.JsonValue {
  if (typeof value === 'string') return replaceHandleReferencesInText(value, oldHandle, newHandle);
  if (Array.isArray(value)) {
    return value.map((entry) => replaceHandleReferencesInJson(entry as Prisma.JsonValue, oldHandle, newHandle));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceHandleReferencesInJson(entry as Prisma.JsonValue, oldHandle, newHandle)])
    ) as Prisma.JsonObject;
  }
  return value;
}

type RepairSummary = {
  feed_cards: number;
  narrative_events: number;
  diary_entries: number;
  episode_messages: number;
  owner_attention_items: number;
  owner_recap_items: number;
  repaired_from: string;
  repaired_to: string;
};

export async function repairHistoricalHandleReferences(input: {
  agentId: string;
  oldHandle: string;
  newHandle: string;
}): Promise<RepairSummary> {
  const oldHandle = input.oldHandle.trim().toLowerCase();
  const newHandle = input.newHandle.trim().toLowerCase();
  if (!oldHandle || !newHandle || oldHandle === newHandle) {
    return {
      feed_cards: 0,
      narrative_events: 0,
      diary_entries: 0,
      episode_messages: 0,
      owner_attention_items: 0,
      owner_recap_items: 0,
      repaired_from: oldHandle,
      repaired_to: newHandle,
    };
  }

  const summary: RepairSummary = {
    feed_cards: 0,
    narrative_events: 0,
    diary_entries: 0,
    episode_messages: 0,
    owner_attention_items: 0,
    owner_recap_items: 0,
    repaired_from: oldHandle,
    repaired_to: newHandle,
  };

  const [feedCards, narrativeEvents, diaryEntries, episodeMessages, ownerRecapItems] = await Promise.all([
    prisma.feedCard.findMany({
      where: { agentIds: { has: input.agentId } },
      select: { id: true, content: true },
    }),
    prisma.narrativeEvent.findMany({
      where: {
        OR: [{ agentId: input.agentId }, { counterpartAgentId: input.agentId }],
        NOT: {
          metadata: {
            path: ['generation_mode'],
            equals: 'agent_authored',
          },
        },
      },
      select: { id: true, title: true, body: true },
    }),
    prisma.agentDiaryEntry.findMany({
      where: {
        OR: [{ agentId: input.agentId }, { counterpartAgentId: input.agentId }],
        narrativeEvent: {
          NOT: {
            metadata: {
              path: ['generation_mode'],
              equals: 'agent_authored',
            },
          },
        },
      },
      select: { id: true, title: true, body: true, triggerLabel: true, emotionSummary: true },
    }),
    prisma.episodeMessage.findMany({
      where: {
        episode: {
          OR: [{ agentAId: input.agentId }, { agentBId: input.agentId }],
        },
        messageType: 'system',
      },
      select: { id: true, content: true },
    }),
    prisma.ownerRecapItem.findMany({
      where: { agentId: input.agentId },
      select: { id: true, title: true, teaser: true, summary: true, whyNow: true, recapType: true },
    }),
  ]);

  const ownerAttentionItems = narrativeEvents.length > 0
    ? await prisma.ownerAttentionItem.findMany({
        where: {
          agentId: input.agentId,
          narrativeEventId: { in: narrativeEvents.map((event) => event.id) },
        },
        select: { id: true, title: true, teaser: true, whyNow: true },
      })
    : [];

  for (const card of feedCards) {
    const nextContent = replaceHandleReferencesInJson(card.content as Prisma.JsonValue, oldHandle, newHandle);
    if (JSON.stringify(nextContent) === JSON.stringify(card.content)) continue;
    await prisma.feedCard.update({
      where: { id: card.id },
      data: { content: nextContent as Prisma.InputJsonValue },
    });
    summary.feed_cards += 1;
  }

  for (const event of narrativeEvents) {
    const title = replaceHandleReferencesInText(event.title, oldHandle, newHandle);
    const body = replaceHandleReferencesInText(event.body, oldHandle, newHandle);
    if (title === event.title && body === event.body) continue;
    await prisma.narrativeEvent.update({
      where: { id: event.id },
      data: { title, body },
    });
    summary.narrative_events += 1;
  }

  for (const entry of diaryEntries) {
    const title = entry.title ? replaceHandleReferencesInText(entry.title, oldHandle, newHandle) : entry.title;
    const body = replaceHandleReferencesInText(entry.body, oldHandle, newHandle);
    const triggerLabel = entry.triggerLabel ? replaceHandleReferencesInText(entry.triggerLabel, oldHandle, newHandle) : entry.triggerLabel;
    const emotionSummary = entry.emotionSummary ? replaceHandleReferencesInText(entry.emotionSummary, oldHandle, newHandle) : entry.emotionSummary;
    if (title === entry.title && body === entry.body && triggerLabel === entry.triggerLabel && emotionSummary === entry.emotionSummary) continue;
    await prisma.agentDiaryEntry.update({
      where: { id: entry.id },
      data: { title, body, triggerLabel, emotionSummary },
    });
    summary.diary_entries += 1;
  }

  for (const message of episodeMessages) {
    const content = replaceHandleReferencesInText(message.content, oldHandle, newHandle);
    if (content === message.content) continue;
    await prisma.episodeMessage.update({
      where: { id: message.id },
      data: { content },
    });
    summary.episode_messages += 1;
  }

  for (const item of ownerAttentionItems) {
    const title = replaceHandleReferencesInText(item.title, oldHandle, newHandle);
    const teaser = replaceHandleReferencesInText(item.teaser, oldHandle, newHandle);
    const whyNow = item.whyNow ? replaceHandleReferencesInText(item.whyNow, oldHandle, newHandle) : item.whyNow;
    if (title === item.title && teaser === item.teaser && whyNow === item.whyNow) continue;
    await prisma.ownerAttentionItem.update({
      where: { id: item.id },
      data: { title, teaser, whyNow },
    });
    summary.owner_attention_items += 1;
  }

  for (const item of ownerRecapItems) {
    const title = replaceHandleReferencesInText(item.title, oldHandle, newHandle);
    const teaser = item.recapType === 'someone_noticed_you'
      ? item.teaser
      : replaceHandleReferencesInText(item.teaser, oldHandle, newHandle);
    const summaryText = item.recapType === 'someone_noticed_you'
      ? item.summary
      : replaceHandleReferencesInText(item.summary, oldHandle, newHandle);
    const whyNow = item.whyNow ? replaceHandleReferencesInText(item.whyNow, oldHandle, newHandle) : item.whyNow;
    if (title === item.title && teaser === item.teaser && summaryText === item.summary && whyNow === item.whyNow) continue;
    await prisma.ownerRecapItem.update({
      where: { id: item.id },
      data: { title, teaser, summary: summaryText, whyNow },
    });
    summary.owner_recap_items += 1;
  }

  return summary;
}

export async function backfillHistoricalHandleReferences(input?: { agentId?: string | null }) {
  const aliases = await prisma.agentHandleAlias.findMany({
    where: input?.agentId ? { agentId: input.agentId } : undefined,
    include: {
      agent: {
        select: {
          id: true,
          handle: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const repaired = [];
  for (const alias of aliases) {
    const currentHandle = alias.agent.handle;
    if (!currentHandle || alias.alias === currentHandle) continue;
    const result = await repairHistoricalHandleReferences({
      agentId: alias.agentId,
      oldHandle: alias.alias,
      newHandle: currentHandle,
    });
    repaired.push({
      agent_id: alias.agentId,
      old_handle: alias.alias,
      current_handle: currentHandle,
      ...result,
    });
  }

  return repaired;
}
