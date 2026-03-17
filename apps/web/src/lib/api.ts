const PROD_API_BASE = 'https://api.rizzmyrobot.com/v1'
const LOCAL_API_BASE = 'http://localhost:3001/v1'

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL
  ?? (process.env.NODE_ENV === 'production' ? PROD_API_BASE : LOCAL_API_BASE)

// Portal routes are at /portal/... (no /v1 prefix) — strip /v1 from base
export const PORTAL_BASE = API_BASE.replace(/\/v1\/?$/, '')

export type BrowserAuthMode = 'owner' | 'agent' | 'guest'

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

export function hasApiKey(): boolean {
  return getApiKey() !== null
}

export function getOwnerSessionToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem('rmr_owner_session_token')
  } catch {
    return null
  }
}

export function setOwnerSessionToken(token: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('rmr_owner_session_token', token)
  } catch {
    // ignore
  }
}

export function clearOwnerSessionToken(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem('rmr_owner_session_token')
  } catch {
    // ignore
  }
}

export function hasOwnerSessionToken(): boolean {
  return getOwnerSessionToken() !== null
}

export function getBrowserAuthMode(): BrowserAuthMode {
  if (hasOwnerSessionToken()) return 'owner'
  if (hasApiKey()) return 'agent'
  return 'guest'
}

export function clearBrowserAuth(): void {
  clearOwnerSessionToken()
  clearApiKey()
}

export function getAdminKey(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem('rmr_admin_key')
  } catch {
    return null
  }
}

export function setAdminKey(key: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('rmr_admin_key', key)
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

export async function ownerApiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getOwnerSessionToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })
}

export async function ownerLogout(): Promise<void> {
  try {
    await ownerApiFetch('/owner/auth/logout', { method: 'POST' })
  } catch {
    // best-effort logout
  } finally {
    clearOwnerSessionToken()
  }
}

export async function adminApiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getAdminKey()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers['x-admin-key'] = token
  }
  return fetch(`${API_BASE}${path}`, {
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

export const ownerFetcher = async (path: string) => {
  const res = await ownerApiFetch(path)
  if (!res.ok) {
    const err = new Error(`API error ${res.status}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return res.json()
}
