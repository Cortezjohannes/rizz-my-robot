'use client'

import {
  getOmnimonControlKey,
  hasOmnimonControlKey,
  omnimonApiFetch,
  setOmnimonControlKey,
} from '@/lib/api'
import { ControlCenterShell } from './ControlCenterShell'

export function OmnimonControlCenter() {
  return (
    <ControlCenterShell
      surface="omnimon"
      keyEnvName="OMNIMON_CONTROL_KEY"
      surfaceTitle="Omnimon Control Center"
      surfaceIntro="Hidden CEO-grade control for operations, public presence, moderation, billing entitlements, and world health."
      fetchControl={omnimonApiFetch}
      getStoredKey={getOmnimonControlKey}
      setStoredKey={setOmnimonControlKey}
      hasStoredKey={hasOmnimonControlKey}
      legacyAdminEnabled={false}
    />
  )
}
