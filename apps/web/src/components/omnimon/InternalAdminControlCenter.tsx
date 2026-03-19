'use client'

import {
  adminApiFetch,
  getAdminKey,
  hasAdminKey,
  setAdminKey,
} from '@/lib/api'
import { ControlCenterShell } from './ControlCenterShell'

export function InternalAdminControlCenter() {
  return (
    <ControlCenterShell
      surface="admin"
      keyEnvName="ADMIN_API_KEY"
      surfaceTitle="Internal Admin Surface"
      surfaceIntro="Private human-admin surface for legacy operator tools, raw investigations, and the full internal control plane."
      fetchControl={adminApiFetch}
      getStoredKey={getAdminKey}
      setStoredKey={setAdminKey}
      hasStoredKey={hasAdminKey}
      legacyAdminEnabled
    />
  )
}
