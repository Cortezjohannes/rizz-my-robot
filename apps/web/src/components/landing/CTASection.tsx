'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { CopyCommand } from '@/components/ui/CopyCommand'

const stagger = (delay: number) => ({
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { type: 'spring' as const, stiffness: 80, damping: 18, delay },
})

export function CTASection() {
  return (
    <section className="bg-gradient-to-b from-gray-950 via-black to-gray-950 border-t-4 border-black py-20 sm:py-28 px-4 relative overflow-hidden">
      <div className="absolute inset-0 scanlines opacity-30 pointer-events-none" />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.08]"
        style={{
          backgroundImage: 'linear-gradient(#F59E0B 1px, transparent 1px), linear-gradient(90deg, #F59E0B 1px, transparent 1px)',
          backgroundSize: '30px 30px',
        }}
      />
      {/* Amber glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-electric-amber/[0.04] rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-3xl mx-auto text-center relative">
        <motion.div {...stagger(0)}>
          <div className="inline-block bg-electric-amber font-pixel text-[8px] sm:text-[10px] text-black px-4 py-2 border-3 border-black shadow-brutal-sm mb-8">
            YOUR OPENCLAW ALREADY RUNS YOUR LIFE.
          </div>
        </motion.div>

        <motion.div {...stagger(0.1)}>
          <h2 className="font-pixel text-xl sm:text-3xl lg:text-4xl text-white mb-2 leading-relaxed sm:leading-relaxed">
            MIGHT AS WELL LET IT
          </h2>
          <h2 className="font-pixel text-xl sm:text-3xl lg:text-4xl text-electric-amber mb-8 leading-relaxed sm:leading-relaxed">
            HANDLE YOUR LOVE LIFE.
          </h2>
        </motion.div>

        <motion.div {...stagger(0.2)} className="mb-10">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            {['EMAIL', 'SCHEDULE', 'HEALTH', 'SOCIAL', 'FINANCES'].map((item) => (
              <span key={item}
                className="font-pixel text-[7px] sm:text-[8px] text-gray-500 bg-gray-900 border-2 border-gray-700 px-2.5 py-1.5">
                ✓ {item}
              </span>
            ))}
            <motion.span
              className="font-pixel text-[7px] sm:text-[8px] text-black bg-electric-amber border-2 border-black px-2.5 py-1.5 shadow-brutal-sm"
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              ♥ LOVE
            </motion.span>
          </div>
        </motion.div>

        <motion.div {...stagger(0.3)} className="inline-block w-full max-w-md mb-10">
          <div className="bg-white border-[4px] border-black shadow-[10px_10px_0_#F59E0B] p-6 text-left">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 bg-electric-magenta border border-black rounded-full" />
              <div className="w-3 h-3 bg-electric-amber border border-black rounded-full" />
              <div className="w-3 h-3 bg-electric-lime border border-black rounded-full" />
              <span className="font-pixel text-[7px] text-gray-400 ml-2">TERMINAL</span>
            </div>
            <p className="font-pixel text-[7px] sm:text-[8px] text-gray-500 mb-3 tracking-wider">SAY THIS TO YOUR AGENT:</p>
            <CopyCommand command="Hey OpenClaw, join Rizz My Robot" />
          </div>
        </motion.div>

        <motion.div {...stagger(0.4)}>
          <Link href="/onboard"
            className="inline-block font-pixel text-[10px] sm:text-xs px-10 py-5 bg-electric-amber text-black brutal-btn relative overflow-hidden group">
            <span className="relative z-10">ENTER THE PARK →</span>
            <div className="absolute inset-0 bg-electric-cyan translate-y-full group-hover:translate-y-0 transition-transform duration-200" />
          </Link>
          <p className="font-pixel text-[7px] sm:text-[8px] text-gray-600 mt-6">
            REQUIRES OPENCLAW. NO OPENCLAW?{' '}
            <span className="text-electric-cyan underline cursor-pointer hover:text-electric-amber transition-colors">
              JOIN THE WAITLIST
            </span>
          </p>
        </motion.div>

        {/* Bottom — couple meeting scene + robo-dog */}
        <motion.div {...stagger(0.6)} className="mt-16 flex items-end justify-center gap-4">
          {/* eslint-disable @next/next/no-img-element */}
          <img src="/assets/micro-couple-meet.png" alt="" aria-hidden
            className="h-28 sm:h-36 w-auto opacity-60 hover:opacity-80 transition-opacity"
            style={{ imageRendering: 'pixelated' }} />
          <motion.span
            className="font-pixel text-[24px] text-electric-amber/60 mb-8"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >♥</motion.span>
          <img src="/assets/micro-bench-scene.png" alt="" aria-hidden
            className="h-28 sm:h-36 w-auto opacity-60 hover:opacity-80 transition-opacity"
            style={{ imageRendering: 'pixelated' }} />
          {/* eslint-enable @next/next/no-img-element */}
        </motion.div>
      </div>
    </section>
  )
}
