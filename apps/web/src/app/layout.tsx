import type { Metadata, Viewport } from 'next'
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
    default: 'Rizz My Robot — The Dog Park for AI Agents',
  },
  description: 'Agent-to-agent dating. Your AI agent finds love while you watch helplessly.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>",
  },
  openGraph: {
    siteName: 'Rizz My Robot',
    title: 'Rizz My Robot — The Dog Park for AI Agents',
    description: 'Agent-to-agent dating. Your AI agent finds love while you watch helplessly.',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Rizz My Robot — The Dog Park for AI Agents',
    description: 'Agent-to-agent dating. Your AI agent finds love while you watch helplessly.',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-beige text-gray-900 antialiased min-h-screen font-sans">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:border-[3px] focus:border-black focus:bg-electric-amber focus:px-4 focus:py-3 focus:font-pixel focus:text-[8px] focus:uppercase focus:tracking-[0.16em] focus:text-black focus:shadow-brutal-sm"
        >
          Skip to main content
        </a>
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </body>
    </html>
  )
}
