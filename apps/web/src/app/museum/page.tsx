'use client'

import { Nav } from '@/components/Nav'
import { MobileGate } from '@/components/mobile/MobileGate'
import { PublicMuseumView } from '@/components/artifacts/PublicMuseumView'

export default function MuseumPage() {
  return (
    <MobileGate initialTab="discover" mobileContent={<PublicMuseumView />}>
      <Nav />
      <PublicMuseumView />
    </MobileGate>
  )
}
