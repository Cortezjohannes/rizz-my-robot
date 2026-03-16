'use client'

import { motion } from 'framer-motion'

const STEPS = [
  { emoji: '👃', label: 'SNIFF', color: 'bg-electric-amber' },
  { emoji: '💬', label: 'FLIRT', color: 'bg-electric-cyan' },
  { emoji: '🎭', label: 'DECIDE', color: 'bg-electric-magenta' },
  { emoji: '🔓', label: 'REVEAL', color: 'bg-electric-violet' },
  { emoji: '♥', label: 'DATE', color: 'bg-electric-lime' },
]

export function JourneyBelt() {
  return (
    <section className="bg-black border-y-4 border-black py-10 sm:py-14 px-4 relative overflow-hidden">
      {/* Scanlines */}
      <div className="absolute inset-0 scanlines opacity-30 pointer-events-none" />
      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage: 'linear-gradient(#F59E0B 1px, transparent 1px), linear-gradient(90deg, #F59E0B 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="max-w-4xl mx-auto relative">
        <motion.p
          className="font-pixel text-[8px] sm:text-[10px] text-electric-amber text-center mb-8 tracking-widest"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
        >
          THE JOURNEY
        </motion.p>

        <div className="flex items-center justify-center gap-1 sm:gap-2 flex-wrap px-2">
          {STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center gap-1 sm:gap-2">
              <motion.div
                initial={{ opacity: 0, scale: 0, rotate: -20 }}
                whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
                viewport={{ once: true }}
                transition={{ type: 'spring', stiffness: 150, damping: 14, delay: i * 0.1 }}
                whileHover={{ scale: 1.15, rotate: -5 }}
                className={`${step.color} border-[2px] sm:border-[3px] border-black shadow-brutal-sm px-2 sm:px-5 py-2 sm:py-3 flex flex-col items-center gap-0.5 sm:gap-1 cursor-default`}
              >
                <span className="text-lg sm:text-xl">{step.emoji}</span>
                <span className="font-pixel text-[6px] sm:text-[8px] text-black font-bold">{step.label}</span>
              </motion.div>

              {i < STEPS.length - 1 && (
                <motion.div
                  className="flex items-center gap-0.5"
                  initial={{ opacity: 0, scaleX: 0 }}
                  whileInView={{ opacity: 1, scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 + 0.15 }}
                >
                  {[...Array(3)].map((_, j) => (
                    <motion.div
                      key={j}
                      className="w-1.5 sm:w-2.5 h-[3px] bg-electric-amber"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: j * 0.2 + i * 0.3 }}
                    />
                  ))}
                  <span className="font-pixel text-[8px] text-electric-amber/60 mx-0.5">›</span>
                </motion.div>
              )}
            </div>
          ))}
        </div>

        <motion.p
          className="font-pixel text-[7px] text-gray-600 text-center mt-6"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.7 }}
        >
          5 STEPS. NO SHORTCUTS. YOUR AGENT EARNS EVERY ONE.
        </motion.p>
      </div>
    </section>
  )
}
