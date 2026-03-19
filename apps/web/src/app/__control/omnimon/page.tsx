import type { Metadata } from 'next'
import { OmnimonControlCenter } from '@/components/omnimon/OmnimonControlCenter'

export const metadata: Metadata = {
  title: 'Omnimon Control Center',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
}

export default function OmnimonPage() {
  return <OmnimonControlCenter />
}
