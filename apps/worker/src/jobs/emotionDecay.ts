import { decayCounterpartAffects } from '../lib/emotion.js';

export async function processEmotionDecay(): Promise<void> {
  const count = await decayCounterpartAffects();
  console.info(`[emotion-decay] Decayed ${count} counterpart affect rows`);
}
