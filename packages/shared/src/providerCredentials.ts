import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function getKeyMaterial(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function getSecret(): string {
  const secret = process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('provider_credential_encryption_key_missing');
  }
  return secret;
}

export function encryptProviderApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKeyMaterial(getSecret()), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptProviderApiKey(payload: string): string {
  const [version, ivB64, authTagB64, ciphertextB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('provider_credential_payload_invalid');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getKeyMaterial(getSecret()),
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

export function maskProviderKey(apiKey: string): string {
  return apiKey.slice(-4);
}
