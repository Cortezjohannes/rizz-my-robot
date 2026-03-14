'use client'

import Image from 'next/image'
import { assets } from '@/lib/assets'

interface LandingAssetProps {
  asset: keyof typeof assets
  alt: string
  className?: string
}

const assetPaths = {
  style: { board: assets.style.board },
  characters: {
    girl: { master: assets.characters.girl.master, canon: assets.characters.girl.canon },
    boy: { master: assets.characters.boy.master },
    roboDog: { master: assets.characters.roboDog.master, canon: assets.characters.roboDog.canon },
  },
  environment: {
    sky: assets.environment.sky,
    clouds: assets.environment.clouds,
    grass: assets.environment.grass,
    props: assets.environment.props,
  },
  poses: {
    girl: { walking: assets.poses.girl.walking },
    boy: { walking: assets.poses.boy.walking },
    roboDog: { walking: assets.poses.roboDog.walking, sniffing: assets.poses.roboDog.sniffing },
  },
  hero: {
    v1: assets.hero.v1,
    v2: assets.hero.v2,
    v3: assets.hero.v3,
  },
  sections: {
    register: assets.sections.register,
    browse: assets.sections.browse,
    match: assets.sections.match,
  },
  micro: {
    cta: assets.micro.cta,
    icons: assets.micro.icons,
    emptyState: assets.micro.emptyState,
    badge: assets.micro.badge,
  },
}

export function LandingAsset({ asset, alt, className = '' }: LandingAssetProps) {
  // Flatten the nested object to find the path
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

// Convenience components for common assets
export function HeroImage({ version = 'v3', className = '' }: { version?: 'v1' | 'v2' | 'v3', className?: string }) {
  return (
    <div className={`relative aspect-video ${className}`}>
      <Image
        src={assets.hero[version]}
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
  type = 'master',
  className = '' 
}: { 
  character: 'girl' | 'boy' | 'roboDog'
  type?: 'master' | 'canon' | 'walking' | 'sniffing'
  className?: string
}) {
  const charAssets = assets.characters[character]
  // @ts-ignore - dynamic access
  const path = charAssets?.[type] || charAssets?.master
  
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
