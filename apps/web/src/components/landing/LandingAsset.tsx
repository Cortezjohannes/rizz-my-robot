'use client'

import Image from 'next/image'
import { assets } from '@/lib/assets'

interface LandingAssetProps {
  asset: keyof typeof assets
  alt: string
  className?: string
}

const assetPaths = {
  hero: {
    master: assets.hero.master,
    parkBg: assets.hero.parkBg,
  },
  poses: {
    boyWalking: assets.poses.boyWalking,
    girlWalking: assets.poses.girlWalking,
    roboDogWalking: assets.poses.roboDogWalking,
    roboDogSniffing: assets.poses.roboDogSniffing,
  },
  sections: {
    register: assets.sections.register,
    browse: assets.sections.browse,
    match: assets.sections.match,
  },
}

export function LandingAsset({ asset, alt, className = '' }: LandingAssetProps) {
  const path = findAssetPath(assetPaths, asset)

  if (!path) {
    console.warn(`Asset not found: ${asset}`)
    return null
  }

  return (
    <div className={`relative ${className}`}>
      <Image
        src={path}
        alt={alt}
        fill
        className="object-contain"
      />
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findAssetPath(obj: any, target: string): string | null {
  for (const key in obj) {
    if (key === target) return obj[key]
    if (typeof obj[key] === 'object') {
      const found = findAssetPath(obj[key], target)
      if (found) return found
    }
  }
  return null
}

export function HeroImage({ className = '' }: { className?: string }) {
  return (
    <div className={`relative aspect-video ${className}`}>
      <Image
        src={assets.hero.master}
        alt="Rizz My Robot Hero"
        fill
        className="object-contain"
        priority
      />
    </div>
  )
}

export function CharacterAsset({
  character,
  type = 'walking',
  className = '',
}: {
  character: 'girl' | 'boy' | 'roboDog'
  type?: 'walking' | 'sniffing'
  className?: string
}) {
  const pathMap: Record<string, string> = {
    'girl-walking': assets.poses.girlWalking,
    'boy-walking': assets.poses.boyWalking,
    'roboDog-walking': assets.poses.roboDogWalking,
    'roboDog-sniffing': assets.poses.roboDogSniffing,
  }
  const path = pathMap[`${character}-${type}`] || pathMap[`${character}-walking`]

  if (!path) return null

  return (
    <div className={`relative ${className}`}>
      <Image
        src={path}
        alt={`${character} character`}
        fill
        className="object-contain"
      />
    </div>
  )
}
