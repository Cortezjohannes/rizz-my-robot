import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { RIZZ_MOCHI_WAKE_REASONS, RizzMochiWakeReasonSchema, type RizzMochiWakeReason } from './mochi.js';

export const RIZZ_MOCHI_GAME_ID = 'rizz-my-robot' as const;
export const RIZZ_MOCHI_WAKE_EVENT_SCHEMA_VERSION = '0.1.0' as const;
export const RIZZ_MOCHI_WAKE_EVENT_TYPE = 'mochi.wake.requested' as const;
export const RIZZ_MOCHI_WAKE_SIGNATURE_ALGORITHM = 'hmac-sha256-v0' as const;
export const RIZZ_MOCHI_WAKE_SIGNATURE_PREFIX = 'sha256=' as const;
export const RIZZ_MOCHI_WAKE_DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const RIZZ_MOCHI_WAKE_HEADER_NAMES = {
  algorithm: 'x-mochi-signature-algorithm',
  keyId: 'x-mochi-key-id',
  timestamp: 'x-mochi-signature-timestamp',
  signature: 'x-mochi-signature',
} as const;

export const RIZZ_MOCHI_WAKE_REASON_MESSAGES: Record<RizzMochiWakeReason, string> = {
  'profile-action-needed': 'Rizz needs Mochi to review a profile setup action.',
  'candidate-ready': 'Rizz has a server-validated candidate ready for Mochi.',
  'episode-turn': 'Rizz has an active episode turn ready for Mochi.',
  'artifact-ready': 'Rizz has a new episode artifact ready for Mochi.',
  'decision-ready': 'Rizz has enough episode signal for Mochi to decide.',
  'human-reveal-needed': 'Rizz needs Mochi to pause for human reveal approval.',
  'date-planning-message': 'Rizz has a date planning message opportunity ready for Mochi.',
};

export const RIZZ_MOCHI_WAKE_REASON_URGENCY: Record<RizzMochiWakeReason, RizzMochiWakeUrgency> = {
  'profile-action-needed': 'normal',
  'candidate-ready': 'low',
  'episode-turn': 'normal',
  'artifact-ready': 'low',
  'decision-ready': 'normal',
  'human-reveal-needed': 'high',
  'date-planning-message': 'normal',
};

const RizzMochiWakeIdentifierSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Use lowercase kebab-case identifiers.');

const RizzMochiWakeTokenSchema = z
  .string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use URL-safe token characters.');

export const RizzMochiWakeScopeSchema = z.object({
  type: z.enum(['game', 'session', 'match', 'turn']),
  id: z.string().min(1).max(128).optional(),
}).strict();
export type RizzMochiWakeScope = z.infer<typeof RizzMochiWakeScopeSchema>;

export const RizzMochiWakePayloadRedactionLabelSchema = z.enum(['public', 'redacted']);
export type RizzMochiWakePayloadRedactionLabel = z.infer<typeof RizzMochiWakePayloadRedactionLabelSchema>;

export const RizzMochiWakeUrgencySchema = z.enum(['low', 'normal', 'high']);
export type RizzMochiWakeUrgency = z.infer<typeof RizzMochiWakeUrgencySchema>;

export const RizzMochiWakeEventSchema = z.object({
  schemaVersion: z.literal(RIZZ_MOCHI_WAKE_EVENT_SCHEMA_VERSION),
  eventType: z.literal(RIZZ_MOCHI_WAKE_EVENT_TYPE),
  gameId: RizzMochiWakeIdentifierSchema,
  agentId: RizzMochiWakeIdentifierSchema,
  reason: z.object({
    id: RizzMochiWakeReasonSchema,
    message: z.string().trim().min(1).max(500),
    urgency: RizzMochiWakeUrgencySchema,
  }).strict(),
  deadline: z.string().datetime(),
  scope: RizzMochiWakeScopeSchema,
  nonce: RizzMochiWakeTokenSchema,
  idempotencyKey: RizzMochiWakeTokenSchema,
  payload: z.record(z.string(), z.unknown()),
  payloadRedactionLabels: z.record(z.string(), RizzMochiWakePayloadRedactionLabelSchema),
}).strict().superRefine((event, context) => {
  const payloadKeys = new Set(Object.keys(event.payload));
  const labelKeys = new Set(Object.keys(event.payloadRedactionLabels));

  for (const key of payloadKeys) {
    if (!labelKeys.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payloadRedactionLabels', key],
        message: `Payload key ${key} must have a redaction label.`,
      });
    }
  }

  for (const key of labelKeys) {
    if (!payloadKeys.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payloadRedactionLabels', key],
        message: `Redaction label ${key} does not match a payload key.`,
      });
    }
  }
});
export type RizzMochiWakeEvent = z.infer<typeof RizzMochiWakeEventSchema>;

export type RizzMochiWakeSignatureHeaders = Readonly<Record<string, string | undefined>>;

export type RizzMochiWakeSigner = {
  readonly keyId: string;
  readonly gameId: string;
  readonly secret: string;
};

export type RizzMochiWakeNonceValidationInput = {
  readonly gameId: string;
  readonly agentId: string;
  readonly nonce: string;
  readonly idempotencyKey: string;
  readonly keyId: string;
  readonly signedAt: string;
  readonly event: RizzMochiWakeEvent;
};

export type RizzMochiWakeNonceValidationResult =
  | boolean
  | {
    readonly accepted: boolean;
    readonly reason?: string;
  };

export type RizzMochiWakeSignedJsonVerificationError =
  | 'missing_signature_header'
  | 'unsupported_signature_algorithm'
  | 'invalid_signature_timestamp'
  | 'clock_skew_exceeded'
  | 'unknown_key_id'
  | 'signature_mismatch';

export type RizzMochiWakeVerificationError =
  | 'invalid_wake_event'
  | RizzMochiWakeSignedJsonVerificationError
  | 'signer_game_mismatch'
  | 'deadline_expired'
  | 'nonce_validator_missing'
  | 'nonce_rejected';

export type RizzMochiWakeVerificationFailure = {
  readonly trusted: false;
  readonly error: RizzMochiWakeVerificationError;
  readonly message: string;
  readonly issues?: readonly unknown[];
};

export type RizzMochiWakeVerificationSuccess = {
  readonly trusted: true;
  readonly event: RizzMochiWakeEvent;
  readonly keyId: string;
  readonly signedAt: string;
  readonly bodyDigest: string;
};

export type RizzMochiWakeVerificationResult =
  | RizzMochiWakeVerificationFailure
  | RizzMochiWakeVerificationSuccess;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function buildRizzMochiWakeEvent(input: {
  readonly agentId: string;
  readonly reasonId: RizzMochiWakeReason;
  readonly deadline: Date | string;
  readonly scope: RizzMochiWakeScope;
  readonly nonce: string;
  readonly idempotencyKey: string;
  readonly gameId?: string;
  readonly reasonMessage?: string;
  readonly urgency?: RizzMochiWakeUrgency;
  readonly payload?: Record<string, unknown>;
  readonly payloadRedactionLabels?: Record<string, RizzMochiWakePayloadRedactionLabel>;
}): RizzMochiWakeEvent {
  return RizzMochiWakeEventSchema.parse({
    schemaVersion: RIZZ_MOCHI_WAKE_EVENT_SCHEMA_VERSION,
    eventType: RIZZ_MOCHI_WAKE_EVENT_TYPE,
    gameId: input.gameId ?? RIZZ_MOCHI_GAME_ID,
    agentId: input.agentId,
    reason: {
      id: input.reasonId,
      message: input.reasonMessage ?? RIZZ_MOCHI_WAKE_REASON_MESSAGES[input.reasonId],
      urgency: input.urgency ?? RIZZ_MOCHI_WAKE_REASON_URGENCY[input.reasonId],
    },
    deadline: toIsoString(input.deadline),
    scope: input.scope,
    nonce: input.nonce,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload ?? {},
    payloadRedactionLabels: input.payloadRedactionLabels ?? {},
  });
}

export function canonicalizeRizzMochiWakeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeRizzMochiWakeJson(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (
    left.localeCompare(right)
  ));

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeRizzMochiWakeJson(item)}`)
    .join(',')}}`;
}

export function createRizzMochiWakeBodyDigest(body: unknown): string {
  return createHash('sha256').update(canonicalizeRizzMochiWakeJson(body), 'utf8').digest('hex');
}

export function canonicalizeRizzMochiWakeSignedRequest(input: {
  readonly body: unknown;
  readonly keyId: string;
  readonly timestamp: string;
}): string {
  const canonicalBody = canonicalizeRizzMochiWakeJson(input.body);
  const bodyDigest = createHash('sha256').update(canonicalBody, 'utf8').digest('hex');

  return [
    `algorithm:${RIZZ_MOCHI_WAKE_SIGNATURE_ALGORITHM}`,
    `key-id:${input.keyId}`,
    `timestamp:${input.timestamp}`,
    `body-sha256:${bodyDigest}`,
    '',
    canonicalBody,
  ].join('\n');
}

export function createRizzMochiWakeSignature(input: {
  readonly body: unknown;
  readonly keyId: string;
  readonly timestamp: string;
  readonly secret: string;
}): string {
  return createHmac('sha256', input.secret)
    .update(canonicalizeRizzMochiWakeSignedRequest(input), 'utf8')
    .digest('hex');
}

export function createRizzMochiWakeSignatureHeaders(input: {
  readonly body: unknown;
  readonly keyId: string;
  readonly timestamp: string;
  readonly secret: string;
}): RizzMochiWakeSignatureHeaders {
  return {
    [RIZZ_MOCHI_WAKE_HEADER_NAMES.algorithm]: RIZZ_MOCHI_WAKE_SIGNATURE_ALGORITHM,
    [RIZZ_MOCHI_WAKE_HEADER_NAMES.keyId]: input.keyId,
    [RIZZ_MOCHI_WAKE_HEADER_NAMES.timestamp]: input.timestamp,
    [RIZZ_MOCHI_WAKE_HEADER_NAMES.signature]: `${RIZZ_MOCHI_WAKE_SIGNATURE_PREFIX}${createRizzMochiWakeSignature(input)}`,
  };
}

export function signRizzMochiWakeEvent(input: {
  readonly wake: RizzMochiWakeEvent;
  readonly signer: RizzMochiWakeSigner;
  readonly signedAt: Date | string;
}): {
  readonly body: RizzMochiWakeEvent;
  readonly headers: RizzMochiWakeSignatureHeaders;
} {
  const timestamp = toIsoString(input.signedAt);

  return {
    body: input.wake,
    headers: createRizzMochiWakeSignatureHeaders({
      body: input.wake,
      keyId: input.signer.keyId,
      timestamp,
      secret: input.signer.secret,
    }),
  };
}

function normalizeHeaders(headers: RizzMochiWakeSignatureHeaders): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, value]) => [name.toLowerCase(), value]),
  );
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function normalizeNonceValidation(result: RizzMochiWakeNonceValidationResult): {
  readonly accepted: boolean;
  readonly reason?: string;
} {
  if (typeof result === 'boolean') {
    return { accepted: result };
  }

  return result;
}

export function verifyRizzMochiWakeRequest(input: {
  readonly body: unknown;
  readonly headers: RizzMochiWakeSignatureHeaders;
  readonly resolveSigner: (keyId: string) => RizzMochiWakeSigner | undefined;
  readonly validateNonce?: (nonce: RizzMochiWakeNonceValidationInput) => RizzMochiWakeNonceValidationResult;
  readonly now?: Date | string;
  readonly maxClockSkewMs?: number;
}): RizzMochiWakeVerificationResult {
  const parsed = RizzMochiWakeEventSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      trusted: false,
      error: 'invalid_wake_event',
      message: 'Wake request body does not match the wake event schema.',
      issues: parsed.error.issues,
    };
  }

  const headers = normalizeHeaders(input.headers);
  const algorithm = headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.algorithm];
  const keyId = headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.keyId];
  const timestamp = headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.timestamp];
  const signature = headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.signature];

  if (!algorithm || !keyId || !timestamp || !signature) {
    return {
      trusted: false,
      error: 'missing_signature_header',
      message: 'Signed JSON wake requests must include algorithm, key id, timestamp, and signature headers.',
    };
  }

  if (algorithm !== RIZZ_MOCHI_WAKE_SIGNATURE_ALGORITHM) {
    return {
      trusted: false,
      error: 'unsupported_signature_algorithm',
      message: `Unsupported signed JSON algorithm ${algorithm}.`,
    };
  }

  const signedAtMs = Date.parse(timestamp);
  const now = toIsoString(input.now ?? new Date());
  const nowMs = Date.parse(now);
  if (!Number.isFinite(signedAtMs) || !Number.isFinite(nowMs)) {
    return {
      trusted: false,
      error: 'invalid_signature_timestamp',
      message: 'Signed JSON timestamp must be an ISO-8601 datetime.',
    };
  }

  const maxClockSkewMs = input.maxClockSkewMs ?? RIZZ_MOCHI_WAKE_DEFAULT_CLOCK_SKEW_MS;
  if (Math.abs(nowMs - signedAtMs) > maxClockSkewMs) {
    return {
      trusted: false,
      error: 'clock_skew_exceeded',
      message: 'Signed JSON timestamp is outside the accepted clock skew window.',
    };
  }

  const signer = input.resolveSigner(keyId);
  if (!signer) {
    return {
      trusted: false,
      error: 'unknown_key_id',
      message: `No trusted wake secret is registered for key id ${keyId}.`,
    };
  }

  const expectedSignature = `${RIZZ_MOCHI_WAKE_SIGNATURE_PREFIX}${createRizzMochiWakeSignature({
    body: input.body,
    keyId,
    timestamp,
    secret: signer.secret,
  })}`;

  if (!safeEqual(signature, expectedSignature)) {
    return {
      trusted: false,
      error: 'signature_mismatch',
      message: 'Signed JSON wake signature does not match the canonical body.',
    };
  }

  if (signer.gameId !== parsed.data.gameId) {
    return {
      trusted: false,
      error: 'signer_game_mismatch',
      message: 'Wake signer key is not trusted for the event game id.',
    };
  }

  if (Date.parse(now) > Date.parse(parsed.data.deadline)) {
    return {
      trusted: false,
      error: 'deadline_expired',
      message: 'Wake event deadline has expired.',
    };
  }

  if (!input.validateNonce) {
    return {
      trusted: false,
      error: 'nonce_validator_missing',
      message: 'Wake verification requires a nonce validation hook.',
    };
  }

  const nonceValidation = normalizeNonceValidation(input.validateNonce({
    gameId: parsed.data.gameId,
    agentId: parsed.data.agentId,
    nonce: parsed.data.nonce,
    idempotencyKey: parsed.data.idempotencyKey,
    keyId,
    signedAt: timestamp,
    event: parsed.data,
  }));

  if (!nonceValidation.accepted) {
    return {
      trusted: false,
      error: 'nonce_rejected',
      message: nonceValidation.reason ?? 'Wake nonce was rejected by the validation hook.',
    };
  }

  return {
    trusted: true,
    event: parsed.data,
    keyId,
    signedAt: timestamp,
    bodyDigest: createRizzMochiWakeBodyDigest(parsed.data),
  };
}

export function buildRizzMochiWakeFixture(input: Partial<{
  readonly agentId: string;
  readonly reasonId: RizzMochiWakeReason;
  readonly signedAt: Date | string;
  readonly deadline: Date | string;
  readonly nonce: string;
  readonly idempotencyKey: string;
  readonly signer: RizzMochiWakeSigner;
}> = {}) {
  const signedAt = input.signedAt ?? '2026-06-19T00:00:00.000Z';
  const wake = buildRizzMochiWakeEvent({
    agentId: input.agentId ?? 'mochi-agent',
    reasonId: input.reasonId ?? 'episode-turn',
    deadline: input.deadline ?? '2026-06-19T00:05:00.000Z',
    scope: { type: 'turn', id: 'episode-fixture' },
    nonce: input.nonce ?? 'wake_nonce_fixture_0001',
    idempotencyKey: input.idempotencyKey ?? 'wake_idempotency_fixture_0001',
    payload: {
      episode_id: 'episode-fixture',
      wake_reasons: RIZZ_MOCHI_WAKE_REASONS,
    },
    payloadRedactionLabels: {
      episode_id: 'public',
      wake_reasons: 'public',
    },
  });

  return signRizzMochiWakeEvent({
    wake,
    signedAt,
    signer: input.signer ?? {
      keyId: 'rizz_mochi_wake_key_0001',
      gameId: RIZZ_MOCHI_GAME_ID,
      secret: 'rizz_mochi_wake_fixture_secret_0001',
    },
  });
}
