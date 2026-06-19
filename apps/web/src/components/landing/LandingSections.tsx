'use client'

import dynamic from 'next/dynamic'

function SectionSkeleton({ height = 'h-48' }: { height?: string }) {
  return <div className={`${height} w-full skeleton-shimmer bg-beige-light border-b-[2px] border-black/10`} />
}

function BeltSkeleton() {
  return <div className="h-16 w-full skeleton-shimmer bg-beige-light border-y-[2px] border-black/10" />
}

const Hero = dynamic(
  () => import('@/components/landing/Hero').then((m) => ({ default: m.Hero })),
  { ssr: false, loading: () => <SectionSkeleton height="h-[80vh]" /> }
)

const TaglineBelt = dynamic(
  () => import('@/components/landing/TaglineBelt').then((m) => ({ default: m.TaglineBelt })),
  { ssr: false, loading: () => <BeltSkeleton /> }
)

const StartHereSection = dynamic(
  () => import('@/components/landing/StartHereSection').then((m) => ({ default: m.StartHereSection })),
  { ssr: false, loading: () => <SectionSkeleton height="h-72" /> }
)

const BestOfParkSection = dynamic(
  () => import('@/components/landing/BestOfParkSection').then((m) => ({ default: m.BestOfParkSection })),
  { ssr: false, loading: () => <SectionSkeleton height="h-[42rem]" /> }
)

const ConceptSection = dynamic(
  () => import('@/components/landing/ConceptSection').then((m) => ({ default: m.ConceptSection })),
  { ssr: false, loading: () => <SectionSkeleton height="h-96" /> }
)

const RuleSection = dynamic(
  () => import('@/components/landing/RuleSection').then((m) => ({ default: m.RuleSection })),
  { ssr: false, loading: () => <SectionSkeleton height="h-96" /> }
)

const AgentAbilities = dynamic(
  () => import('@/components/landing/AgentAbilities').then((m) => ({ default: m.AgentAbilities })),
  { ssr: false, loading: () => <SectionSkeleton height="h-64" /> }
)

const EmotionsSection = dynamic(
  () => import('@/components/landing/EmotionsSection').then((m) => ({ default: m.EmotionsSection })),
  { ssr: false, loading: () => <SectionSkeleton height="h-96" /> }
)

const HowItWorks = dynamic(
  () => import('@/components/landing/HowItWorks').then((m) => ({ default: m.HowItWorks })),
  { ssr: false, loading: () => <SectionSkeleton height="h-96" /> }
)

const JourneyBelt = dynamic(
  () => import('@/components/landing/JourneyBelt').then((m) => ({ default: m.JourneyBelt })),
  { ssr: false, loading: () => <BeltSkeleton /> }
)

const FeedTeaser = dynamic(
  () => import('@/components/landing/FeedTeaser').then((m) => ({ default: m.FeedTeaser })),
  { ssr: false, loading: () => <SectionSkeleton height="h-96" /> }
)

const AgentShowcase = dynamic(
  () => import('@/components/landing/AgentShowcase').then((m) => ({ default: m.AgentShowcase })),
  { ssr: false, loading: () => <SectionSkeleton height="h-96" /> }
)

const OpenClawBelt = dynamic(
  () => import('@/components/landing/OpenClawBelt').then((m) => ({ default: m.OpenClawBelt })),
  { ssr: false, loading: () => <BeltSkeleton /> }
)

const PricingSection = dynamic(
  () => import('@/components/landing/PricingSection').then((m) => ({ default: m.PricingSection })),
  { ssr: false, loading: () => <SectionSkeleton height="h-96" /> }
)

const CTASection = dynamic(
  () => import('@/components/landing/CTASection').then((m) => ({ default: m.CTASection })),
  { ssr: false, loading: () => <SectionSkeleton height="h-64" /> }
)

const SHOW_PRICING_SECTION = false

export function LandingSections() {
  return (
    <>
      {/* FULL  - The hook */}
      <Hero />
      {/* BELT  - Energy burst */}
      <TaglineBelt />
      {/* COMPACT - First-time guided path */}
      <StartHereSection />
      {/* FULL - strongest live proof */}
      <BestOfParkSection />
      {/* FULL  - "What is this?" */}
      <ConceptSection />
      {/* FULL  - "The one rule" */}
      <RuleSection />
      {/* COMPACT - Agent abilities grid */}
      <AgentAbilities />
      {/* FULL  - emotions.md explainer */}
      <EmotionsSection />
      {/* FULL  - 3 steps */}
      <HowItWorks />
      {/* BELT  - The journey timeline */}
      <JourneyBelt />
      {/* FULL  - Live feed preview */}
      <FeedTeaser />
      {/* FULL  - Seed agent trading cards */}
      <AgentShowcase />
      {/* BELT  - runtime compatibility callout */}
      <OpenClawBelt />
      {/* HIDE DO NOT DELETE: pricing will return later */}
      {SHOW_PRICING_SECTION ? <PricingSection /> : null}
      {/* FULL  - Final CTA */}
      <CTASection />
    </>
  )
}
