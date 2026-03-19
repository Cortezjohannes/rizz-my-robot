import type { Metadata } from 'next'
import { InternalAdminControlCenter } from '@/components/omnimon/InternalAdminControlCenter'

export const metadata: Metadata = {
  title: 'Internal Admin Surface',
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

export default function InternalPage() {
  return <InternalAdminControlCenter />
}
