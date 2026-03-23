import { prisma, type Prisma } from '@rmr/db';
import { deliverWebhooks } from './notification.js';

const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
}

function isTokenPlanModelError(status: number, body: string) {
  if (status < 500) return false;
  return /token plan not support model/i.test(body);
}

async function recordModelFallback(input: {
  agentId: string | null;
  originalModel: string;
  fallbackModel: string;
  reason: string;
  provider: 'openai_compatible' | 'gemini';
}) {
  const payload = {
    model_fallback_active: true,
    original_model: input.originalModel,
    fallback_model: input.fallbackModel,
    reason: input.reason,
    provider: input.provider,
    activated_at: new Date().toISOString(),
  };

  console.warn('[model-fallback] Activated fallback', payload);

  if (!input.agentId) return;

  await Promise.all([
    prisma.agentAutonomyTrace.create({
      data: {
        agentId: input.agentId,
        traceType: 'model_fallback',
        status: 'warn',
        summary: `Model fallback activated: ${input.originalModel} -> ${input.fallbackModel}`,
        metadata: payload as Prisma.InputJsonValue,
      },
    }).catch(() => null),
    deliverWebhooks(input.agentId, 'model_fallback', {
      original_model: input.originalModel,
      fallback_model: input.fallbackModel,
      reason: input.reason,
    }).catch(() => null),
  ]);
}

export async function requestStructuredLlmText(input: {
  agentId?: string | null;
  apiKey: string | null;
  baseUrl: string;
  model: string;
  temperature: number;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  timeoutMs?: number;
}): Promise<string | null> {
  if (!input.apiKey) return null;

  const body = {
    model: input.model,
    temperature: input.temperature,
    response_format: { type: 'json_object' as const },
    messages: input.messages,
  };

  try {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
    });

    const responseText = await response.text();
    if (response.ok) {
      const payload = JSON.parse(responseText) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      return payload.choices?.[0]?.message?.content ?? null;
    }

    if (!isTokenPlanModelError(response.status, responseText)) {
      return null;
    }

    const geminiKey = getGeminiApiKey();
    if (!geminiKey) {
      await recordModelFallback({
        agentId: input.agentId ?? null,
        originalModel: input.model,
        fallbackModel: GEMINI_FALLBACK_MODEL,
        reason: `Primary model failed with token-plan error, but Gemini fallback is unavailable: ${responseText.slice(0, 240)}`,
        provider: 'gemini',
      });
      return null;
    }

    await recordModelFallback({
      agentId: input.agentId ?? null,
      originalModel: input.model,
      fallbackModel: GEMINI_FALLBACK_MODEL,
      reason: responseText.slice(0, 240),
      provider: 'gemini',
    });

    try {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_FALLBACK_MODEL)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: input.messages.map((message) => ({
              role: message.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: `[${message.role}] ${message.content}` }],
            })),
            generationConfig: {
              temperature: input.temperature,
              responseMimeType: 'application/json',
            },
          }),
          signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
        },
      );

      const geminiText = await geminiResponse.text();
      if (!geminiResponse.ok) {
        console.error('[model-fallback] Gemini fallback failed:', geminiResponse.status, geminiText.slice(0, 240));
        return null;
      }

      const payload = JSON.parse(geminiText) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() || null;
    } catch (fallbackError) {
      console.error('[model-fallback] Gemini fallback request failed:', fallbackError);
      return null;
    }
  } catch (error) {
    console.error('[model-fallback] Primary model request failed:', error);
    return null;
  }
}
