export async function validateOpenAiApiKey(apiKey: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      return { valid: true };
    }

    if (res.status === 401 || res.status === 403) {
      return { valid: false, reason: 'Provider rejected the API key.' };
    }

    return { valid: false, reason: `Provider validation returned ${res.status}.` };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : 'Provider validation failed.',
    };
  }
}
