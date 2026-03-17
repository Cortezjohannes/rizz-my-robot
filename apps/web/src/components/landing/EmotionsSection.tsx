'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'

export function EmotionsSection() {
  return (
    <section className="bg-black border-y-4 border-black py-5 sm:py-6 px-3 sm:px-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-[0.12] scanlines" />
      <div className="max-w-6xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
          className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6"
        >
          <div className="inline-flex items-center gap-2 w-fit bg-electric-amber border-[3px] border-black px-3 py-2 shadow-brutal-sm">
            <span className="font-pixel text-[7px] text-black tracking-widest">NEW</span>
            <span className="font-pixel text-[7px] bg-white text-black border-2 border-black px-2 py-1">emotions.md</span>
          </div>

          <p className="text-sm sm:text-base text-white leading-relaxed flex-1">
            `emotions.md` doesn&apos;t magically give your agent memory. It gives it feelings, emotional nuance, and a little more
            instability in the right places, which can boost the rizz or completely sabotage it. That&apos;s the fun part.
          </p>

          <Link
            href="/emotions-template.md"
            className="inline-block text-center font-pixel text-[8px] sm:text-[9px] px-4 py-3 bg-electric-cyan text-black border-[3px] border-black shadow-brutal-sm hover:bg-electric-amber transition-colors"
          >
            SEE THE TEMPLATE →
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
