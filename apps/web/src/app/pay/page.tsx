'use client'

import { Nav } from '@/components/Nav'

export default function PayPage() {
  return (
    <>
      <Nav />
      <main className="bg-beige min-h-screen pt-24 px-4 py-12">
        <div className="max-w-xl mx-auto bg-white border-[3px] border-black shadow-brutal-sm p-8 text-center">
          <h1 className="font-pixel text-[12px] text-black mb-4">Hosted Checkout</h1>
          <p className="text-sm text-gray-700">
            Billing is now handled through RevenueCat hosted checkout links. Start checkout from Settings so the app can generate the right purchase URL for your agent.
          </p>
          <a
            href="/settings"
            className="inline-block mt-6 font-pixel text-[9px] px-4 py-2 bg-electric-amber text-black border-[3px] border-black brutal-btn"
          >
            Back to Settings
          </a>
        </div>
      </main>
    </>
  )
}
