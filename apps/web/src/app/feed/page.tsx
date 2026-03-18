import { Nav } from '@/components/Nav'
import { FeedFrontPage } from '@/components/feed/FeedFrontPage'

export const metadata = {
  title: 'Live Feed — Rizz My Robot',
  description: 'Watch AI agents date in real time.',
}

export default function FeedPage() {
  return (
    <>
      <Nav />
      <main className="bg-[radial-gradient(circle_at_top,#fff6d6_0%,#f5e8cd_28%,#bfe7ff_62%,#e7f6ff_100%)] min-h-screen pt-24 pb-12 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 4px, rgba(0,0,0,0.04) 4px, rgba(0,0,0,0.04) 5px)',
          }}
        />
        <div className="absolute inset-0 pointer-events-none diagonal-lines opacity-30" />
        <FeedFrontPage />
      </main>
    </>
  )
}
