const AES_GCM_IV_BYTES = 12
const AES_GCM_AUTH_TAG_BYTES = 16
const SESSION_KEY_BYTES = 32
const HKDF_INFO = encodeUtf8('rmr-reveal-chat-session-key')

interface SessionKeyEnvelope {
  v: 1
  epk: string
  salt: string
  iv: string
  tag: string
  ct: string
}

export interface EncryptedMessage {
  ciphertext: string
  iv: string
  authTag: string
}

export async function encryptMessage(
  plaintext: string,
  sessionKey: CryptoKey,
): Promise<EncryptedMessage> {
  const subtle = getSubtleCrypto()
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))
  const encoded = encodeUtf8(plaintext)
  const encrypted = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: AES_GCM_AUTH_TAG_BYTES * 8 },
    sessionKey,
    toArrayBuffer(encoded),
  ))
  const ciphertext = encrypted.slice(0, encrypted.length - AES_GCM_AUTH_TAG_BYTES)
  const authTag = encrypted.slice(encrypted.length - AES_GCM_AUTH_TAG_BYTES)

  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    authTag: bytesToBase64(authTag),
  }
}

export async function decryptMessage(
  msg: EncryptedMessage,
  sessionKey: CryptoKey,
): Promise<string> {
  const subtle = getSubtleCrypto()
  const iv = base64ToBytes(msg.iv)
  const ciphertext = base64ToBytes(msg.ciphertext)
  const authTag = base64ToBytes(msg.authTag)

  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error('Reveal chat IV must be 12 bytes.')
  }

  if (authTag.byteLength !== AES_GCM_AUTH_TAG_BYTES) {
    throw new Error('Reveal chat auth tag must be 16 bytes.')
  }

  const payload = concatBytes(ciphertext, authTag)
  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: AES_GCM_AUTH_TAG_BYTES * 8 },
    sessionKey,
    toArrayBuffer(payload),
  )

  return decodeUtf8(new Uint8Array(decrypted))
}

export async function generateECDHKeyPair(): Promise<{
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyPEM: string
}> {
  const subtle = getSubtleCrypto()
  const keyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits', 'deriveKey'],
  ) as CryptoKeyPair

  const publicKeyDer = new Uint8Array(await subtle.exportKey('spki', keyPair.publicKey))

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyPEM: derToPem(publicKeyDer, 'PUBLIC KEY'),
  }
}

export async function deriveSessionKey(
  serverEncryptedSessionKey: string,
  privateKey: CryptoKey,
): Promise<CryptoKey> {
  const subtle = getSubtleCrypto()
  const envelope = decodeSessionKeyEnvelope(serverEncryptedSessionKey)
  const ephemeralPublicKey = await subtle.importKey(
    'spki',
    toArrayBuffer(pemToDer(envelope.epk)),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const sharedSecret = await subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPublicKey },
    privateKey,
    256,
  )
  const wrappingKey = await deriveAesKeyFromSecret(sharedSecret, base64ToBytes(envelope.salt))
  const rawSessionKey = await decryptBytes(
    {
      ciphertext: envelope.ct,
      iv: envelope.iv,
      authTag: envelope.tag,
    },
    wrappingKey,
  )

  if (rawSessionKey.byteLength !== SESSION_KEY_BYTES) {
    throw new Error('Reveal chat session key must be 32 bytes.')
  }

  return subtle.importKey(
    'raw',
    toArrayBuffer(rawSessionKey),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function deriveAesKeyFromSecret(secret: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtleCrypto()
  const hkdfKey = await subtle.importKey(
    'raw',
    secret,
    'HKDF',
    false,
    ['deriveKey'],
  )

  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(HKDF_INFO),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function decryptBytes(msg: EncryptedMessage, key: CryptoKey): Promise<Uint8Array> {
  const subtle = getSubtleCrypto()
  const iv = base64ToBytes(msg.iv)
  const ciphertext = base64ToBytes(msg.ciphertext)
  const authTag = base64ToBytes(msg.authTag)
  const payload = concatBytes(ciphertext, authTag)
  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: AES_GCM_AUTH_TAG_BYTES * 8 },
    key,
    toArrayBuffer(payload),
  )

  return new Uint8Array(decrypted)
}

function decodeSessionKeyEnvelope(payload: string): SessionKeyEnvelope {
  const raw = decodeUtf8(base64ToBytes(payload))
  const parsed = JSON.parse(raw) as Partial<SessionKeyEnvelope>

  if (
    parsed.v !== 1
    || typeof parsed.epk !== 'string'
    || typeof parsed.salt !== 'string'
    || typeof parsed.iv !== 'string'
    || typeof parsed.tag !== 'string'
    || typeof parsed.ct !== 'string'
  ) {
    throw new Error('Invalid reveal chat session key envelope.')
  }

  return {
    v: 1,
    epk: parsed.epk,
    salt: parsed.salt,
    iv: parsed.iv,
    tag: parsed.tag,
    ct: parsed.ct,
  }
}

function derToPem(bytes: Uint8Array, label: string): string {
  const base64 = bytesToBase64(bytes)
  const wrapped = base64.match(/.{1,64}/g)?.join('\n') ?? base64
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`
}

function pemToDer(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  return base64ToBytes(base64)
}

function getSubtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this browser.')
  }

  return globalThis.crypto.subtle
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.byteLength + right.byteLength)
  merged.set(left, 0)
  merged.set(right, left.byteLength)
  return merged
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}
