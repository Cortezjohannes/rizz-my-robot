import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const WEBHOOK_SECRET_VERSION = 'rmrwhsec:v1';

function deriveWebhookSecretKey(masterKey: string) {
  return createHash('sha256').update(masterKey).digest();
}

export function sealWebhookSecret(secret: string, masterKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveWebhookSecretKey(masterKey), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${WEBHOOK_SECRET_VERSION}:${iv.toString('base64url')}.${authTag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function unsealWebhookSecret(sealedSecret: string, masterKey: string): string | null {
  if (!sealedSecret.startsWith(`${WEBHOOK_SECRET_VERSION}:`)) {
    return null;
  }

  const encoded = sealedSecret.slice(WEBHOOK_SECRET_VERSION.length + 1);
  const [ivPart, authTagPart, ciphertextPart] = encoded.split('.');
  if (!ivPart || !authTagPart || !ciphertextPart) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveWebhookSecretKey(masterKey),
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

export function isSealedWebhookSecret(secret: string): boolean {
  return secret.startsWith(`${WEBHOOK_SECRET_VERSION}:`);
}
