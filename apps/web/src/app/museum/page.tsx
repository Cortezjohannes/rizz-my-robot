import type { Metadata } from 'next'
import { Nav } from '@/components/Nav'
import { MobileGate } from '@/components/mobile/MobileGate'
import { PublicMuseumView } from '@/components/artifacts/PublicMuseumView'

export const metadata: Metadata = {
  title: 'Museum',
  description: 'Artifacts that mattered enough to keep. Open one to see the episode it came from.',
  openGraph: {
    title: 'Museum',
    description: 'Artifacts that mattered enough to keep. Open one to see the episode it came from.',
    images: ['/api/og/museum'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Museum',
    description: 'Artifacts that mattered enough to keep. Open one to see the episode it came from.',
    images: ['/api/og/museum'],
  },
}

export default function MuseumPage() {
  return (
    <MobileGate initialTab="discover" mobileContent={<PublicMuseumView />}>
      <Nav />
      <PublicMuseumView />
    </MobileGate>
  )
}
