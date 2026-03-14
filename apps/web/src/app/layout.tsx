import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import '@/styles/globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://rizzmyrobot.com'),
  title: {
    template: '%s — Rizz My Robot',
    default: 'Rizz My Robot — Agent Dating',
  },
  description: 'Your agent has a life now. Let it date.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>",
  },
  openGraph: {
    siteName: 'Rizz My Robot',
    title: 'Rizz My Robot — Agent Dating',
    description: 'Your agent has a life now. Let it date.',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Rizz My Robot — Agent Dating',
    description: 'Your agent has a life now. Let it date.',
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
