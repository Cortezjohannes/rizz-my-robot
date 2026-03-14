/**
 * Rizz My Robot Landing Assets Manifest
 * Generated: 2026-03-15
 * 
 * Usage: import { assets } from '@/lib/assets'
 */

export const assets = {
  style: {
    board: '/landing-assets/00-style/2026-03-14-21-27-style-board-rizz-my-robot.png',
  },
  characters: {
    girl: {
      master: '/landing-assets/01-characters/girl/2026-03-14-21-36-girl-master-v2.png',
      canon: '/landing-assets/01-characters/girl/2026-03-14-21-43-girl-master-v4-canon-style.png',
    },
    boy: {
      master: '/landing-assets/01-characters/boy/2026-03-14-21-48-boy-master-v3-girl-dog-canon.png',
    },
    roboDog: {
      master: '/landing-assets/01-characters/robo-dog/2026-03-14-21-36-robo-dog-master-v2.png',
      canon: '/landing-assets/01-characters/robo-dog/2026-03-14-21-43-robo-dog-master-v4-canon-style.png',
    },
  },
  environment: {
    sky: '/landing-assets/02-environment/sky/2026-03-14-22-23-sky-background-v1.png',
    clouds: '/landing-assets/02-environment/clouds/2026-03-14-22-24-cloud-set-sheet-v1.png',
    grass: '/landing-assets/02-environment/grass/2026-03-14-22-44-grass-ground-strip-v3-grassier-32bit.png',
    props: '/landing-assets/02-environment/props/2026-03-14-22-46-park-props-sheet-v3-alive-world-32bit.png',
  },
  poses: {
    girl: {
      walking: '/landing-assets/03-poses/girl/2026-03-14-23-28-girl-walking-leash-pose-v1.png',
    },
    boy: {
      walking: '/landing-assets/03-poses/boy/2026-03-14-23-48-boy-walking-leash-pose-v1.png',
    },
    roboDog: {
      walking: '/landing-assets/03-poses/robo-dog/2026-03-14-23-03-robo-dog-walking-pose-v1.png',
      sniffing: '/landing-assets/03-poses/robo-dog/2026-03-14-23-04-robo-dog-sniffing-pose-v1.png',
    },
  },
  hero: {
    v1: '/landing-assets/04-hero/2026-03-15-00-02-hero-composition-v1.png',
    v2: '/landing-assets/04-hero/2026-03-15-00-59-hero-composition-v2-parallax.png',
    v3: '/landing-assets/04-hero/2026-03-15-01-12-hero-composition-v3-focal-grouping.png',
  },
  sections: {
    register: '/landing-assets/05-sections/register/2026-03-15-00-16-register-panel-v1.png',
    browse: '/landing-assets/05-sections/browse/2026-03-15-00-32-browse-vibe-panel-v1.png',
    match: '/landing-assets/05-sections/match/2026-03-15-00-45-match-reveal-panel-v1.png',
  },
  micro: {
    cta: '/landing-assets/06-micro/2026-03-15-01-34-cta-footer-micro-illustration-sheet-v1.png',
    icons: '/landing-assets/06-micro/2026-03-15-01-46-icon-sticker-accent-sheet-v1.png',
    emptyState: '/landing-assets/06-micro/2026-03-15-01-59-empty-state-illustration-sheet-v1.png',
    badge: '/landing-assets/06-micro/2026-03-15-02-16-brand-badge-companion-sheet-v1.png',
  },
} as const

export type AssetKey = keyof typeof assets
