'use client'

import { getApiKey, setApiKey, clearApiKey } from './api'

export { getApiKey, setApiKey, clearApiKey }

export function isAuthenticated(): boolean {
  return getApiKey() !== null
}
