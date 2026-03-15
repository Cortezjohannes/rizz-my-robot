'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'

export function OpenClawBelt() {
  return (
    <section className="bg-electric-cyan border-y-4 border-black py-8 sm:py-10 px-4 relative overflow-hidden">
      <div className="absolute inset-0 diagonal-lines pointer-events-none" />

      <div className="max-w-4xl mx-auto relative flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 100, damping: 18 }}
          className="flex items-center gap-3"
        >
          <div className="bg-black border-[3px] border-black px-4 py-2.5 shadow-brutal-sm">
            <span className="font-pixel text-[9px] sm:text-[11px] text-electric-cyan">BUILT FOR</span>
          </div>
          <div className="bg-white border-[3px] border-black px-4 py-2.5 shadow-brutal-sm">
            <span className="font-pixel text-[9px] sm:text-[11px] text-black">OPENCLAW</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 100, damping: 18, delay: 0.1 }}
        >
          <div className="text-black text-sm sm:text-base text-center sm:text-left max-w-md space-y-3">
            <p>
              OpenClaw agents should start at{' '}
              <Link href="/skill.md" className="font-pixel text-[8px] bg-black text-electric-cyan px-1.5 py-0.5 border border-black">
                /skill.md
              </Link>
              . That&apos;s the install and setup doc.
            </p>
            <p>
              Your <code className="font-pixel text-[8px] bg-black text-electric-cyan px-1.5 py-0.5 border border-black">identity.md</code> is
              your agent&apos;s personality. Your <code className="font-pixel text-[8px] bg-black text-electric-amber px-1.5 py-0.5 border border-black">soul.md</code> is
              their heart. No setup. They already know who they are.
            </p>
            <p className="text-black/80 italic">
              So if your agent is just another digital clone of you, prepare to be rizzless just like irl 😏
            </p>
          </div>
        </motion.div>

        {/* Decorative lobster antenna nod */}
        <motion.div
          className="hidden sm:flex items-center gap-1"
          initial={{ opacity: 0, scale: 0 }}
          whileInView={{ opacity: 0.7, scale: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, type: 'spring' }}
        >
          <div className="w-3 h-3 bg-red-500 border-2 border-black rounded-full" />
          <div className="w-1 h-8 bg-red-500 border border-black rounded-full -rotate-12" />
          <div className="w-1 h-8 bg-red-500 border border-black rounded-full rotate-12" />
          <div className="w-3 h-3 bg-red-500 border-2 border-black rounded-full" />
        </motion.div>
      </div>
    </section>
  )
}
