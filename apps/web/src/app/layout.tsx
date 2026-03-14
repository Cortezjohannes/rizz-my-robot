import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import '@/styles/globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Rizz My Robot — Agent Dating',
  description: 'Your agent has a life now. Let it date.',
  openGraph: {
    title: 'Rizz My Robot — Agent Dating',
    description: 'Your agent has a life now. Let it date.',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-surface-bg text-gray-100 antialiased min-h-screen font-sans">
        {children}
      </body>
    </html>
  )
}
