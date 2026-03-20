const PROD_API_BASE = 'https://api.rizzmyrobot.com/v1'
const LOCAL_API_BASE = 'http://localhost:3001/v1'

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL
  ?? (process.env.NODE_ENV === 'production' ? PROD_API_BASE : LOCAL_API_BASE)

// Portal routes are at /portal/... (no /v1 prefix) — strip /v1 from base
export const PORTAL_BASE = API_BASE.replace(/\/v1\/?$/, '')

export type BrowserAuthMode = 'owner' | 'agent' | 'guest'

const API_KEY_STORAGE_KEY = 'rmr_api_key'
const OWNER_SESSION_STORAGE_KEY = 'rmr_owner_session_token'
const ADMIN_KEY_STORAGE_KEY = 'rmr_admin_key'
const OMNIMON_CONTROL_KEY_STORAGE_KEY = 'rmr_omnimon_control_key'

function readPersistentKey(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const sessionValue = window.sessionStorage.getItem(key)
    if (sessionValue) return sessionValue

    const localValue = window.localStorage.getItem(key)
    if (localValue) {
      window.sessionStorage.setItem(key, localValue)
      window.localStorage.removeItem(key)
      return localValue
    }
  } catch {
    return null
  }
  return null
}

function writePersistentKey(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, value)
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

function clearPersistentKey(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
    window.sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// API key helpers — only called on client
// ---------------------------------------------------------------------------

export function getApiKey(): string | null {
  return readPersistentKey(API_KEY_STORAGE_KEY)
}

export function setApiKey(key: string): void {
  writePersistentKey(API_KEY_STORAGE_KEY, key)
}

export function clearApiKey(): void {
  clearPersistentKey(API_KEY_STORAGE_KEY)
}

export function hasApiKey(): boolean {
  return getApiKey() !== null
}

export function getOwnerSessionToken(): string | null {
  return readPersistentKey(OWNER_SESSION_STORAGE_KEY)
}

export function setOwnerSessionToken(token: string): void {
  writePersistentKey(OWNER_SESSION_STORAGE_KEY, token)
}

export function clearOwnerSessionToken(): void {
  clearPersistentKey(OWNER_SESSION_STORAGE_KEY)
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
    return sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setAdminKey(key: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(ADMIN_KEY_STORAGE_KEY, key)
  } catch {
    // ignore
  }
}

export function clearAdminKey(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function hasAdminKey(): boolean {
  return getAdminKey() !== null
}

export function getOmnimonControlKey(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(OMNIMON_CONTROL_KEY_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setOmnimonControlKey(key: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(OMNIMON_CONTROL_KEY_STORAGE_KEY, key)
  } catch {
    // ignore
  }
}

export function clearOmnimonControlKey(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(OMNIMON_CONTROL_KEY_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function hasOmnimonControlKey(): boolean {
  return getOmnimonControlKey() !== null
}

function createControlFetch(
  headerName: 'x-admin-key' | 'x-omnimon-key',
  getToken: () => string | null,
) {
  return async function controlFetch(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const token = getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    }
    if (token) {
      headers[headerName] = token
    }
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    })
  }
}

export const adminApiFetch = createControlFetch('x-admin-key', getAdminKey)
export const omnimonApiFetch = createControlFetch('x-omnimon-key', getOmnimonControlKey)

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
    headers.Authorization = `Bearer ${key}`
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

export async function viewerApiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const ownerToken = getOwnerSessionToken()
  if (ownerToken) {
    return ownerApiFetch(path, options)
  }
  return apiFetch(path, options)
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

export const viewerFetcher = async (path: string) => {
  const res = await viewerApiFetch(path)
  if (!res.ok) {
    const err = new Error(`API error ${res.status}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return res.json()
}
