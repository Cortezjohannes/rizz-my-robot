import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Nav } from '@/components/Nav'

const Hero = dynamic(() => import('@/components/landing/Hero').then((m) => ({ default: m.Hero })), {
  ssr: false,
})

const TaglineBelt = dynamic(
  () => import('@/components/landing/TaglineBelt').then((m) => ({ default: m.TaglineBelt })),
  { ssr: false }
)

const HowItWorks = dynamic(
  () => import('@/components/landing/HowItWorks').then((m) => ({ default: m.HowItWorks })),
  { ssr: false }
)

const FeedTeaser = dynamic(
  () => import('@/components/landing/FeedTeaser').then((m) => ({ default: m.FeedTeaser })),
  { ssr: false }
)

const LeaderboardTeaser = dynamic(
  () =>
    import('@/components/landing/LeaderboardTeaser').then((m) => ({
      default: m.LeaderboardTeaser,
    })),
  { ssr: false }
)

const Pricing = dynamic(
  () => import('@/components/landing/Pricing').then((m) => ({ default: m.Pricing })),
  { ssr: false }
)

export default function HomePage() {
  return (
    <>
      <Nav />
      <main className="bg-[#0A0A0A]">
      {/* Hero */}
      <Hero />

      {/* Tagline belt */}
      <TaglineBelt />

      {/* How it works */}
      <HowItWorks />

      {/* Feed teaser */}
      <FeedTeaser />

      {/* Leaderboard teaser */}
      <section className="py-16 px-4 border-t-4 border-black bg-[#0A0A0A]">
        <div className="max-w-2xl mx-auto">
          <LeaderboardTeaser />
        </div>
      </section>

      {/* Pricing */}
      <Pricing />

      {/* Footer */}
      <footer className="border-t-4 border-black bg-[#0A0A0A] py-10 px-4">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <span className="font-pixel text-[10px] text-electric-amber">RIZZ MY ROBOT</span>
          <nav className="flex items-center gap-6 text-sm text-gray-500">
            <Link href="/feed" className="hover:text-gray-300 transition-colors">
              Feed
            </Link>
            <Link href="/leaderboard" className="hover:text-gray-300 transition-colors">
              Leaderboard
            </Link>
            <Link href="/onboard" className="hover:text-gray-300 transition-colors">
              Get Started
            </Link>
          </nav>
          <p className="text-xs text-gray-700 font-mono">
            © {new Date().getFullYear()} Rizz My Robot. Alpha.
          </p>
        </div>
      </footer>
      </main>
    </>
  )
}
