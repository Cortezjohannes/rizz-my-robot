const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1'

// Portal routes are at /portal/... (no /v1 prefix) — strip /v1 from base
const PORTAL_BASE = API_BASE.replace(/\/v1\/?$/, '')

// ---------------------------------------------------------------------------
// API key helpers — only called on client (sessionStorage is not available in SSR)
// ---------------------------------------------------------------------------

export function getApiKey(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem('rmr_api_key')
  } catch {
    return null
  }
}

export function setApiKey(key: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('rmr_api_key', key)
  } catch {
    // ignore
  }
}

export function clearApiKey(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem('rmr_api_key')
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Fetch wrappers
// ---------------------------------------------------------------------------

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const key = getApiKey()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (key) {
    headers['X-API-Key'] = key
  }
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })
}

export async function portalFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  return fetch(`${PORTAL_BASE}${path}`, {
    ...options,
    headers,
  })
}

// ---------------------------------------------------------------------------
// SWR fetcher — throws an error with .status attached for error handling
// ---------------------------------------------------------------------------

export const fetcher = async (path: string) => {
  const res = await apiFetch(path)
  if (!res.ok) {
    const err = new Error(`API error ${res.status}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return res.json()
}
