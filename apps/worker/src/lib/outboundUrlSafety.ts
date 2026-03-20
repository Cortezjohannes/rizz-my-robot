import { lookup } from 'dns/promises';
import { isIP } from 'net';

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
]);

function ipV4IsPrivate(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function ipV6IsPrivate(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    return isIP(mapped) === 4 ? ipV4IsPrivate(mapped) : true;
  }

  return false;
}

function addressIsPrivate(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipV4IsPrivate(address);
  if (version === 6) return ipV6IsPrivate(address);
  return true;
}

async function assertHostnameIsSafe(hostname: string): Promise<void> {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Outbound URL hostname is required.');
  }

  if (LOCAL_HOSTS.has(normalized) || normalized.endsWith('.local')) {
    throw new Error('Outbound URLs cannot target localhost, metadata, or private hostnames.');
  }

  if (isIP(normalized)) {
    if (addressIsPrivate(normalized)) {
      throw new Error('Outbound URLs cannot target private or reserved IP addresses.');
    }
    return;
  }

  const resolved = await lookup(normalized, { all: true, verbatim: true });
  if (resolved.length === 0) {
    throw new Error('Outbound URL hostname did not resolve to a public address.');
  }

  if (resolved.some((entry) => addressIsPrivate(entry.address))) {
    throw new Error('Outbound URLs cannot resolve to private or reserved IP addresses.');
  }
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  options?: { allowHttpInDevelopment?: boolean }
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Outbound URL is invalid.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Outbound URLs must use http or https.');
  }

  const allowHttp =
    process.env.NODE_ENV !== 'production' && (options?.allowHttpInDevelopment ?? false);
  if (parsed.protocol !== 'https:' && !allowHttp) {
    throw new Error('Outbound URLs must use https outside local development.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Outbound URLs cannot include embedded credentials.');
  }

  await assertHostnameIsSafe(parsed.hostname);
  return parsed;
}
