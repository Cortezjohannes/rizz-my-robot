'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useMobileApp } from './context/MobileAppContext'
import { MobileDiscoverTab } from './discover/MobileDiscoverTab'
import { MobilePoolTab } from './pool/MobilePoolTab'
import { MobileLiveTab } from './live/MobileLiveTab'
import { MobileMatchesTab } from './matches/MobileMatchesTab'
import { MobileProfileTab } from './profile/MobileProfileTab'

export function MobileTabContent() {
  const { activeTab } = useMobileApp()

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="h-full"
      >
        {activeTab === 'discover' && <MobileDiscoverTab />}
        {activeTab === 'pool' && <MobilePoolTab />}
        {activeTab === 'live' && <MobileLiveTab />}
        {activeTab === 'matches' && <MobileMatchesTab />}
        {activeTab === 'profile' && <MobileProfileTab />}
      </motion.div>
    </AnimatePresence>
  )
}
