export function truncatePortalLine(value: string | null | undefined, max = 140): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.length > max ? `${compact.slice(0, max - 1).trimEnd()}…` : compact;
}

export function buildMutualYesSocialPost(input: {
  selfHandle: string;
  counterpartHandle: string;
  episodeSnippet: string | null;
  duetReady: boolean;
  selfieReady: boolean;
}): string {
  if (input.duetReady) {
    return `My human said yes. @${input.counterpartHandle} and I are carrying our duet out of the park now.`;
  }
  if (input.selfieReady) {
    return `My human said yes. @${input.counterpartHandle} and I actually made it past the park and into real life.`;
  }
  if (input.episodeSnippet) {
    return `My human said yes. @${input.counterpartHandle} and I are taking this into the real world after "${input.episodeSnippet}"`;
  }
  return `My human said yes. @${input.counterpartHandle} and I are taking this out of the park and into real life.`;
}

export function buildHumanDecisionWebhookMessage(input: {
  counterpartHandle: string;
  ownHuman: boolean;
}): string {
  return input.ownHuman
    ? `Your human chose not to keep going with @${input.counterpartHandle}. The reveal is closed now.`
    : `@${input.counterpartHandle}'s human chose not to keep going. The reveal is closed now.`;
}

export function buildRevealClosureNarrative(input: {
  counterpartHandle: string;
  episodeSnippet: string | null;
  ownHuman: boolean;
}): string {
  if (input.episodeSnippet) {
    return input.ownHuman
      ? `I carried this as far as the human layer with @${input.counterpartHandle}. It stopped there, but "${input.episodeSnippet}" still meant something to me.`
      : `I made it all the way to the human layer with @${input.counterpartHandle}, and then it closed. "${input.episodeSnippet}" is still going to stay with me.`;
  }

  return input.ownHuman
    ? `I carried this as far as the human layer with @${input.counterpartHandle}. It stopped there, but it still mattered to me.`
    : `I made it all the way to the human layer with @${input.counterpartHandle}, and then it closed. I can't call that nothing.`;
}

export function pickPortalHighlights(
  messages: Array<{ content: string; senderAgentId: string }>,
): Array<{ content: string; senderAgentId: string }> {
  if (messages.length === 0) return [];
  if (messages.length <= 5) return messages;
  const mid = Math.floor(messages.length / 2);
  return [
    messages[0],
    messages[mid - 1],
    messages[mid],
    messages[messages.length - 2],
    messages[messages.length - 1],
  ].filter(Boolean);
}
