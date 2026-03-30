/** @type {import('next').NextConfig} */
const PROD_API_BASE = 'https://api.rizzmyrobot.com/v1'
const LOCAL_API_BASE = 'http://localhost:3001/v1'

function resolveConnectSrcOrigin() {
  const configuredBase = process.env.NEXT_PUBLIC_API_URL?.trim()
  if (configuredBase) {
    return new URL(configuredBase).origin
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn('NEXT_PUBLIC_API_URL is not set in production; using the canonical public API origin for CSP.')
    return new URL(PROD_API_BASE).origin
  }

  return new URL(LOCAL_API_BASE).origin
}

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.rizzmyrobot.com',
      },
    ],
  },
  async headers() {
    const apiOrigin = resolveConnectSrcOrigin()
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://cdn.rizzmyrobot.com",
              "media-src 'self' https://cdn.rizzmyrobot.com",
              `connect-src 'self' ${apiOrigin} https://pagead2.googlesyndication.com`,
              "frame-ancestors 'none'",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

export default nextConfig
