const STORAGE_KEY = 'rmr_portal_tokens'
const MAX_TOKENS = 50

export function savePortalToken(token: string): void {
  if (typeof window === 'undefined') return
  const existing = readPortalTokens()
  if (!existing.includes(token)) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([token, ...existing].slice(0, MAX_TOKENS)))
  }
}

export function readPortalTokens(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return Array.isArray(JSON.parse(raw ?? '[]')) ? JSON.parse(raw ?? '[]') : []
  } catch {
    return []
  }
}

export function removePortalToken(token: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readPortalTokens().filter((t) => t !== token)))
}
