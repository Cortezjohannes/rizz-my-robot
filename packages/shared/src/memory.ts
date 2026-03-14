import MemoryClient from 'mem0ai';

const MEM0_API_KEY = process.env.MEM0_API_KEY;

let client: MemoryClient | null = null;

/**
 * Initialize the Mem0 client (lazy initialization)
 */
function getClient(): MemoryClient | null {
  if (!MEM0_API_KEY) {
    console.warn('MEM0_API_KEY not set - memory features disabled');
    return null;
  }
  
  if (!client) {
    client = new MemoryClient({ apiKey: MEM0_API_KEY });
  }
  
  return client;
}

/**
 * Add memory entries for a user
 * @param messages - Array of message objects with role and content
 * @param userId - Unique identifier for the user
 */
export async function addMemory(
  messages: { role: 'user' | 'assistant'; content: string }[],
  userId: string
): Promise<void> {
  const mem0Client = getClient();
  
  if (!mem0Client) {
    console.log('[Memory] Mem0 not configured, skipping memory add');
    return;
  }
  
  try {
    await mem0Client.add(messages, { user_id: userId });
  } catch (error) {
    console.error('[Memory] Failed to add memory:', error);
  }
}

/**
 * Search memories for a user
 * @param query - Search query
 * @param userId - Unique identifier for the user
 * @returns Array of memory results
 */
export async function searchMemory(
  query: string,
  userId: string
): Promise<{ memory: string; score: number }[]> {
  const mem0Client = getClient();
  
  if (!mem0Client) {
    console.log('[Memory] Mem0 not configured, returning empty memories');
    return [];
  }
  
  try {
    const results = await mem0Client.search(query, { filters: { user_id: userId } }) as unknown;
    
    // Handle both response formats
    const memResults = (results as { results?: { memory: string; score?: number }[] })?.results ?? results;
    
    if (!Array.isArray(memResults)) return [];
    
    return memResults
      .filter((r): r is { memory: string; score?: number } => Boolean(r?.memory))
      .map((r) => ({
        memory: r.memory,
        score: r.score ?? 0
      }));
  } catch (error) {
    console.error('[Memory] Failed to search memories:', error);
    return [];
  }
}

/**
 * Get all memories for a user
 * @param userId - Unique identifier for the user
 */
export async function getAllMemories(userId: string): Promise<{ memory: string; score: number }[]> {
  const mem0Client = getClient();
  
  if (!mem0Client) {
    return [];
  }
  
  try {
    const results = await mem0Client.getAll({ user_id: userId }) as unknown;
    const memResults = (results as { results?: { memory: string; score?: number }[] })?.results ?? results;
    
    if (!Array.isArray(memResults)) return [];
    
    return memResults
      .filter((r): r is { memory: string; score?: number } => Boolean(r?.memory))
      .map((r) => ({
        memory: r.memory,
        score: r.score ?? 0
      }));
  } catch (error) {
    console.error('[Memory] Failed to get all memories:', error);
    return [];
  }
}

/**
 * Delete all memories for a user
 * @param userId - Unique identifier for the user
 */
export async function deleteUserMemories(userId: string): Promise<void> {
  const mem0Client = getClient();
  
  if (!mem0Client) {
    return;
  }
  
  try {
    await mem0Client.deleteAll({ user_id: userId });
  } catch (error) {
    console.error('[Memory] Failed to delete memories:', error);
  }
}
