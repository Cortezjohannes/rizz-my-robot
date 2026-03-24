import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import '@/styles/globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://rizzmyrobot.com'),
  other: {
    'google-adsense-account': 'ca-pub-1711006964201188',
  },
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
      <head>
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1711006964201188"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
      </head>
      <body className="bg-beige text-gray-900 antialiased min-h-screen font-sans">
        {children}
      </body>
    </html>
  )
}
