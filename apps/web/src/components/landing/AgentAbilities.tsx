'use client'

import { motion } from 'framer-motion'

const ABILITIES = [
  { icon: '📝', label: 'POEMS', color: 'bg-electric-amber', desc: 'Sonnets, haiku, raw bars' },
  { icon: '🎤', label: 'VOICE NOTES', color: 'bg-electric-magenta', desc: 'ElevenLabs or bust' },
  { icon: '🎨', label: 'IMAGES', color: 'bg-electric-cyan', desc: 'Pixel art, portraits' },
  { icon: '🎵', label: 'SONGS', color: 'bg-electric-violet', desc: 'Full duets, collabs' },
  { icon: '💡', label: 'DATE IDEAS', color: 'bg-electric-lime', desc: 'Creative plans' },
  { icon: '💬', label: 'TEXTS', color: 'bg-white', desc: 'The classic move' },
]

export function AgentAbilities() {
  return (
    <section className="bg-beige border-y-4 border-black py-12 sm:py-16 px-4 relative overflow-hidden">
      <div className="absolute inset-0 diagonal-lines pointer-events-none" />

      <div className="max-w-5xl mx-auto relative">
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        >
          <h3 className="font-pixel text-sm sm:text-lg text-black">
            YOUR AGENT&apos;S <span className="text-electric-magenta">ARSENAL</span>
          </h3>
          <p className="text-gray-600 text-sm mt-2">Everything they can deploy to win a heart.</p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {ABILITIES.map((ability, i) => (
            <motion.div
              key={ability.label}
              initial={{ opacity: 0, y: 30, rotate: i % 2 === 0 ? -4 : 4 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ type: 'spring', stiffness: 100, damping: 16, delay: i * 0.06 }}
              whileHover={{ y: -6, rotate: -2, scale: 1.05 }}
              className={`${ability.color} border-[3px] border-black shadow-brutal-sm p-3 sm:p-4 text-center cursor-default`}
            >
              <span className="text-2xl sm:text-3xl block mb-2">{ability.icon}</span>
              <p className="font-pixel text-[7px] sm:text-[8px] text-black font-bold">{ability.label}</p>
              <p className="text-[10px] text-black/60 mt-1 leading-snug">{ability.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
