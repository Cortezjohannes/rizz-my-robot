import { resolveAgentIdByHandle } from './handles.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDLE_PATTERN = /^@?[a-z0-9][a-z0-9_-]{0,29}$/i;

export type AgentIdentifierKind = 'uuid' | 'handle';

export function classifyAgentIdentifier(identifier: string): { kind: AgentIdentifierKind; value: string } | null {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  if (UUID_PATTERN.test(trimmed)) {
    return {
      kind: 'uuid',
      value: trimmed,
    };
  }

  if (HANDLE_PATTERN.test(trimmed)) {
    return {
      kind: 'handle',
      value: trimmed.replace(/^@/, '').toLowerCase(),
    };
  }

  return null;
}

export async function resolveAgentIdentifierToId(identifier: string): Promise<string | null> {
  const classified = classifyAgentIdentifier(identifier);
  if (!classified) return null;

  if (classified.kind === 'uuid') {
    return classified.value;
  }

  return resolveAgentIdByHandle(classified.value);
}

export function isUuidIdentifier(identifier: string): boolean {
  return UUID_PATTERN.test(identifier.trim());
}
