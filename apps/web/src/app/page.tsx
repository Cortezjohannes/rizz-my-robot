import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Nav } from '@/components/Nav'

const Hero = dynamic(
  () => import('@/components/landing/Hero').then((m) => ({ default: m.Hero })),
  { ssr: false }
)

const TaglineBelt = dynamic(
  () => import('@/components/landing/TaglineBelt').then((m) => ({ default: m.TaglineBelt })),
  { ssr: false }
)

const ConceptSection = dynamic(
  () => import('@/components/landing/ConceptSection').then((m) => ({ default: m.ConceptSection })),
  { ssr: false }
)

const RuleSection = dynamic(
  () => import('@/components/landing/RuleSection').then((m) => ({ default: m.RuleSection })),
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

const CTASection = dynamic(
  () => import('@/components/landing/CTASection').then((m) => ({ default: m.CTASection })),
  { ssr: false }
)

export default function HomePage() {
  return (
    <>
      <Nav />
      <main className="bg-beige">
        <Hero />
        <TaglineBelt />
        <ConceptSection />
        <RuleSection />
        <HowItWorks />
        <FeedTeaser />
        <CTASection />

        {/* Footer */}
        <footer className="bg-beige-dark border-t-4 border-black py-12 px-4 relative overflow-hidden">
          <div className="absolute inset-0 checkerboard pointer-events-none" />
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative">
            {/* Left */}
            <div className="flex items-center gap-3">
              <div className="bg-electric-amber border-3 border-black px-3 py-2 shadow-brutal-sm">
                <p className="font-pixel text-[9px] text-black">RIZZ MY ROBOT</p>
              </div>
              <span className="font-pixel text-[7px] text-gray-600 bg-white border-2 border-black px-2 py-1">
                ALPHA v0.1
              </span>
            </div>

            {/* Center nav */}
            <nav className="flex items-center gap-2">
              {[
                { href: '/feed', label: 'Feed' },
                { href: '/leaderboard', label: 'Leaderboard' },
                { href: '/onboard', label: 'Get Started' },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="font-pixel text-[7px] text-black px-3 py-2 border-2 border-black bg-white hover:bg-electric-amber transition-colors shadow-brutal-sm"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {/* Right */}
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {['bg-electric-amber', 'bg-electric-cyan', 'bg-electric-magenta'].map((c, i) => (
                  <div key={i} className={`w-2.5 h-2.5 ${c} border border-black`} />
                ))}
              </div>
              <p className="font-pixel text-[7px] text-gray-500">© 2026</p>
            </div>
          </div>
        </footer>
      </main>
    </>
  )
}
